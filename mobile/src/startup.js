// Startup state for the Harvey Taxi WebView shell.
//
// Pure logic, no React Native imports, so it can be unit tested directly.
// The rule this module enforces: the app is always in exactly one of
// three visible states -- loading, ready (web content showing) or error
// (message plus Retry). There is no state in which the user sees an empty
// screen.

export const START_URL = 'https://harveytaxiservice.com';

// How long the first page may take before the connection screen replaces
// the spinner. Long enough for a slow cellular connection, short enough
// that nobody stares at a spinner indefinitely.
export const LOAD_TIMEOUT_MS = 30000;

// After this long the loading screen adds a "still connecting" hint.
export const SLOW_HINT_MS = 8000;

// Web content process terminations tolerated (each followed by an
// automatic reload) before the error screen is shown instead.
export const MAX_AUTO_RELOADS = 2;

export const PHASE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error'
});

export const ERROR_KIND = Object.freeze({
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  SECURE_CONNECTION: 'secure_connection',
  SERVER: 'server',
  CRASHED: 'crashed',
  GENERIC: 'generic'
});

export const ERROR_COPY = Object.freeze({
  [ERROR_KIND.OFFLINE]: {
    title: "You're offline",
    message: 'Harvey Taxi needs an internet connection. Check Wi-Fi or cellular data, then try again.'
  },
  [ERROR_KIND.TIMEOUT]: {
    title: 'Connection is taking too long',
    message: 'Harvey Taxi could not load in time. Your connection may be slow. Please try again.'
  },
  [ERROR_KIND.UNREACHABLE]: {
    title: "Can't reach Harvey Taxi",
    message: 'We could not connect to Harvey Taxi right now. Check your connection and try again.'
  },
  [ERROR_KIND.SECURE_CONNECTION]: {
    title: 'Secure connection failed',
    message: 'A secure connection to Harvey Taxi could not be established. If you are on public Wi-Fi, try another network.'
  },
  [ERROR_KIND.SERVER]: {
    title: 'Harvey Taxi is temporarily unavailable',
    message: 'Our service did not respond correctly. Please try again in a moment.'
  },
  [ERROR_KIND.CRASHED]: {
    title: 'Something went wrong',
    message: 'The page stopped unexpectedly. Tap Try Again to reload Harvey Taxi.'
  },
  [ERROR_KIND.GENERIC]: {
    title: "Harvey Taxi couldn't load",
    message: 'Something went wrong while loading. Please try again.'
  }
});

// iOS NSURLErrorDomain codes and Android WebViewClient ERROR_* codes.
const OFFLINE_CODES = new Set([-1009, -1018, -1020]);
const TIMEOUT_CODES = new Set([-1001, -8]);
const UNREACHABLE_CODES = new Set([-1003, -1004, -1005, -1006, -2, -6]);
const SECURE_CODES = new Set([-1200, -1201, -1202, -1203, -1204, -1205, -1206, -1022, -11]);

// Not failures: -999 is NSURLErrorCancelled (a navigation superseded by
// another, e.g. a redirect or a quick second tap); WebKitErrorDomain 102
// is "frame load interrupted" (a link handed off to another app, or a
// download). Showing an error screen for these would be wrong.
export function isIgnorableLoadError(nativeEvent = {}) {
  const code = Number(nativeEvent.code);
  if (code === -999) return true;
  if (nativeEvent.domain === 'WebKitErrorDomain' && code === 102) return true;
  return false;
}

export function classifyLoadError(nativeEvent = {}) {
  const code = Number(nativeEvent.code);
  if (OFFLINE_CODES.has(code)) return ERROR_KIND.OFFLINE;
  if (TIMEOUT_CODES.has(code)) return ERROR_KIND.TIMEOUT;
  if (UNREACHABLE_CODES.has(code)) return ERROR_KIND.UNREACHABLE;
  if (SECURE_CODES.has(code)) return ERROR_KIND.SECURE_CONNECTION;
  return ERROR_KIND.GENERIC;
}

