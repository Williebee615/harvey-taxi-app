const {
  PAYMENT_RECORD_STATUS: S,
  decideHoldRelease,
  buildCreatedPaymentRecord,
  buildAuthorizedPaymentRecord
} = require("./unusedHolds");

const NOW = Date.parse("2026-10-01T12:00:00Z");
function intent(overrides = {}) {
  return {
    id: "pi_1",
    status: "requires_capture",
    capture_method: "manual",
    amount: 2450,
    currency: "usd",
    client_secret: "pi_1_secret_abc",
    created: Math.floor((NOW - 3 * 3600_000) / 1000),
    metadata: { app: "harvey_taxi", rider_id: "RIDER_1" },
    ...overrides
  };
}
const rider = (o = {}) => ({ kind: "rider", riderId: "RIDER_1", clientSecret: null, ...o });

test("owner (verified session) may release an unbound hold", () => {
  expect(decideHoldRelease({ intent: intent(), requester: rider(), now: NOW })).toEqual({ release: true, reason: "rider_left_booking" });
});

test("proof of possession (client secret) works without a session; a wrong secret does not", () => {
  expect(decideHoldRelease({ intent: intent(), requester: rider({ riderId: null, clientSecret: "pi_1_secret_abc" }), now: NOW }).release).toBe(true);
  expect(decideHoldRelease({ intent: intent(), requester: rider({ riderId: null, clientSecret: "pi_1_secret_abX" }), now: NOW }).reason).toBe("not_owner");
  expect(decideHoldRelease({ intent: intent(), requester: rider({ riderId: "RIDER_2" }), now: NOW }).reason).toBe("not_owner");
  expect(decideHoldRelease({ intent: intent(), requester: rider({ riderId: null }), now: NOW }).reason).toBe("not_owner");
});

test("never releases a payment bound to a ride (rides.payment_id or the payment record)", () => {
  expect(decideHoldRelease({ intent: intent(), boundRideIds: ["RIDE_1"], requester: rider(), now: NOW }).reason).toBe("bound_to_ride");
  expect(decideHoldRelease({ intent: intent(), record: { status: S.AUTHORIZED, ride_id: "RIDE_1" }, requester: rider(), now: NOW }).reason).toBe("bound_to_ride");
});

test.each([
  ["succeeded", "not_releasable_succeeded"],
  ["processing", "not_releasable_processing"],
  ["canceled", "already_cancelled"]
])("intent status %s is never released", (status, reason) => {
  expect(decideHoldRelease({ intent: intent({ status }), requester: rider(), now: NOW }).reason).toBe(reason);
});

test("other merchants' or automatic-capture intents are refused", () => {
  expect(decideHoldRelease({ intent: intent({ metadata: { rider_id: "RIDER_1" } }), requester: rider(), now: NOW }).reason).toBe("not_a_harvey_taxi_payment");
  expect(decideHoldRelease({ intent: intent({ capture_method: "automatic" }), requester: rider(), now: NOW }).reason).toBe("not_a_hold");
});

test("records already being released, released or bound are left alone; a failed release may retry", () => {
  for (const status of [S.RELEASE_PENDING, S.RELEASED]) {
    expect(decideHoldRelease({ intent: intent(), record: { status, ride_id: null }, requester: rider(), now: NOW }).release).toBe(false);
  }
  expect(decideHoldRelease({ intent: intent(), record: { status: S.RELEASE_FAILED, ride_id: null }, requester: rider(), now: NOW }).release).toBe(true);
});

test("the sweep only releases holds older than the booking window", () => {
  expect(decideHoldRelease({ intent: intent(), requester: { kind: "sweep" }, now: NOW }).release).toBe(true);
  expect(decideHoldRelease({ intent: intent({ created: Math.floor((NOW - 10 * 60_000) / 1000) }), requester: { kind: "sweep" }, now: NOW }).reason).toBe("too_recent");
});

test("payment records never contain the client secret", () => {
  const created = buildCreatedPaymentRecord({ intent: intent(), riderId: "RIDER_1", rideType: "standard" });
  const bound = buildAuthorizedPaymentRecord({ intent: intent(), ride: { id: "RIDE_1", rider_id: "RIDER_1" } });
  expect(JSON.stringify([created, bound])).not.toMatch(/secret/);
  expect(created).toMatchObject({ id: "pi_1", status: S.CREATED, amount: 24.5, currency: "USD" });
  expect(bound).toMatchObject({ id: "pi_1", status: S.AUTHORIZED, ride_id: "RIDE_1" });
});

test("Stripe metadata naming a ride is not by itself a binding (failed authorization)", () => {
  const stale = intent({ metadata: { app: "harvey_taxi", rider_id: "RIDER_1", ride_id: "RIDE_1" } });
  expect(decideHoldRelease({ intent: stale, requester: rider(), now: NOW }).release).toBe(true);
});
