// Rider navigation for the Harvey Taxi WebView shell.
//
// Pure logic and injected-script text, no React Native imports, so it can
// be unit tested directly (same split as startup.js).
//
//   - Launch: a signed-in rider who opens the app lands on the rider
//     dashboard instead of the marketing home page. The decision is made
//     by the site itself, using the existing GET /api/rider/session check
//     with the WebView's own (HttpOnly) session cookie; the app never sees
//     or stores a session token.
//   - Links: harveytaxi:// links and https links to the Harvey Taxi site
//     open the matching screen; explicit booking and tracking links are
//     kept exactly and never replaced by the launch redirect.
//   - Driver pages: driving operations open in Harvey Taxi Driver, not
//     here (isDriverOperationsUrl); sign-up and account deletion stay.
//   - Android Back: booking or tracking -> rider dashboard (the same
//     action as the page's own "Back to Dashboard"); other site pages ->
//     previous page; dashboard or home -> leave the app, the standard
//     Android behaviour at an app's top level.

export const APP_ORIGIN = 'https://harveytaxiservice.com';
export const DASHBOARD_PATH = '/rider-dashboard.html';
export const LAUNCH_URL = `${APP_ORIGIN}/`;
export const APP_SCHEME = 'harveytaxi';

// How long the launch check may hold the loading screen after the first
// page loaded before the home page is simply shown.
export const LAUNCH_CHECK_TIMEOUT_MS = 4000;

const SITE_HOSTS = new Set(['harveytaxiservice.com', 'www.harveytaxiservice.com']);

// Rider and driver apps are separate. Driving operations (the driver
// dashboard, the old driver console, the driver wallet) live in the Harvey
// Taxi Driver app, so this app never opens those pages: it shows a
// hand-off screen instead. Driver sign-up (/driver-signup.html) and
// account deletion (/settings.html?account=driver) stay available here.
const DRIVER_OPERATIONS_PATHS = new Set([
  '/driver-dashboard.html',
  '/driver-dashboard',
  '/driver.html',
  '/driver',
  '/driver-wallet.html',
  '/driver-wallet'
]);
export const DRIVER_APP_SCHEME_URL = 'harveytaxidriver://';
export const DRIVER_APP_STORE_URLS = Object.freeze({
  ios: 'https://apps.apple.com/app/id6818705885',
  android: 'https://play.google.com/store/apps/details?id=com.harveytaxi.driver'
});
export const DRIVER_DELETION_URL = `${APP_ORIGIN}/settings.html?account=driver#account-deletion`;

// True for an https link to a driving-operations page on our site.
export function isDriverOperationsUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !SITE_HOSTS.has(url.hostname.toLowerCase())) return false;
  return DRIVER_OPERATIONS_PATHS.has(url.pathname.toLowerCase());
}
// The booking modes the rider dashboard's wizard defines.
const BOOKING_MODES = new Set(['driver', 'airport', 'autonomous', 'food', 'grocery']);
const RIDE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROOT_PATHS = new Set(['/', '/index.html', DASHBOARD_PATH, '/rider-dashboard']);

function dashboardUrl(params) {
  const query = new URLSearchParams(params).toString();
  return `${APP_ORIGIN}${DASHBOARD_PATH}${query ? `?${query}` : ''}`;
}

