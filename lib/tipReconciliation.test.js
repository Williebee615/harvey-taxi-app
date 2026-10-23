const { reconcileTips, DISCREPANCY } = require("./tipReconciliation");

const intent = (id, extra = {}) => ({
  id, status: "succeeded", amount: 500, amount_received: 500, currency: "usd", livemode: true,
  metadata: { kind: "ride_tip", tip_id: `tip_${id}`, ride_id: "ride_1" }, latest_charge: { amount_refunded: 0 }, ...extra
});
const tip = (piId, extra = {}) => ({ id: `tip_${piId}`, ride_id: "ride_1", amount_cents: 500, status: "succeeded", mode: "live", payment_intent_id: piId, ...extra });
const earning = (extra = {}) => ({ ride_id: "ride_1", tip_amount: 5, driver_base_earning: 20, total_earning: 25, ...extra });
const codes = (r) => r.findings.map((f) => f.code).sort();

describe("reconcileTips (read-only)", () => {
  test("a matching tip, earning and charge has no findings", () => {
    const r = reconcileTips({ mode: "live", intents: [intent("pi_1")], tips: [tip("pi_1")], rides: [{ id: "ride_1", tip_amount: 0 }], earnings: [earning()] });
    expect(r.findings).toEqual([]);
    expect(r.summary).toMatchObject({ mode: "live", tip_intents_succeeded: 1, stripe_tip_cents: 500, recorded_paid_tips: 1, recorded_tip_cents: 500, earnings_checked: 1, discrepancies: 0 });
  });

  test("a succeeded charge with no row, or a pending or cancelled row, is reported", () => {
    const r = reconcileTips({
      mode: "live",
      intents: [intent("pi_1"), intent("pi_2"), intent("pi_3")],
      tips: [tip("pi_2", { status: "pending" }), tip("pi_3", { status: "cancelled" })]
    });
    expect(codes(r)).toEqual([DISCREPANCY.PAID_NOT_RECORDED, DISCREPANCY.PAID_NOT_RECORDED, DISCREPANCY.PAID_UNTRACKED]);
  });

  test("a paid row whose charge didn't succeed, or isn't in Stripe, is reported", () => {
    const r = reconcileTips({ mode: "live", intents: [intent("pi_1", { status: "requires_payment_method" })], tips: [tip("pi_1"), tip("pi_9")] });
    expect(codes(r)).toEqual([DISCREPANCY.INTENT_MISSING, DISCREPANCY.RECORDED_NOT_PAID]);
  });

  test("amount, metadata, refund and mode mismatches are reported", () => {
    const r = reconcileTips({
      mode: "live",
      intents: [intent("pi_1", { amount_received: 700, livemode: false, metadata: { kind: "ride_tip", tip_id: "other", ride_id: "ride_1" }, latest_charge: { amount_refunded: 200 } })],
      tips: [tip("pi_1")]
    });
    expect(codes(r)).toEqual([DISCREPANCY.AMOUNT_MISMATCH, DISCREPANCY.METADATA_MISMATCH, DISCREPANCY.MODE_MISMATCH, DISCREPANCY.REFUNDED]);
  });

  test("earnings must carry the booking tip plus paid and simulated tips, and total = base + tip", () => {
    const tips = [tip("pi_1"), { id: "sim", ride_id: "ride_2", amount_cents: 300, status: "simulated", mode: "simulated", payment_intent_id: null }];
    const r = reconcileTips({
      mode: "live",
      intents: [intent("pi_1")],
      tips,
      rides: [{ id: "ride_1", tip_amount: 2 }, { id: "ride_2", tip_amount: 0 }],
      earnings: [earning({ tip_amount: 5, total_earning: 25 }), { ride_id: "ride_2", tip_amount: 3, driver_base_earning: 10, total_earning: 12 }]
    });
    expect(r.findings).toEqual([
      expect.objectContaining({ code: DISCREPANCY.EARNING_TIP_MISMATCH, ride_id: "ride_1", earning_tip_cents: 500, expected_tip_cents: 700 }),
      expect.objectContaining({ code: DISCREPANCY.EARNING_TOTAL_MISMATCH, ride_id: "ride_2", earning_total_cents: 1200, expected_total_cents: 1300 })
    ]);
  });

  test("non-tip intents, other modes' rows and unfinished tips are ignored", () => {
    const r = reconcileTips({
      mode: "live",
      intents: [{ id: "pi_ride", status: "succeeded", amount: 2500, livemode: true, metadata: { app: "harvey_taxi" } }, intent("pi_2", { status: "requires_payment_method" })],
      tips: [tip("pi_test", { mode: "test" }), tip("pi_2", { status: "pending" })]
    });
    expect(r.findings).toEqual([]);
    expect(r.summary).toMatchObject({ tip_intents: 1, pending_tips: 1, recorded_paid_tips: 0 });
  });

  test("findings carry identifiers, amounts and codes only", () => {
    const r = reconcileTips({ mode: "live", intents: [intent("pi_1", { client_secret: "secret", metadata: { kind: "ride_tip", ride_id: "ride_1", rider_phone: "+1615" } })] });
    expect(JSON.stringify(r)).not.toMatch(/secret|\+1615/);
  });
});
