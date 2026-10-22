// Dispatch exception console, v1 (owner decisions 2026-10-22): flag rides
// that need a person's attention, from real ride and driver data, and
// suggest nearby ready drivers. Staff decide every action; nothing here
// reassigns, pays or contacts anyone. Pure rules; server.js reads the data.

// Scheduled rides are offered to drivers at their scheduled time
// (lib/rideDispatch.js), so the early warning is coverage: a pickup coming
// up with no ready driver online nearby.
const SCHEDULED_LOOKAHEAD_MIN = 45;
const SCHEDULED_CRITICAL_MIN = 30;
const COVERAGE_RADIUS_MILES = 10;
// A driver counts as "live" if their location updated this recently.
const LIVE_LOCATION_MAX_AGE_MS = 3 * 60 * 1000;
const UNMATCHED_WARNING_S = 120;
const UNMATCHED_CRITICAL_S = 300;
const LATE_WARNING_MIN = 10;
const LATE_CRITICAL_MIN = 20;
const ARRIVED_WAIT_INFO_MIN = 10;
const MAX_CANDIDATES = 5;

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const ON_TRIP_STATUSES = ["driver_assigned", "driver_enroute", "arrived", "in_progress"];
const WAITING_STATUSES = ["awaiting_driver_acceptance"];
// Statuses staff may reassign from the console: before the trip starts.
const REASSIGNABLE_STATUSES = ["payment_authorized", "awaiting_driver_acceptance", "driver_assigned", "driver_enroute"];

const ms = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

function milesBetween(a, b) {
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const driverPoint = (d) => ({ lat: d.current_lat ?? d.latitude, lng: d.current_lng ?? d.longitude });
const pickupPoint = (r) => ({ lat: r.pickup_lat, lng: r.pickup_lng });

function driverLive(driver, now) {
  const seen = ms(driver.last_seen_at);
  return Boolean(driver.online || driver.is_online) && seen !== null && now - seen <= LIVE_LOCATION_MAX_AGE_MS;
}

// Ready drivers near a pickup, nearest first. `isReady(driver)` is the
// server's verification rule; `busyDriverIds` are drivers on a trip.
function candidateDrivers(ride, drivers, { now = Date.now(), isReady = () => true, busyDriverIds = new Set(), limit = MAX_CANDIDATES } = {}) {
  return drivers
    .filter((d) => driverLive(d, now) && isReady(d) && !busyDriverIds.has(String(d.id)) && String(d.id) !== String(ride.driver_id || ""))
    .map((d) => ({ driver: d, miles: milesBetween(driverPoint(d), pickupPoint(ride)) }))
    .filter((c) => c.miles !== null)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit)
    .map((c) => ({
      driver_id: c.driver.id,
      name: [c.driver.first_name, c.driver.last_name ? `${String(c.driver.last_name)[0]}.` : ""].filter(Boolean).join(" ") || "Driver",
      vehicle: [c.driver.vehicle_year, c.driver.vehicle_make, c.driver.vehicle_model].filter(Boolean).join(" "),
      straight_line_miles: Math.round(c.miles * 10) / 10
    }));
}

