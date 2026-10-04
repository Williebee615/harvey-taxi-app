// Native push: ride offers (urgent channel), ride updates, and the rest.
// The server sends only when driver_native_push_enabled is on; the app
// always registers so turning it on needs no app update.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

// The in-app offer alert (playOfferSound, below) is sound only: the
// offer card is already on screen, so no banner or Notification Center
// entry. Every other notification shows as usual.
export const OFFER_ALERT_KIND = 'offer_alert';

export function presentationFor(data) {
  const soundOnly = Boolean(data && data.kind === OFFER_ALERT_KIND);
  return { shouldShowBanner: !soundOnly, shouldShowList: !soundOnly, shouldPlaySound: true, shouldSetBadge: false };
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => presentationFor(n && n.request && n.request.content && n.request.content.data)
});

// Plays the standard notification sound for a new offer while the app is
// open. Uses the notification system the app already has (respects the
// silent switch; no microphone-capable audio library). Without
// notification permission it does nothing, and the vibration still runs.
export async function playOfferSound() {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'New ride request', sound: 'default', data: { kind: OFFER_ALERT_KIND } },
    trigger: Platform.OS === 'android' ? { channelId: 'ride-offers' } : null
  });
}

let registeredToken = null;

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('ride-offers', {
    name: 'Ride offers',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
  });
  await Notifications.setNotificationChannelAsync('ride-updates', {
    name: 'Trip updates',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default'
  });
}

// Returns { ok, reason }. Never throws: push is helpful, not required to drive.
export async function registerForPush(api) {
  try {
    await ensureChannels();
    if (!Device.isDevice) return { ok: false, reason: 'simulator' };
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return { ok: false, reason: 'denied' };
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return { ok: false, reason: 'no_project_id' };
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('/api/driver/push-token', {
      token,
      platform: Platform.OS,
      app_version: `${Application.nativeApplicationVersion || ''} (${Application.nativeBuildVersion || ''})`
    });
    registeredToken = token;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err && err.message };
  }
}

export async function unregisterPush(api) {
  if (!registeredToken) return;
  await api.del('/api/driver/push-token', { token: registeredToken }).catch(() => {});
  registeredToken = null;
}

export function onNotificationTap(handler) {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => handler(response.notification.request.content.data || {}));
  return () => sub.remove();
}

export function onNotificationReceived(handler) {
  const sub = Notifications.addNotificationReceivedListener((n) => handler(n.request.content.data || {}));
  return () => sub.remove();
}
