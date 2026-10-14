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

module.exports = { errorCode, errorClass, routeTemplate, serverErrorEntry };
