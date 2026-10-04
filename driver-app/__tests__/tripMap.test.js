import { cameraFor, legendFor, riderSharingText, tripMapPoints } from '../src/tripMap';

const ride = (over = {}) => ({
  ride_id: 'R1',
  status: 'driver_enroute',
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  dropoff_lat: 36.12,
  dropoff_lng: -86.68,
  rider_location: null,
  ...over
});

test('before pickup: pickup, drop-off and a shared rider position', () => {
  const { markers, frame } = tripMapPoints(ride({ rider_location: { lat: 36.161, lng: -86.781, age_seconds: 4 } }), { lat: 36.2, lng: -86.8 });
  expect(markers.map((m) => m.id)).toEqual(['pickup', 'dropoff', 'rider']);
  expect(frame).toHaveLength(4);
});

test('during the trip: drop-off only, never the rider position', () => {
  const { markers } = tripMapPoints(ride({ status: 'in_progress', rider_location: { lat: 36.161, lng: -86.781 } }));
  expect(markers.map((m) => m.id)).toEqual(['dropoff']);
});

test('missing coordinates are skipped, not drawn at 0,0', () => {
  const { markers } = tripMapPoints(ride({ pickup_lat: null, pickup_lng: null, dropoff_lat: undefined }));
  expect(markers).toEqual([]);
});

test('camera: centers one point, fits several, nothing for none', () => {
  expect(cameraFor([{ lat: 1, lng: 2 }])).toEqual({ centerCoordinate: [2, 1], zoomLevel: 14 });
  expect(cameraFor([{ lat: 1, lng: 2 }, { lat: 3, lng: -4 }]).bounds).toMatchObject({ ne: [2, 3], sw: [-4, 1] });
  expect(cameraFor([])).toBeNull();
});

test('legend and sharing text', () => {
  const { markers } = tripMapPoints(ride({ rider_location: { lat: 36.161, lng: -86.781 } }));
  expect(legendFor(markers)).toBe('🔵 You · 📍 Pickup · 🏁 Drop-off · 🙋 Rider (shared until pickup)');
  expect(riderSharingText(ride())).toBeNull();
  expect(riderSharingText(ride({ rider_location: { age_seconds: 3 } }))).toBe('Rider is sharing their location');
  expect(riderSharingText(ride({ rider_location: { age_seconds: 40 } }))).toBe('Rider is sharing their location (40s ago)');
  expect(riderSharingText(ride({ rider_location: { age_seconds: 110 } }))).toBe('Rider is sharing their location (2 min ago)');
});