export const initialState = Object.freeze({
  phase: PHASE.LOADING,
  errorKind: null,
  attempt: 0,
  autoReloads: 0,
  slow: false
});

// Actions: RETRY, LOADED, SLOW, TIMEOUT, LOAD_ERROR, HTTP_ERROR,
// PROCESS_TERMINATED.
export function startupReducer(state, action) {
  switch (action.type) {
    case 'RETRY':
      return {
        phase: PHASE.LOADING,
        errorKind: null,
        attempt: state.attempt + 1,
        autoReloads: action.automatic ? state.autoReloads : 0,
        slow: false
      };

    case 'LOADED':
      // A page that finished loading after an HTTP error is the server's
      // error page, not the app: keep the error screen.
      if (state.phase === PHASE.ERROR) return state;
      return { ...state, phase: PHASE.READY, errorKind: null, autoReloads: 0, slow: false };

    case 'SLOW':
      return state.phase === PHASE.LOADING ? { ...state, slow: true } : state;

    case 'TIMEOUT':
      return state.phase === PHASE.LOADING ? { ...state, phase: PHASE.ERROR, errorKind: ERROR_KIND.TIMEOUT } : state;

    case 'LOAD_ERROR':
      return { ...state, phase: PHASE.ERROR, errorKind: action.kind || ERROR_KIND.GENERIC };

    case 'HTTP_ERROR':
      // Only the first page decides whether the app started. Once the site
      // is showing, its own 404/500 pages are part of the site.
      if (state.phase !== PHASE.LOADING) return state;
      return { ...state, phase: PHASE.ERROR, errorKind: ERROR_KIND.SERVER };

    case 'PROCESS_TERMINATED':
      // iOS kills the web content process under memory pressure, often
      // while the app is in the background; the WebView is left blank.
      // Reload automatically a limited number of times, then ask the user.
      if (state.autoReloads >= MAX_AUTO_RELOADS) {
        return { ...state, phase: PHASE.ERROR, errorKind: ERROR_KIND.CRASHED };
      }
      return {
        phase: PHASE.LOADING,
        errorKind: null,
        attempt: state.attempt + 1,
        autoReloads: state.autoReloads + 1,
        slow: false
      };

    default:
      return state;
  }
}

// Errors worth retrying automatically when the app returns to the
// foreground (the network may have come back while it was away).
export function shouldAutoRetryOnForeground(state) {
  return (
    state.phase === PHASE.ERROR &&
    [ERROR_KIND.OFFLINE, ERROR_KIND.TIMEOUT, ERROR_KIND.UNREACHABLE].includes(state.errorKind)
  );
}

const EXTERNAL_SCHEMES = new Set(['tel:', 'mailto:', 'sms:', 'maps:', 'itms-apps:']);
const SUBFRAME_SCHEMES = new Set(['about:', 'blob:']);

// Decides what happens to a navigation request:
//   'allow'    -- load it in the WebView (HTTPS only; App Transport
//                 Security stays fully enabled);
//   'external' -- hand it to the OS (phone, mail, SMS, maps, App Store,
//                 and plain-HTTP links, which open in Safari rather than
//                 loading insecurely in the app);
//   'block'    -- ignore it (javascript:, file:, data:, custom schemes).
export function navigationDecision(url, { isTopFrame = true } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return 'block';
  }
  const scheme = parsed.protocol;
  if (scheme === 'https:') return 'allow';
  if (SUBFRAME_SCHEMES.has(scheme)) return 'allow';
  if (EXTERNAL_SCHEMES.has(scheme)) return isTopFrame ? 'external' : 'block';
  if (scheme === 'http:') return isTopFrame ? 'external' : 'block';
  return 'block';
}

// Diagnostic line for the device log. Deliberately excludes URLs,
// descriptions and headers, which can carry session tokens, reset links
// or personal data: only the event name and a numeric code.
export function describeForLog(event, code) {
  const numeric = Number(code);
  return Number.isFinite(numeric) ? `[startup] ${event} code=${numeric}` : `[startup] ${event}`;
}
