// Pure decision logic for what a rate-limited request gets told and what
// is safe to log about it. server.js's rateLimit() middleware owns the
// actual counting (an in-memory Map, or Redis when configured) and the
// Express response; this module decides the numbers/shape once a limit
// has already been exceeded, so those rules are unit-testable without a
// live request, a real clock, or Redis.
//
// The incident this closes: a rejected reviewer login due to rate
// limiting (HTTP 429) was indistinguishable, client-side, from a wrong
// password -- the client only special-cased a 503 and collapsed every
// other non-2xx status into "Invalid reviewer credentials." A 429 needs
// its own honest message and, where possible, a concrete wait time.

// How many whole seconds remain until `resetAt`, given `now` -- never
// negative (a resetAt already in the past is 0 seconds left, not a
// negative number that would make "wait N seconds" nonsensical), and
// never a fraction (rounds up so a caller who waits exactly this long is
// guaranteed to be past the reset, not a moment short of it).
function computeRetryAfterSeconds({ resetAt, now = Date.now() }) {
  if (!Number.isFinite(resetAt) || !Number.isFinite(now)) {
    return null;
  }

  return Math.max(0, Math.ceil((resetAt - now) / 1000));
}

// The sanitized event server.js logs whenever any rate limiter rejects a
// request. keyPrefix identifies *which* limiter (e.g.
// "review_rider_login_dest") -- never the per-caller identity itself (an
// IP address or a hashed destination), which this function never even
// receives. No raw email, password, token, cookie, or Authorization
// header is ever passed into or read by this function -- there is
// nothing here for any of those to leak through.
function buildRateLimitExceededLogEvent({ keyPrefix, retryAfterSeconds }) {
  return {
    event: "rate_limit_exceeded",
    key_prefix: keyPrefix,
    retry_after_seconds: retryAfterSeconds
  };
}

module.exports = {
  computeRetryAfterSeconds,
  buildRateLimitExceededLogEvent
};
