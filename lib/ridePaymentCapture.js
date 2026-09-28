// Trip completion, payment capture, and driver-earning creation are three
// separate facts about a ride, tracked and resumed independently. Before
// this module: /api/driver/rides/:rideId/complete ran capture, then
// earnings creation, then the status write, as one linear sequence with
// no durable record of which step a crash landed between -- a retry
// after a crash (or a client retry after a timeout) had no way to tell
// "capture already succeeded, don't call Stripe again" from "capture was
// never attempted," and a completed ride's status alone was treated as
// proof the whole sequence had finished.
//
// This module owns the payment_status state machine and the stable,
// ride-derived Stripe idempotency key. It does not call Stripe itself
// (server.js owns the stripe client) -- these are pure decisions, so the
// resumability logic is testable without mocking an SDK.

const CAPTURE_STATUS = Object.freeze({
  PENDING: "pending",
  CAPTURE_PENDING: "capture_pending",
  CAPTURED: "captured",
  CAPTURE_FAILED: "capture_failed",
  NOT_REQUIRED: "not_required"
});

// Terminal from this module's point of view: nothing further should be
// attempted automatically. CAPTURE_FAILED is deliberately terminal here
// too -- "do not automatically retry charges indefinitely" means a
// driver double-tapping /complete (or any retry of the route itself)
// must not re-attempt a capture that already failed once. The only way
// out of capture_failed is the dedicated admin reconciliation endpoint.
const RESOLVED_CAPTURE_STATUSES = Object.freeze([
  CAPTURE_STATUS.CAPTURED,
  CAPTURE_STATUS.CAPTURE_FAILED,
  CAPTURE_STATUS.NOT_REQUIRED
]);

function isCaptureResolved(paymentStatus) {
  return RESOLVED_CAPTURE_STATUSES.includes(paymentStatus);
}

// Stable and derived only from the ride id -- the same key is reused
// across every retry/resume attempt for this ride's completion capture,
// which is exactly what makes it safe to call Stripe again after an
// unknown-outcome crash: Stripe returns the original result instead of
// creating a second capture.
function captureIdempotencyKey(rideId) {
  return `complete-capture:${rideId}`;
}

// The single resumability decision every /complete call (first attempt
// or retry) makes about the payment side, before touching Stripe:
//
//   "skip"          -- already resolved (captured, failed, or not
//                       required); do not call Stripe again.
//   "not_required"  -- no payment_id / payment gate off; nothing to
//                       capture, but this ride has never recorded that
//                       fact yet, so the caller should persist
//                       NOT_REQUIRED (distinct from "skip," which means
//                       don't even write anything -- it's already there).
//   "attempt"        -- should call Stripe now, using
//                       captureIdempotencyKey(ride.id). Covers both a
//                       true first attempt (payment_status is null/
//                       PENDING) and resuming an interrupted one
//                       (CAPTURE_PENDING) -- both are safe to (re-)try
//                       with the same idempotency key.
// forceRetry (admin-reconciliation use only, see POST /api/admin/payments/
// :rideId/reconcile) is what lets a capture that already failed once be
// retried -- without it, CAPTURE_FAILED is resolved/skipped forever, which
// is deliberate for every OTHER caller (a driver double-tapping /complete
// must not re-trigger a charge attempt on its own). CAPTURED and
// NOT_REQUIRED remain unconditionally skipped even with forceRetry --
// there's never a reason to "retry" a charge that already succeeded or
// was never owed.
function decideCaptureAction({ ride, stripeConfigured, forceRetry = false }) {
  if (!ride) {
    return { action: "skip", reason: "no_ride" };
  }

  if (
    ride.payment_status === CAPTURE_STATUS.CAPTURED ||
    ride.payment_status === CAPTURE_STATUS.NOT_REQUIRED
  ) {
    return { action: "skip", reason: `already_${ride.payment_status}` };
  }

  if (ride.payment_status === CAPTURE_STATUS.CAPTURE_FAILED && !forceRetry) {
    return { action: "skip", reason: "already_capture_failed" };
  }

  if (!stripeConfigured || !ride.payment_id) {
    return { action: "not_required" };
  }

  return { action: "attempt" };
}

module.exports = {
  CAPTURE_STATUS,
  RESOLVED_CAPTURE_STATUSES,
  isCaptureResolved,
  captureIdempotencyKey,
  decideCaptureAction
};
