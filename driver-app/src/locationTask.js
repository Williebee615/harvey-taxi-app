// Location tracking while the driver is online or on a trip, including with
// the screen locked:
//   iOS     "While Using" permission + the location background mode; updates
//           start while the app is open, and iOS shows the blue location
//           indicator while it keeps running in the background. The app never
//           asks for "Always".
//   Android foreground service (visible "Harvey Taxi Driver is online"
//           notification) started while the app is open; no background
//           location permission.
// Tracking stops when the driver goes offline and has no trip.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { API_BASE, LOCATION_TASK } from './config';
import { getToken } from './session';
import { profileFor, shouldSend } from './locationPolicy';

let activeProfile = null;
let lastSent = null;
let onUnauthorized = null;

export const stats = { received: 0, sent: 0, skipped: 0, failed: 0 };

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function sendFix(fix) {
  const token = await getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/driver/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-driver-token': token },
      body: JSON.stringify(fix)
    });
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    // 409: the server says there's nothing to track (driver went offline
    // elsewhere). The next state sync stops tracking.
    if (res.ok) {
      lastSent = { latitude: fix.latitude, longitude: fix.longitude, sentAt: Date.now() };
      stats.sent += 1;
    } else {
      stats.failed += 1;
    }
  } catch {
    stats.failed += 1; // offline: the next fix will try again
  }
}

export async function handleLocations(locations, now = Date.now()) {
  if (!activeProfile || !locations || !locations.length) return;
  // Only the newest fix in a batch matters.
  const latest = locations[locations.length - 1];
  stats.received += locations.length;
  const fix = {
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    accuracy: latest.coords.accuracy,
    heading: latest.coords.heading,
    speed: latest.coords.speed
  };
  if (!shouldSend({ profile: activeProfile, last: lastSent, fix, now })) {
    stats.skipped += 1;
    return;
  }
  await sendFix(fix);
}

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    await handleLocations(data.locations);
  });
}

const ACCURACY = { high: Location.Accuracy.High, balanced: Location.Accuracy.Balanced };

export async function locationPermission() {
  const current = await Location.getForegroundPermissionsAsync();
  return current.status;
}

export async function requestLocationPermission() {
  const result = await Location.requestForegroundPermissionsAsync();
  return result.status;
}

// Starts, retunes or stops tracking to match the server's view of the
// driver. Must be called while the app is in the foreground to start
// (Android won't start a location service from the background).
export async function syncTracking(snapshot) {
  const profile = profileFor(snapshot);
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);

  if (!profile) {
    activeProfile = null;
    lastSent = null;
    if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    return { tracking: false };
  }
  if (running && activeProfile && activeProfile.name === profile.name) return { tracking: true, profile: profile.name };

  if ((await locationPermission()) !== 'granted') return { tracking: false, needsPermission: true };

  activeProfile = profile;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: ACCURACY[profile.accuracy],
    timeInterval: profile.timeIntervalMs,
    distanceInterval: profile.distanceMeters,
    deferredUpdatesInterval: profile.timeIntervalMs,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Harvey Taxi Driver is online',
      notificationBody: 'Sharing your location while you are online or on a trip. Go offline to stop.',
      notificationColor: '#0B1730'
    }
  });
  return { tracking: true, profile: profile.name };
}

export async function stopTracking() {
  activeProfile = null;
  lastSent = null;
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
}

// The phone's current position for a one-off record (the arrival check
// when the driver taps Arrived). A recent known position is enough; never
// throws, and returns null when location isn't available.
export async function currentFix({ maxAgeMs = 60000 } = {}) {
  try {
    const known = typeof Location.getLastKnownPositionAsync === 'function' ? await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }) : null;
    const pos = known || (typeof Location.getCurrentPositionAsync === 'function' ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }) : null);
    if (!pos || !pos.coords) return null;
    const { latitude, longitude, accuracy } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null };
  } catch (err) {
    return null;
  }
}
