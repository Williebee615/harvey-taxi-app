// Regression for review ride RIDE-06D4C93EF9 (2026-10-03): a ride offer
// must appear on the Drive screen when it arrives the way it does on a
// device -- the driver is online, the event stream is live, the server
// sends a "sync" event, and the app re-reads GET /api/driver/state.
// The state body is built by the server's own shaping code
// (lib/driverApp.js shapeOffer / driverMode) from that ride's real
// production values, so a change on either side of the contract (server
// fields vs. what the Drive screen reads) fails here.
import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockStore = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k, v) => {
    mockStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k) => {
    delete mockStore[k];
  })
}));

const mockLocation = { started: null, startCalls: [], stopCalls: 0, permission: 'granted' };
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: mockLocation.permission })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: mockLocation.permission })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => mockLocation.started !== null),
  startLocationUpdatesAsync: jest.fn(async (task, options) => {
    mockLocation.started = options;
    mockLocation.startCalls.push(options);
  }),
  stopLocationUpdatesAsync: jest.fn(async () => {
    mockLocation.started = null;
    mockLocation.stopCalls += 1;
  })
}));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'local-id'),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[testtesttest12]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 }
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const da = require('../../lib/driverApp.js');

// The ride's production values (personal fields left out).
const RIDE = {
  id: 'RIDE-06D4C93EF9',
  status: 'awaiting_driver_acceptance',
  ride_type: 'standard',
  service_type: 'ride',
  notes: '',
  pickup_address: '1617 Lebanon Pike, Nashville, Tennessee 37210, United States',
  dropoff_address: '4509 Red Tail Trl, Smyrna, Tennessee 37167, United States',
  pickup_lat: 36.153086,
  pickup_lng: -86.717801,
  estimated_fare: 40.69,
  driver_payout: 27.08,
  estimated_driver_payout: null,
  distance_miles: null,
  estimated_distance_miles: 23.74,
  driver_eta_to_pickup_minutes: 1,
  is_review_ride: true
};

// A streaming XMLHttpRequest stand-in: the app's SSE client reads
// responseText progressively, exactly as on a device.
const streams = [];
function FakeXHR() {
  this.readyState = 0;
  this.status = 0;
  this.responseText = '';
  streams.push(this);
}
FakeXHR.prototype.open = function open(method, url) {
  this.url = url;
};
FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
FakeXHR.prototype.send = function send() {
  this.readyState = 3;
  this.status = 200;
  this.onreadystatechange && this.onreadystatechange();
};
FakeXHR.prototype.abort = function abort() {};
FakeXHR.prototype.push = function push(text) {
  this.responseText += text;
  this.onreadystatechange && this.onreadystatechange();
};
global.XMLHttpRequest = FakeXHR;

const server = { offer: null, stateReads: 0 };
function stateBody() {
  const offers = server.offer ? [da.shapeOffer(server.offer, RIDE)] : [];
  const mode = da.driverMode({ online: true, offers, activeRide: null });
  return {
    ok: true,
    server_time: new Date().toISOString(),
    driver: { id: 'DRIVER_GPLAY_REVIEWER', first_name: 'Google', online: true, approval_status: 'approved', photo_url: null, is_review_account: true },
    readiness: { ready: true, approved: true, checks: {} },
    mode,
    offers,
    active_ride: null,
    poll_ms: da.pollIntervalFor(mode),
    reconcile_ms: da.RECONCILE_MS,
    native_push_enabled: false
  };
}
global.fetch = jest.fn(async (url) => {
  const path = url.replace('https://harveytaxiservice.com', '');
  const reply = (data) => ({ ok: true, status: 200, json: async () => data });
  if (path === '/api/driver/state') {
    server.stateReads += 1;
    return reply(stateBody());
  }
  if (path === '/api/agent/status') return reply({ ok: true, assist_available: false });
  return reply({ ok: true });
});

// eslint-disable-next-line import/first
import App from '../App';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const text = (tree) => tree.root.findAll((n) => typeof n.type === 'string' && n.type === 'Text').map((n) => [].concat(n.props.children).join('')).join(' | ');
const has = (tree, id) => tree.root.findAll((n) => n.props && n.props.testID === id).length > 0;

test('review ride offer appears on the Drive screen after a stream "sync" event', async () => {
  const vibrate = jest.spyOn(require('react-native').Vibration, 'vibrate').mockImplementation(() => {});
  mockStore.harvey_driver_token = 'TOKEN_REVIEW';
  mockStore.harvey_driver_id = 'DRIVER_GPLAY_REVIEWER';
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();

  // Online with a live stream, no offer yet.
  const stream = streams.find((s) => /\/api\/driver\/stream$/.test(s.url));
  expect(stream).toBeTruthy();
  expect(has(tree, 'accept-offer')).toBe(false);
  expect(text(tree)).toMatch(/Live updates on/);

  // Dispatch creates the offer and the server sends "sync".
  server.offer = { id: 'OFFER-9E1375D173', ride_id: RIDE.id, status: 'pending', expires_at: new Date(Date.now() + 29000).toISOString() };
  const readsBefore = server.stateReads;
  await act(async () => {
    stream.push('event: sync\ndata: {"reason":"ride_offer"}\n\n');
  });
  await flush();

  expect(server.stateReads).toBe(readsBefore + 1);
  expect(has(tree, 'accept-offer')).toBe(true);
  const shown = text(tree);
  expect(shown).toMatch(/New ride request/);
  expect(shown).toMatch(/1617 Lebanon Pike/);
  expect(shown).toMatch(/4509 Red Tail Trl/);
  expect(shown).toMatch(/\$40\.69/);
  expect(shown).toMatch(/\$27\.08/);
  expect(shown).toMatch(/Test ride · no charge/);
  expect(shown).toMatch(/\b(29|30)s\b/);

  // Foreground alert: one vibration and one sound-only notification.
  const Notifications = require('expo-notifications');
  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].content).toMatchObject({ sound: 'default', data: { kind: 'offer_alert' } });

  // A later refresh with the same offer does not alert again.
  await act(async () => {
    stream.push('event: sync\ndata: {"reason":"reconcile"}\n\n');
  });
  await flush();
  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

  await act(async () => tree.unmount());
});
