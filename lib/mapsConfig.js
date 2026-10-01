// Google Maps browser-key configuration: what /api/maps-key returns and
// what the server logs about it. Pure functions over an env-like object
// so they can be unit tested. Nothing here ever returns or logs the key
// itself except mapsKeyResponse's success body, which is the route's job.

const MAPS_KEY_ENV = "GOOGLE_MAPS_BROWSER_KEY";

// Names people commonly set by mistake. Reported by name only (never by
// value) and never used as a fallback: a server-side key must not be
// handed to browsers.
const LOOKALIKE_ENV_NAMES = Object.freeze([
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_KEY",
  "GOOGLE_MAPS_BROWSER_API_KEY",
  "GOOGLE_BROWSER_KEY",
  "GOOGLE_API_KEY",
  "MAPS_API_KEY",
  "MAPS_BROWSER_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
  "REACT_APP_GOOGLE_MAPS_API_KEY"
]);

const MAPS_NOT_CONFIGURED_MESSAGE =
  "Address lookup and fare estimates are temporarily unavailable: maps are not configured on this server.";

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// Describes the configuration without exposing the value: whether it is
// set, which look-alike variables are set instead, and whether the value
// looks malformed (wrapped in quotes or containing spaces, as happens
// when a key is pasted with surrounding characters).
function describeMapsConfig(envObj = {}) {
  const raw = envObj[MAPS_KEY_ENV];
  const configured = isSet(raw);
  const value = configured ? String(raw).trim() : "";
  const problems = [];
  if (configured) {
    if (/^["'`]|["'`]$/.test(value)) problems.push("value is wrapped in quotes");
    if (/\s/.test(value)) problems.push("value contains spaces");
  }
  const lookalikes = LOOKALIKE_ENV_NAMES.filter((name) => isSet(envObj[name]));
  return { configured, problems, lookalikes };
}

// Startup/runtime log lines. Names and booleans only.
function mapsConfigLogLines(description) {
  if (description.configured && description.problems.length === 0) {
    return { level: "log", lines: [`✅ Google Maps browser key configured (${MAPS_KEY_ENV})`] };
  }
  if (description.configured) {
    return {
      level: "warn",
      lines: [`⚠️ ${MAPS_KEY_ENV} is set but looks malformed: ${description.problems.join(", ")}. Re-enter it in the hosting environment.`]
    };
  }
  const lines = [
    `⚠️ Google Maps inactive: ${MAPS_KEY_ENV} is not set. Riders cannot look up addresses or get route-based fare estimates.`
  ];
  if (description.lookalikes.length) {
    lines.push(
      `⚠️ Found ${description.lookalikes.join(", ")} instead. The app reads only ${MAPS_KEY_ENV}; set that name (a browser key restricted to the site's domains).`
    );
  }
  return { level: "warn", lines };
}

// GET /api/maps-key outcome. Missing key: a clear 503 configuration error
// instead of { ok: true, key: "" }.
function mapsKeyResponse(key) {
  if (isSet(key)) {
    return { status: 200, body: { key: String(key).trim() } };
  }
  return {
    status: 503,
    body: { message: MAPS_NOT_CONFIGURED_MESSAGE, code: "maps_not_configured" }
  };
}

module.exports = {
  MAPS_KEY_ENV,
  LOOKALIKE_ENV_NAMES,
  MAPS_NOT_CONFIGURED_MESSAGE,
  describeMapsConfig,
  mapsConfigLogLines,
  mapsKeyResponse
};
