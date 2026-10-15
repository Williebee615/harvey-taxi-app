const { requestRefund, REFUND_ERROR, ledgerStatusFor, stripeIdempotencyKey } = require("./refunds");

const TEST_KEY = "sk_test_" + "x".repeat(10);
const LIVE_KEY = "sk_live_" + "x".repeat(10);

// In-memory stand-in for the two ledger functions (the real ones are
// covered against Postgres in test/db/paymentRefunds.db.test.js).
function fakeLedger() {
  const rows = new Map();
  let seq = 0;
  async function rpc(name, a) {
    if (name === "reserve_payment_refund") {
      const existing = [...rows.values()].find((r) => r.idempotency_key === a.p_idempotency_key);
      if (existing) {
        if (existing.payment_intent_id !== a.p_payment_intent_id || existing.amount_cents !== a.p_amount_cents) return { outcome: "idempotency_mismatch" };
        return { outcome: "replayed", refund: { ...existing } };
      }
      const reserved = [...rows.values()].filter((r) => r.payment_intent_id === a.p_payment_intent_id && r.status !== "failed").reduce((n, r) => n + r.amount_cents, 0);
      const already = Math.max(reserved, a.p_stripe_refunded_cents || 0);
      if (already + a.p_amount_cents > a.p_captured_cents) return { outcome: "exceeds_refundable", captured_cents: a.p_captured_cents, already_refunded_cents: already };
      const row = { id: `ledger-${++seq}`, payment_intent_id: a.p_payment_intent_id, amount_cents: a.p_amount_cents, idempotency_key: a.p_idempotency_key, status: "pending", stripe_refund_id: null };
      rows.set(row.id, row);
      return { outcome: "reserved", refund: { ...row } };
    }
    if (name === "record_payment_refund_result") {
      const row = rows.get(a.p_id);
      if (row.status === "pending" || row.status === "submitted") Object.assign(row, { status: a.p_status, stripe_refund_id: a.p_stripe_refund_id || row.stripe_refund_id, error_code: a.p_error_code });
      return { ...row };
    }
    throw new Error("unknown rpc");
  }
  return { rpc, rows };
}

function fakeStripe({ intent = {}, createImpl } = {}) {
  const calls = { create: [], retrieve: 0 };
  const byKey = new Map();
  let n = 0;
  return {
    calls,
    paymentIntents: {
      retrieve: async (id) => {
        calls.retrieve += 1;
        return { id, status: "succeeded", amount_received: 2500, currency: "usd", livemode: false, metadata: { app: "harvey_taxi" }, latest_charge: { amount_refunded: 0 }, ...intent };
      }
    },
    refunds: {
      create: async (params, opts) => {
        calls.create.push({ params, opts });
        if (createImpl) return createImpl(params, opts, calls.create.length);
        if (!byKey.has(opts.idempotencyKey)) byKey.set(opts.idempotencyKey, { id: `re_${++n}`, status: "succeeded", amount: params.amount });
        return byKey.get(opts.idempotencyKey);
      },
      retrieve: async (id) => ({ id, status: "succeeded" })
    }
  };
}

const base = { paymentIntentId: "pi_123", amountCents: 1000, reasonCode: "fare_adjustment", idempotencyKey: "req-0001-abc", requestedBy: "owner@harvey.example" };

