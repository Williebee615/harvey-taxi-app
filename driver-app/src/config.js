// Harvey Taxi Driver: fixed endpoints. The app talks only to the existing
// Harvey Taxi backend; there is no separate driver backend.
export const PRODUCTION_API_BASE = 'https://harveytaxiservice.com';

// A test build can point at a staging server by building with
// EXPO_PUBLIC_API_BASE=https://… (EAS profile env). Only https is accepted;
// anything else falls back to production.
export function resolveApiBase(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(text) ? text : PRODUCTION_API_BASE;
}

export const API_BASE = resolveApiBase(process.env.EXPO_PUBLIC_API_BASE);

export const LINKS = Object.freeze({
  // Onboarding (application, identity and background checks) stays on the
  // website, where Persona and Checkr run today.
  driverSignup: `${API_BASE}/driver-signup.html`,
  onboarding: `${API_BASE}/driver-dashboard.html`,
  support: `${API_BASE}/support.html`,
  privacy: `${API_BASE}/privacy-policy.html`,
  terms: `${API_BASE}/terms.html`,
  accountDeletionWeb: `${API_BASE}/settings.html?account=driver#account-deletion`
});

export const SUPPORT_PHONE = null; // set when Harvey Taxi publishes a driver support line
export const EMERGENCY_NUMBER = '911';

export const LOCATION_TASK = 'harvey-driver-location';
