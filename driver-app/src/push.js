// Native push: ride offers (urgent channel), ride updates, and the rest.
// The server sends only when driver_native_push_enabled is on; the app
// always registers so turning it on needs no app update.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

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
