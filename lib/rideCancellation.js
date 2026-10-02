// Cancellation-eligibility policy and Stripe-void resumability decisions
// for rider-initiated (and admin-incident) ride cancellation. Driver
// *withdrawal* (releasing themselves from an accepted ride, which
// returns the ride to dispatch rather than cancelling it) is a
// deliberately separate, much simpler operation -- see
// POST /api/driver/rides/:rideId/withdraw in server.js -- because it
// never touches payment at all, so it doesn't need this module.
//
// Policy (approved): no cancellation fee in this phase. Before driver
// acceptance, cancel and void any uncaptured PaymentIntent. After
// acceptance but before the trip starts, same, plus release the driver
// and record who cancelled and why. Once in_progress, self-service
// cancellation is not offered -- only an authorized admin incident
// resolution. completed/cancelled are terminal. Refunds are an explicit,
// separate workflow, not built here.

const { RIDE_STATUS } = require("./rideDispatch");

const CANCELLATION_PAYMENT_STATUS = Object.freeze({
  NOT_REQUIRED: "not_required",
  CANCEL_PENDING: "cancel_pending",
  CANCELLED: "cancelled",
  CANCEL_FAILED: "cancel_failed"
});

// Every status a rider (or an admin incident resolution) may cancel a
// ride from. Deliberately mirrors lib/rideLifecycle.js's RIDE_TRANSITIONS
// CANCELLED edges exactly -- IN_PROGRESS, COMPLETED, and CANCELLED are
// not here, matching "no self-service cancellation once a trip starts"
// and "completed/cancelled are terminal."
const CANCELLABLE_STATUSES = Object.freeze([
  RIDE_STATUS.DRAFT,
  RIDE_STATUS.PAYMENT_REQUIRED,
  RIDE_STATUS.PAYMENT_AUTHORIZED,
  RIDE_STATUS.AWAITING_DRIVER,
  RIDE_STATUS.DRIVER_ASSIGNED,
  RIDE_STATUS.DRIVER_ENROUTE,
  RIDE_STATUS.ARRIVED,
  RIDE_STATUS.FAILED
]);

// A driver is already assigned in these statuses -- cancelling from one
// of these must release the driver (see driverAvailability.js /
// ACTIVE_RIDE_STATUSES, which this is a subset of) and notify them, on
// top of the payment reconciliation every cancellation needs.
const POST_ACCEPTANCE_STATUSES = Object.freeze([
  RIDE_STATUS.DRIVER_ASSIGNED,
  RIDE_STATUS.DRIVER_ENROUTE,
  RIDE_STATUS.ARRIVED
]);

function isCancellable(status) {
  return CANCELLABLE_STATUSES.includes(status);
}

function hasAssignedDriver(status) {
  return POST_ACCEPTANCE_STATUSES.includes(status);
}

// Stable and derived only from the ride id, same rationale as
// lib/ridePaymentCapture.js's captureIdempotencyKey -- a retried or
// resumed void call reuses this key so Stripe can't be asked to cancel
// the same intent twice as two different operations.
function cancelPaymentIdempotencyKey(rideId) {
  return `cancel-payment-intent:${rideId}`;
}

// The resumability decision a cancel request (first attempt, or a
// repeated request finding the ride already cancelled) makes about the
// Stripe side, before touching Stripe:
//
//   "skip"          -- already resolved (cancelled, or genuinely
//                       not_required); do not call Stripe again.
//   "not_required"  -- no payment_id at all; nothing to void, but this
//                       ride hasn't recorded that fact yet.
//   "attempt"        -- should call Stripe now (first attempt, or
//                       resuming a cancel_pending/cancel_failed state).
//                       The caller must first retrieve the intent from
//                       Stripe and check its real status -- if Stripe
//                       reports it already succeeded (captured), this
//                       function's caller must NOT call cancel; that
//                       case routes to an explicit refund/incident
//                       workflow instead, never an automatic reversal.
function decideCancelPaymentAction({ ride }) {
  if (!ride) {
    return { action: "skip", reason: "no_ride" };
  }

  if (ride.cancellation_payment_status === CANCELLATION_PAYMENT_STATUS.CANCELLED) {
    return { action: "skip", reason: "already_cancelled" };
  }

  if (ride.cancellation_payment_status === CANCELLATION_PAYMENT_STATUS.NOT_REQUIRED) {
    return { action: "skip", reason: "not_required" };
  }

  // App Review rides are simulated end to end: no hold to release.
  if (ride.is_review_ride === true) {
    return { action: "not_required", reason: "review_ride" };
  }

  if (!ride.payment_id) {
    return { action: "not_required" };
  }

  return { action: "attempt" };
}

module.exports = {
  CANCELLATION_PAYMENT_STATUS,
  CANCELLABLE_STATUSES,
  POST_ACCEPTANCE_STATUSES,
  isCancellable,
  hasAssignedDriver,
  cancelPaymentIdempotencyKey,
  decideCancelPaymentAction
};
