const { reconcilePayments, DISCREPANCY } = require("./paymentReconciliation");

const intent = (id, status, extra = {}) => ({ id, status, amount: 2500, amount_received: status === "succeeded" ? 2500 : 0, livemode: false, metadata: { app: "harvey_taxi" }, ...extra });
const codes = (r) => r.findings.map((f) => f.code).sort();

describe("reconcilePayments (read-only)", () => {
  test("a clean ledger has no discrepancies", () => {
    const r = reconcilePayments({
      intents: [intent("pi_1", "succeeded")],
      payments: [{ id: "pi_1", amount: 25, stripe_latest_status: "succeeded", provider: "stripe" }],
      rides: [{ id: "ride_1", payment_id: "pi_1", payment_status: "captured" }]
    });
    expect(r.findings).toEqual([]);
    expect(r.summary).toMatchObject({ harvey_intents: 1, payments_rows: 1, rides_with_payment: 1, discrepancies: 0 });
  });

  test("cancelled intents with no record are not money and aren't reported", () => {
    const r = reconcilePayments({ intents: [intent("pi_1", "canceled"), intent("pi_2", "requires_payment_method")] });
    expect(r.findings).toEqual([]);
    expect(r.summary.harvey_intent_statuses).toEqual({ canceled: 1, requires_payment_method: 1 });
  });

  test("reports untracked holds and captures, captured-without-ride, status and amount mismatches", () => {
    const r = reconcilePayments({
      intents: [intent("pi_hold", "requires_capture"), intent("pi_cap", "succeeded"), intent("pi_rec", "requires_capture")],
      payments: [{ id: "pi_rec", amount: 20, stripe_latest_status: "canceled", ride_id: "ride_x" }]
    });
    expect(codes(r)).toEqual([DISCREPANCY.AMOUNT_MISMATCH, DISCREPANCY.CAPTURED_WITHOUT_RIDE, DISCREPANCY.INTENT_UNTRACKED, DISCREPANCY.INTENT_UNTRACKED, DISCREPANCY.STATUS_MISMATCH].sort());
  });

  test("ride and database rows that point at missing intents; capture mismatch", () => {
    const r = reconcilePayments({
      intents: [intent("pi_1", "requires_capture")],
      payments: [{ id: "pi_1", amount: 25, stripe_latest_status: "requires_capture" }, { id: "pi_gone", amount: 10, provider: "stripe" }],
      rides: [{ id: "ride_1", payment_id: "pi_1", payment_status: "captured" }, { id: "ride_2", payment_id: "pi_gone2" }]
    });
    expect(codes(r)).toEqual([DISCREPANCY.PAYMENT_NOT_IN_STRIPE, DISCREPANCY.RIDE_CAPTURE_MISMATCH, DISCREPANCY.RIDE_INTENT_MISSING].sort());
  });

  test("rows outside the Stripe read window aren't judged", () => {
    const r = reconcilePayments({ payments: [{ id: "pi_old", amount: 1, created_at: "2020-01-01T00:00:00Z" }], window: { gte: 1700000000, lte: 1800000000 } });
    expect(r.findings).toEqual([]);
  });

  test("refunds: untracked Stripe refund and ledger mismatch", () => {
    const r = reconcilePayments({
      intents: [intent("pi_1", "succeeded")],
      payments: [{ id: "pi_1", amount: 25, stripe_latest_status: "succeeded", ride_id: "ride_1" }],
      refunds: [{ id: "re_1", payment_intent: "pi_1", amount: 500, status: "succeeded" }, { id: "re_2", payment_intent: "pi_1", amount: 300, status: "succeeded" }],
      ledger: [{ payment_intent_id: "pi_1", stripe_refund_id: "re_2", amount_cents: 200 }, { payment_intent_id: "pi_1", stripe_refund_id: "re_missing", amount_cents: 100 }]
    });
    expect(codes(r)).toEqual([DISCREPANCY.REFUND_LEDGER_MISMATCH, DISCREPANCY.REFUND_LEDGER_MISMATCH, DISCREPANCY.REFUND_UNTRACKED].sort());
  });

  test("other apps' and synthetic intents are counted, never reported; live objects in a test run are", () => {
    const r = reconcilePayments({
      intents: [intent("pi_other", "succeeded", { metadata: { app: "someone_else" } }), intent("pi_syn", "succeeded", { metadata: { app: "harvey_taxi", synthetic: "true" } }), intent("pi_live", "canceled", { livemode: true })],
      refunds: [{ id: "re_syn", payment_intent: "pi_syn", amount: 100 }]
    });
    expect(r.summary).toMatchObject({ other_app_intents: 1, synthetic_intents: 1, harvey_intents: 1 });
    expect(codes(r)).toEqual([DISCREPANCY.MODE_MISMATCH]);
  });

  test("findings carry identifiers and amounts only", () => {
    const r = reconcilePayments({ intents: [intent("pi_1", "succeeded", { client_secret: "pi_1_secret_x", receipt_email: "a@b.example" })] });
    expect(JSON.stringify(r)).not.toMatch(/secret|@/);
  });
});
