// What the trip map shows (docs/live-map-tracking.md). No native
// dependencies, so the rules are unit tested without the map SDK.
//
// - pickup, until the trip starts;
// - drop-off;
// - the rider's own position, only when the server sends one (the rider
//   chose to share it, it is fresh, and the ride is before pickup);
// - the driver's position is drawn by the map's own location puck and is
//   used here only to frame the camera.

const STATUS_BEFORE_PICKUP = ['driver_assigned', 'driver_enroute', 'arrived'];

function point(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : null;
}

export function tripMapPoints(ride, me = null) {
  if (!ride) return { markers: [], frame: [] };
  const markers = [];
  if (ride.status !== 'in_progress') {
    const pickup = point(ride.pickup_lat, ride.pickup_lng);
    if (pickup) markers.push({ id: 'pickup', label: 'Pickup', emoji: '📍', ...pickup });
  }
  const dropoff = point(ride.dropoff_lat, ride.dropoff_lng);
  if (dropoff) markers.push({ id: 'dropoff', label: 'Drop-off', emoji: '🏁', ...dropoff });
  const shared = ride.rider_location;
  if (shared && STATUS_BEFORE_PICKUP.includes(ride.status)) {
    const rider = point(shared.lat, shared.lng);
    if (rider) markers.push({ id: 'rider', label: 'Rider', emoji: '🙋', ...rider });
  }
  const frame = markers.map(({ lat, lng }) => ({ lat, lng }));
  const mine = me ? point(me.lat, me.lng) : null;
  if (mine) frame.push(mine);
  return { markers, frame };
}

// Camera framing: one point centers on it; several fit them all.
export function cameraFor(frame) {
  if (!frame || !frame.length) return null;
  if (frame.length === 1) return { centerCoordinate: [frame[0].lng, frame[0].lat], zoomLevel: 14 };
  const lats = frame.map((p) => p.lat);
  const lngs = frame.map((p) => p.lng);
  return {
    bounds: {
      ne: [Math.max(...lngs), Math.max(...lats)],
      sw: [Math.min(...lngs), Math.min(...lats)],
      paddingTop: 56,
      paddingBottom: 56,
      paddingLeft: 48,
      paddingRight: 48
    }
  };
}

export function legendFor(markers) {
  const parts = ['🔵 You'];
  markers.forEach((m) => parts.push(`${m.emoji} ${m.id === 'rider' ? 'Rider (shared until pickup)' : m.label}`));
  return parts.join(' · ');
}

export function riderSharingText(ride) {
  const shared = ride && ride.rider_location;
  if (!shared) return null;
  const age = Number(shared.age_seconds);
  if (!Number.isFinite(age) || age < 15) return 'Rider is sharing their location';
  if (age < 60) return `Rider is sharing their location (${age}s ago)`;
  return `Rider is sharing their location (${Math.round(age / 60)} min ago)`;
}
