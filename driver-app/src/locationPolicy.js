// How often the app samples and sends location, by driver state. Pure, so
// the rules are unit tested and the background task and the screen use the
// same numbers.
//
// offline         no tracking at all
// online_idle     coarse: keeps dispatch's position current
// offer_pending   same as idle
// to_pickup       precise: rider watches the car approach
// arrived         slow: the car is parked
// on_trip         precise
//
// The server additionally throttles to one stored update per 5 s per
// driver; these profiles stay well above that.

export const PROFILES = Object.freeze({
  none: null,
  idle: { name: 'idle', accuracy: 'balanced', timeIntervalMs: 60000, distanceMeters: 150, minSendMs: 60000, minMoveMeters: 100 },
  pickup: { name: 'pickup', accuracy: 'high', timeIntervalMs: 10000, distanceMeters: 25, minSendMs: 10000, minMoveMeters: 20 },
  arrived: { name: 'arrived', accuracy: 'balanced', timeIntervalMs: 30000, distanceMeters: 50, minSendMs: 30000, minMoveMeters: 40 },
  trip: { name: 'trip', accuracy: 'high', timeIntervalMs: 10000, distanceMeters: 25, minSendMs: 10000, minMoveMeters: 20 }
});

// Never let a location sit unsent longer than this while tracking, even if
// the car hasn't moved (shows the rider and dispatch the driver is live).
export const MAX_SILENCE_MS = 120000;
// Fixes worse than this are only used if nothing better arrives in time.
export const POOR_ACCURACY_METERS = 100;

export function profileFor(snapshot) {
  if (!snapshot) return PROFILES.none;
  const ride = snapshot.active_ride;
  if (ride) {
    if (ride.status === 'arrived') return PROFILES.arrived;
    if (ride.status === 'in_progress') return PROFILES.trip;
    return PROFILES.pickup;
  }
  if (snapshot.driver && snapshot.driver.online) return PROFILES.idle;
  return PROFILES.none;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Decides whether a new fix is worth a request. `last` is the last fix
// actually sent ({ latitude, longitude, sentAt }) or null.
export function shouldSend({ profile, last, fix, now }) {
  if (!profile || !fix) return false;
  const { latitude, longitude, accuracy } = fix;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (!last) return true;
  const elapsed = now - last.sentAt;
  if (elapsed >= MAX_SILENCE_MS) return true;
  if (elapsed < profile.minSendMs) return false;
  if (Number.isFinite(accuracy) && accuracy > POOR_ACCURACY_METERS) return false;
  return distanceMeters(last, fix) >= profile.minMoveMeters;
}
