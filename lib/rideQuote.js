// Server-issued, short-lived ride quote token.
//
// hasValidTripDistance() (lib/pricing.js) only proves a request carried a
// positive miles/minutes pair -- it says nothing about whether that
// distance is real. A direct caller could submit {miles: 0.1, minutes: 1}
// for an actual 20-mile trip and the old guard would accept it, because
// both values are positive. This module closes that gap: the server
// computes the fare exactly once, at estimate time, freezes every number
// that fare depends on into a signed token, and every later step
// (payment-intent, ride request) must present that same token and use the
// numbers inside it -- never numbers resubmitted by the client.
//
// Deliberately does NOT reuse lib/riderAuth.js's token helpers, even
// though the shape is similar (HMAC + base64url, same fail-closed expiry
// boundary) -- this PR is scoped away from rider authentication on
// purpose, and a shared dependency between the two would blur that line
// for no real benefit. Dependency-free like lib/pricing.js, so it's
// requirable directly by tests.
//
// Honesty about what this token proves: QUOTE_SOURCE below is
// "browser_calculated" because the miles/minutes it freezes came from the
// rider's own browser calling Google Maps' Distance Matrix client-side
// (see ensureTripDistance() in rider-dashboard.html) -- the server itself
// never independently obtained or verified that distance against a
// routing provider. This token guarantees the frozen numbers can't be
// altered or reused after the fact; it does not guarantee the browser's
// original Distance Matrix call was honest. See
// docs/route-verification-requirement.md for the follow-up requirement
// (server-side Google Routes/Distance Matrix verification) before general
// public launch.

const crypto = require("crypto");

const RIDE_QUOTE_SUBJECT = "harvey-ride-quote";
const QUOTE_SOURCE_BROWSER_CALCULATED = "browser_calculated";

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

// Same gotcha lib/riderAuth.js's version guards against: Node's
// crypto.timingSafeEqual throws on mismatched buffer lengths instead of
// returning false, which itself leaks a length signal if callers aren't
// careful.
function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Coordinates round-trip through JSON twice (estimate response -> token;
// client resubmission -> comparison) as the same JS float in the normal
// flow, so exact equality would usually work -- but rounding to 6 decimal
// places (~0.11m) removes any risk of a serialization/formatting quirk
// producing a false mismatch, while still catching any real change in
// the submitted address.
function roundCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : null;
}

function isFiniteCoordPair(point) {
  return (
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  );
}

// Signs a quote token. Every value the eventual charge depends on --
// miles, minutes, ride_type, the two coordinate pairs, and the fully
// computed fare/fee breakdown itself -- is embedded and covered by the
// HMAC signature, so none of it can be swapped out later by a client
// resubmitting different numbers alongside a still-valid token.
//
// estimate is the exact object calculateRideEstimate() returned for this
// quote -- stored verbatim (not recomputed later) so a rider is always
// charged precisely what they were quoted, even if pricing env vars
// happen to change between the estimate and the eventual charge.
function signRideQuote({
  rideType,
  miles,
  minutes,
  pickup,
  destination,
  riderId,
  estimate,
  secret,
  ttlMinutes,
  now = Date.now()
}) {
  if (!secret) {
    throw new Error("signRideQuote requires a secret.");
  }

  if (!rideType) {
    throw new Error("signRideQuote requires rideType.");
  }

  if (!Number.isFinite(Number(miles)) || Number(miles) <= 0) {
    throw new Error("signRideQuote requires a positive miles value.");
  }

  if (!Number.isFinite(Number(minutes)) || Number(minutes) < 0) {
    throw new Error("signRideQuote requires a nonnegative minutes value.");
  }

  if (!isFiniteCoordPair(pickup) || !isFiniteCoordPair(destination)) {
    throw new Error("signRideQuote requires finite pickup and destination coordinates.");
  }

  if (!estimate || typeof estimate !== "object" || !Number.isFinite(Number(estimate.total))) {
    throw new Error("signRideQuote requires a computed estimate with a finite total.");
  }

  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error("signRideQuote requires a positive ttlMinutes.");
  }

  const payload = {
    sub: RIDE_QUOTE_SUBJECT,
    ride_type: String(rideType),
    miles: Number(miles),
    minutes: Number(minutes),
    pickup: { lat: roundCoord(pickup.lat), lng: roundCoord(pickup.lng) },
    destination: { lat: roundCoord(destination.lat), lng: roundCoord(destination.lng) },
    // null (not "") when no rider is attached yet -- a guest quote should
    // only ever match a later guest submission, never coerce into
    // matching an empty-string rider_id some other caller sent by
    // accident.
    rider_id: riderId ? String(riderId) : null,
    estimate,
    quote_source: QUOTE_SOURCE_BROWSER_CALCULATED,
    iat: now,
    exp: now + ttlMinutes * 60 * 1000
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");

  return `${encoded}.${sig}`;
}

