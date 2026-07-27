// Ride status/dispatch constants and pure decision logic, kept dependency-free
// (no Supabase, no env vars) so this module can be required directly by tests
// without booting the whole server. server.js requires this instead of
// defining RIDE_STATUS/shouldDispatchRideNow inline.

const RIDE_STATUS = {
  DRAFT: "draft",
  PAYMENT_REQUIRED: "payment_required",
  PAYMENT_AUTHORIZED: "payment_authorized",
  AWAITING_DRIVER: "awaiting_driver_acceptance",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_ENROUTE: "driver_enroute",
  ARRIVED: "arrived",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed"
};

// Single source of truth for "is it time to send this ride to dispatch."
// Used by every route that might dispatch a ride (creation, payment
// authorization) and by sweepScheduledRides() in server.js, so a scheduled
// ride is held consistently no matter which path got it to
// PAYMENT_AUTHORIZED.
function shouldDispatchRideNow(ride, now = new Date()) {
  if (!ride || ride.status !== RIDE_STATUS.PAYMENT_AUTHORIZED) {
    return false;
  }

  if (!ride.scheduled_time) {
    return true;
  }

  const scheduledAt = new Date(ride.scheduled_time);

  if (Number.isNaN(scheduledAt.getTime())) {
    // Unparseable scheduled_time shouldn't silently block dispatch forever.
    return true;
  }

  return scheduledAt.getTime() <= now.getTime();
}

// How long a ride is allowed to sit claimed ("dispatching") before a later
// sweep treats the claim as stale and reclaims it. Covers the case a plain
// try/catch can't: the process dying between the claim and dispatchRide()
// completing, where no catch block ever runs to reset the ride itself.
const SCHEDULED_DISPATCH_LEASE_MS = 5 * 60 * 1000;

// Orchestrates one sweep pass over due scheduled rides. Takes its I/O as
// injected functions rather than talking to Supabase directly, so the
// retry/skip/reclaim logic — the part that actually had the reliability
// bugs — is unit-testable without a database. server.js wires the real
// Supabase-backed findDueRides/claimRide/resetRide here; see
// findDueScheduledRides/claimScheduledRide/resetScheduledRideForRetry.
//
// findDueRides(nowDate, cutoffDate) -> ride[]
//   Rides past their scheduled_time that are either still
//   "ready_to_dispatch", or "dispatching" with a claim older than
//   cutoffDate (a stale/crashed claim).
// claimRide(rideId, cutoffDate) -> ride | null
//   Atomically claims one ride, re-checking both dispatch_status and ride
//   status so a ride that changed state after the query above (e.g. a
//   future cancellation feature) can't be claimed. Returns null if the
//   claim didn't apply to any row.
// resetRide(rideId) -> void
//   Puts a ride back to "ready_to_dispatch" so the next sweep retries it
//   immediately, rather than waiting out the full lease timeout.
// dispatchRide(ride) -> dispatch result
//   The existing dispatch logic (offer creation, notifications, etc).
async function sweepScheduledRides({
  findDueRides,
  claimRide,
  resetRide,
  dispatchRide,
  now = () => new Date(),
  log = console.log,
  logError = console.error
}) {
  const nowDate = now();
  const cutoffDate = new Date(nowDate.getTime() - SCHEDULED_DISPATCH_LEASE_MS);

  const result = { dispatched: [], failed: [], skipped: [] };

  let dueRides;

  try {
    dueRides = await findDueRides(nowDate, cutoffDate);
  } catch (err) {
    logError("⚠️ sweepScheduledRides query failed:", err.message);
    return result;
  }

  for (const ride of dueRides || []) {
    let claimed;

    try {
      claimed = await claimRide(ride.id, cutoffDate);
    } catch (err) {
      logError(`⚠️ sweepScheduledRides claim failed for ${ride.id}:`, err.message);
      result.skipped.push(ride.id);
      continue;
    }

    if (!claimed) {
      // Already claimed by another tick, or the ride's state changed (e.g.
      // cancelled) between the query above and this claim attempt.
      result.skipped.push(ride.id);
      continue;
    }

    log(
      `🕐 sweepScheduledRides: ride ${claimed.id} was scheduled for ` +
      `${claimed.scheduled_time} and is now due — dispatching.`
    );

    try {
      await dispatchRide(claimed);
      result.dispatched.push(claimed.id);
    } catch (err) {
      logError(
        `⚠️ sweepScheduledRides dispatch failed for ${claimed.id}, resetting for retry:`,
        err.message
      );

      try {
        await resetRide(claimed.id);
      } catch (resetErr) {
        logError(
          `⚠️ sweepScheduledRides failed to reset ${claimed.id} after failed dispatch ` +
          `(it will stay claimed until the lease timeout):`,
          resetErr.message
        );
      }

      result.failed.push(claimed.id);
    }
  }

  return result;
}

module.exports = {
  RIDE_STATUS,
  shouldDispatchRideNow,
  sweepScheduledRides,
  SCHEDULED_DISPATCH_LEASE_MS
};
