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
  RELEASE_FAILED: "release_failed", // cancellation claimed but Stripe refused
  REVIEW_REQUIRED: "review_required" // ownership or attachment uncertain; a person decides
});

// Explicit metadata on every PaymentIntent this server creates. `app` and
// `account` together identify Harvey Taxi Service's own intents, so
// reconciliation never acts on another application's payments in the same
// Stripe account. `rider_verified` is "true" only when rider_id came from
// a verified rider session; a client-supplied rider_id is recorded for
// the ride-match check but never proves ownership.
const STRIPE_APP_TAG = "harvey_taxi";
const STRIPE_ACCOUNT_TAG = "harvey_taxi_service";
const INTENT_METADATA_VERSION = "2";

function buildIntentMetadata({ rideType, riderId, riderVerified }) {
  // The tracking placeholder is never a rider identity.
  if (String(riderId || "") === "unidentified") {
    riderId = "";
    riderVerified = false;
  }
  return {
    app: STRIPE_APP_TAG,
    account: STRIPE_ACCOUNT_TAG,
    metadata_version: INTENT_METADATA_VERSION,
    ride_type: rideType || "",
    rider_id: riderId ? String(riderId) : "",
    rider_verified: riderVerified ? "true" : "false"
  };
}

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
// rider_id is NOT NULL in production; an intent created without any rider
// identity is still tracked, under "unidentified".
const UNIDENTIFIED_RIDER = "unidentified";

function buildCreatedPaymentRecord({ intent, riderId, rideType, stripeCustomerId = null }) {
  return {
    id: intent.id,
    rider_id: riderId ? String(riderId) : UNIDENTIFIED_RIDER,
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
// A hold flagged for review can still be attached by a genuine booking
// (authorization runs its own ownership and amount checks); it just can't
// be cancelled automatically.
const BINDABLE_RECORD_STATUSES = Object.freeze([
  PAYMENT_RECORD_STATUS.CREATED,
  PAYMENT_RECORD_STATUS.AUTHORIZED,
  PAYMENT_RECORD_STATUS.REVIEW_REQUIRED
]);

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
    // Ownership: the verified session's rider must be the intent's rider
    // AND that rider_id must itself have come from a verified session when
    // the intent was created (metadata.rider_verified, written only by this
    // server); otherwise the caller must hold the intent's client secret
    // (only the browser that created the hold has it). A rider_id named by
    // a client -- in this request or when the intent was created -- is
    // never accepted as proof.
    const sessionOwns =
      Boolean(requester.riderId) &&
      String(requester.riderId) !== UNIDENTIFIED_RIDER &&
      intent.metadata?.rider_verified === "true" &&
      String(requester.riderId) === String(intent.metadata?.rider_id || "");
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

// Reconciliation: decides what to do with a PaymentIntent found at Stripe
// (the source of truth for holds), independent of whether this server ever
// managed to record it.
//   action "ignore"            not ours, not a live hold, or too recent
//   action "keep"              bound to a ride, or already being handled
//   action "review"            ownership or attachment uncertain
//   action "release_candidate" an unused Harvey Taxi hold past the window
function decideReconciliation({ intent, boundRideIds = [], record = null, now = Date.now(), minAgeMs = DEFAULT_SWEEP_MIN_AGE_MS }) {
  if (!intent || !intent.id) return { action: "ignore", reason: "no_intent" };
  if (intent.metadata?.app !== STRIPE_APP_TAG) return { action: "ignore", reason: "not_a_harvey_taxi_payment" };
  if (intent.capture_method !== "manual") return { action: "ignore", reason: "not_a_hold" };
  // Open holds (requires_capture) and never-confirmed intents (which hold
  // no money but should not linger untracked) are in scope; anything
  // captured, processing or cancelled is not.
  if (!RELEASABLE_INTENT_STATUSES.includes(intent.status)) return { action: "ignore", reason: `not_open_${intent.status}` };
  const createdMs = Number(intent.created) * 1000;
  if (!Number.isFinite(createdMs) || now - createdMs < minAgeMs) return { action: "ignore", reason: "too_recent" };

  if (boundRideIds.length > 1) return { action: "review", reason: "bound_to_multiple_rides" };
  if (boundRideIds.length || (record && record.ride_id)) {
    if (record && record.ride_id && boundRideIds.length && String(record.ride_id) !== String(boundRideIds[0])) {
      return { action: "review", reason: "record_and_ride_disagree" };
    }
    return { action: "keep", reason: "bound_to_ride" };
  }
  // Another instance is cancelling it right now.
  if (record && record.status === PAYMENT_RECORD_STATUS.RELEASE_PENDING) return { action: "keep", reason: "release_in_progress" };
  // The record and Stripe disagree (authorized with no ride, or released
  // while Stripe still holds the funds).
  if (record && [PAYMENT_RECORD_STATUS.AUTHORIZED, PAYMENT_RECORD_STATUS.RELEASED].includes(record.status)) {
    return { action: "review", reason: `record_${record.status}_without_ride` };
  }
  if (record && record.status === PAYMENT_RECORD_STATUS.REVIEW_REQUIRED) return { action: "keep", reason: "awaiting_review" };

  if (intent.metadata?.account !== STRIPE_ACCOUNT_TAG) return { action: "review", reason: "missing_account_tag" };
  // Stripe names a ride but the database has no binding: a booking may be
  // mid-attachment or may have failed. Uncertain -> a person decides.
  if (intent.metadata?.ride_id) return { action: "review", reason: "stripe_names_ride_without_binding" };
  if (record && record.rider_id && intent.metadata?.rider_id && record.rider_id !== UNIDENTIFIED_RIDER && String(record.rider_id) !== String(intent.metadata.rider_id)) {
    return { action: "review", reason: "rider_mismatch" };
  }
  return { action: "release_candidate", reason: "unused_after_booking_window" };
}

// Operational alert payload with an allow-list of fields, so a client
// secret, card detail, email or phone number can never reach logs, the
// audit trail or an alert email.
const ALERT_FIELDS = ["payment_intent_id", "reason", "amount_cents", "intent_status", "age_minutes", "record_status", "action_needed"];

function buildPaymentOpsAlert(event, fields = {}) {
  const alert = { event: String(event), at: new Date().toISOString() };
  for (const key of ALERT_FIELDS) {
    if (fields[key] !== undefined && fields[key] !== null) alert[key] = typeof fields[key] === "number" ? fields[key] : String(fields[key]).slice(0, 120);
  }
  if (alert.payment_intent_id && !/^pi_[A-Za-z0-9_]+$/.test(alert.payment_intent_id)) delete alert.payment_intent_id;
  return alert;
}

function releaseIdempotencyKey(intentId) {
  return `harvey-hold-release-${intentId}`;
}

module.exports = {
  STRIPE_APP_TAG,
  STRIPE_ACCOUNT_TAG,
  UNIDENTIFIED_RIDER,
  buildIntentMetadata,
  decideReconciliation,
  buildPaymentOpsAlert,
  PAYMENT_RECORD_STATUS,
  RELEASABLE_INTENT_STATUSES,
  BINDABLE_RECORD_STATUSES,
  DEFAULT_SWEEP_MIN_AGE_MS,
  buildCreatedPaymentRecord,
  buildAuthorizedPaymentRecord,
  decideHoldRelease,
  releaseIdempotencyKey
};
