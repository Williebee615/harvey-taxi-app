// Busy-driver exclusion for the Node-side driver-matching fallback path
// (findAvailableDrivers() in server.js, used only when the nearest_drivers
// RPC is unreachable). The RPC itself gets the equivalent SQL exclusion
// plus a real advisory-lock concurrency guarantee (see the
// dispatch_ride_atomic migration) -- this module is the best-effort
// matching-time filter for the fallback path only, and does NOT by
// itself prevent two concurrent dispatch attempts from both matching the
// same driver before either commits an offer. That guarantee exists only
// on the atomic RPC path; see the migration's own comments for why the
// fallback can't fully match it without becoming its own stored
// procedure.
//
// Before this module: neither the nearest_drivers() RPC nor the Node
// fallback excluded a driver already assigned to another active ride --
// only online/status/approval_status were checked. A driver mid-trip
// remained eligible to be offered a second, unrelated ride.

const { RIDE_STATUS } = require("./rideDispatch");

// A driver counts as "busy" while assigned to a ride in any of these
// statuses. Deliberately excludes AWAITING_DRIVER (not yet assigned to
// anyone) and every terminal/pre-assignment status.
const ACTIVE_RIDE_STATUSES = Object.freeze([
  RIDE_STATUS.DRIVER_ASSIGNED,
  RIDE_STATUS.DRIVER_ENROUTE,
  RIDE_STATUS.ARRIVED,
  RIDE_STATUS.IN_PROGRESS
]);

// Pure: given a list of driver rows and a set of busy driver ids, returns
// only the drivers not currently on an active ride. Kept separate from
// the DB query below so the exclusion logic itself is trivially
// unit-testable without a database.
function excludeBusyDrivers(drivers, busyDriverIds) {
  const busy = new Set((busyDriverIds || []).map((id) => String(id)));
  return (drivers || []).filter((driver) => !busy.has(String(driver && driver.id)));
}

// Queries which drivers currently have an active-ride assignment.
// Returns a deduplicated array of driver ids (not a Set, so callers can
// pass it straight to excludeBusyDrivers or log/inspect it directly).
async function getBusyDriverIds({ supabase, statuses = ACTIVE_RIDE_STATUSES }) {
  const { data, error } = await supabase
    .from("rides")
    .select("driver_id")
    .in("status", statuses);

  if (error) {
    throw error;
  }

  const ids = (data || [])
    .map((row) => row.driver_id)
    .filter((id) => id !== null && id !== undefined && id !== "");

  return Array.from(new Set(ids.map((id) => String(id))));
}

module.exports = {
  ACTIVE_RIDE_STATUSES,
  excludeBusyDrivers,
  getBusyDriverIds
};
