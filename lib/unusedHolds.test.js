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
    metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1", rider_verified: "true" },
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
  const stale = intent({ metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1", rider_verified: "true", ride_id: "RIDE_1" } });
  expect(decideHoldRelease({ intent: stale, requester: rider(), now: NOW }).release).toBe(true);
});

// ---- Ownership, metadata, reconciliation and alerts (untracked-hold fix) ----
const { buildIntentMetadata, decideReconciliation, buildPaymentOpsAlert, UNIDENTIFIED_RIDER } = require("./unusedHolds");

test("a client-claimed rider_id never proves ownership: session release needs rider_verified", () => {
  const claimed = intent({ metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1", rider_verified: "false" } });
  expect(decideHoldRelease({ intent: claimed, requester: rider(), now: NOW })).toEqual({ release: false, reason: "not_owner" });
  // The browser that created it still holds the secret.
  expect(decideHoldRelease({ intent: claimed, requester: rider({ riderId: null, clientSecret: "pi_1_secret_abc" }), now: NOW }).release).toBe(true);
});

test("intent metadata is explicit about app, account and rider verification", () => {
  expect(buildIntentMetadata({ rideType: "standard", riderId: "RIDER_1", riderVerified: true })).toEqual({
    app: "harvey_taxi", account: "harvey_taxi_service", metadata_version: "2", ride_type: "standard", rider_id: "RIDER_1", rider_verified: "true"
  });
  expect(buildIntentMetadata({ rideType: "standard", riderId: "", riderVerified: false })).toMatchObject({ rider_id: "", rider_verified: "false" });
});

test("an intent with no rider identity is still recorded", () => {
  expect(buildCreatedPaymentRecord({ intent: intent(), riderId: "" }).rider_id).toBe(UNIDENTIFIED_RIDER);
});

describe("decideReconciliation", () => {
  const OLD = NOW - 3 * 60 * 60 * 1000;
  const hold = (overrides = {}) =>
    intent({ status: "requires_capture", created: Math.floor(OLD / 1000), metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1" }, ...overrides });
  const decide = (args) => decideReconciliation({ now: NOW, ...args });

  test("ignores other applications, non-holds, non-open holds and recent holds", () => {
    expect(decide({ intent: hold({ metadata: { app: "other" } }) }).action).toBe("ignore");
    expect(decide({ intent: hold({ capture_method: "automatic" }) }).action).toBe("ignore");
    expect(decide({ intent: hold({ status: "succeeded" }) }).action).toBe("ignore");
    expect(decide({ intent: hold({ status: "canceled" }) }).action).toBe("ignore");
    // A never-confirmed intent holds no money but is still reconciled.
    expect(decide({ intent: hold({ status: "requires_payment_method" }) }).action).toBe("release_candidate");
    expect(decide({ intent: hold({ created: Math.floor(NOW / 1000) }) }).action).toBe("ignore");
  });
  test("keeps holds bound to a ride, in release, or awaiting review", () => {
    expect(decide({ intent: hold(), boundRideIds: ["RIDE_1"] })).toEqual({ action: "keep", reason: "bound_to_ride" });
    expect(decide({ intent: hold(), record: { status: "authorized", ride_id: "RIDE_1" } }).action).toBe("keep");
    expect(decide({ intent: hold(), record: { status: "release_pending", ride_id: null } }).reason).toBe("release_in_progress");
    expect(decide({ intent: hold(), record: { status: "review_required", ride_id: null } }).reason).toBe("awaiting_review");
  });
  test("flags uncertain ownership or attachment for review", () => {
    expect(decide({ intent: hold(), boundRideIds: ["RIDE_1", "RIDE_2"] }).reason).toBe("bound_to_multiple_rides");
    expect(decide({ intent: hold(), boundRideIds: ["RIDE_1"], record: { status: "authorized", ride_id: "RIDE_2" } }).reason).toBe("record_and_ride_disagree");
    expect(decide({ intent: hold({ metadata: { app: "harvey_taxi", rider_id: "RIDER_1" } }) }).reason).toBe("missing_account_tag");
    expect(decide({ intent: hold({ metadata: { app: "harvey_taxi", account: "harvey_taxi_service", ride_id: "RIDE_9" } }) }).reason).toBe("stripe_names_ride_without_binding");
    expect(decide({ intent: hold(), record: { status: "created", ride_id: null, rider_id: "RIDER_2" } }).reason).toBe("rider_mismatch");
    expect(decide({ intent: hold(), record: { status: "released", ride_id: null } }).action).toBe("review");
    expect(decide({ intent: hold(), record: { status: "authorized", ride_id: null } }).action).toBe("review");
  });
  test("an unused, unbound Harvey Taxi hold past the window is a release candidate", () => {
    expect(decide({ intent: hold(), record: { status: "created", ride_id: null, rider_id: "RIDER_1" } }).action).toBe("release_candidate");
    expect(decide({ intent: hold(), record: { status: "created", ride_id: null, rider_id: UNIDENTIFIED_RIDER } }).action).toBe("release_candidate");
    expect(decide({ intent: hold(), record: { status: "release_failed", ride_id: null, rider_id: "RIDER_1" } }).action).toBe("release_candidate");
  });
});

test("ops alerts carry only allow-listed fields", () => {
  const alert = buildPaymentOpsAlert("payment_intent_untracked", {
    payment_intent_id: "pi_123",
    reason: "record_write_failed_and_cancel_failed",
    amount_cents: 2000,
    client_secret: "pi_123_secret_zzz",
    email: "rider@example.test",
    card_last4: "4242"
  });
  expect(Object.keys(alert).sort()).toEqual(["amount_cents", "at", "event", "payment_intent_id", "reason"]);
  expect(JSON.stringify(alert)).not.toMatch(/secret|example\.test|4242/);
  expect(buildPaymentOpsAlert("x", { payment_intent_id: "pi_1_secret_abc def" }).payment_intent_id).toBeUndefined();
});
