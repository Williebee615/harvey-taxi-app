// Redaction for operational logs (server console and audit_logs metadata).
//
// URLs and error messages are not automatically free of personal
// information: a query string can carry an email or phone number, and a
// database error can echo the value that failed ("Key (email)=(...)
// already exists"). Everything below is masked before it is logged.
// Pure functions, no I/O.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// +1 (615) 555-0100, 615-555-0100, 6155550100, +16155550100, 1-615-555-0100.
const PHONE = /(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g;
const LONG_DIGITS = /\b\d{7,}\b/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const SECRET_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}\b/g;
// Postgres error detail: Key (col)=(value) / Failing row contains (...).
const PG_KEY_VALUE = /(Key \([^)]*\)=\()[^)]*(\))/g;
const PG_FAILING_ROW = /(Failing row contains \().*(\))/g;

function redactLogText(value, max = 500) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(PG_FAILING_ROW, "$1[redacted]$2")
    .replace(PG_KEY_VALUE, "$1[redacted]$2")
    .replace(JWT, "[token]")
    .replace(BEARER, "$1 [token]")
    .replace(SECRET_KEY, "[key]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(LONG_DIGITS, "[number]")
    .slice(0, max);
}

// Path only: the query string is dropped (its presence is noted), and
// identifiers that look personal are masked in the path itself.
function redactPath(url) {
  if (url === null || url === undefined) return url;
  const raw = String(url);
  const q = raw.indexOf("?");
  const pathOnly = q === -1 ? raw : raw.slice(0, q);
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    /* keep it encoded */
  }
  return redactLogText(decoded, 300) + (q === -1 ? "" : "?[query removed]");
}

module.exports = { redactLogText, redactPath };
