// Autonomous Pilot V1 — pure lifecycle state machine + zone eligibility
// logic. Dependency-free (no Supabase, no Express) so it's directly
// unit-testable, same pattern as lib/pricing.js and lib/rideDispatch.js.
//
// Deliberately does NOT touch rides.status (RIDE_STATUS in
// lib/rideDispatch.js) — that stays the canonical ride lifecycle every
// dispatch/payment/admin code path already depends on. pilot_status is
// a separate, additive substate that only pilot-aware code ever reads.

const PILOT_STATUS = {
  REQUESTED: "pilot_requested",
  ELIGIBILITY_CHECK: "eligibility_check",
  WAITLISTED: "waitlisted",
  VEHICLE_RESERVED: "vehicle_reserved",
  VEHICLE_ENROUTE: "vehicle_enroute",
  VEHICLE_ARRIVED: "vehicle_arrived",
  BOARDING_CONFIRMATION: "boarding_confirmation",
  TRIP_IN_PROGRESS: "trip_in_progress",
  TRIP_COMPLETED: "trip_completed",
  HUMAN_FALLBACK_OFFERED: "human_fallback_offered",
  CANCELLED: "cancelled"
};

const AVAILABILITY_RESULT = {
  VEHICLE_AVAILABLE: "vehicle_available",
  WAITLISTED: "waitlisted",
  HUMAN_FALLBACK_OFFERED: "human_fallback_offered",
  OUTSIDE_ZONE: "outside_zone",
  PILOT_PAUSED: "pilot_paused"
};

// Every non-terminal status may move to CANCELLED except
// TRIP_IN_PROGRESS — once a trip is actually underway, "cancel the
// pilot request" is the wrong control; that's what the separate
// emergency/support workflow exists for, not this state machine.
const PILOT_TRANSITIONS = {
  [PILOT_STATUS.REQUESTED]: [PILOT_STATUS.ELIGIBILITY_CHECK, PILOT_STATUS.CANCELLED],
  [PILOT_STATUS.ELIGIBILITY_CHECK]: [
    PILOT_STATUS.WAITLISTED,
    PILOT_STATUS.VEHICLE_RESERVED,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.WAITLISTED]: [
    PILOT_STATUS.VEHICLE_RESERVED,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.VEHICLE_RESERVED]: [
    PILOT_STATUS.VEHICLE_ENROUTE,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.VEHICLE_ENROUTE]: [
    PILOT_STATUS.VEHICLE_ARRIVED,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.VEHICLE_ARRIVED]: [
    PILOT_STATUS.BOARDING_CONFIRMATION,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.BOARDING_CONFIRMATION]: [
    PILOT_STATUS.TRIP_IN_PROGRESS,
    PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
    PILOT_STATUS.CANCELLED
  ],
  [PILOT_STATUS.TRIP_IN_PROGRESS]: [PILOT_STATUS.TRIP_COMPLETED],
  [PILOT_STATUS.TRIP_COMPLETED]: [],
  [PILOT_STATUS.HUMAN_FALLBACK_OFFERED]: [],
  [PILOT_STATUS.CANCELLED]: []
};

const TERMINAL_PILOT_STATUSES = [
  PILOT_STATUS.TRIP_COMPLETED,
  PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
  PILOT_STATUS.CANCELLED
];

function isTerminalPilotStatus(status) {
  return TERMINAL_PILOT_STATUSES.includes(status);
}

const VALID_PILOT_STATUSES = Object.values(PILOT_STATUS);

// Re-applying the same status is always allowed — this is what makes a
// retried/duplicate provider callback a safe no-op instead of a
// rejected transition. The database-level guard against true duplicate
// provider events is the partial unique index on
// autonomous_pilot_events.provider_event_id (see the schema migration);
// this is the corresponding lifecycle-level guarantee that replaying
// the same transition twice never errors.
function canTransitionPilotStatus(fromStatus, toStatus) {
  if (!VALID_PILOT_STATUSES.includes(fromStatus) || !VALID_PILOT_STATUSES.includes(toStatus)) {
    return false;
  }

  if (fromStatus === toStatus) {
    return true;
  }

  return (PILOT_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

// Pure transition function — no side effects, no I/O. Returns a result
// object rather than throwing, so callers can branch on `ok` directly.
function transitionPilotStatus(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return { ok: true, status: toStatus, idempotent: true };
  }

  if (!canTransitionPilotStatus(fromStatus, toStatus)) {
    return {
      ok: false,
      status: fromStatus,
      error: `Cannot transition pilot_status from "${fromStatus}" to "${toStatus}".`
    };
  }

  return { ok: true, status: toStatus, idempotent: false };
}

// A pilot request may only be cancelled while it's in a non-terminal,
// not-yet-in-progress state. Checked directly against the transition
// graph (not via canTransitionPilotStatus) because that function's
// same-status-is-idempotent rule exists for retried provider callbacks
// landing on an unchanged non-terminal status — it would otherwise
// make canCancelPilotStatus(CANCELLED) incorrectly return true, as if
// an already-cancelled request could be meaningfully cancelled again.
function canCancelPilotStatus(status) {
  if (isTerminalPilotStatus(status)) {
    return false;
  }

  return (PILOT_TRANSITIONS[status] || []).includes(PILOT_STATUS.CANCELLED);
}

// The single gate dispatchRide() (server.js) must check before letting
// a ride enter the normal human-driver offer pool. Non-pilot rides are
// always allowed through, unaffected by anything in this module.
function canEnterHumanDispatch(ride) {
  if (!ride || !ride.autonomous_pilot) {
    return true;
  }

  return ride.human_fallback_allowed === true;
}

// Valid only when a real disclosure acceptance was recorded (a
// timestamp exists) AND it was accepted against the disclosure version
// currently in force — accepting an old version's text never counts as
// consenting to a newer one.
function hasValidPilotConsent(ride, currentDisclosureVersion) {
  if (!ride || !ride.pilot_consent_at || !currentDisclosureVersion) {
    return false;
  }

  return ride.pilot_disclosure_version === currentDisclosureVersion;
}

// ---- Zone eligibility ----

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Duplicated (not imported) from server.js's haversineMiles on purpose
// — this module must stay dependency-free/testable without booting the
// whole server, same as lib/pricing.js and lib/rideDispatch.js.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a));
}

