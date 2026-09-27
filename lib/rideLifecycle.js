// Centralized, server-side ride-status transition table plus the one
// atomic primitive every status-changing route should go through instead
// of an unconditional `.update({status: X}).eq("id", rideId)`.
//
// Before this module: every driver-side transition route (enroute,
// arrived, start, complete) wrote a new status unconditionally, checking
// only "is this the assigned driver," never "is the ride currently in a
// status this transition is legal from." That allowed a completed ride to
// be reopened by a stray/duplicate call, and gave /complete no protection
// against being run twice concurrently. claimRideTransition() closes both
// gaps with one atomic, race-safe primitive: a conditional UPDATE whose
// WHERE clause is the current status itself, exactly the pattern already
// proven by the driver-offer accept/decline routes (`.eq("status",
// "pending")`) -- only the caller whose request actually matches a row
// gets to proceed; everyone else (a concurrent racer, a stale retry, a
// genuinely wrong-state request) gets back a clear "did not apply."
//
// Dependency-free except for RIDE_STATUS (no Supabase import at module
// load), so the transition table itself is directly unit-testable. The
// one function that touches the database (claimRideTransition) takes its
// Supabase client as a parameter rather than importing one, so it works
// against both the real client and test/fakeSupabase.js.

const { RIDE_STATUS } = require("./rideDispatch");

// The map: current status -> the set of statuses a *normal* (non-incident)
// operation may move it to next. This is the actual lifecycle graph, not
// a permissions table -- which actor (rider/driver/admin/system) may walk
// a given edge is enforced by which route/middleware calls
// claimRideTransition(), not by this module.
//
// completed and cancelled are hard-terminal: no entry for either key
// below means no code path -- including the admin incident-resolution
// route -- can transition a ride *out* of either state through this
// primitive. (The admin incident route is documented as an intentional,
// narrowly-scoped exception to the normal graph for the one case this
// table doesn't cover -- an in_progress ride that needs a human
// resolution -- and it still uses claimRideTransition() for the actual
// write, it just isn't restricted to the edges listed here. See
// resolveRideIncident() in server.js.)
const RIDE_TRANSITIONS = Object.freeze({
  [RIDE_STATUS.DRAFT]: [
    RIDE_STATUS.PAYMENT_REQUIRED,
    RIDE_STATUS.PAYMENT_AUTHORIZED,
    RIDE_STATUS.CANCELLED
  ],
  [RIDE_STATUS.PAYMENT_REQUIRED]: [
    RIDE_STATUS.PAYMENT_AUTHORIZED,
    RIDE_STATUS.FAILED,
    RIDE_STATUS.CANCELLED
  ],
  [RIDE_STATUS.PAYMENT_AUTHORIZED]: [
    RIDE_STATUS.AWAITING_DRIVER,
    RIDE_STATUS.FAILED,
    RIDE_STATUS.CANCELLED
  ],
  [RIDE_STATUS.AWAITING_DRIVER]: [
    RIDE_STATUS.DRIVER_ASSIGNED,
    // max dispatch attempts reached / no drivers available
    RIDE_STATUS.FAILED,
    RIDE_STATUS.CANCELLED
  ],
  [RIDE_STATUS.DRIVER_ASSIGNED]: [
    RIDE_STATUS.DRIVER_ENROUTE,
    RIDE_STATUS.CANCELLED,
    // driver withdrawal: releases the driver, returns the ride to
    // dispatch -- a different operation from cancellation, see
    // lib/rideCancellation.js and POST /api/driver/rides/:id/withdraw.
    RIDE_STATUS.AWAITING_DRIVER
  ],
  [RIDE_STATUS.DRIVER_ENROUTE]: [
    RIDE_STATUS.ARRIVED,
    RIDE_STATUS.CANCELLED,
    RIDE_STATUS.AWAITING_DRIVER
  ],
  [RIDE_STATUS.ARRIVED]: [
    RIDE_STATUS.IN_PROGRESS,
    RIDE_STATUS.CANCELLED,
    RIDE_STATUS.AWAITING_DRIVER
  ],
  // Deliberately no CANCELLED here: once a trip is in_progress, rider/
  // driver self-service cancellation is no longer offered (per policy) --
  // only completion, or an authorized admin incident resolution which
  // bypasses this table entirely and is separately audited.
  [RIDE_STATUS.IN_PROGRESS]: [
    RIDE_STATUS.COMPLETED
  ],
  // A failed dispatch (no drivers found / max attempts) can still be
  // manually redispatched or cancelled; it is not terminal the way
  // completed/cancelled are.
  [RIDE_STATUS.FAILED]: [
    RIDE_STATUS.AWAITING_DRIVER,
    RIDE_STATUS.CANCELLED
  ],
  [RIDE_STATUS.COMPLETED]: [],
  [RIDE_STATUS.CANCELLED]: []
});

const TERMINAL_STATUSES = Object.freeze([
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELLED
]);

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function isValidTransition(fromStatus, toStatus) {
  const allowed = RIDE_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

// The one atomic primitive. `fromStatuses` is normally the exact set
// isValidTransition() would allow into `toStatus`, but callers doing an
// idempotent-retry check (cancellation, completion) may pass a narrower
// or different set deliberately -- this function does not itself consult
// RIDE_TRANSITIONS; validating that a given (from, to) pair is legal is
// the caller's job (via isValidTransition or by construction), so this
// stays a pure "conditional write" primitive usable for both normal
// transitions and the admin incident-resolution exception.
//
// Returns:
//   { ok: true, ride }
//     -- this call won the claim; `ride` is the row *after* the update.
//   { ok: false, reason: "not_found", ride: null }
//     -- no ride exists with this id.
//   { ok: false, reason: "invalid_transition", currentStatus, ride }
//     -- the ride exists, but its status wasn't one of fromStatuses at
//        the moment of the attempted write (already transitioned by a
//        concurrent request, a stale retry, or a genuinely wrong-state
//        call). `ride` is the *current* row, fetched fresh, so the
//        caller can decide how to respond (e.g. "already completed" is
//        not an error to a client retrying after a timeout).
async function claimRideTransition({
  supabase,
  rideId,
  fromStatuses,
  toStatus,
  patch = {}
}) {
  const fromList = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];

  const { data, error } = await supabase
    .from("rides")
    .update({ status: toStatus, ...patch })
    .eq("id", rideId)
    .in("status", fromList)
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return { ok: true, ride: data };
  }

  // Didn't win the claim. Find out why, so the caller can respond
  // correctly (404 vs 409, and "already done" vs "wrong state").
  const { data: current, error: lookupError } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (!current) {
    return { ok: false, reason: "not_found", currentStatus: null, ride: null };
  }

  return {
    ok: false,
    reason: "invalid_transition",
    currentStatus: current.status,
    ride: current
  };
}

module.exports = {
  RIDE_TRANSITIONS,
  TERMINAL_STATUSES,
  isTerminalStatus,
  isValidTransition,
  claimRideTransition
};
