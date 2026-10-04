// Harvey Assistant in the driver app, against a fake backend: it shows only
// when the server has it on, answers through POST /api/agent/driver/assist
// with client "driver_app", turns proposals into buttons that need a
// confirmation before anything changes, and goes hands-free during a trip
// (no typing, answers read aloud). Native modules are mocked.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Platform } from 'react-native';

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
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
// eslint-disable-next-line import/first
import * as Speech from 'expo-speech';

global.XMLHttpRequest = function XHR() {};
global.XMLHttpRequest.prototype = { open() {}, setRequestHeader() {}, send() {}, abort() {} };

const server = { calls: [], bodies: [], assist: true, online: true, offers: [], ride: null, nextAssist: null, handoffBodies: [], draftBodies: [], handoffReply: null };
const snapshot = () => ({
  ok: true,
  server_time: new Date().toISOString(),
  driver: { id: 'DRIVER_A', first_name: 'Morgan', online: server.online, is_review_account: false },
  readiness: { ready: true, approved: true, checks: {} },
  mode: server.ride ? 'on_trip' : server.offers.length ? 'offer_pending' : server.online ? 'online_idle' : 'offline',
  offers: server.offers,
  active_ride: server.ride,
  poll_ms: 0,
  reconcile_ms: 60000,
  native_push_enabled: false
});
global.fetch = jest.fn(async (url, init = {}) => {
  const path = url.replace('https://harveytaxiservice.com', '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.calls.push(`${init.method || 'GET'} ${path}`);
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (path === '/api/agent/status') return reply({ ok: true, assist_available: server.assist, answer_mode: 'rules_only' });
  if (init.headers['x-driver-token'] !== 'TOKEN_A') return reply({ ok: false, error: 'auth' }, 401);
  if (path === '/api/driver/state') return reply(snapshot());
  if (path === '/api/driver/push-token' || path === '/api/driver/location') return reply({ ok: true });
  if (path === '/api/agent/driver/assist') {
    server.bodies.push(body);
    return reply({ ok: true, agent_available: true, source: 'rules', escalation: null, ...server.nextAssist });
  }
  if (path === '/api/agent/driver/handoff/draft') {
    server.draftBodies.push(body);
    if (body.kind === 'lost_item') {
      return reply({ ok: true, signed_in: true, kind: 'lost_item', ride: { id: 'TEST-RIDE-9', label: 'Sun, Oct 4, 1:23 PM: TEST 1 Broadway to TEST BNA' }, draft: 'Found item report (a rider left something in my car).\n\nTrip: Sun, Oct 4, 1:23 PM: TEST 1 Broadway to TEST BNA\nItem found: ' });
    }
    return reply({ ok: true, signed_in: true, kind: 'general', ride: null, draft: 'I need help from Harvey Taxi support.\n\nWhat I asked the assistant:\n- I need to contact support\n\nMore details: ' });
  }
  if (path === '/api/agent/driver/handoff') {
    server.handoffBodies.push(body);
    const r = server.handoffReply || { status: 200, data: { ok: true, sent: true, case_created: true, duplicate: false, reference: 'HT-SUP-20261004-ABC234', email: { status: 'accepted' }, message: "Received. Your request is in Harvey Taxi's support queue as case HT-SUP-20261004-ABC234." } };
    return reply(r.data, r.status);
  }
  if (path === '/api/driver/status') {
    server.online = body.online;
    return reply({ ok: true });
  }
  if (/^\/api\/driver\/offers\/.+\/accept$/.test(path)) {
    server.offers = [];
    server.ride = { ride_id: 'RIDE_1', status: 'driver_assigned', pickup_address: '1 Broadway', dropoff_address: 'BNA', pickup_lat: 36.16, pickup_lng: -86.78 };
    return reply({ ok: true });
  }
  if (/^\/api\/driver\/rides\/RIDE_1\/enroute$/.test(path)) {
    server.ride = { ...server.ride, status: 'driver_enroute' };
    return reply({ ok: true });
  }
  return reply({ ok: false, error: `unexpected ${path}` }, 404);
});

// eslint-disable-next-line import/first
import App from '../App';
// eslint-disable-next-line import/first
import { clearAllChats } from '../src/chatMemory';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const find = (tree, id) => tree.root.findAll((n) => n.props && n.props.testID === id && typeof n.props.onPress === 'function');
const has = (tree, id) => tree.root.findAll((n) => n.props && n.props.testID === id).length > 0;
const press = async (tree, id) => {
  const found = find(tree, id);
  if (!found.length) {
    const ids = tree.root.findAll((n) => n.props && n.props.testID).map((n) => n.props.testID);
    throw new Error(`no ${id}; visible: ${[...new Set(ids)].join(', ')}`);
  }
  await act(async () => {
    await found[0].props.onPress();
  });
  await flush();
};
const start = async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await flush();
  return tree;
};

