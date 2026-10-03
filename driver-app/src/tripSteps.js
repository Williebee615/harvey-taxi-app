// The next step for an assigned ride, mapped to the existing driver routes.
// Deliveries (food/grocery) have extra steps (order pickup, PIN, photo)
// that this first release leaves to the web dashboard.

const STEPS = Object.freeze({
  driver_assigned: { action: 'enroute', label: 'Start driving to pickup', navigateTo: 'pickup' },
  driver_enroute: { action: 'arrived', label: "I've arrived at pickup", navigateTo: 'pickup' },
  arrived: { action: 'start', label: 'Start trip (rider is in the car)', navigateTo: null },
  in_progress: { action: 'complete', label: 'Complete trip', navigateTo: 'dropoff' }
});

export function isDelivery(ride) {
  return Boolean(ride && ['food', 'grocery'].includes(ride.ride_type));
}

export function nextStep(ride) {
  if (!ride || isDelivery(ride)) return null;
  return STEPS[ride.status] || null;
}

export function stepPath(ride, step) {
  return `/api/driver/rides/${encodeURIComponent(ride.ride_id)}/${step.action}`;
}

// Opens turn-by-turn directions in the phone's maps app. Coordinates when
// known, otherwise the address.
export function directionsUrl({ lat, lng, address }, platform) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const dest = hasCoords ? `${lat},${lng}` : encodeURIComponent(address || '');
  if (!dest) return null;
  if (platform === 'ios') return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export const STATUS_LABELS = Object.freeze({
  driver_assigned: 'Ride accepted',
  driver_enroute: 'Driving to pickup',
  arrived: 'At pickup',
  in_progress: 'Trip in progress'
});
