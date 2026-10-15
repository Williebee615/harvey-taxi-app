// payment_refunds ledger: idempotent retries, partial refunds, the
// refundable ceiling, concurrent requests, forward-only results, server-only.

const { describeDb, createTestDatabase, waitForLockWaiters } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("payment refunds ledger", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  const reserve = async (client, { pi = "pi_test_1", amount, key, captured = 2500, stripeRefunded = 0 }) =>
    (
      await client.query("select public.reserve_payment_refund($1, $2, 'usd', 'fare_adjustment', $3, 'owner@harvey.example', $4, $5) as r", [
        pi,
        amount,
        key,
        captured,
        stripeRefunded
      ])
    ).rows[0].r;
  const result = async (id, status, refundId = null, code = null) =>
    (await q("select (public.record_payment_refund_result($1, $2, $3, $4)).*", [id, status, refundId, code]))[0];

  test("a retry with the same key returns the original row, never a second refund", async () => {
    const first = await reserve(admin, { amount: 500, key: "retry-key-0001" });
    expect(first.outcome).toBe("reserved");
    const again = await reserve(admin, { amount: 500, key: "retry-key-0001" });
    expect(again.outcome).toBe("replayed");
    expect(again.refund.id).toBe(first.refund.id);
    const [{ n }] = await q("select count(*)::int as n from public.payment_refunds where idempotency_key = 'retry-key-0001'");
    expect(n).toBe(1);
  });

  test("the same key with a different amount or intent is refused", async () => {
    expect((await reserve(admin, { amount: 501, key: "retry-key-0001" })).outcome).toBe("idempotency_mismatch");
    expect((await reserve(admin, { pi: "pi_test_other", amount: 500, key: "retry-key-0001" })).outcome).toBe("idempotency_mismatch");
  });

  test("partial refunds add up to the captured amount and no further", async () => {
    // 500 already reserved above; captured 2500.
    expect((await reserve(admin, { amount: 1500, key: "partial-0002" })).outcome).toBe("reserved");
    expect((await reserve(admin, { amount: 500, key: "partial-0003" })).outcome).toBe("reserved");
    const over = await reserve(admin, { amount: 1, key: "partial-0004" });
    expect(over).toMatchObject({ outcome: "exceeds_refundable", captured_cents: 2500, already_refunded_cents: 2500 });
  });

  test("a failed refund frees its amount; Stripe's own refunded total also counts", async () => {
    const pi = "pi_test_2";
    const a = await reserve(admin, { pi, amount: 1000, key: "free-0001", captured: 1000 });
    expect((await reserve(admin, { pi, amount: 1, key: "free-0002", captured: 1000 })).outcome).toBe("exceeds_refundable");
    await result(a.refund.id, "failed", null, "stripe_refused");
    expect((await reserve(admin, { pi, amount: 1000, key: "free-0003", captured: 1000 })).outcome).toBe("reserved");
    // A refund made outside the ledger (e.g. in the Stripe dashboard).
    expect((await reserve(admin, { pi: "pi_test_3", amount: 600, key: "outside-0001", captured: 1000, stripeRefunded: 500 })).outcome).toBe("exceeds_refundable");
  });

  test("concurrent requests for the same intent never exceed the captured amount", async () => {
    const pi = "pi_test_race";
    const gate = await db.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtextextended('payment_refunds:' || $1, 0))", [pi]);
    const contenders = await Promise.all(Array.from({ length: 6 }, () => db.connect()));
    // Six requests of 400 against 1000 captured: at most two can fit.
    const pending = contenders.map((c, i) => reserve(c, { pi, amount: 400, key: `race-key-000${i}`, captured: 1000 }));
    await waitForLockWaiters(admin, 6);
    await gate.query("commit");
    const outcomes = (await Promise.all(pending)).map((r) => r.outcome);
    expect(outcomes.filter((o) => o === "reserved")).toHaveLength(2);
    expect(outcomes.filter((o) => o === "exceeds_refundable")).toHaveLength(4);
    const [{ total }] = await q("select sum(amount_cents)::int as total from public.payment_refunds where payment_intent_id = $1", [pi]);
    expect(total).toBe(800);
  });

  test("concurrent retries with one key create one row", async () => {
    const contenders = await Promise.all(Array.from({ length: 4 }, () => db.connect()));
    const outcomes = (await Promise.all(contenders.map((c) => reserve(c, { pi: "pi_test_dupe", amount: 300, key: "same-key-dupe" })))).map((r) => r.outcome);
    expect(outcomes.filter((o) => o === "reserved")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "replayed")).toHaveLength(3);
  });

  test("results only move forward; a final row never changes", async () => {
    const r = (await reserve(admin, { pi: "pi_test_4", amount: 100, key: "forward-0001" })).refund;
    expect((await result(r.id, "submitted", "re_test_1")).status).toBe("submitted");
    expect((await result(r.id, "succeeded", "re_test_1")).status).toBe("succeeded");
    expect((await result(r.id, "failed", null, "late")).status).toBe("succeeded");
    expect((await result(r.id, "pending")).status).toBe("succeeded");
    // A submitted or succeeded row must name its Stripe refund.
    const r2 = (await reserve(admin, { pi: "pi_test_5", amount: 100, key: "forward-0002" })).refund;
    await expect(result(r2.id, "succeeded", null)).rejects.toThrow(/check/);
  });

  test("server-only", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.payment_refunds'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.payment_refunds', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.payment_refunds', 'insert') as auth_insert,
      has_function_privilege('anon', 'public.reserve_payment_refund(text, integer, text, text, text, text, integer, integer)', 'execute') as anon_exec,
      has_function_privilege('authenticated', 'public.record_payment_refund_result(uuid, text, text, text)', 'execute') as auth_exec`);
    expect(g).toEqual({ anon_select: false, auth_insert: false, anon_exec: false, auth_exec: false });
  });
});
