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

// Signs a self-contained, stateless session token. sessionVersion is
// embedded so a later mismatch against the rider's live DB row (done by
// server.js, not here) is what actually implements logout/revocation --
// see isSessionVersionCurrent().
function signRiderSession({ riderId, sessionVersion, secret, ttlHours, now = Date.now() }) {
  if (!secret) {
    throw new Error("signRiderSession requires a secret.");
  }

  if (!riderId) {
    throw new Error("signRiderSession requires riderId.");
  }

  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error("signRiderSession requires a positive ttlHours.");
  }

  const payload = {
    sub: RIDER_SESSION_SUBJECT,
    rider_id: String(riderId),
    session_version: Number.isFinite(sessionVersion) ? sessionVersion : 0,
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

  if (
    !payload ||
    payload.sub !== RIDER_SESSION_SUBJECT ||
    !payload.rider_id ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (now > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    riderId: payload.rider_id,
    sessionVersion: Number(payload.session_version) || 0,
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
// schedule. Only meaningful for a token that's still valid -- an
// already-expired session isn't a renewal question, it's a
// sign-in-again question, so this returns false rather than throwing.
function shouldRenewSession({ iat, exp, now = Date.now() }) {
  if (typeof iat !== "number" || typeof exp !== "number") {
    return false;
  }

  if (now > exp) {
    return false;
  }

  const ttl = exp - iat;
  const elapsed = now - iat;

  return elapsed >= ttl / 2;
}

module.exports = {
  RIDER_SESSION_SUBJECT,
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  shouldRenewSession,
  base64UrlEncode,
  base64UrlDecode,
  timingSafeEqualString
};