describe("requestRefund", () => {
  test("refuses a live-mode key before touching Stripe or the ledger", async () => {
    const stripe = fakeStripe();
    const ledger = fakeLedger();
    expect(await requestRefund({ stripe, secretKey: LIVE_KEY, rpc: ledger.rpc, ...base })).toEqual({ ok: false, error: REFUND_ERROR.LIVE_MODE_REFUSED });
    expect(stripe.calls.retrieve).toBe(0);
    expect(ledger.rows.size).toBe(0);
  });

  test("refuses a live-mode PaymentIntent even with a test key", async () => {
    const stripe = fakeStripe({ intent: { livemode: true } });
    const ledger = fakeLedger();
    expect((await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base })).error).toBe(REFUND_ERROR.LIVE_MODE_REFUSED);
    expect(stripe.calls.create).toHaveLength(0);
  });

  test("refuses other apps' payments, uncaptured payments and bad input", async () => {
    const ledger = fakeLedger();
    expect((await requestRefund({ stripe: fakeStripe({ intent: { metadata: { app: "x" } } }), secretKey: TEST_KEY, rpc: ledger.rpc, ...base })).error).toBe(REFUND_ERROR.NOT_HARVEY_INTENT);
    expect((await requestRefund({ stripe: fakeStripe({ intent: { status: "requires_capture" } }), secretKey: TEST_KEY, rpc: ledger.rpc, ...base })).error).toBe(REFUND_ERROR.NOT_CAPTURED);
    expect((await requestRefund({ stripe: fakeStripe(), secretKey: TEST_KEY, rpc: ledger.rpc, ...base, amountCents: 0 })).field).toBe("amount_cents");
    expect((await requestRefund({ stripe: fakeStripe(), secretKey: TEST_KEY, rpc: ledger.rpc, ...base, reasonCode: "because" })).field).toBe("reason_code");
    expect(ledger.rows.size).toBe(0);
  });

  test("a partial refund succeeds with a Stripe idempotency key tied to the ledger row", async () => {
    const stripe = fakeStripe();
    const ledger = fakeLedger();
    const r = await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    expect(r).toMatchObject({ ok: true, replayed: false, refund: { status: "succeeded", stripe_refund_id: "re_1", amount_cents: 1000 } });
    expect(stripe.calls.create[0].opts.idempotencyKey).toBe(stripeIdempotencyKey(r.refund.id));
    expect(stripe.calls.create[0].params).toMatchObject({ payment_intent: "pi_123", amount: 1000 });
  });

  test("a retry after success returns the same refund without calling Stripe again", async () => {
    const stripe = fakeStripe();
    const ledger = fakeLedger();
    await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    const again = await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    expect(again).toMatchObject({ ok: true, replayed: true, refund: { stripe_refund_id: "re_1" } });
    expect(stripe.calls.create).toHaveLength(1);
  });

  test("an ambiguous Stripe failure stays pending; the retry resumes with the same Stripe key", async () => {
    const ledger = fakeLedger();
    const stripe = fakeStripe({
      createImpl: (params, opts, attempt) => {
        if (attempt === 1) throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
        return { id: "re_after_retry", status: "succeeded", amount: params.amount };
      }
    });
    const first = await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    expect(first).toMatchObject({ ok: false, error: "stripe_outcome_unknown", retryable: true, refund: { status: "pending" } });
    const second = await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    expect(second).toMatchObject({ ok: true, replayed: true, refund: { status: "succeeded", stripe_refund_id: "re_after_retry" } });
    expect(stripe.calls.create[0].opts.idempotencyKey).toBe(stripe.calls.create[1].opts.idempotencyKey);
    expect(ledger.rows.size).toBe(1);
  });

  test("a definite Stripe refusal marks the row failed and frees the amount", async () => {
    const ledger = fakeLedger();
    const refusing = fakeStripe({ createImpl: () => { throw Object.assign(new Error("Refund amount exceeds"), { type: "StripeInvalidRequestError", statusCode: 400, code: "amount_too_large" }); } });
    const r = await requestRefund({ stripe: refusing, secretKey: TEST_KEY, rpc: ledger.rpc, ...base, amountCents: 2500 });
    expect(r).toMatchObject({ ok: false, error: "stripe_refused", refund: { status: "failed", error_code: "amount_too_large" } });
    const ok = await requestRefund({ stripe: fakeStripe(), secretKey: TEST_KEY, rpc: ledger.rpc, ...base, idempotencyKey: "req-0002-abc", amountCents: 2500 });
    expect(ok.ok).toBe(true);
  });

  test("partial refunds cannot exceed the captured amount, counting Stripe's refunded total", async () => {
    const ledger = fakeLedger();
    const stripe = fakeStripe();
    expect((await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base, idempotencyKey: "p-0001-abc", amountCents: 1500 })).ok).toBe(true);
    const over = await requestRefund({ stripe, secretKey: TEST_KEY, rpc: ledger.rpc, ...base, idempotencyKey: "p-0002-abc", amountCents: 1001 });
    expect(over).toMatchObject({ ok: false, error: REFUND_ERROR.EXCEEDS_REFUNDABLE, captured_cents: 2500, already_refunded_cents: 1500 });
    const outside = fakeStripe({ intent: { latest_charge: { amount_refunded: 2000 } } });
    expect((await requestRefund({ stripe: outside, secretKey: TEST_KEY, rpc: fakeLedger().rpc, ...base, amountCents: 600 })).error).toBe(REFUND_ERROR.EXCEEDS_REFUNDABLE);
  });

  test("reusing a key for a different amount is refused", async () => {
    const ledger = fakeLedger();
    await requestRefund({ stripe: fakeStripe(), secretKey: TEST_KEY, rpc: ledger.rpc, ...base });
    expect((await requestRefund({ stripe: fakeStripe(), secretKey: TEST_KEY, rpc: ledger.rpc, ...base, amountCents: 999 })).error).toBe(REFUND_ERROR.IDEMPOTENCY_MISMATCH);
  });

  test("Stripe refund status maps to ledger status", () => {
    expect(ledgerStatusFor("succeeded")).toBe("succeeded");
    expect(ledgerStatusFor("pending")).toBe("submitted");
    expect(ledgerStatusFor("requires_action")).toBe("submitted");
    expect(ledgerStatusFor("failed")).toBe("failed");
    expect(ledgerStatusFor("canceled")).toBe("failed");
  });
});
