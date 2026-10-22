// Structured, allowlisted log entries for operational errors.
//
// Masking free text is not reliable: names, addresses and arbitrary
// database values can't be recognised by pattern. So these entries never
// contain raw exception messages, request bodies, query strings, URL
// parameter values or headers. They carry only fixed fields:
//   error_code  -- a fixed code derived from the error's type, never its text
//   error_class -- the error constructor, from an allowlist
//   route       -- the matched route TEMPLATE (e.g. /api/drivers/:id), never
//                  the actual URL
//   method      -- the HTTP method, from an allowlist
// Pure functions, no I/O.

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const ERROR_CLASSES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "AbortError", "FetchError"]);
// Body-parser / http-errors types (fixed strings set by the library).
const BODY_TYPES = new Map([
  ["entity.parse.failed", "request_body_invalid_json"],
  ["entity.too.large", "request_body_too_large"],
  ["encoding.unsupported", "request_body_bad_encoding"],
  ["request.aborted", "request_aborted"]
]);
const STRIPE_TYPES = new Set([
  "StripeCardError",
  "StripeInvalidRequestError",
  "StripeAPIError",
  "StripeAuthenticationError",
  "StripePermissionError",
  "StripeRateLimitError",
  "StripeConnectionError",
  "StripeSignatureVerificationError",
  "StripeIdempotencyError"
]);

function errorCode(error) {
  if (!error || typeof error !== "object") return "unknown";
  if (error.corsDiagnostics) return "cors_origin_blocked";
  if (typeof error.type === "string" && BODY_TYPES.has(error.type)) return BODY_TYPES.get(error.type);
  if (typeof error.type === "string" && STRIPE_TYPES.has(error.type)) return `stripe_${error.type.replace(/^Stripe/, "").replace(/Error$/, "").toLowerCase()}`;
  const code = typeof error.code === "string" ? error.code : "";
  if (/^[0-9A-Z]{5}$/.test(code)) return `db_${code}`; // Postgres SQLSTATE
  if (/^PGRST\d{3}$/.test(code)) return `postgrest_${code}`;
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_[A-Z_]+)$/.test(code)) return `net_${code}`;
  if (error.name === "SyntaxError") return "js_syntax";
  if (error.name === "TypeError") return "js_type";
  if (error.name === "RangeError") return "js_range";
  return "unhandled";
}

function errorClass(error) {
  const name = error && error.constructor && error.constructor.name;
  if (ERROR_CLASSES.has(name)) return name;
  if (typeof name === "string" && /^Stripe[A-Za-z]*Error$/.test(name)) return "StripeError";
  return "Other";
}

function routeTemplate(req) {
  if (req && req.route && typeof req.route.path === "string") return `${req.baseUrl || ""}${req.route.path}`.slice(0, 200);
  return "unmatched";
}

function method(req) {
  const m = req && typeof req.method === "string" ? req.method.toUpperCase() : "";
  return METHODS.has(m) ? m : "OTHER";
}

function serverErrorEntry(error, req) {
  return { error_code: errorCode(error), error_class: errorClass(error), route: routeTemplate(req), method: method(req) };
}

// Fixed fields for a failed database write: SQLSTATE-derived code only.
// Postgres `details` ("Failing row contains (...)", "Key (email)=(...)")
// and `hint` echo the values being written, so they are never logged.
function dbErrorEntry(error) {
  return { error_code: errorCode(error) };
}

// A safety net under every console call (log privacy audit, 2026-10-22).
// The allowlisted entries above are the primary control; this catches
// what slips through a free-text message: email addresses, phone
// numbers, Postgres row dumps and credentials. It cannot recognise names
// or street addresses, so it does not replace allowlisting.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// E.164 (+ and 10-15 digits) and US formats with separators. Bare digit
// runs are left alone: they are usually IDs, timestamps or amounts.
const PHONE_RE = /\+\d{10,15}\b|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g;
// Values can contain parentheses, so everything to the end of the line goes.
const PG_ROW_RE = /(Failing row contains|Key \([^)\n]*\)=)[^\n]*/g;
const SECRET_RE = /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+|\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const MAX_DEPTH = 4;

function redactLogText(text) {
  if (typeof text !== "string" || !text) return text;
  return text
    .replace(PG_ROW_RE, "$1 [values redacted]")
    .replace(SECRET_RE, "[secret]")
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]");
}

function redactLogValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return redactLogText(value);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Error) return redactLogText(value.stack || `${value.name}: ${value.message}`);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[object]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactLogValue(v, depth + 1, seen));
  const out = {};
  for (const [key, v] of Object.entries(value)) out[key] = redactLogValue(v, depth + 1, seen);
  return out;
}

const INSTALLED = Symbol.for("harvey.safeLog.consoleRedaction");

// Wraps console.log/info/warn/error/debug once; later calls are no-ops.
function installConsoleRedaction(target = console) {
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = target[level];
    if (typeof original !== "function" || original[INSTALLED]) continue;
    const wrapped = function redactedConsole(...args) {
      return original.apply(this, args.map((a) => redactLogValue(a)));
    };
    wrapped[INSTALLED] = true;
    target[level] = wrapped;
  }
  return target;
}

module.exports = { errorCode, errorClass, routeTemplate, serverErrorEntry, dbErrorEntry, redactLogText, redactLogValue, installConsoleRedaction };
