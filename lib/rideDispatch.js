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

module.exports = { RIDE_STATUS, shouldDispatchRideNow };