beforeEach(() => {
  // Each test starts a fresh conversation (memory is per account, in memory).
  clearAllChats();
  mockStore.harvey_driver_token = 'TOKEN_A';
  mockStore.harvey_driver_id = 'DRIVER_A';
  Object.assign(server, { calls: [], bodies: [], assist: true, online: true, offers: [], ride: null, nextAssist: null, handoffBodies: [], draftBodies: [], handoffReply: null });
  Speech.speak.mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('hidden while the server has the assistant off', async () => {
  server.assist = false;
  const tree = await start();
  expect(has(tree, 'go-offline')).toBe(true);
  expect(has(tree, 'open-assistant')).toBe(false);
  await act(async () => tree.unmount());
});

test('asks with the driver session and client "driver_app"; nothing changes without confirmation', async () => {
  const tree = await start();
  await press(tree, 'open-assistant');
  expect(has(tree, 'assistant-input')).toBe(true); // not on a trip: typing allowed
  server.nextAssist = { intent: 'driver_availability', reply: 'You control your availability…', actions: [{ type: 'toggle_availability', requires_confirmation: true }] };
  await press(tree, 'assistant-quick-online');
  // First question: no earlier turns, so an empty context.
  expect(server.bodies[0]).toEqual({ message: 'How do I go online?', client: 'driver_app', platform: Platform.OS, context: [] });
  expect(Speech.speak).not.toHaveBeenCalled(); // read-aloud is off unless driving or switched on

  // The driver is online, so the proposal becomes "Go offline". Cancelling
  // the confirmation changes nothing.
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press(tree, 'assistant-action-offline');
  expect(alert).toHaveBeenCalledWith('Go offline?', expect.any(String), expect.any(Array));
  expect(server.calls).not.toContain('POST /api/driver/status');
  // Confirming runs the same route as the Drive screen's button.
  const [, , buttons] = alert.mock.calls[0];
  await act(async () => {
    await buttons[1].onPress();
  });
  await flush();
  expect(server.calls).toContain('POST /api/driver/status');
  expect(server.online).toBe(false);
  expect(has(tree, 'assistant-close')).toBe(false); // back on the Drive screen
  await act(async () => tree.unmount());
});

test('a new offer closes the assistant; reopened, Accept needs confirmation', async () => {
  const tree = await start();
  await press(tree, 'open-assistant');
  server.offers = [{ offer_id: 'OFFER_1', ride_id: 'RIDE_1', seconds_left: 25, pickup_address: '1 Broadway', dropoff_address: 'BNA', estimated_fare: 21, estimated_payout: null, eta_to_pickup_minutes: 4 }];
  server.nextAssist = { intent: 'driver_offers', reply: 'You have 1 ride offer waiting.', actions: [{ type: 'respond_offer', offer_id: 'OFFER_1', requires_confirmation: true }, { type: 'respond_offer', offer_id: 'NOT_MINE', requires_confirmation: true }] };
  // The offer reaches the app the way it does in production: a push
  // notification triggers a state read while the assistant is open.
  const Notifications = require('expo-notifications');
  await act(async () => {
    await Notifications.addNotificationReceivedListener.mock.calls.at(-1)[0]({ request: { content: { data: { kind: 'ride_offer' } } } });
  });
  await flush();
  expect(has(tree, 'accept-offer')).toBe(true);
  expect(has(tree, 'assistant-close')).toBe(false);

  await press(tree, 'open-assistant');
  await press(tree, 'assistant-quick-offers');
  expect(has(tree, 'assistant-action-accept:OFFER_1')).toBe(true);
  expect(has(tree, 'assistant-action-accept:NOT_MINE')).toBe(false); // not in this driver's live offers
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((t, m, b) => b[1].onPress());
  await press(tree, 'assistant-action-accept:OFFER_1');
  expect(alert.mock.calls[0][0]).toBe('Accept this ride?');
  expect(server.calls).toContain('POST /api/driver/offers/OFFER_1/accept');
  await act(async () => tree.unmount());
});

test('during a trip: no typing, answers read aloud, trip step needs confirmation', async () => {
  server.ride = { ride_id: 'RIDE_1', status: 'driver_assigned', pickup_address: '1 Broadway', dropoff_address: 'BNA', pickup_lat: 36.16, pickup_lng: -86.78 };
  const tree = await start();
  await press(tree, 'open-assistant');
  expect(has(tree, 'assistant-input')).toBe(false);
  server.nextAssist = {
    intent: 'driver_active_ride',
    reply: 'Your current ride is accepted by your driver. When you set off, tap "Start driving to pickup".',
    actions: [
      { type: 'navigate', ride_id: 'RIDE_1', target: 'pickup', address: '1 Broadway' },
      { type: 'trip_step', ride_id: 'RIDE_1', status: 'driver_assigned', requires_confirmation: true },
      { type: 'trip_step', ride_id: 'RIDE_1', status: 'in_progress', requires_confirmation: true } // stale: ignored
    ]
  };
  await press(tree, 'assistant-quick-trip');
  expect(Speech.speak).toHaveBeenCalledWith('Your current ride is accepted by your driver. When you set off, tap Start driving to pickup.', { language: 'en-US' });
  expect(has(tree, 'assistant-action-nav:pickup')).toBe(true);
  expect(has(tree, 'assistant-action-step:enroute')).toBe(true);

  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press(tree, 'assistant-action-step:enroute');
  expect(server.calls).not.toContain('POST /api/driver/rides/RIDE_1/enroute');
  await act(async () => {
    await alert.mock.calls[0][2][1].onPress();
  });
  await flush();
  expect(server.calls).toContain('POST /api/driver/rides/RIDE_1/enroute');
  await act(async () => tree.unmount());
});

test('server errors and an off assistant give a safe reply, no actions', async () => {
  const tree = await start();
  await press(tree, 'open-assistant');
  global.fetch.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, agent_available: false, reply: 'The assistant is switched off. In an emergency, call 911.' }) }));
  await press(tree, 'assistant-quick-earnings');
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('The assistant is switched off');
  expect(tree.root.findAll((n) => n.props && typeof n.props.testID === 'string' && n.props.testID.startsWith('assistant-action-'))).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('conversation memory: kept for the account, sent as context for a follow-up, cleared by Clear chat and sign-out', async () => {
  const { contextFrom, loadChat, saveChat, clearChat } = require('../src/chatMemory');
  saveChat('DRIVER_A', [{ id: 0, who: 'bot', text: 'Hi' }, { id: 1, who: 'me', text: 'How long do you keep my data?' }, { id: 2, who: 'bot', text: 'From our Privacy Policy...' }]);
  expect(loadChat('DRIVER_A')).toHaveLength(3);
  expect(loadChat('DRIVER_B')).toBeNull();
  expect(contextFrom(loadChat('DRIVER_A'))).toEqual([
    { role: 'user', text: 'How long do you keep my data?' },
    { role: 'assistant', text: 'From our Privacy Policy...' }
  ]);
  clearChat('DRIVER_A');
  expect(loadChat('DRIVER_A')).toBeNull();
  saveChat('DRIVER_A', [{ id: 1, who: 'me', text: 'x' }]);
  clearAllChats();
  expect(loadChat('DRIVER_A')).toBeNull();
});

