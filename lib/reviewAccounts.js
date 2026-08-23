// Pure decision logic for the two dedicated Google Play reviewer
// accounts (one rider, one driver). server.js owns the actual Supabase
// reads/writes, Stripe skip, and Twilio/SendGrid suppression; this
// module decides what "a review account may do right now" means, so
// those rules are unit-testable without a live database, request, or
// third-party client -- same split as lib/riderAuth.js/driverCompliance.js.
//
// The rule this module exists to enforce (approved requirement,
// non-negotiable): review-account status, and every consequence of it
// (simulated payment, direct-to-review-driver dispatch, suppressed
// messaging), is resolved ONLY from a freshly loaded database row's
// is_review_account column. Nothing here ever accepts a client-supplied
// boolean/role/mode for this decision -- every function below takes the
// already-loaded row (or nothing at all) and never a request body/query
// value that could claim to *be* a review account.

const crypto = require("crypto");

const SCRYPT_KEY_LENGTH = 64;

// Node's crypto.timingSafeEqual throws on mismatched buffer lengths
// instead of returning false -- normalize that away, same gotcha
// lib/riderAuth.js's timingSafeEqualString already avoids.
function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "hex");
  const bufB = Buffer.from(String(b ?? ""), "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Generates a fresh random-salt scrypt hash for one reviewer
// credential. Never used for ordinary rider/driver passwords -- those
// don't exist in this app (OTP-only) -- this exists solely so the two
// review-account passwords can be stored as a salted hash instead of
// plaintext, per the approved requirement that no plaintext credential
// is ever committed anywhere. The caller (an offline admin script, not
// a route -- see the deployment runbook) prints the plaintext password
// once for secure handoff and stores only what this returns.
function hashReviewPassword(password, { salt = crypto.randomBytes(16).toString("hex") } = {}) {
  if (!password || typeof password !== "string" || password.length < 12) {
    throw new Error("hashReviewPassword requires a password of at least 12 characters.");
  }

  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");

  return { salt, hash };
}

// Verifies a submitted password against a stored salt+hash pair. Missing
// salt/hash (an ordinary rider/driver row, or a review row that hasn't
// been seeded yet) always fails closed rather than throwing -- a login
// route calling this should never crash on a row that simply isn't a
// configured review account.
function verifyReviewPassword({ password, salt, hash }) {
  if (!password || !salt || !hash) {
    return false;
  }

  let candidate;

  try {
    candidate = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  } catch {
    return false;
  }

  return timingSafeEqualHex(candidate, hash);
}

// The single source of truth for "is this row a review account" --
// deliberately trivial so every call site uses the exact same
// boolean-coercion rule instead of five slightly different `=== true`
// checks drifting apart over time. Always takes a DB row, never a
// client-supplied value.
function isReviewAccountRow(row) {
  return Boolean(row?.is_review_account);
}

// The login decision for both POST /api/review/rider/login and
// POST /api/review/driver/login. `row` is whatever server.js already
// loaded by email (already-scoped to is_review_account = true in the
// query, per server.js) -- this function still re-checks
// isReviewAccountRow itself rather than trusting the caller's query
// filter, so a future call site that forgets that filter fails closed
// here instead of silently trusting an ordinary rider/driver row.
// Generic, identical failure for "no such row" / "not a review
// account" / "revoked" / "wrong password" -- a reviewer mistyping their
// password must never learn which part was wrong, same
// no-enumeration principle as the real rider/driver login routes.
function resolveReviewLoginOutcome({ row, password, reviewLoginEnabled }) {
  if (!reviewLoginEnabled) {
    return {
      ok: false,
      statusCode: 503,
      message: "Google Play review sign-in is temporarily disabled."
    };
  }

  if (
    !row ||
    !isReviewAccountRow(row) ||
    row.access_revoked === true ||
    row.deleted_at ||
    !verifyReviewPassword({ password, salt: row.review_password_salt, hash: row.review_password_hash })
  ) {
    return { ok: false, statusCode: 401, message: "Invalid credentials." };
  }

  return { ok: true, id: row.id };
}

// The re-check requireRider/requireDriver run on every authenticated
// request, not just at login -- this is what makes disabling
// review_account_login_enabled reject an already-issued reviewer
// session immediately, without needing a separate session-revocation
// list. An ordinary (non-review) row always passes through unaffected
// regardless of the flag's value -- this function only ever removes
// access from review accounts, never from anyone else.
function resolveReviewSessionOutcome({ row, reviewLoginEnabled }) {
  if (isReviewAccountRow(row) && !reviewLoginEnabled) {
    return {
      ok: false,
      statusCode: 403,
      message: "Google Play review access is currently disabled."
    };
  }

  return { ok: true };
}

// Dispatch isolation (approved requirement: two-way). A review rider's
// ride may reach only the one paired review driver, and a review driver
// must never appear as a candidate for a real rider's ride. server.js
// loads the (at most one) review driver row once and passes its id/
// online state in here; this function decides which of the two
// dispatch shapes applies, without itself touching Supabase or
// findAvailableDrivers -- server.js still owns the actual query, this
// only decides how to call it.
function planReviewAwareDispatch({ isReviewRide, reviewDriverId, reviewDriverOnline }) {
  if (isReviewRide) {
    return {
      bypassNormalMatching: true,
      candidateDriverIds: reviewDriverId && reviewDriverOnline ? [reviewDriverId] : []
    };
  }

  return {
    bypassNormalMatching: false,
    extraExcludeDriverIds: reviewDriverId ? [reviewDriverId] : []
  };
}

// Option A (approved requirement): a review rider's ride never touches
// live Stripe. server.js checks isReviewAccountRow(rider) and, if true,
// calls this instead of stripe.paymentIntents.create() -- id is
// injected (server.js passes a real makeId()-style value) so this stays
// a pure function with no random/global-clock dependency of its own.
// Deliberately mirrors the real endpoint's response shape
// (payment_intent_id/client_secret/estimate) so the reviewer-facing
// client code path is identical either way, plus two additive fields
// the UI uses to render the "Simulated payment" banner.
const SIMULATED_PAYMENT_LABEL = "Simulated payment — Google Play review mode";

function buildSimulatedPaymentIntentResponse({ id, estimate }) {
  return {
    payment_intent_id: `review_sim_${id}`,
    client_secret: `review_sim_${id}_secret`,
    estimate,
    simulated: true,
    simulated_label: SIMULATED_PAYMENT_LABEL
  };
}

module.exports = {
  SCRYPT_KEY_LENGTH,
  SIMULATED_PAYMENT_LABEL,
  hashReviewPassword,
  verifyReviewPassword,
  isReviewAccountRow,
  resolveReviewLoginOutcome,
  resolveReviewSessionOutcome,
  planReviewAwareDispatch,
  buildSimulatedPaymentIntentResponse
};
