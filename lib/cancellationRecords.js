// Cancellation and no-show records (docs/policy-cancellation-noshow-draft.md).
//
// Owner instruction (2026-10-04): build and test the controls and records
// first, keeping every cancellation free. Nothing here charges anything:
// assessCancellation() always returns fee_cents 0 and charges_active false,
// and the database enforces rides.cancellation_fee_cents = 0
// (migration 20261005030000). What it does record is what the draft policy
// *would* decide, so the owner can see how it behaves before approving any
// fee:
//
//   - free before a driver accepts and for 2 minutes after acceptance;
//   - after that a fee could apply only while the driver is making
//     progress toward the pickup;
//   - waived when the driver made no progress, is 5+ minutes past the
//     pickup estimate recorded at acceptance, or Harvey caused it
//     (service failure, no driver found, admin incident);
//   - a no-show needs a verified arrival at the pickup, 7 minutes of
//     waiting and a recorded contact attempt.
//
// Any record that is missing (no estimate, no location fix) waives the
// fee: an unknown is never resolved against the rider.
//
// The numbers are draft parameters for the owner's review, not promises.
// Pure functions only: no database, no network.

const POLICY_VERSION = "draft-2026-10-04";

const FREE_WINDOW_MS = 2 * 60 * 1000;
const LATE_WAIVER_MS = 5 * 60 * 1000;
const NO_SHOW_WAIT_MS = 7 * 60 * 1000;

// "Making progress toward pickup": the driver got at least this much
// closer, at least this recently (or has arrived).
const PROGRESS_MIN_METERS = 50;
const PROGRESS_RECENT_MS = 3 * 60 * 1000;

// "Verified arrival": a fix this fresh and this accurate, this close to
// the pickup point.
const ARRIVAL_MAX_DISTANCE_M = 150;
const ARRIVAL_MAX_FIX_AGE_MS = 2 * 60 * 1000;
const ARRIVAL_MAX_ACCURACY_M = 100;

const CANCELLATION_CATEGORY = Object.freeze({
  RIDER: "rider_cancelled",
  DRIVER_NO_SHOW: "driver_no_show",
  SERVICE_FAILURE: "harvey_service_failure",
  ADMIN_INCIDENT: "admin_incident"
});

const CONTACT_METHODS = Object.freeze(["call", "message"]);

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const ms = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pickupOf(ride) {
  const lat = num(ride && ride.pickup_lat);
  const lng = num(ride && ride.pickup_lng);
  return lat === null || lng === null ? null : { lat, lng };
}

// At acceptance: the pickup estimate the rider is shown, kept so a later
// "5 minutes late" check compares against what was promised, not the
// latest moving estimate. The ORIGINAL estimate is kept for the whole ride:
// when a driver releases the ride and another accepts it, the first
// estimate and its due time stay (the rider was promised that time; a
// reassignment never moves it later). The per-driver records (progress,
// arrival, contact attempts) reset for the new driver.
function estimateAtAcceptPatch({ acceptedAt, etaMinutes, existing = null }) {
  const at = ms(acceptedAt);
  const eta = num(etaMinutes);
  const usable = at !== null && eta !== null && eta >= 0 && eta <= 240;
  const keepOriginal = Boolean(existing && existing.pickup_due_at);
  return {
    ...(keepOriginal
      ? {}
      : {
          eta_at_accept_minutes: usable ? Math.round(eta * 10) / 10 : null,
          pickup_due_at: usable ? new Date(at + eta * 60000).toISOString() : null
        }),
    pickup_start_distance_m: null,
    pickup_last_distance_m: null,
    pickup_progress_at: null,
    pickup_fix_lat: null,
    pickup_fix_lng: null,
    pickup_fix_accuracy_m: null,
    pickup_fix_at: null,
    arrival_verified: null,
    arrival_distance_m: null,
    arrival_check: null,
    contact_attempt_count: 0,
    last_contact_attempt_at: null
  };
}

// One driver location sample before pickup -> the ride's progress record.
// Progress is counted when the driver is at least PROGRESS_MIN_METERS
// closer than the last distance that counted.
function progressPatch(ride, { lat, lng, accuracy, at }) {
  const pickup = pickupOf(ride);
  const la = num(lat);
  const lo = num(lng);
  if (!pickup || la === null || lo === null) return null;
  const when = new Date(ms(at) ?? Date.now()).toISOString();
  const distance = Math.round(haversineMeters(la, lo, pickup.lat, pickup.lng));
  const lastCounted = num(ride.pickup_last_distance_m);
  const patch = {
    pickup_fix_lat: la,
    pickup_fix_lng: lo,
    pickup_fix_accuracy_m: num(accuracy),
    pickup_fix_at: when
  };
  if (num(ride.pickup_start_distance_m) === null) patch.pickup_start_distance_m = distance;
  if (lastCounted === null) {
    patch.pickup_last_distance_m = distance;
  } else if (lastCounted - distance >= PROGRESS_MIN_METERS) {
    patch.pickup_last_distance_m = distance;
    patch.pickup_progress_at = when;
  }
  return patch;
}

