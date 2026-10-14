// Stripe webhook -> ride transitions: forward-only under duplicate, late
// and out-of-order delivery (lib/stripeWebhookTransitions.js).
const { rideUpdateForStripeEvent: next } = require("./stripeWebhookTransitions");

const apply = (ride, type) => {
  const { patch } = next(type, ride);
  return patch ? { ...ride, ...patch } : ride;
};

const AUTH = "payment_intent.amount_capturable_updated";
const OK = "payment_intent.succeeded";
const FAIL = "payment_intent.payment_failed";
const CANCEL = "payment_intent.canceled";

describe("normal order", () => {
  test("authorize -> (capture path sets captured) -> succeeded", () => {
    let ride = { status: "payment_required", payment_status: "pending" };
    ride = apply(ride, AUTH);
    expect(ride).toEqual({ status: "payment_authorized", payment_status: "authorized" });
    ride = { ...ride, status: "completed", payment_status: "captured" };
    ride = apply(ride, OK);
    expect(ride).toEqual({ status: "completed", payment_status: "succeeded", payment_captured: true });
  });

  test("failure before authorization fails the ride", () => {
    expect(apply({ status: "payment_required", payment_status: "pending" }, FAIL)).toEqual({ status: "failed", payment_status: "failed" });
  });
});

describe("duplicates change nothing the second time", () => {
  test.each([
    [AUTH, { status: "payment_required", payment_status: "pending" }],
    [OK, { status: "completed", payment_status: "captured" }],
    [FAIL, { status: "payment_required", payment_status: "pending" }],
    [CANCEL, { status: "awaiting_driver_acceptance", payment_status: "authorized" }]
  ])("%s", (type, start) => {
    const once = apply(start, type);
    expect(next(type, once).patch).toBeNull();
  });
});

describe("late and out-of-order events never move a ride backwards", () => {
  test.each(["driver_assigned", "driver_enroute", "arrived", "in_progress", "completed"])("late authorization on a %s ride doesn't reset its status", (status) => {
    const { patch } = next(AUTH, { status, payment_status: "authorized" });
    expect(patch).toBeNull();
    const fresh = next(AUTH, { status, payment_status: null });
    expect(fresh.patch).toEqual({ payment_status: "authorized" });
  });

  test("an authorization arriving after the capture is ignored", () => {
    expect(next(AUTH, { status: "completed", payment_status: "succeeded" }).patch).toBeNull();
    expect(next(AUTH, { status: "completed", payment_status: "captured" }).patch).toBeNull();
  });

  test("an earlier failed attempt arriving after a successful authorization doesn't fail the ride", () => {
    expect(next(FAIL, { status: "payment_authorized", payment_status: "authorized" }).patch).toBeNull();
    expect(next(FAIL, { status: "awaiting_driver_acceptance", payment_status: "authorized" }).patch).toBeNull();
  });

  test("failure or cancellation during or after a trip never overwrites the trip; staff are flagged", () => {
    for (const status of ["driver_assigned", "in_progress", "completed"]) {
      expect(next(FAIL, { status, payment_status: "authorized" })).toEqual({ patch: null, review: "payment_failed_during_or_after_trip" });
      expect(next(CANCEL, { status, payment_status: "authorized" })).toEqual({ patch: null, review: "authorization_canceled_during_or_after_trip" });
    }
  });

  test("events after a capture are flagged, never applied", () => {
    expect(next(FAIL, { status: "completed", payment_status: "succeeded" })).toEqual({ patch: null, review: "failure_after_capture" });
    expect(next(CANCEL, { status: "completed", payment_status: "captured" })).toEqual({ patch: null, review: "canceled_after_capture" });
  });
});

describe("cancellations", () => {
  test("our own cancellation releasing the hold leaves the cancelled ride as cancelled", () => {
    expect(next(CANCEL, { status: "cancelled", payment_status: "authorized" })).toEqual({ patch: null, review: null });
  });

  test("Stripe canceling the hold before a driver is assigned (e.g. expiry) fails the ride", () => {
    for (const status of ["payment_authorized", "awaiting_driver_acceptance", "offer_sent"]) {
      expect(next(CANCEL, { status, payment_status: "authorized" }).patch).toEqual({ payment_status: "failed", status: "failed" });
    }
  });

  test("a capture on a cancelled or failed ride is recorded and flagged", () => {
    expect(next(OK, { status: "cancelled", payment_status: "authorized" })).toEqual({
      patch: { payment_status: "succeeded", payment_captured: true },
      review: "captured_on_closed_ride"
    });
  });

  test("an authorization after the ride was closed is flagged, not applied", () => {
    expect(next(AUTH, { status: "cancelled", payment_status: "pending" })).toEqual({ patch: null, review: "authorized_after_ride_closed" });
  });
});

test("unknown event types change nothing", () => {
  expect(next("charge.refunded", { status: "completed", payment_status: "succeeded" })).toEqual({ patch: null, review: null });
});
