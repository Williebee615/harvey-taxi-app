// Stripe payment-intent webhooks -> ride updates, as explicit, forward-only
// transitions. Stripe can deliver an event more than once, late, or out of
// order; applying the same event twice, or an older event after a newer
// state, must never move a ride backwards, overwrite a cancellation, or
// undo a capture. Pure: decides; server.js applies the patch with a
// conditional update on the status it read.
const { RIDE_STATUS } = require("./rideDispatch");

const PRE_AUTHORIZATION = new Set([RIDE_STATUS.DRAFT, RIDE_STATUS.PAYMENT_REQUIRED]);
// Before a driver is assigned: losing the payment authorization here means
// the ride can't go ahead.
const BEFORE_ASSIGNMENT = new Set([
  RIDE_STATUS.DRAFT,
  RIDE_STATUS.PAYMENT_REQUIRED,
  RIDE_STATUS.PAYMENT_AUTHORIZED,
  RIDE_STATUS.AWAITING_DRIVER,
  "offer_sent"
]);
const TRIP_UNDERWAY = new Set([RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.ARRIVED, RIDE_STATUS.IN_PROGRESS]);
const CAPTURED = new Set(["captured", "succeeded"]);

// Returns { patch, review }:
//   patch  -- fields to set, or null for "no change" (duplicate, late or
//             already reflected);
//   review -- a reason code when staff should look (never null-and-silent
//             for money states that don't fit), else null.
function rideUpdateForStripeEvent(eventType, ride) {
  const status = ride && ride.status;
  const paymentStatus = (ride && ride.payment_status) || null;
  const none = (review = null) => ({ patch: null, review });

  switch (eventType) {
    case "payment_intent.amount_capturable_updated":
      // Authorization succeeded. Only a ride still waiting for payment moves
      // forward; a late copy never pulls an assigned/active/finished ride
      // back to "payment authorized".
      if (CAPTURED.has(paymentStatus) || paymentStatus === "authorized") return none();
      if (PRE_AUTHORIZATION.has(status)) return { patch: { payment_status: "authorized", status: RIDE_STATUS.PAYMENT_AUTHORIZED }, review: null };
      if (status === RIDE_STATUS.CANCELLED || status === RIDE_STATUS.FAILED) return none("authorized_after_ride_closed");
      return { patch: { payment_status: "authorized" }, review: null };

    case "payment_intent.succeeded":
      // Money was captured (Stripe's confirmation of our capture, which the
      // capture path records as "captured"). Record it; never change the
      // ride's trip status.
      if (paymentStatus === "succeeded") return none();
      return {
        patch: { payment_status: "succeeded", payment_captured: true },
        review: status === RIDE_STATUS.CANCELLED || status === RIDE_STATUS.FAILED ? "captured_on_closed_ride" : null
      };

    case "payment_intent.payment_failed":
      if (CAPTURED.has(paymentStatus)) return none("failure_after_capture");
      if (PRE_AUTHORIZATION.has(status)) return { patch: { payment_status: "failed", status: RIDE_STATUS.FAILED }, review: null };
      // Capture failures are recorded by the capture path itself
      // (payment_status capture_failed); don't overwrite a trip.
      return none(TRIP_UNDERWAY.has(status) || status === RIDE_STATUS.COMPLETED ? "payment_failed_during_or_after_trip" : null);

    case "payment_intent.canceled":
      if (status === RIDE_STATUS.CANCELLED) return none(); // our own cancellation flow released the hold
      if (CAPTURED.has(paymentStatus)) return none("canceled_after_capture");
      if (BEFORE_ASSIGNMENT.has(status)) return { patch: { payment_status: "failed", status: RIDE_STATUS.FAILED }, review: null };
      if (TRIP_UNDERWAY.has(status) || status === RIDE_STATUS.COMPLETED) return none("authorization_canceled_during_or_after_trip");
      return none();

    default:
      return none();
  }
}

module.exports = { rideUpdateForStripeEvent };