// Maps an incoming link to the https URL the WebView should open, or null
// if it is not one of ours. Never returns a URL on another host.
//   harveytaxi://dashboard
//   harveytaxi://book[?mode=airport]
//   harveytaxi://ride/<rideId>          (tracking)
//   https://harveytaxiservice.com/...   (any page on the site)
export function resolveIncomingLink(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol === 'https:') {
    if (!SITE_HOSTS.has(url.hostname.toLowerCase()) || url.port) return null;
    return `${APP_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  }

  if (url.protocol !== `${APP_SCHEME}:`) return null;

  // harveytaxi://ride/ID parses with host "ride" and path "/ID".
  const parts = [url.hostname, ...url.pathname.split('/')].filter(Boolean);
  const [target, id] = parts;
  switch ((target || '').toLowerCase()) {
    case 'dashboard':
    case '':
      return dashboardUrl({});
    case 'book': {
      const mode = (url.searchParams.get('mode') || 'driver').toLowerCase();
      return dashboardUrl({ screen: 'book', mode: BOOKING_MODES.has(mode) ? mode : 'driver' });
    }
    case 'ride':
    case 'track': {
      const rideId = id || url.searchParams.get('ride_id') || '';
      if (!RIDE_ID_PATTERN.test(rideId)) return dashboardUrl({});
      return dashboardUrl({ screen: 'track', ride_id: rideId });
    }
    default:
      return null;
  }
}

// Page state reported by PAGE_STATE_SCRIPT. Anything malformed is ignored.
export function parseShellMessage(data) {
  let msg;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || msg.source !== 'harvey-shell') return null;
  if (msg.type === 'page') {
    return {
      type: 'page',
      path: typeof msg.path === 'string' ? msg.path.slice(0, 200) : '',
      wizardOpen: msg.wizardOpen === true
    };
  }
  if (msg.type === 'launch') {
    return { type: 'launch', result: msg.result === 'redirect' ? 'redirect' : 'stay' };
  }
  return null;
}

// Android hardware/gesture Back. Returns:
//   'close-wizard' -- booking or tracking is open: return to the dashboard
//   'go-back'      -- another site page with history: previous page
//   'exit'         -- dashboard, home, or nothing to go back to: leave the app
export function decideAndroidBack({ page, canGoBack }) {
  if (page && page.wizardOpen) return 'close-wizard';
  if (page && ROOT_PATHS.has(page.path)) return 'exit';
  if (canGoBack) return 'go-back';
  return 'exit';
}

// Runs in every page. Reports the path and whether the rider booking or
// tracking screen is open, on load, on history changes and when the
// screen opens or closes. Also performs the one-time launch check on the
// home page. No cookies, tokens or page content are sent to the app.
export const PAGE_STATE_SCRIPT = `
(function () {
  if (window.__harveyShellInstalled) { return; }
  window.__harveyShellInstalled = true;
  function post(message) {
    message.source = 'harvey-shell';
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (e) {}
  }
  function wizardOpen() {
    var overlay = document.getElementById('rideWizardOverlay');
    return !!overlay && !overlay.hidden;
  }
  var last = '';
  function report() {
    var state = { type: 'page', path: location.pathname, wizardOpen: wizardOpen() };
    var key = state.path + '|' + state.wizardOpen;
    if (key === last) { return; }
    last = key;
    post(state);
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(report, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(report, 0); });
  var overlay = document.getElementById('rideWizardOverlay');
  if (overlay && window.MutationObserver) {
    new MutationObserver(report).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  }
  report();

  // Launch check: only on the home page, once per app session.
  var launchKey = 'harvey_app_launch_checked';
  var checked = false;
  try { checked = sessionStorage.getItem(launchKey) === '1'; sessionStorage.setItem(launchKey, '1'); } catch (e) {}
  if (checked || (location.pathname !== '/' && location.pathname !== '/index.html')) {
    post({ type: 'launch', result: 'stay' });
    return;
  }
  fetch('/api/rider/session', { credentials: 'include', headers: { Accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (data && data.ok !== false && data.rider_id) {
        post({ type: 'launch', result: 'redirect' });
        location.replace('${DASHBOARD_PATH}');
      } else {
        post({ type: 'launch', result: 'stay' });
      }
    })
    .catch(function () { post({ type: 'launch', result: 'stay' }); });
})();
true;
`;

// Android Back on the booking/tracking screen: the page's own "Back to
// Dashboard" control, so the app behaves exactly like the visible button
// (including the "no ride was requested" notice after an abandoned
// booking). Falls back to history.back() if the control is missing.
export const CLOSE_WIZARD_SCRIPT = `
(function () {
  var link = document.querySelector('#rideWizardOverlay .wizard-close-link');
  if (link) { link.click(); } else { history.back(); }
})();
true;
`;

// Appended to the WebView's user agent (never replacing it) so the
// Harvey Taxi server can count assistant requests per app: rider iOS app,
// rider Android app, or the website (lib/agent/usage.js). A label for
// reporting only; it grants nothing.
export function riderAppUserAgentTag(platformOS, version) {
  const os = platformOS === 'ios' || platformOS === 'android' ? platformOS : 'other';
  const v = /^[\w.-]{1,20}$/.test(String(version || '')) ? String(version) : '0';
  return `HarveyTaxiRider/${v} (${os})`;
}
