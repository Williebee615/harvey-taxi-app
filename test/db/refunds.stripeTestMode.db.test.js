// Refunds end to end against Stripe TEST mode and a real Postgres ledger.
// Opt-in only (HARVEY_STRIPE_TEST_REFUNDS=1); never runs in CI and refuses
// anything but a test-mode key. Creates synthetic, captured test-mode
// PaymentIntents tagged synthetic="true" (excluded from reconciliation)
// with Stripe's test card; no real card or person is involved.

const { describeDb, createTestDatabase } = require("./pgHarness");
const { requestRefund } = require("../../lib/refunds");
const { buildIntentMetadata } = require("../../lib/unusedHolds");

jest.setTimeout(120_000);

const enabled = process.env.HARVEY_STRIPE_TEST_REFUNDS === "1";
const KEY = process.env.HARVEY_STRIPE_TEST_KEY || "sk_test_proxy_injected";
const d = enabled ? describeDb : describe.skip;

d("refunds in Stripe test mode", () => {
  let db;
  let admin;
  let stripe;
  const rpc = async (name, args) => {
    if (name === "reserve_payment_refund") {
      const c = await db.connect();
      try {
        return (await c.query("select public.reserve_payment_refund($1,$2,$3,$4,$5,$6,$7,$8) as r", [args.p_payment_intent_id, args.p_amount_cents, args.p_currency, args.p_reason_code, args.p_idempotency_key, args.p_requested_by, args.p_captured_cents, args.p_stripe_refunded_cents])).rows[0].r;
      } finally {
        await c.end();
      }
    }
    return (await admin.query("select to_jsonb(public.record_payment_refund_result($1,$2,$3,$4)) as r", [args.p_id, args.p_status, args.p_stripe_refund_id, args.p_error_code])).rows[0].r;
  };

  const capturedIntent = async (amount) =>
    stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "SMOKE TEST refund test (synthetic)",
      metadata: { ...buildIntentMetadata({ rideType: "standard", riderId: "", riderVerified: false }), synthetic: "true", test_run: "refund-tests" }
    });

  const run = (args) => requestRefund({ stripe, secretKey: KEY, rpc, reasonCode: "fare_adjustment", requestedBy: "refund-test@example.test", ...args });

  beforeAll(async () => {
    const Stripe = require("stripe");
    stripe = Stripe(KEY, { httpClient: Stripe.createFetchHttpClient() });
    db = await createTestDatabase();
    admin = await db.connect();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("partial refunds, a retry, and the ceiling", async () => {
    const pi = await capturedIntent(2500);
    expect(pi.status).toBe("succeeded");
    expect(pi.livemode).toBe(false);
    const tag = pi.id.slice(-8);

    const a = await run({ paymentIntentId: pi.id, amountCents: 1000, idempotencyKey: `a-${tag}` });
    expect(a).toMatchObject({ ok: true, refund: { status: "succeeded" } });
    const retry = await run({ paymentIntentId: pi.id, amountCents: 1000, idempotencyKey: `a-${tag}` });
    expect(retry).toMatchObject({ ok: true, replayed: true, refund: { stripe_refund_id: a.refund.stripe_refund_id } });

    const b = await run({ paymentIntentId: pi.id, amountCents: 1500, idempotencyKey: `b-${tag}` });
    expect(b.ok).toBe(true);
    const over = await run({ paymentIntentId: pi.id, amountCents: 1, idempotencyKey: `c-${tag}` });
    expect(over).toMatchObject({ ok: false, error: "exceeds_refundable" });

    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 10 });
    expect(refunds.data.map((r) => r.amount).sort((x, y) => x - y)).toEqual([1000, 1500]);
  });

  test("a lost response: Stripe's idempotency key returns the same refund on retry", async () => {
    const pi = await capturedIntent(1200);
    const tag = pi.id.slice(-8);
    // Simulate a crash after Stripe accepted the refund but before the
    // ledger recorded it: the first create succeeds at Stripe, then throws.
    const realCreate = stripe.refunds.create.bind(stripe.refunds);
    let first = true;
    stripe.refunds.create = async (params, opts) => {
      const res = await realCreate(params, opts);
      if (first) {
        first = false;
        throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
      }
      return res;
    };
    try {
      const lost = await run({ paymentIntentId: pi.id, amountCents: 700, idempotencyKey: `lost-${tag}` });
      expect(lost).toMatchObject({ ok: false, error: "stripe_outcome_unknown", refund: { status: "pending" } });
      const resumed = await run({ paymentIntentId: pi.id, amountCents: 700, idempotencyKey: `lost-${tag}` });
      expect(resumed).toMatchObject({ ok: true, refund: { status: "succeeded" } });
    } finally {
      stripe.refunds.create = realCreate;
    }
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 10 });
    expect(refunds.data).toHaveLength(1);
    expect(refunds.data[0].amount).toBe(700);
  });

  test("concurrent requests: only what fits is refunded", async () => {
    const pi = await capturedIntent(1000);
    const tag = pi.id.slice(-8);
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) => run({ paymentIntentId: pi.id, amountCents: 400, idempotencyKey: `race-${i}-${tag}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => r.error === "exceeds_refundable")).toHaveLength(3);
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 10 });
    expect(refunds.data.reduce((n, r) => n + r.amount, 0)).toBe(800);
  });

  test("concurrent retries of one request: one Stripe refund", async () => {
    const pi = await capturedIntent(900);
    const tag = pi.id.slice(-8);
    const results = await Promise.all([0, 1, 2].map(() => run({ paymentIntentId: pi.id, amountCents: 300, idempotencyKey: `dupe-${tag}` })));
    expect(results.every((r) => r.ok || r.retryable)).toBe(true);
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 10 });
    expect(refunds.data).toHaveLength(1);
  });
});
