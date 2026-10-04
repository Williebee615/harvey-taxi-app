// Live map tracking rules (docs/live-map-tracking.md). Pure functions,
// shared by server.js and lib/driverApp.js and unit tested on their own.
//
// The rider sees the assigned driver's position (that already existed as
// text). New here: the rider may choose to share their own phone's
// position with the assigned driver, and only until pickup. The server
// enforces the window; the page's switch is a convenience, not the guard.

// Statuses where a driver is on the way to the rider. Sharing ends when
// the trip starts (in_progress) or the ride ends any other way.
const RIDER_SHARE_STATUSES = Object.freeze(["driver_assigned", "driver_enroute", "arrived"]);

// A rider position older than this is not shown to the driver: the
// rider's page stopped sending (closed, locked phone, sharing switched
// off without the delete reaching us).
const RIDER_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;

// Writes closer together than this are acknowledged but not stored, so a
// page that sends too often can't turn into a write (and driver-refresh)
// flood.
const RIDER_LOCATION_MIN_INTERVAL_MS = 4 * 1000;

// A stored rider position is deleted once the ride leaves the sharing
// window, or after this long without an update, whichever comes first.
const RIDER_LOCATION_RETENTION_MS = 10 * 60 * 1000;

const RIDER_LOCATION_COLUMNS = Object.freeze({
  rider_live_lat: null,
  rider_live_lng: null,
  rider_live_accuracy_m: null,
  rider_live_at: null
});

function canShareRiderLocation(status) {
  return RIDER_SHARE_STATUSES.includes(String(status || ""));
}

// Validates a posted position. Returns { ok: true, location } or
// { ok: false, message }.
function parseLocationBody(body) {
  const lat = Number(body && body.latitude);
  const lng = Number(body && body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, message: "A valid latitude and longitude are required." };
  }
  if (lat === 0 && lng === 0) {
    return { ok: false, message: "A valid latitude and longitude are required." };
  }
  const rawAccuracy = body && body.accuracy !== undefined && body.accuracy !== null ? Number(body.accuracy) : null;
  const accuracy = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? Math.min(Math.round(rawAccuracy), 100000) : null;
  return { ok: true, location: { lat, lng, accuracy } };
}

function ageMs(iso, nowMs) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? nowMs - t : Infinity;
}

// What the assigned driver sees of the rider: a fresh position inside the
// sharing window, otherwise nothing.
function riderLocationForDriver(ride, nowMs = Date.now()) {
  if (!ride || !canShareRiderLocation(ride.status)) return null;
  const lat = Number(ride.rider_live_lat);
  const lng = Number(ride.rider_live_lng);
  if (ride.rider_live_lat === null || ride.rider_live_lat === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const age = ageMs(ride.rider_live_at, nowMs);
  if (age > RIDER_LOCATION_MAX_AGE_MS) return null;
  const accuracy = Number(ride.rider_live_accuracy_m);
  return {
    lat,
    lng,
    accuracy_meters: Number.isFinite(accuracy) ? accuracy : null,
    updated_at: ride.rider_live_at,
    age_seconds: Math.max(0, Math.round(age / 1000))
  };
}

// The rider's own view of their sharing state.
function riderSharingState(ride, nowMs = Date.now()) {
  const allowed = Boolean(ride) && canShareRiderLocation(ride.status);
  return { allowed, active: allowed && riderLocationForDriver(ride, nowMs) !== null };
}

// True when the write should be skipped because the last one was too
// recent.
function isTooSoon(ride, nowMs = Date.now()) {
  return ageMs(ride && ride.rider_live_at, nowMs) < RIDER_LOCATION_MIN_INTERVAL_MS;
}

// True when a stored rider position must be deleted.
function shouldPurgeRiderLocation(ride, nowMs = Date.now()) {
  if (!ride) return false;
  const hasData = [ride.rider_live_lat, ride.rider_live_lng, ride.rider_live_at].some((v) => v !== null && v !== undefined);
  if (!hasData) return false;
  return !canShareRiderLocation(ride.status) || ageMs(ride.rider_live_at, nowMs) > RIDER_LOCATION_RETENTION_MS;
}

module.exports = {
  RIDER_SHARE_STATUSES,
  RIDER_LOCATION_MAX_AGE_MS,
  RIDER_LOCATION_MIN_INTERVAL_MS,
  RIDER_LOCATION_RETENTION_MS,
  RIDER_LOCATION_COLUMNS,
  canShareRiderLocation,
  parseLocationBody,
  riderLocationForDriver,
  riderSharingState,
  isTooSoon,
  shouldPurgeRiderLocation
};