test('follow-up sends the earlier turns; Clear chat starts over; reopening keeps the conversation', async () => {
  const tree = await start();
  await press(tree, 'open-assistant');
  server.nextAssist = { intent: 'policy_question', reply: 'From our Privacy Policy ("6. Data Retention", October 2026): …', actions: [], sources: [{ title: 'Privacy Policy', section: '6. Data Retention', url: '/privacy-policy.html', updated: 'October 2026' }] };
  await press(tree, 'assistant-quick-earnings');
  expect(has(tree, 'assistant-sources')).toBe(true);
  server.nextAssist = { intent: 'driver_hours', reply: 'You have been online 2 h…', actions: [] };
  await press(tree, 'assistant-quick-hours');
  expect(server.bodies[1].context).toEqual([
    { role: 'user', text: 'How much did I earn?' },
    { role: 'assistant', text: 'From our Privacy Policy ("6. Data Retention", October 2026): …' }
  ]);

  // Close and reopen: same conversation (memory on this device only).
  await press(tree, 'assistant-close');
  await press(tree, 'open-assistant');
  expect(JSON.stringify(tree.toJSON())).toContain('You have been online 2 h');

  await press(tree, 'assistant-clear');
  const text = JSON.stringify(tree.toJSON());
  expect(text).not.toContain('You have been online 2 h');
  expect(tree.root.findAll((n) => n.props && n.props.testID === 'assistant-reply' && n.type === 'View')).toHaveLength(1); // greeting only
  await act(async () => tree.unmount());
});

