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
function buildDefaultAllowedOrigins({ appBaseUrl, canonicalHost, foundationHost }) {
  return new Set(
    [
      appBaseUrl,
      canonicalHost && `https://${canonicalHost}`,
      canonicalHost && `https://www.${canonicalHost}`,
      foundationHost && `https://${foundationHost}`,
      foundationHost && `https://www.${foundationHost}`
    ].filter(Boolean)
  );
}

function isAllowedOrigin(
  origin,
  { isProduction, configuredOrigins = [], appBaseUrl, canonicalHost, foundationHost }
) {
  if (!origin) return true;
  if (!isProduction) return true;

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  return buildDefaultAllowedOrigins({ appBaseUrl, canonicalHost, foundationHost }).has(origin);
}

module.exports = { isAllowedOrigin, buildDefaultAllowedOrigins };
