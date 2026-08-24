// CORS origin allow-list — pure, dependency-free (same pattern as
// lib/pricing.js, lib/riderVerification.js).
//
// This platform intentionally serves the same app from more than one
// public domain: the taxi app (CANONICAL_HOST) and the HTAF foundation
// site (FOUNDATION_HOST), each with a www variant, per the multi-domain
// routing already in server.js (FOUNDATION_HOSTS). Before this fix, the
// CORS origin check only accepted an exact match against a single
// APP_BASE_URL. Any legitimate same-origin fetch from a page loaded on
// one of the other real domains (or a www-vs-apex mismatch, or
// APP_BASE_URL falling back to Render's own *.onrender.com URL when
// PUBLIC_APP_URL/APP_BASE_URL aren't set) was rejected by the `cors`
// package, which surfaces as an uncaught error to Express's global
// error handler — "Internal server error." to the end user — for every
// POST from that origin, including rider signup. This was never a
// Supabase/schema problem: the request never reached the database.
// A bare hostname (what Render's RENDER_EXTERNAL_HOSTNAME env var is
// documented to contain) shouldn't have a scheme, whitespace, or a
// path/slash in it. Guards against a malformed value turning into a
// broken or unexpected origin string (e.g. "https://https://foo" or an
// origin with a path baked in) -- if it doesn't look like a plain
// hostname, it's dropped rather than trusted.
function isPlausibleHostname(value) {
  return typeof value === "string" && value.length > 0 && !/[\s/]/.test(value) && !value.includes("://");
}

function buildDefaultAllowedOrigins({ appBaseUrl, canonicalHost, foundationHost, renderExternalHostname }) {
  return new Set(
    [
      appBaseUrl,
      canonicalHost && `https://${canonicalHost}`,
      canonicalHost && `https://www.${canonicalHost}`,
      foundationHost && `https://${foundationHost}`,
      foundationHost && `https://www.${foundationHost}`,
      isPlausibleHostname(renderExternalHostname) && `https://${renderExternalHostname}`
    ].filter(Boolean)
  );
}

function isAllowedOrigin(
  origin,
  { isProduction, configuredOrigins = [], appBaseUrl, canonicalHost, foundationHost, renderExternalHostname }
) {
  if (!origin) return true;
  if (!isProduction) return true;

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  return buildDefaultAllowedOrigins({ appBaseUrl, canonicalHost, foundationHost, renderExternalHostname }).has(origin);
}

// Parses a rejected Origin header into only what's safe to persist in
// diagnostics: the scheme and hostname. Discards userinfo, port, path,
// query, and fragment even when the raw value carries them, and never
// throws -- a missing Origin, the literal "null" some sandboxed iframes
// and WebViews send, a custom-scheme value (capacitor://..., file://...),
// or plain garbage all resolve to a safe, classified shape instead of
// blowing up the CORS middleware that calls this on every rejection.
function parseOriginForDiagnostics(origin) {
  if (!origin) {
    return { origin_scheme: null, origin_hostname: null };
  }

  if (origin === "null") {
    return { origin_scheme: "null", origin_hostname: null };
  }

  try {
    const url = new URL(origin);
    return {
      origin_scheme: url.protocol.replace(/:$/, ""),
      origin_hostname: url.hostname || null
    };
  } catch {
    return { origin_scheme: "unparseable", origin_hostname: null };
  }
}

// Builds the Error thrown into Express's error handler when an Origin is
// rejected, carrying only the sanitized diagnostic fields (never the raw
// Origin) so the global error handler can enrich its audit_logs row
// without parsing the origin a second time in server.js. Diagnostic
// only -- does not change what gets rejected, only what gets recorded
// about a rejection.
function buildCorsRejectionError(origin, { buildSha = null } = {}) {
  const error = new Error("CORS origin blocked");
  const { origin_scheme, origin_hostname } = parseOriginForDiagnostics(origin);

  error.corsDiagnostics = {
    origin_scheme,
    origin_hostname,
    rejection_reason: "origin_not_in_allowlist",
    build_sha: buildSha
  };

  return error;
}

module.exports = {
  isAllowedOrigin,
  buildDefaultAllowedOrigins,
  parseOriginForDiagnostics,
  buildCorsRejectionError
};