describe('support handoff (phase 4)', () => {
  const HANDOFF_ACTIONS = [
    { type: 'support_handoff', label: 'Send a request to support', requires_confirmation: true },
    { type: 'open_support', label: 'Contact support' }
  ];
  const text = (tree) => JSON.stringify(tree.toJSON());
  const askSupport = async (tree) => {
    server.nextAssist = { reply: 'Harvey Taxi support can help.', intent: 'driver_support', actions: HANDOFF_ACTIONS };
    await press(tree, 'open-assistant');
    const input = tree.root.findAll((n) => n.props && n.props.testID === 'assistant-input' && n.props.onChangeText)[0];
    await act(async () => input.props.onChangeText('I need to contact support'));
    await press(tree, 'assistant-send');
  };
  const typeSummary = async (tree, value) => {
    const area = tree.root.findAll((n) => n.props && n.props.testID === 'assistant-handoff-text' && n.props.onChangeText)[0];
    await act(async () => area.props.onChangeText(value));
  };

  test('review and edit, then send: only the approved text; reference shown after the server confirms', async () => {
    const tree = await start();
    await askSupport(tree);
    await press(tree, 'assistant-action-handoff');
    expect(has(tree, 'assistant-handoff')).toBe(true);
    expect(text(tree)).toContain('- I need to contact support');
    expect(server.calls).not.toContain('POST /api/agent/driver/handoff'); // nothing sent yet
    await typeSummary(tree, 'Please check my payout for last week. (test fixture)');
    await press(tree, 'assistant-handoff-send');
    expect(server.handoffBodies).toEqual([
      { summary: 'Please check my payout for last week. (test fixture)', approved: true, kind: 'general', ride_id: null, request_id: expect.stringMatching(/^req-/), client: 'driver_app', platform: Platform.OS }
    ]);
    expect(has(tree, 'assistant-handoff')).toBe(false);
    expect(text(tree)).toContain('support queue as case HT-SUP-20261004-ABC234');
    await act(async () => tree.unmount());
  });

  test('a failed send says not sent and keeps the text; no reference', async () => {
    server.handoffReply = { status: 503, data: { ok: false, sent: false, error: 'Your request was not sent. Please try again, or use the Support page to contact Harvey Taxi. In an emergency, call 911.' } };
    const tree = await start();
    await askSupport(tree);
    await press(tree, 'assistant-action-handoff');
    await typeSummary(tree, 'Please check my payout for last week.');
    await press(tree, 'assistant-handoff-send');
    expect(has(tree, 'assistant-handoff')).toBe(true);
    expect(text(tree)).toContain('Your request was not sent');
    expect(text(tree)).not.toContain('support queue as case');
    await act(async () => tree.unmount());
  });

  test('cancel sends nothing', async () => {
    const tree = await start();
    await askSupport(tree);
    await press(tree, 'assistant-action-handoff');
    await press(tree, 'assistant-handoff-cancel');
    expect(server.handoffBodies).toEqual([]);
    expect(text(tree)).toContain('Not sent. Nothing was shared with support.');
    await act(async () => tree.unmount());
  });

  test('during a trip the editor does not open (no typing while driving)', async () => {
    server.ride = { ride_id: 'RIDE_1', status: 'driver_enroute', pickup_address: '1 Broadway', dropoff_address: 'BNA', pickup_lat: 36.16, pickup_lng: -86.78 };
    server.nextAssist = { reply: 'Harvey Taxi support can help.', intent: 'driver_support', actions: HANDOFF_ACTIONS };
    const tree = await start();
    await press(tree, 'open-assistant');
    const quick = tree.root.findAll((n) => n.props && typeof n.props.testID === 'string' && n.props.testID.startsWith('assistant-quick-') && n.props.onPress)[0];
    await act(async () => quick.props.onPress());
    await flush();
    await press(tree, 'assistant-action-handoff');
    expect(has(tree, 'assistant-handoff')).toBe(false);
    expect(server.calls).not.toContain('POST /api/agent/driver/handoff/draft');
    expect(text(tree)).toContain("once you're not on a trip");
    await act(async () => tree.unmount());
  });

  test('found item: draft with the trip, trip attached by default and removable; a double tap sends once', async () => {
    server.nextAssist = {
      reply: 'If a rider left something in your car, you can send a found-item report.',
      intent: 'lost_item',
      actions: [{ type: 'support_handoff', kind: 'lost_item', label: 'Report a found item', requires_confirmation: true }, { type: 'open_support', label: 'Contact support' }]
    };
    const tree = await start();
    await press(tree, 'open-assistant');
    const input = tree.root.findAll((n) => n.props && n.props.testID === 'assistant-input' && n.props.onChangeText)[0];
    await act(async () => input.props.onChangeText('A rider left a bag in my car'));
    await press(tree, 'assistant-send');
    await press(tree, 'assistant-action-handoff-lost');
    expect(server.draftBodies[0].kind).toBe('lost_item');
    expect(text(tree)).toContain('Report a found item');
    expect(text(tree)).toContain('Attach this trip for support');
    await typeSummary(tree, 'Found item report. Item found: blue umbrella (test fixture)');
    // Two quick taps.
    const btn = find(tree, 'assistant-handoff-send')[0];
    await act(async () => {
      btn.props.onPress();
      btn.props.onPress();
    });
    await flush();
    expect(server.handoffBodies).toHaveLength(1);
    expect(server.handoffBodies[0]).toMatchObject({ kind: 'lost_item', ride_id: 'TEST-RIDE-9', approved: true });
    await act(async () => tree.unmount());
  });

  test('found item: unticking the trip sends no ride id', async () => {
    server.nextAssist = { reply: 'Found item.', intent: 'lost_item', actions: [{ type: 'support_handoff', kind: 'lost_item' }] };
    const tree = await start();
    await press(tree, 'open-assistant');
    await press(tree, 'assistant-quick-earnings');
    await press(tree, 'assistant-action-handoff-lost');
    await press(tree, 'assistant-handoff-ride');
    await typeSummary(tree, 'Found item report. Item found: keys (test fixture)');
    await press(tree, 'assistant-handoff-send');
    expect(server.handoffBodies[0].ride_id).toBeNull();
    await act(async () => tree.unmount());
  });
});

test('conversation memory lasts for the app session only: a fresh app start has none', () => {
  const memory = require('../src/chatMemory');
  memory.saveChat('DRIVER_A', [{ id: 1, who: 'me', text: 'How long do you keep my data?' }]);
  expect(memory.loadChat('DRIVER_A')).toHaveLength(1);
  // A cold start loads the app's JavaScript again; nothing was written to disk.
  jest.isolateModules(() => {
    const fresh = require('../src/chatMemory');
    expect(fresh.loadChat('DRIVER_A')).toBeNull();
  });
  expect(mockStore).not.toHaveProperty('harvey_assistant_chat');
  expect(Object.keys(mockStore).some((k) => /chat/i.test(k))).toBe(false);
});
