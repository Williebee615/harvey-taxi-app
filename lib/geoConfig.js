// Address search / routing provider configuration (Mapbox). Pure
// functions over an env-like object so they can be unit tested. Nothing
// here returns or logs the token itself.

const GEO_TOKEN_ENV = "MAPBOX_ACCESS_TOKEN";

// Names commonly set by mistake. Reported by name only, never read as a
// fallback.
const LOOKALIKE_ENV_NAMES = Object.freeze([
  "MAPBOX_TOKEN",
  "MAPBOX_API_KEY",
  "MAPBOX_KEY",
  "MAPBOX_PUBLIC_TOKEN",
  "MAPBOX_SECRET_TOKEN",
  "MAPBOX_ACCESSTOKEN",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
  "VITE_MAPBOX_TOKEN",
  "REACT_APP_MAPBOX_TOKEN"
]);

const GEO_UNAVAILABLE_MESSAGE =
  "Address lookup and fare estimates are temporarily unavailable. Please try again later or contact support.";

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// Trimmed token, or "" when missing/blank.
function readGeoToken(envObj = {}) {
  const raw = envObj[GEO_TOKEN_ENV];
  return isSet(raw) ? String(raw).trim() : "";
}

function describeGeoConfig(envObj = {}) {
  const token = readGeoToken(envObj);
  const configured = token !== "";
  const problems = [];
  if (configured) {
    if (/^["'`]|["'`]$/.test(token)) problems.push("value is wrapped in quotes");
    if (/\s/.test(token)) problems.push("value contains spaces");
  }
  const lookalikes = LOOKALIKE_ENV_NAMES.filter((name) => isSet(envObj[name]));
  return { configured, problems, lookalikes };
}

// Startup log lines: names and booleans only.
function geoConfigLogLines(description) {
  if (description.configured && description.problems.length === 0) {
    return { level: "log", lines: [`✅ Mapbox address search and routing configured (${GEO_TOKEN_ENV})`] };
  }
  if (description.configured) {
    return {
      level: "warn",
      lines: [`⚠️ ${GEO_TOKEN_ENV} is set but looks malformed: ${description.problems.join(", ")}. Re-enter it in the hosting environment.`]
    };
  }
  const lines = [
    `⚠️ Mapbox inactive: ${GEO_TOKEN_ENV} is not set. Riders cannot look up addresses or get route-based fare estimates.`
  ];
  if (description.lookalikes.length) {
    lines.push(`⚠️ Found ${description.lookalikes.join(", ")} instead. The app reads only ${GEO_TOKEN_ENV}.`);
  }
  return { level: "warn", lines };
}

module.exports = {
  GEO_TOKEN_ENV,
  LOOKALIKE_ENV_NAMES,
  GEO_UNAVAILABLE_MESSAGE,
  readGeoToken,
  describeGeoConfig,
  geoConfigLogLines
};
