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

// Riders are stored with real format drift in their phone column --
// confirmed live: some rows are a bare 10-digit US number
// ("6156366201", no country code at all), some are 11-digit
// ("16156366201"), and some are already full E.164 ("+16150000001").
// Matching on the last 10 digits (the significant digits of any US
// number regardless of how a leading "1" or "+1" was or wasn't stored)
// is resilient to all three observed formats. US-only by design,
// matching this app's actual service area.
//
// Deliberately only accepts exactly-10-digit or exactly-11-digit-
// starting-with-1 input -- NOT "10 or more digits, take the last 10."
// A merely-suffix-based rule would treat a malformed/garbage value with
// extra leading digits (e.g. a 13-digit data-entry error that happens
// to end in a real rider's 10 digits) as if it were that same number,
// which is exactly the false-positive an ilike suffix lookup at the SQL
// layer can hand back (see selectExactlyOneActiveRider below). Anything
// outside the two valid shapes returns "" -- not a match, not a guess.
function phoneLast10(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (digits.length === 10) {
    return digits;
  }

  if (digits.length === 11 && digits[0] === "1") {
    return digits.slice(1);
  }

  return "";
}

// Builds a guaranteed-valid US E.164 number from whatever format a
// rider's row actually has on file, for the one place that needs strict
// E.164 (the Twilio Verify `to` field) -- see phoneLast10() above for
// why a rider's stored phone can't be trusted as already-correct.
function phoneToE164US(phone) {
  const last10 = phoneLast10(phone);
  return last10 ? `+1${last10}` : null;
}

// The actual ambiguity-resolution decision behind rider phone login,
// pulled out as a pure function so it's testable with a plain array of
// candidate rows instead of a live Supabase query. server.js's
// findExactlyOneActiveRiderByPhone fetches every row an ilike suffix
// match could plausibly return (a real net that can include false
// positives and, per this table's confirmed live data, actual
// duplicates) and hands the raw candidate list to this function, which:
//   1. narrows to rows whose OWN normalized last-10-digits are an exact
//      match (eliminating any ilike false positive -- e.g. a longer,
//      malformed value that merely ends in the same digits);
//   2. narrows further to rows that are active (not access_revoked, not
//      deleted_at);
//   3. proceeds only when that leaves exactly one row.
// Zero or multiple matches are both "no match" -- this never guesses by
// returning the first/best candidate.
function selectExactlyOneActiveRider(candidates, targetLast10) {
  if (!targetLast10) {
    return { rider: null, matchCount: 0 };
  }

  const exact = (candidates || []).filter((row) => phoneLast10(row?.phone) === targetLast10);
  const eligible = exact.filter((row) => row.access_revoked !== true && !row.deleted_at);

  if (eligible.length !== 1) {
    return { rider: null, matchCount: eligible.length };
  }

  return { rider: eligible[0], matchCount: 1 };
}

// Resolves how many minutes a verification code should live, given an
// optional explicit override (e.g. rider login's short,
// login-appropriate expiry) versus each channel's own default. Pulled
// out as a pure function so "rider login actually gets a short TTL, and
// every other existing caller of createVerificationRecord is
// unaffected" is directly testable, instead of only being visible as a
// side effect of what got written to a database row.
function resolveVerificationTtlMinutes({ isEmail, ttlMinutes, emailVerifyTtlHours, verifyTtlMinutes }) {
  if (Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
    return ttlMinutes;
  }

  return isEmail ? emailVerifyTtlHours * 60 : verifyTtlMinutes;
}

