// Drives the real App through a full driver session against a fake
// backend: phone sign-in, going online (permission + tracking start),
// an offer arriving, accepting it, every trip step to completion, and
// going offline (tracking stops). Native modules are mocked; the API
// calls and their order are what the real server receives.
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

// Event streams never connect in this test; the app falls back to reads.
global.XMLHttpRequest = function XHR() {};
global.XMLHttpRequest.prototype = { open() {}, setRequestHeader() {}, send() {}, abort() {} };

// ---------------- fake backend ----------------
const server = { calls: [], driver: { online: false }, offers: [], ride: null, validToken: 'TOKEN_A', deleted: false, map: { token: null }, stateDown: false };
const snapshot = () => ({
  ok: true,
  server_time: new Date().toISOString(),
  driver: { id: 'DRIVER_A', first_name: 'Morgan', online: server.driver.online, is_review_account: false },
  readiness: { ready: true, approved: true, checks: { email_verified: true, phone_verified: true } },
  mode: server.ride ? 'on_trip' : server.offers.length ? 'offer_pending' : server.driver.online ? 'online_idle' : 'offline',
  offers: server.offers,
  active_ride: server.ride,
  poll_ms: 0,
  reconcile_ms: 60000,
  native_push_enabled: false,
  map: server.map
});
const NEXT = { enroute: 'driver_enroute', arrived: 'arrived', start: 'in_progress' };
global.fetch = jest.fn(async (url, init = {}) => {
  const path = url.replace('https://harveytaxiservice.com', '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.calls.push(`${init.method || 'GET'} ${path}`);
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (path === '/api/driver/session/phone/start') return reply({ ok: true, sent: true, message: 'Code sent.' });
  if (path === '/api/driver/session/phone/verify') {
    return body.code === '123456' ? reply({ ok: true, driver_token: 'TOKEN_A', driver_id: 'DRIVER_A' }) : reply({ ok: false, error: 'Invalid or expired code.' }, 400);
  }
  if (init.headers['x-driver-token'] !== server.validToken) return reply({ ok: false, error: 'auth' }, 401);
  if (path === '/api/account/driver/delete-request') {
    server.deleted = true;
    return reply({ ok: true, request_id: 'DEL-1', status: 'pending' });
  }
  if (path === '/api/driver/location') return reply({ ok: true });
  if (path === '/api/driver/state') return server.stateDown ? reply({ ok: false, error: 'Database unavailable.' }, 504) : reply(snapshot());
  if (path === '/api/driver/push-token') return reply({ ok: true });
  if (path === '/api/driver/status') {
    server.driver.online = body.online;
    return reply({ ok: true, online: body.online });
  }
  const accept = /^\/api\/driver\/offers\/(.+)\/accept$/.exec(path);
  if (accept) {
    server.offers = [];
    server.ride = { ride_id: 'RIDE_1', status: 'driver_assigned', pickup_address: '1 Broadway', dropoff_address: 'BNA', pickup_lat: 36.16, pickup_lng: -86.78, rider_first_name: 'Jamie', rider_phone: '+16155550101' };
    return reply({ ok: true });
  }
  const step = /^\/api\/driver\/rides\/RIDE_1\/(\w+)$/.exec(path);
  if (step) {
    if (step[1] === 'complete') server.ride = null;
    else server.ride = { ...server.ride, status: NEXT[step[1]] };
    return reply({ ok: true });
  }
  return reply({ ok: false, error: `unexpected ${path}` }, 404);
});

// eslint-disable-next-line import/first
import App from '../App';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const byId = (tree, id) => {
  const found = tree.root.findAll((n) => n.props && n.props.testID === id && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function'));
  if (!found.length) {
    const ids = tree.root.findAll((n) => n.props && n.props.testID).map((n) => n.props.testID);
    throw new Error(`no ${id}; visible: ${[...new Set(ids)].join(', ')}`);
  }
  return found[0];
};
const press = async (tree, id) => {
  await act(async () => {
    await byId(tree, id).props.onPress();
  });
  await flush();
};
const type = async (tree, id, text) => {
  await act(async () => {
    byId(tree, id).props.onChangeText(text);
  });
};
const has = (tree, id) => tree.root.findAll((n) => n.props && n.props.testID === id).length > 0;

test('sign in, go online, accept an offer, drive it to completion, go offline', async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();

  // Signed out: phone sign-in.
  await type(tree, 'phone-input', '(615) 555-0201');
  await press(tree, 'send-code');
  await type(tree, 'code-input', '123456');
  await press(tree, 'verify-code');
  expect(mockStore.harvey_driver_token).toBe('TOKEN_A');
  expect(server.calls).toContain('POST /api/driver/push-token');
  expect(has(tree, 'go-online')).toBe(true);
  expect(mockLocation.started).toBeNull();

  // Online: tracking starts with the idle profile and a foreground service.
  await press(tree, 'go-online');
  expect(server.driver.online).toBe(true);
  expect(mockLocation.started).toMatchObject({ timeInterval: 60000, showsBackgroundLocationIndicator: true });
  expect(mockLocation.started.foregroundService.notificationTitle).toMatch(/online/);

  // An offer arrives (next state read).
  server.offers = [{ offer_id: 'OFFER_1', ride_id: 'RIDE_1', seconds_left: 25, pickup_address: '1 Broadway', dropoff_address: 'BNA', estimated_fare: 21, estimated_payout: null, eta_to_pickup_minutes: 4 }];
  await act(async () => {
    tree.root.findAll((n) => n.props && n.props.refreshControl)[0].props.refreshControl.props.onRefresh();
  });
  await flush();
  expect(has(tree, 'accept-offer')).toBe(true);

  await press(tree, 'accept-offer');
  expect(server.calls).toContain('POST /api/driver/offers/OFFER_1/accept');
  expect(mockLocation.started).toMatchObject({ timeInterval: 10000 }); // precise while heading to pickup

  for (const step of ['enroute', 'arrived', 'start']) {
    // eslint-disable-next-line no-await-in-loop
    await press(tree, `step-${step}`);
    expect(server.calls).toContain(`POST /api/driver/rides/RIDE_1/${step}`);
  }
  expect(mockLocation.started).toMatchObject({ timeInterval: 10000 });

  // Complete asks for confirmation first.
  const { Alert } = require('react-native');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((t, m, buttons) => buttons[1].onPress());
  await press(tree, 'step-complete');
  alert.mockRestore();
  expect(server.calls).toContain('POST /api/driver/rides/RIDE_1/complete');
  expect(server.ride).toBeNull();
  expect(mockLocation.started).toMatchObject({ timeInterval: 60000 }); // back to idle

  // Offline: tracking stops.
  await press(tree, 'go-offline');
  expect(server.driver.online).toBe(false);
  expect(mockLocation.started).toBeNull();
  expect(mockLocation.stopCalls).toBeGreaterThanOrEqual(1);
});

test('restart in the middle of a trip: the saved session resumes and tracking restarts (trip recovery)', async () => {
  server.ride = { ride_id: 'RIDE_2', status: 'driver_enroute', pickup_address: '2 Broadway', dropoff_address: 'BNA' };
  mockLocation.started = null;
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  expect(has(tree, 'step-arrived')).toBe(true);
  expect(mockLocation.started).toMatchObject({ timeInterval: 10000 });
  await act(async () => tree.unmount());
});

test('trip map: shown with a map token, with the rider\'s shared position; absent without a token', async () => {
  server.ride = {
    ride_id: 'RIDE_3',
    status: 'driver_enroute',
    pickup_address: '3 Broadway',
    dropoff_address: 'BNA',
    pickup_lat: 36.16,
    pickup_lng: -86.78,
    dropoff_lat: 36.12,
    dropoff_lng: -86.68,
    rider_location: { lat: 36.161, lng: -86.781, accuracy_meters: 10, age_seconds: 5 }
  };
  server.map = { token: null };
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  expect(has(tree, 'step-arrived')).toBe(true);
  expect(has(tree, 'trip-map')).toBe(false);
  expect(has(tree, 'rider-sharing')).toBe(true);
  await act(async () => tree.unmount());

  server.map = { token: 'pk.test-app-token' };
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  expect(has(tree, 'trip-map')).toBe(true);
  const annotations = tree.root.findAll((n) => n.props && typeof n.props.id === 'string' && n.props.id.startsWith('trip-') && n.props.coordinate);
  expect([...new Set(annotations.map((n) => n.props.id))].sort()).toEqual(['trip-dropoff', 'trip-pickup', 'trip-rider']);
  await act(async () => tree.unmount());
  server.map = { token: null };
});

test('server down at launch: shows the error and a retry instead of loading forever; recovers', async () => {
  server.ride = null;
  server.stateDown = true;
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  expect(has(tree, 'load-error')).toBe(true);
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('Database unavailable.');
  server.stateDown = false;
  await press(tree, 'load-retry');
  expect(has(tree, 'load-error')).toBe(false);
  expect(has(tree, 'stale-status')).toBe(false);

  // Down again after the screen has loaded: the last status stays, with a warning.
  server.stateDown = true;
  await act(async () => {
    await tree.root.findAll((n) => n.props && typeof n.props.onRefresh === 'function')[0].props.onRefresh();
  });
  await flush();
  expect(has(tree, 'stale-status')).toBe(true);
  expect(has(tree, 'load-error')).toBe(false);
  server.stateDown = false;
  await act(async () => tree.unmount());
});

test('a session the server no longer accepts signs the driver out and stops tracking', async () => {
  server.validToken = 'SOMETHING_ELSE';
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  expect(has(tree, 'phone-input')).toBe(true);
  expect(mockStore.harvey_driver_token).toBeUndefined();
  expect(mockLocation.started).toBeNull();
  await act(async () => tree.unmount());
});

test('account deletion from the Account tab', async () => {
  server.validToken = 'TOKEN_A';
  server.ride = null;
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  await type(tree, 'phone-input', '6155550201');
  await press(tree, 'send-code');
  await type(tree, 'code-input', '123456');
  await press(tree, 'verify-code');
  await press(tree, 'tab-account');
  await press(tree, 'delete-start');
  const input = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Type DELETE to confirm' && n.props.onChangeText)[0];
  await act(async () => input.props.onChangeText('DELETE'));
  await press(tree, 'delete-confirm');
  expect(server.deleted).toBe(true);
  expect(has(tree, 'phone-input')).toBe(true);
  expect(mockStore.harvey_driver_token).toBeUndefined();
  await act(async () => tree.unmount());
});

test('signed out: "Apply to drive" opens driver sign-up on the website', async () => {
  delete mockStore.harvey_driver_token;
  delete mockStore.harvey_driver_id;
  const WebBrowser = require('expo-web-browser');
  WebBrowser.openBrowserAsync.mockClear();
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  await press(tree, 'apply-to-drive');
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://harveytaxiservice.com/driver-signup.html');
  await act(async () => tree.unmount());
});