// When the driver taps Arrived: is the latest fix fresh, accurate and at
// the pickup? Recorded, never blocking (a driver can always mark arrival).
function arrivalCheck(ride, { fix = null, now = Date.now() } = {}) {
  const pickup = pickupOf(ride);
  const f = fix || {
    lat: ride && ride.pickup_fix_lat,
    lng: ride && ride.pickup_fix_lng,
    accuracy: ride && ride.pickup_fix_accuracy_m,
    at: ride && ride.pickup_fix_at
  };
  const lat = num(f.lat);
  const lng = num(f.lng);
  const at = ms(f.at);
  const accuracy = num(f.accuracy);
  if (!pickup) return { arrival_verified: false, arrival_distance_m: null, arrival_check: "no_pickup_location" };
  if (lat === null || lng === null || at === null) return { arrival_verified: false, arrival_distance_m: null, arrival_check: "no_driver_location" };
  const distance = Math.round(haversineMeters(lat, lng, pickup.lat, pickup.lng));
  if (now - at > ARRIVAL_MAX_FIX_AGE_MS) return { arrival_verified: false, arrival_distance_m: distance, arrival_check: "location_stale" };
  if (accuracy !== null && accuracy > ARRIVAL_MAX_ACCURACY_M) return { arrival_verified: false, arrival_distance_m: distance, arrival_check: "location_inaccurate" };
  if (distance > ARRIVAL_MAX_DISTANCE_M) return { arrival_verified: false, arrival_distance_m: distance, arrival_check: "not_at_pickup" };
  return { arrival_verified: true, arrival_distance_m: distance, arrival_check: "verified" };
}

function driverProgressing(ride, now) {
  if (ride.status === "arrived") return true;
  const at = ms(ride.pickup_progress_at);
  return at !== null && now - at <= PROGRESS_RECENT_MS;
}

// What the draft policy would decide for a cancellation now. Never a
// charge: fee_cents is always 0 and charges_active false.
function assessCancellation(ride, { now = Date.now(), category = CANCELLATION_CATEGORY.RIDER } = {}) {
  const accepted = ms(ride.accepted_at);
  const assigned = ["driver_assigned", "driver_enroute", "arrived"].includes(ride.status);
  const waivers = [];
  let phase;
  if (category === CANCELLATION_CATEGORY.SERVICE_FAILURE || category === CANCELLATION_CATEGORY.ADMIN_INCIDENT || ride.status === "failed") {
    phase = "harvey";
    waivers.push("harvey_service_failure");
  } else if (!assigned || accepted === null) {
    phase = "before_acceptance";
    waivers.push("before_acceptance");
  } else if (now - accepted <= FREE_WINDOW_MS) {
    phase = "free_window";
    waivers.push("within_free_window");
  } else {
    phase = "after_free_window";
    if (!driverProgressing(ride, now)) waivers.push("no_driver_progress");
    const due = ms(ride.pickup_due_at);
    if (due === null) waivers.push("pickup_estimate_unknown");
    else if (ride.status !== "arrived" && now >= due + LATE_WAIVER_MS) waivers.push("driver_5_min_late");
    else if (ride.status === "arrived" && ms(ride.arrived_at) !== null && ms(ride.arrived_at) >= due + LATE_WAIVER_MS) waivers.push("driver_5_min_late");
  }
  return {
    policy_version: POLICY_VERSION,
    category,
    phase,
    seconds_since_acceptance: accepted === null ? null : Math.max(0, Math.round((now - accepted) / 1000)),
    // Whether the draft policy would allow a fee (only after the free
    // window, with the driver progressing and no waiver).
    policy_fee_eligible: phase === "after_free_window" && waivers.length === 0,
    waivers,
    fee_cents: 0,
    charges_active: false
  };
}

// Whether a driver may mark the rider as a no-show now, and what's missing.
function noShowEligibility(ride, { now = Date.now() } = {}) {
  const missing = [];
  if (ride.status !== "arrived") missing.push("not_arrived");
  if (ride.arrival_verified !== true) missing.push("arrival_not_verified");
  const arrived = ms(ride.arrived_at);
  const waited = arrived === null ? 0 : Math.max(0, now - arrived);
  if (waited < NO_SHOW_WAIT_MS) missing.push("wait_under_7_minutes");
  const contacted = ms(ride.last_contact_attempt_at);
  if (contacted === null || arrived === null || contacted < arrived) missing.push("no_contact_attempt_after_arrival");
  return {
    eligible: missing.length === 0,
    missing,
    waited_seconds: Math.round(waited / 1000),
    wait_required_seconds: NO_SHOW_WAIT_MS / 1000,
    seconds_until_wait_met: Math.max(0, Math.round((NO_SHOW_WAIT_MS - waited) / 1000))
  };
}

// What a rider sees before confirming: always the exact fee that will be
// charged. Today that is always $0.00.
function cancelPreview(ride, { now = Date.now() } = {}) {
  const assessment = assessCancellation(ride, { now });
  return {
    fee_cents: assessment.fee_cents,
    fee_display: `$${(assessment.fee_cents / 100).toFixed(2)}`,
    free: assessment.fee_cents === 0,
    message: "Cancelling this ride is free. You won't be charged, and any hold on your card is released.",
    assessment
  };
}

// The ride columns the pickup records write. Records only: no ride
// status, assignment or payment column is ever among them.
const PICKUP_RECORD_COLUMNS = Object.freeze(Object.keys(estimateAtAcceptPatch({ acceptedAt: null, etaMinutes: null })));

module.exports = {
  POLICY_VERSION,
  PICKUP_RECORD_COLUMNS,
  FREE_WINDOW_MS,
  LATE_WAIVER_MS,
  NO_SHOW_WAIT_MS,
  PROGRESS_MIN_METERS,
  PROGRESS_RECENT_MS,
  ARRIVAL_MAX_DISTANCE_M,
  ARRIVAL_MAX_FIX_AGE_MS,
  ARRIVAL_MAX_ACCURACY_M,
  CANCELLATION_CATEGORY,
  CONTACT_METHODS,
  haversineMeters,
  estimateAtAcceptPatch,
  progressPatch,
  arrivalCheck,
  assessCancellation,
  noShowEligibility,
  cancelPreview
};