// One-way hash for anything that must identify "which caller/destination"
// in a rate-limit key or an audit log without ever storing or logging
// the raw phone number/email itself. Truncated -- this only needs to be
// collision-resistant enough for rate-limiting and audit correlation,
// not cryptographically unforgeable, and a shorter value keeps log
// lines/keys readable.
function hashIdentifier(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

// The destination-dimension rate-limit key (approved requirement: both
// an IP limit and a separate per-destination limit). Normalizes exactly
// the way the login routes themselves do -- phoneLast10 for phone,
// lowercase for email (already done by server.js's cleanEmail before
// this is called) -- so the same rider retrying with differently
// formatted input still hits one limit, then hashes the result. Phone
// takes priority when both are somehow present, matching the routes'
// own phone-first branching. Never returns anything a raw phone/email
// could be recovered from.
function hashLoginDestination({ phone, email }) {
  const last10 = phoneLast10(phone);

  if (last10) {
    return hashIdentifier(`sms:${last10}`);
  }

  return hashIdentifier(`email:${email || ""}`);
}

// Decides what the logout route tells the client, given whether there
// was a signature-verified riderId to act on at all and, if so, whether
// the atomic invalidation RPC actually succeeded. Pulled out as its own
// pure function specifically so "a server-side revocation failure must
// never be reported to the client as a full, successful logout" is
// unit-testable without a live route/database -- server.js's logout
// handler always clears the local cookie itself regardless of which
// branch this returns; this function only decides the HTTP response
// describing what happened server-side.
function buildLogoutOutcome({ hadTrustedRiderId, rpcSucceeded }) {
  if (!hadTrustedRiderId || rpcSucceeded) {
    // Either there was nothing to invalidate server-side (no session,
    // or a token whose riderId couldn't be trusted), or there was and
    // the atomic RPC confirmed it -- both are a real, complete logout.
    return {
      statusCode: 200,
      body: { logged_out: true, session_fully_invalidated: true }
    };
  }

  // A trusted session existed but the atomic version-bump+audit RPC did
  // not confirm success. The local cookie is still cleared by the
  // caller, but a copied/stolen cookie may remain valid until its
  // natural expiry -- this must read as a partial, non-success outcome,
  // not "logged_out: true".
  return {
    statusCode: 502,
    body: {
      logged_out_locally: true,
      session_fully_invalidated: false,
      error:
        "You've been signed out on this device, but we couldn't confirm your session was fully revoked everywhere. If you believe your account was compromised, contact support."
    }
  };
}

// The actual decision behind requireRider (server.js's not-yet-wired-in
// rider auth middleware, PR #1 of the P0 remediation plan -- see
// docs/p0-security-remediation-plan.md), pulled out as a pure function
// for the same reason buildLogoutOutcome above is: "a revoked, logged-
// out, or nonexistent rider must never be treated as authenticated" is
// then testable with plain objects, without a live HTTP request or
// database.
//
// riderRow is whatever server.js loaded for verification.riderId (or
// null if the row no longer exists, e.g. a deleted account) -- this
// function never fetches it itself, mirroring the requireDriver split
// between IO (server.js) and decision (here). Deliberately re-fetches
// session_version from the *row*, not the token: the whole point of
// session_version is that it can move after a token was issued (logout,
// Force Logout, access-revoked deletion), so trusting the token's own
// claim here would defeat revocation entirely.
function resolveRiderAuthOutcome({ verification, riderRow, now = Date.now() }) {
  if (!verification || !verification.ok) {
    return {
      ok: false,
      statusCode: 401,
      message: "Please sign in to continue."
    };
  }

  if (!riderRow) {
    return {
      ok: false,
      statusCode: 401,
      message: "Your session is no longer valid. Please sign in again."
    };
  }

  if (riderRow.access_revoked === true || riderRow.deleted_at) {
    return {
      ok: false,
      statusCode: 403,
      message: "This account's access has been revoked."
    };
  }

  const currentVersion = Number.isInteger(riderRow.session_version) ? riderRow.session_version : 0;

  if (!isSessionVersionCurrent({ tokenVersion: verification.sessionVersion, currentVersion })) {
    return {
      ok: false,
      statusCode: 401,
      message: "Your session has been signed out. Please sign in again."
    };
  }

  return {
    ok: true,
    riderId: verification.riderId,
    shouldRenew: shouldRenewSession({ iat: verification.iat, exp: verification.exp, now })
  };
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
  buildLogoutOutcome,
  resolveRiderAuthOutcome,
  phoneLast10,
  phoneToE164US,
  selectExactlyOneActiveRider,
  resolveVerificationTtlMinutes,
  hashIdentifier,
  hashLoginDestination,
  base64UrlEncode,
  base64UrlDecode,
  timingSafeEqualString
};
