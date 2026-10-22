const t = require("./rideTips");

const NOW = Date.parse("2026-10-22T14:00:00Z");
const ride = (over = {}) => ({ id: "R1", rider_id: "U1", driver_id: "D1", status: "in_progress", ...over });

test.each([
  ["5", 500],
  [7.5, 750],
  ["1", 100],
  ["100", 10000]
])("tip amount %p is %p cents", (input, cents) => {
  expect(t.validateTipAmount(input)).toEqual({ ok: true, amount_cents: cents });
});

test.each([["0.99"], ["100.01"], ["abc"], [""], ["5.555"], [-5]])("rejects tip amount %p", (input) => {
  expect(t.validateTipAmount(input).ok).toBe(false);
});

test("eligibility: own ride, with a driver, in progress or completed within 24 hours", () => {
  expect(t.tipEligibility(ride(), "U1", { now: NOW }).ok).toBe(true);
  expect(t.tipEligibility(ride(), "U2", { now: NOW }).statusCode).toBe(404);
  expect(t.tipEligibility(ride({ driver_id: null }), "U1", { now: NOW }).statusCode).toBe(409);
  expect(t.tipEligibility(ride({ status: "driver_enroute" }), "U1", { now: NOW }).statusCode).toBe(409);
  expect(t.tipEligibility(ride({ status: "completed", completed_at: "2026-10-22T00:00:00Z" }), "U1", { now: NOW }).ok).toBe(true);
  expect(t.tipEligibility(ride({ status: "completed", completed_at: "2026-10-21T13:00:00Z" }), "U1", { now: NOW }).statusCode).toBe(409);
});

test("mode: App Review rides are simulated; otherwise test until live is approved", () => {
  expect(t.tipMode(ride({ is_review_ride: true }), { liveEnabled: true })).toBe("simulated");
  expect(t.tipMode(ride(), { liveEnabled: false })).toBe("test");
  expect(t.tipMode(ride(), { liveEnabled: true })).toBe("live");
});

test("a PaymentIntent must match the tip exactly before it counts", () => {
  const tip = { id: "T1", ride_id: "R1", amount_cents: 500, payment_intent_id: "pi_1" };
  const intent = { id: "pi_1", status: "succeeded", amount: 500, amount_received: 500, currency: "usd", metadata: { kind: "ride_tip", tip_id: "T1", ride_id: "R1" } };
  expect(t.intentMatchesTip(intent, tip)).toBe(true);
  expect(t.intentMatchesTip({ ...intent, status: "requires_payment_method" }, tip)).toBe(false);
  expect(t.intentMatchesTip({ ...intent, amount_received: 400 }, tip)).toBe(false);
  expect(t.intentMatchesTip({ ...intent, metadata: { ...intent.metadata, ride_id: "R2" } }, tip)).toBe(false);
  expect(t.intentMatchesTip({ ...intent, id: "pi_2" }, tip)).toBe(false);
});

test("total tip: booking tip plus paid or simulated tips, never pending ones", () => {
  const tips = [{ status: "succeeded", amount_cents: 500 }, { status: "pending", amount_cents: 1000 }, { status: "cancelled", amount_cents: 200 }];
  expect(t.totalTipDollars({ tip_amount: 3 }, tips)).toBe(8);
  expect(t.totalTipDollars({}, [{ status: "simulated", amount_cents: 200 }])).toBe(2);
  expect(t.totalTipDollars({ tip_amount: null }, [])).toBe(0);
});