// Verifies signature, structure, and expiry only -- exactly like
// lib/riderAuth.js's verifyRiderSession, including the same fail-closed
// expiry boundary (expired the instant now reaches exp, not only
// strictly after it). Does not check whether the payload matches a fresh
// submission -- that's quoteMatchesSubmission() below, kept separate so
// "is this token real and current" and "does it match what's being
// submitted right now" can each be tested independently.
function verifyRideQuote({ token, secret, now = Date.now() }) {
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
    payload.sub !== RIDE_QUOTE_SUBJECT ||
    !payload.ride_type ||
    !Number.isFinite(payload.miles) ||
    payload.miles <= 0 ||
    !Number.isFinite(payload.minutes) ||
    payload.minutes < 0 ||
    !isFiniteCoordPair(payload.pickup) ||
    !isFiniteCoordPair(payload.destination) ||
    !payload.estimate ||
    !Number.isFinite(Number(payload.estimate.total)) ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= payload.iat
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (now >= payload.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

// The actual anti-tampering decision: does a freshly submitted
// ride_type/pickup/destination/riderId still match what this quote was
// issued for? Pulled out as its own pure function (rather than inlined in
// server.js) so every one of these mismatch cases -- wrong rider, wrong
// service type, moved pickup, moved destination -- is directly
// unit-testable without booting Express or a database.
//
// Deliberately does NOT compare miles/minutes/fare against anything the
// client submitted: those must come exclusively from quote.estimate /
// quote.miles / quote.minutes on the caller's side, never from
// req.body, so there is nothing for a resubmitted miles/fare value to
// even be compared against -- it's simply ignored.
function quoteMatchesSubmission({ quote, rideType, pickup, destination, riderId }) {
  if (!quote) {
    return { ok: false, reason: "missing_quote" };
  }

  if (String(quote.ride_type) !== String(rideType || "")) {
    return { ok: false, reason: "ride_type_mismatch" };
  }

  if (String(quote.rider_id || "") !== String(riderId || "")) {
    return { ok: false, reason: "rider_mismatch" };
  }

  if (
    !isFiniteCoordPair(pickup) ||
    roundCoord(pickup.lat) !== quote.pickup.lat ||
    roundCoord(pickup.lng) !== quote.pickup.lng
  ) {
    return { ok: false, reason: "pickup_mismatch" };
  }

  if (
    !isFiniteCoordPair(destination) ||
    roundCoord(destination.lat) !== quote.destination.lat ||
    roundCoord(destination.lng) !== quote.destination.lng
  ) {
    return { ok: false, reason: "destination_mismatch" };
  }

  return { ok: true };
}

// The single, fully unit-testable decision both /api/rides/payment-intent
// and /api/rides/request in server.js delegate to: verify the token, then
// confirm this specific submission still matches it. Deliberately takes
// no miles/minutes/fare/fee parameters at all -- there is nothing in this
// function's signature for a resubmitted number to even flow through, so
// "the charged amount can't be changed by resubmitting different
// numbers alongside a still-valid token" is true by construction, not
// just by the caller choosing not to read req.body.miles. On success,
// the only trustworthy trip data from here on is quote.miles/
// quote.minutes/quote.estimate/quote.pickup/quote.destination --
// everything the caller submitted alongside the token has already served
// its only purpose (matching) and must not be used again.
function resolveRideQuote({ token, secret, rideType, pickup, destination, riderId, now = Date.now() }) {
  const verified = verifyRideQuote({ token, secret, now });

  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }

  const match = quoteMatchesSubmission({
    quote: verified.payload,
    rideType,
    pickup,
    destination,
    riderId
  });

  if (!match.ok) {
    return { ok: false, reason: match.reason };
  }

  return { ok: true, quote: verified.payload };
}

module.exports = {
  RIDE_QUOTE_SUBJECT,
  QUOTE_SOURCE_BROWSER_CALCULATED,
  signRideQuote,
  verifyRideQuote,
  quoteMatchesSubmission,
  resolveRideQuote,
  roundCoord
};
