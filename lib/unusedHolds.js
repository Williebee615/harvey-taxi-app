// Unused card holds: the payment record a PaymentIntent needs, and the
// rules for safely cancelling a hold that never became a ride.
//
// Background. Booking authorizes the card (a manual-capture PaymentIntent)
// before the ride exists. If the rider leaves after that step, the hold
// stays on the card until it is cancelled or expires; nothing in the app
// cancelled it. Separately, rides.payment_id is a foreign key to
// payments(id), but no code ever created a payments row, so binding a
// real PaymentIntent to a ride could not succeed.
//
// The payments row (id = PaymentIntent id) is also the lock that keeps
// "bind this hold to a ride" and "cancel this unused hold" from both
// winning: each is a single-row conditional write on the same primary
// key, so exactly one of them succeeds.
//
// Pure functions only; server.js performs the Supabase and Stripe calls.

const crypto = require("crypto");

const PAYMENT_RECORD_STATUS = Object.freeze({
  CREATED: "created", // intent created, not yet bound to a ride
  AUTHORIZED: "authorized", // bound to a ride (rides.payment_id)
  RELEASE_PENDING: "release_pending", // claimed for cancellation
  RELEASED: "released", // cancelled at Stripe
  RELEASE_FAILED: "release_failed" // cancellation claimed but Stripe refused
});

// Stripe statuses in which an uncaptured PaymentIntent can be cancelled.
const RELEASABLE_INTENT_STATUSES = Object.freeze([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture"
]);

// Automatic release waits this long after the intent was created, far
// longer than a booking takes, so a rider who is still deciding is never
// affected.
const DEFAULT_SWEEP_MIN_AGE_MS = 2 * 60 * 60 * 1000;

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// The payments row created with the PaymentIntent (no ride yet). The
// client secret is never stored.
function buildCreatedPaymentRecord({ intent, riderId, rideType, stripeCustomerId = null }) {
  return {
    id: intent.id,
    rider_id: String(riderId),
    amount: Number(intent.amount || 0) / 100,
    currency: String(intent.currency || "usd").toUpperCase(),
    status: PAYMENT_RECORD_STATUS.CREATED,
    authorization_status: intent.status || null,
    provider: "stripe",
    type: "ride",
    service_type: rideType || null,
    stripe_payment_intent_id: intent.id,
    stripe_latest_status: intent.status || null,
    stripe_customer_id: stripeCustomerId
  };
}

// The payments row once the intent is bound to a ride.
function buildAuthorizedPaymentRecord({ intent, ride }) {
  return {
    id: intent.id,
    rider_id: String(ride.rider_id || intent.metadata?.rider_id || "unidentified"),
    amount: Number(intent.amount || 0) / 100,
    currency: String(intent.currency || "usd").toUpperCase(),
    status: PAYMENT_RECORD_STATUS.AUTHORIZED,
    authorization_status: intent.status || null,
    provider: "stripe",
    type: "ride",
    service_type: ride.ride_type || null,
    ride_id: String(ride.id),
    stripe_payment_intent_id: intent.id,
    stripe_latest_status: intent.status || null
  };
}

// Statuses from which binding to a ride may proceed (the conditional
// update's allowed "from" set). A hold being released, or released, can
// never be bound.
const BINDABLE_RECORD_STATUSES = Object.freeze([PAYMENT_RECORD_STATUS.CREATED, PAYMENT_RECORD_STATUS.AUTHORIZED]);

// Decides whether an uncaptured hold may be cancelled.
//   intent            Stripe PaymentIntent (retrieved server-side)
//   boundRideIds      ids of rides whose payment_id is this intent
//   record            the payments row, or null
//   requester         { kind: "rider", riderId, clientSecret } or
//                     { kind: "sweep" }
// Returns { release: boolean, reason }.
function decideHoldRelease({ intent, boundRideIds = [], record = null, requester, now = Date.now(), minAgeMs = DEFAULT_SWEEP_MIN_AGE_MS }) {
  if (!intent || !intent.id) return { release: false, reason: "intent_not_found" };
  if (intent.metadata?.app !== "harvey_taxi") return { release: false, reason: "not_a_harvey_taxi_payment" };
  if (intent.capture_method !== "manual") return { release: false, reason: "not_a_hold" };

  // Never touch a payment that belongs to a ride, whatever the ride's
  // status: an active ride needs its hold, and a cancelled ride's hold is
  // already handled by the ride-cancellation workflow.
  // The two real bindings are rides.payment_id and the payments row's
  // ride_id. The intent's metadata.ride_id is not one: authorization writes
  // it to Stripe before the ride is updated and never clears it, so a ride
  // whose authorization then failed would otherwise keep its unused hold
  // forever. Concurrency is handled by the payments-row claim, not by it.
  if (boundRideIds.length) return { release: false, reason: "bound_to_ride" };
  if (record && record.ride_id) return { release: false, reason: "bound_to_ride" };

  if (intent.status === "canceled") return { release: false, reason: "already_cancelled" };
  if (!RELEASABLE_INTENT_STATUSES.includes(intent.status)) {
    return { release: false, reason: `not_releasable_${intent.status}` };
  }
  if (record && ![PAYMENT_RECORD_STATUS.CREATED, PAYMENT_RECORD_STATUS.RELEASE_FAILED].includes(record.status)) {
    return { release: false, reason: `record_${record.status}` };
  }

  if (!requester) return { release: false, reason: "no_requester" };
  if (requester.kind === "rider") {
    // Ownership: the verified session's rider must be the intent's rider,
    // or the caller must hold the intent's client secret (only the browser
    // that created the hold has it). A rider_id named in the request body
    // is never accepted on its own.
    const sessionOwns = Boolean(requester.riderId) && String(requester.riderId) === String(intent.metadata?.rider_id || "");
    const holdsSecret = Boolean(requester.clientSecret) && timingSafeEqualString(requester.clientSecret, intent.client_secret);
    if (!sessionOwns && !holdsSecret) return { release: false, reason: "not_owner" };
    return { release: true, reason: "rider_left_booking" };
  }
  if (requester.kind === "sweep") {
    const createdMs = Number(intent.created) * 1000;
    if (!Number.isFinite(createdMs) || now - createdMs < minAgeMs) return { release: false, reason: "too_recent" };
    return { release: true, reason: "unused_after_booking_window" };
  }
  return { release: false, reason: "unknown_requester" };
}

function releaseIdempotencyKey(intentId) {
  return `harvey-hold-release-${intentId}`;
}

module.exports = {
  PAYMENT_RECORD_STATUS,
  RELEASABLE_INTENT_STATUSES,
  BINDABLE_RECORD_STATUSES,
  DEFAULT_SWEEP_MIN_AGE_MS,
  buildCreatedPaymentRecord,
  buildAuthorizedPaymentRecord,
  decideHoldRelease,
  releaseIdempotencyKey
};