// Returns the exceptions for one ride, most severe first.
function rideExceptions(ride, { now = Date.now(), driversById = new Map(), liveReadyNearby = 0 } = {}) {
  const out = [];
  const add = (code, severity, label, detail) => out.push({ code, severity, label, detail });
  const status = ride.status;

  // 1. Scheduled pickup soon with no ready driver online nearby.
  const scheduled = ms(ride.scheduled_time);
  if (scheduled !== null && status === "payment_authorized" && !ride.driver_id) {
    const minutesAway = (scheduled - now) / 60000;
    if (minutesAway > 0 && minutesAway <= SCHEDULED_LOOKAHEAD_MIN && liveReadyNearby === 0) {
      add(
        "scheduled_no_coverage",
        minutesAway <= SCHEDULED_CRITICAL_MIN ? "critical" : "warning",
        `Scheduled pickup in ${Math.round(minutesAway)} min, no ready driver online within ${COVERAGE_RADIUS_MILES} miles`,
        { minutes_to_pickup: Math.round(minutesAway) }
      );
    }
  }

  // 2. A driver is assigned but has gone offline or stopped updating.
  if (ride.driver_id && ON_TRIP_STATUSES.includes(status)) {
    const driver = driversById.get(String(ride.driver_id));
    if (!driver || !driverLive(driver, now)) {
      const seen = driver ? ms(driver.last_seen_at) : null;
      add(
        "driver_not_live",
        status === "in_progress" ? "warning" : "critical",
        driver && !(driver.online || driver.is_online) ? "Assigned driver is offline" : "No location update from the assigned driver for over 3 minutes",
        { minutes_since_update: seen === null ? null : Math.round((now - seen) / 60000) }
      );
    }
  }

  // 3a. Paid and due, but not yet sent to drivers.
  if (status === "payment_authorized" && !ride.driver_id) {
    const due = ms(ride.scheduled_time) ?? ms(ride.requested_at) ?? ms(ride.created_at);
    if (due !== null && (now - due) / 1000 >= UNMATCHED_CRITICAL_S) {
      add("not_dispatched", "critical", `Due ${Math.round((now - due) / 60000)} min ago and not yet offered to drivers`, { minutes_overdue: Math.round((now - due) / 60000) });
    }
  }

  // 3. Waiting for a driver to accept for too long.
  if (WAITING_STATUSES.includes(status)) {
    const since = ms(ride.last_dispatch_at) ?? ms(ride.requested_at) ?? ms(ride.created_at);
    if (since !== null) {
      const seconds = (now - since) / 1000;
      if (seconds >= UNMATCHED_WARNING_S) {
        add("unmatched", seconds >= UNMATCHED_CRITICAL_S ? "critical" : "warning", `No driver has accepted for ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`, { seconds_waiting: Math.round(seconds) });
      }
    }
  }

  // 4. Driver late to the pickup against the ETA given at acceptance.
  // A staff reassignment keeps the first driver's ETA, so it's skipped.
  if (["driver_assigned", "driver_enroute"].includes(status) && ride.dispatch_status !== "admin_reassigned") {
    const accepted = ms(ride.accepted_at) ?? ms(ride.driver_accepted_at);
    const eta = Number(ride.driver_eta_to_pickup_minutes);
    if (accepted !== null && Number.isFinite(eta)) {
      const lateBy = (now - (accepted + eta * 60000)) / 60000;
      if (lateBy >= LATE_WARNING_MIN) {
        add("late_pickup", lateBy >= LATE_CRITICAL_MIN ? "critical" : "warning", `Pickup ${Math.round(lateBy)} min later than the ETA given at acceptance`, { minutes_late: Math.round(lateBy) });
      }
    }
  }

  // 5. Driver has been waiting at the pickup (the no-show flow applies).
  if (status === "arrived") {
    const arrived = ms(ride.arrived_at);
    if (arrived !== null && (now - arrived) / 60000 >= ARRIVED_WAIT_INFO_MIN) {
      add("rider_not_at_pickup", "info", `Driver has waited ${Math.round((now - arrived) / 60000)} min at the pickup`, {});
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function sortQueue(items) {
  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || String(a.ride_id).localeCompare(String(b.ride_id)));
}

// A staff reassignment must give a reason (audited).
function validateReassignment(body = {}) {
  const driverId = typeof body.driver_id === "string" ? body.driver_id.trim().slice(0, 100) : "";
  const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (!driverId) return { ok: false, error: "Choose a driver." };
  if (note.length < 5) return { ok: false, error: "Add a short note explaining the reassignment (at least 5 characters)." };
  return { ok: true, driver_id: driverId, note };
}

module.exports = {
  SCHEDULED_LOOKAHEAD_MIN,
  SCHEDULED_CRITICAL_MIN,
  COVERAGE_RADIUS_MILES,
  LIVE_LOCATION_MAX_AGE_MS,
  ON_TRIP_STATUSES,
  REASSIGNABLE_STATUSES,
  milesBetween,
  driverLive,
  candidateDrivers,
  rideExceptions,
  sortQueue,
  validateReassignment
};
