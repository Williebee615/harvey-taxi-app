// The driver session token lives in the OS keychain/keystore, never in
// plain storage.
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'harvey_driver_token';
const DRIVER_KEY = 'harvey_driver_id';
let cachedToken;

export async function getToken() {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = (await SecureStore.getItemAsync(TOKEN_KEY)) || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export async function saveSession({ token, driverId }) {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  if (driverId) await SecureStore.setItemAsync(DRIVER_KEY, String(driverId));
}

export async function clearSession() {
  cachedToken = null;
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}), SecureStore.deleteItemAsync(DRIVER_KEY).catch(() => {})]);
}
