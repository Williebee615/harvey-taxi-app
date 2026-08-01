// Pure rider-session token logic: signing, verification, revocation
// checking, and sliding-renewal timing. server.js owns the actual
// Supabase reads/writes (loading the rider row, comparing
// session_version, setting/clearing the cookie); this module decides
// what a valid, current, renewable session token actually is, so those
// rules are unit-testable without a live database or an HTTP request.
//
// Deliberately a standalone module rather than inline in server.js
// (unlike the pre-existing signDriverSession/verifyDriverSession,
// which are inline and untested) -- see docs/rider-auth-design-proposal.md
// for why the rider session needs one thing the driver session doesn't:
// real revocation. That's session_version, checked in
// isSessionVersionCurrent() below, not in the token signature itself --
// a token can be validly signed and unexpired and still be logged out.

const crypto = require("crypto");

const RIDER_SESSION_SUBJECT = "harvey-rider";

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded =
    String(value).replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (String(value).length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

// Node's crypto.timingSafeEqual throws on mismatched buffer lengths
// instead of returning false, which itself leaks a length signal if
// callers aren't careful -- normalize that away here once, the same
// gotcha the existing (server.js) timingSafeEqualString already avoids.
function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Number.isInteger (unlike Number.isFinite) already refuses strings,
// booleans, and non-integers without coercion -- combined with the >= 0
// check this is the single definition of "valid session_version" used
// both when signing and when verifying, so the two can never drift.
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// A verified-but-stale clock (or a deliberately forged iat) shouldn't be
// able to claim a session started before it was actually issued by more
// than a small, explicit tolerance. 60s comfortably covers realistic
// clock drift between this process and whatever set `now` for a test or
// a future distributed deployment, without opening a meaningful replay
// window.
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

// Signs a self-contained, stateless session token. sessionVersion is
// embedded so a later mismatch against the rider's live DB row (done by
// server.js, not here) is what actually implements logout/revocation --
// see isSessionVersionCurrent(). sessionVersion must already be a valid
// nonnegative integer -- this function has no fallback-to-0 behavior,
// on purpose: a caller passing a bad value is a bug to surface loudly,
// not paper over with a default that could sign a token nobody meant to
// issue.
function signRiderSession({ riderId, sessionVersion, secret, ttlHours, now = Date.now() }) {
  if (!secret) {
    throw new Error("signRiderSession requires a secret.");
  }

  if (!riderId) {
    throw new Error("signRiderSession requires riderId.");
  }

  if (!isNonNegativeInteger(sessionVersion)) {
    throw new Error("signRiderSession requires sessionVersion to be a nonnegative integer.");
  }

  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error("signRiderSession requires a positive ttlHours.");
  }

  const payload = {
    sub: RIDER_SESSION_SUBJECT,
    rider_id: String(riderId),
    session_version: sessionVersion,
    iat: now,
    exp: now + ttlHours * 60 * 60 * 1000
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");

  return `${encoded}.${sig}`;
}

// Verifies signature + structure + expiry only. Does NOT check
// session_version against a live rider row -- that comparison needs the
// database and belongs in server.js's requireRider, using
// isSessionVersionCurrent() below with the value it loaded.
function verifyRiderSession({ token, secret, now = Date.now() }) {
  if (!token || !secret) {
    return { ok: false, reason: "missing_token" };
  }

  const parts = String(token).split(".");

  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }

  const [encoded, sig] = parts;

  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("hex");

  if (!timingSafeEqualString(sig, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload;

  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Structural validation. Every one of these is deliberately strict
  // and non-coercive: a missing, zero-like, negative, decimal, NaN, or
  // string session_version claim is rejected outright as malformed
  // rather than silently treated as version 0 -- version 0 is a real,
  // meaningful value (a rider's very first session), so it must only
  // ever come from an actual "0" in the payload, never from a fallback.
  if (
    !payload ||
    payload.sub !== RIDER_SESSION_SUBJECT ||
    !payload.rider_id ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    !isNonNegativeInteger(payload.session_version) ||
    payload.exp <= payload.iat
  ) {
    return { ok: false, reason: "malformed" };
  }

  // Everything past this point has a valid signature (proving only this
  // server could have produced it -- see signRiderSession) and a
  // structurally sound payload, so payload.rider_id is trustworthy from
  // here on even in the two failure branches below. That distinction
  // matters to callers like a logout route: an expired or
  // issued-in-future token still names a real, provably-authentic
  // rider and should still be actionable for "log me out anyway," while
  // a bad_signature/malformed/missing_token result must never expose a
  // riderId at all, since nothing has proven it's genuine.

  // A token whose iat is materially ahead of "now" couldn't have been
  // legitimately issued by this process yet -- reject it as its own
  // distinct reason rather than letting it fall through to the expiry
  // check (which, since exp > iat was just confirmed above, would
  // otherwise likely still pass and mask the problem).
  if (payload.iat > now + CLOCK_SKEW_TOLERANCE_MS) {
    return {
      ok: false,
      reason: "issued_in_future",
      riderId: payload.rider_id,
      sessionVersion: payload.session_version
    };
  }

  // Fail closed at the boundary: a token is expired the instant "now"
  // reaches exp, not only strictly after it.
  if (now >= payload.exp) {
    return {
      ok: false,
      reason: "expired",
      riderId: payload.rider_id,
      sessionVersion: payload.session_version
    };
  }

  return {
    ok: true,
    riderId: payload.rider_id,
    sessionVersion: payload.session_version,
    iat: payload.iat,
    exp: payload.exp
  };
}

// The revocation check. A token can be validly signed and unexpired and
// still not be current: logout, an admin Force Logout, or an
// access_revoked deletion all work by bumping riders.session_version,
// which invalidates every token issued before that bump in one atomic
// UPDATE -- no session table, no denylist to grow or clean up. Equality
// only (never >=): a token from a stale version must never be treated
// as valid just because the counter has since moved past it.
function isSessionVersionCurrent({ tokenVersion, currentVersion }) {
  return Number(tokenVersion) === Number(currentVersion);
}

// Sliding-renewal: re-issue a fresh token once more than half its
// original TTL has elapsed, so an actively-used session is refreshed
// before it can expire mid-use, while an abandoned one still expires on
// schedule. Only meaningful for a token that's presently valid -- an
// already-expired session isn't a renewal question, it's a
// sign-in-again question, and a session that (per a clock anomaly or a
// malformed input) appears not to have started yet, or whose window is
// inverted/zero-width, isn't renewable either. All of those return
// false rather than throwing, since this is called on the hot path of
// every authenticated request and a malformed timestamp here should
// never itself be why a request fails.
function shouldRenewSession({ iat, exp, now = Date.now() }) {
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || !Number.isFinite(now)) {
    return false;
  }

  if (exp <= iat) {
    return false;
  }

  if (now < iat) {
    return false;
  }

  // Same fail-closed boundary as verifyRiderSession: expired at, not
  // only strictly after, exp.
  if (now >= exp) {
    return false;
  }

  const ttl = exp - iat;
  const elapsed = now - iat;

  return elapsed >= ttl / 2;
}

// Logout, and later an admin Force Logout, both need to increment a
// rider's session_version *and* record an audit event as a single
// atomic fact -- exactly the gap already closed for driver compliance
// overrides (see lib/driverCompliance.js's applyContactVerificationOverride
// and supabase/migrations/20260730180000_add_driver_override_atomic_functions.sql).
// This calls the equivalent Postgres function
// (increment_rider_session_version, defined in
// supabase/migrations/20260731150000_add_rider_session_version_rpc.sql),
// which does the UPDATE and the audit_logs INSERT in one transaction:
// if the audit insert fails, the version bump rolls back with it, so
// "the rider was logged out" and "the logout was audited" can never
// diverge. callRpc is injected (server.js passes
// (name, params) => supabase.rpc(name, params)) so this orchestration
// is unit-testable without a live database.
const RIDER_SESSION_VERSION_RPC = "increment_rider_session_version";

async function applyRiderSessionVersionIncrement({
  callRpc,
  riderId,
  actorType,
  actorId,
  action,
  metadata,
  ipAddress,
  userAgent
}) {
  const { data, error } = await callRpc(RIDER_SESSION_VERSION_RPC, {
    p_rider_id: riderId,
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_action: action,
    p_metadata: metadata || {},
    p_ip_address: ipAddress || null,
    p_user_agent: userAgent || null
  });

  if (error) {
    return {
      ok: false,
      error: "The session could not be invalidated and audited together, so it was not invalidated.",
      statusCode: 502
    };
  }

  return { ok: true, rider: data };
}

module.exports = {
  RIDER_SESSION_SUBJECT,
  CLOCK_SKEW_TOLERANCE_MS,
  RIDER_SESSION_VERSION_RPC,
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  isNonNegativeInteger,
  shouldRenewSession,
  applyRiderSessionVersionIncrement,
  base64UrlEncode,
  base64UrlDecode,
  timingSafeEqualString
};
