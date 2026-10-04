// Foreground offer alert (src/offerAlert.js) and the sound-only
// presentation of that alert (src/push.js presentationFor).
import { createOfferAlerter } from '../src/offerAlert';

jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), scheduleNotificationAsync: jest.fn() }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('expo-application', () => ({}));

const offers = (...ids) => ({ offers: ids.map((offer_id) => ({ offer_id })) });

function setup(foreground = true) {
  const calls = { vibrate: 0, sound: 0 };
  const alerter = createOfferAlerter({
    vibrate: () => (calls.vibrate += 1),
    playSound: async () => (calls.sound += 1),
    isForeground: () => foreground
  });
  return { alerter, calls };
}
const settle = () => new Promise((r) => setImmediate(r));

test('alerts once per new offer, never again on later refreshes', async () => {
  const { alerter, calls } = setup();
  expect(alerter.onSnapshot(offers())).toEqual([]);
  expect(alerter.onSnapshot(offers('O1'))).toEqual(['O1']);
  expect(alerter.onSnapshot(offers('O1'))).toEqual([]);
  expect(alerter.onSnapshot(offers('O1', 'O2'))).toEqual(['O2']);
  await settle();
  expect(calls).toEqual({ vibrate: 2, sound: 2 });
});

test('no alert while the app is in the background; the offer is not alerted later either', async () => {
  const bg = setup(false);
  expect(bg.alerter.onSnapshot(offers('O1'))).toEqual([]);
  await settle();
  expect(bg.calls).toEqual({ vibrate: 0, sound: 0 });
});

test('a failing sound or vibration never breaks the snapshot', async () => {
  const alerter = createOfferAlerter({
    vibrate: () => {
      throw new Error('no vibrator');
    },
    playSound: async () => {
      throw new Error('no permission');
    },
    isForeground: () => true
  });
  expect(alerter.onSnapshot(offers('O1'))).toEqual(['O1']);
  await settle();
});

test('the in-app offer sound shows no banner or list entry; other notifications do', () => {
  const { presentationFor, OFFER_ALERT_KIND } = require('../src/push');
  expect(presentationFor({ kind: OFFER_ALERT_KIND })).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false });
  expect(presentationFor({ kind: 'ride_offer' })).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
  expect(presentationFor(undefined)).toMatchObject({ shouldShowBanner: true });
});