// Simple ray-casting point-in-polygon check. polygon is an array of
// [lng, lat] pairs (GeoJSON coordinate order).
function isPointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  const { lat, lng } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lngI, latI] = polygon[i];
    const [lngJ, latJ] = polygon[j];

    const intersects =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// service_hours: { mon: [["08:00","20:00"], ...], ... }, in whatever
// local time `at` represents. No timezone conversion happens here — a
// day key with no entry is treated as closed that day; no
// service_hours at all means always-open whenever the zone is active.
function isWithinServiceHours(serviceHours, at = new Date()) {
  if (!serviceHours) {
    return true;
  }

  const windows = serviceHours[DAY_KEYS[at.getDay()]];

  if (!windows || !windows.length) {
    return false;
  }

  const minutesNow = at.getHours() * 60 + at.getMinutes();

  return windows.some(([start, end]) => {
    const [startH, startM] = String(start).split(":").map(Number);
    const [endH, endM] = String(end).split(":").map(Number);

    if (![startH, startM, endH, endM].every(Number.isFinite)) {
      return false;
    }

    return minutesNow >= startH * 60 + startM && minutesNow <= endH * 60 + endM;
  });
}

// A zone must be active, the point must fall within its radius (and
// its polygon too, if one is configured — both must pass), and the
// current time must fall within its configured service hours. No zone
// match at all, or an inactive zone, means "outside pilot zone" — this
// function never defaults to city-wide availability.
function isWithinPilotZone(zone, point, at = new Date()) {
  if (!zone || !zone.active) {
    return false;
  }

  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) {
    return false;
  }

  const distanceMiles = haversineMiles(
    Number(zone.center_lat),
    Number(zone.center_lng),
    Number(point.lat),
    Number(point.lng)
  );

  if (distanceMiles > Number(zone.radius_miles)) {
    return false;
  }

  if (zone.polygon && !isPointInPolygon(point, zone.polygon)) {
    return false;
  }

  return isWithinServiceHours(zone.service_hours, at);
}

// Finds the first active zone that both the pickup AND destination fall
// inside. A pilot trip must start and end inside a served zone —
// partial coverage isn't "eligible."
function findMatchingPilotZone(zones, pickup, destination, at = new Date()) {
  if (!Array.isArray(zones)) {
    return null;
  }

  return (
    zones.find(
      (zone) => isWithinPilotZone(zone, pickup, at) && isWithinPilotZone(zone, destination, at)
    ) || null
  );
}

// The single honest-availability decision point. Order matters: a
// paused pilot always wins (even with a matched zone and an available
// vehicle, "paused" is the truthful answer an admin chose), then zone
// eligibility, then whatever the provider adapter actually reported.
function evaluatePilotAvailability({ pilotEnabled, matchedZone, providerAvailability }) {
  if (!pilotEnabled) {
    return { result: AVAILABILITY_RESULT.PILOT_PAUSED };
  }

  if (!matchedZone) {
    return { result: AVAILABILITY_RESULT.OUTSIDE_ZONE };
  }

  if (providerAvailability && providerAvailability.available === true) {
    return { result: AVAILABILITY_RESULT.VEHICLE_AVAILABLE, zone: matchedZone };
  }

  if (providerAvailability && providerAvailability.humanFallbackOffered === true) {
    return { result: AVAILABILITY_RESULT.HUMAN_FALLBACK_OFFERED, zone: matchedZone };
  }

  return { result: AVAILABILITY_RESULT.WAITLISTED, zone: matchedZone };
}

module.exports = {
  PILOT_STATUS,
  AVAILABILITY_RESULT,
  TERMINAL_PILOT_STATUSES,
  isTerminalPilotStatus,
  canTransitionPilotStatus,
  transitionPilotStatus,
  canCancelPilotStatus,
  canEnterHumanDispatch,
  hasValidPilotConsent,
  haversineMiles,
  isPointInPolygon,
  isWithinServiceHours,
  isWithinPilotZone,
  findMatchingPilotZone,
  evaluatePilotAvailability
};
