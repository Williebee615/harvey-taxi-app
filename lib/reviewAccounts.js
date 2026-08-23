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
// Generic, identical PUBLIC failure (same statusCode/message) for "no
// such row" / "not a review account" / "revoked" / "wrong password" --
// a reviewer mistyping their password must never learn which part was
// wrong, same no-enumeration principle as the real rider/driver login
// routes. The internal `reason` code is for audit logging only (see
// server.js's review-login routes) -- it is never sent to the client,
// and is deliberately coarse-grained (e.g. "account_not_found" covers
// missing/non-review/revoked alike) for the same no-enumeration reason.
//
// flagQuerySucceeded distinguishes "the flag was read and is off"
// (reason: flag_disabled) from "the flag couldn't be read at all"
// (reason: flag_query_failed, e.g. wrong Supabase project/credentials,
// a genuine infrastructure fault) -- both still return the identical
// generic 503 to the caller; only the audited reason differs, so a
// production diagnostic hotfix can tell these apart without changing
// any client-visible behavior. Defaults to true so every existing
// caller that hasn't been updated to pass it keeps working unchanged.
function resolveReviewLoginOutcome({ row, password, reviewLoginEnabled, flagQuerySucceeded = true }) {
  if (!flagQuerySucceeded) {
    return {
      ok: false,
      statusCode: 503,
      message: "Google Play review sign-in is temporarily disabled.",
      reason: "flag_query_failed"
    };
  }

  if (!reviewLoginEnabled) {
    return {
      ok: false,
      statusCode: 503,
      message: "Google Play review sign-in is temporarily disabled.",
      reason: "flag_disabled"
    };
  }

  if (!row || !isReviewAccountRow(row) || row.access_revoked === true || row.deleted_at) {
    return { ok: false, statusCode: 401, message: "Invalid credentials.", reason: "account_not_found" };
  }

  if (!verifyReviewPassword({ password, salt: row.review_password_salt, hash: row.review_password_hash })) {
    return { ok: false, statusCode: 401, message: "Invalid credentials.", reason: "invalid_credentials" };
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

// The single decision behind resolveAuthenticatedReviewRider()
// (server.js): whether an already-verified rider session actually
// belongs to a review account and may currently use it. Approved
// correction: simulated payment, review-ride creation, and review
// dispatch must never activate just because a client supplies or
// guesses the review rider's id -- they may only activate for a
// request carrying a real, currently-valid session for that exact
// account. `riderAuthOk` is resolveRiderAuthOutcome(...).ok (the same
// signature/expiry/revocation/session-version check requireRider
// itself applies -- this function never re-implements or weakens
// that), and `row` is the freshly loaded database row for the
// session's own riderId, never anything client-supplied. A valid
// session for an ordinary (non-review) rider correctly returns false
// here -- this only ever grants reviewer behavior, never denies
// ordinary rider behavior.
function isValidatedReviewerSession({ riderAuthOk, row, reviewLoginEnabled }) {
  if (!riderAuthOk || !isReviewAccountRow(row)) {
    return false;
  }

  return resolveReviewSessionOutcome({ row, reviewLoginEnabled }).ok;
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

// Diagnostic hotfix (production incident: review_account_login_enabled
// read back as off in Render immediately after being confirmed true in
// Supabase -- root cause suspected to be a mismatched Supabase
// project/credentials on the live service, not application caching;
// getSystemFlag() itself performs no caching, per its own code). This
// is the pure decision behind server.js's getSystemFlagWithDiagnostics()
// wrapper: given the raw {error, data} a Supabase query returned, and
// the fallback the caller would use, compute exactly what's safe to log
// and exactly what value getSystemFlag() itself would have returned --
// so the two can never drift apart. Takes only a Postgres/PostgREST
// error object (code/message -- never a full response, header, or key)
// and the flag row's own public data, so there is no secret this
// function could ever be handed to leak in the first place.
function resolveSystemFlagDiagnostics({ error, data, fallback }) {
  if (error) {
    return {
      querySucceeded: false,
      rowFound: false,
      value: fallback,
      errorCode: error.code || null,
      errorMessage: error.message || null
    };
  }

  return {
    querySucceeded: true,
    rowFound: Boolean(data),
    value: data?.value ?? fallback,
    errorCode: null,
    errorMessage: null
  };
}

// Extracts only the Supabase project reference (the subdomain segment)
// from a full SUPABASE_URL, e.g. "https://orgahzncmzptljapqffj.supabase.co"
// -> "orgahzncmzptljapqffj". Returns null for anything that doesn't
// match rather than falling back to any substring of the input, so a
// malformed or unexpected URL shape can never cause more of it to leak
// into a log line than intended. Never returns the scheme, path, query
// string, or any credential -- there is no credential in a
// SUPABASE_URL to begin with, but this is deliberately narrow anyway.
function extractSupabaseProjectRef(url) {
  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.[a-z]+/i.exec(String(url || ""));
  return match ? match[1] : null;
}

// The exact, sanitized shape server.js logs on every
// getSystemFlagWithDiagnostics("review_account_login_enabled") call --
// pulled out as its own pure function so the allow-list of fields is
// enforced and tested here, once, rather than trusted to a console.log
// call site to remember. Every field is either non-sensitive by
// construction (a flag name, two booleans, a normalized true/false, a
// Postgres error code/message with no user input to reflect back, and
// a project ref -- never a full URL) or explicitly omitted -- there is
// no code path here that could include SUPABASE_SERVICE_ROLE_KEY, an
// Authorization header, a cookie, or a reviewer email/password, because
// none of those are ever passed into this function at all.
function buildFlagDiagnosticLogEvent({ flagKey, diagnostics, supabaseProjectRef }) {
  return {
    event: "system_flag_diagnostic",
    flag: flagKey,
    supabase_project_ref: supabaseProjectRef,
    query_succeeded: diagnostics.querySucceeded,
    row_found: diagnostics.rowFound,
    normalized_value: diagnostics.value === "true",
    error_code: diagnostics.errorCode,
    error_message: diagnostics.errorMessage
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
  isValidatedReviewerSession,
  planReviewAwareDispatch,
  buildSimulatedPaymentIntentResponse,
  resolveSystemFlagDiagnostics,
  extractSupabaseProjectRef,
  buildFlagDiagnosticLogEvent
};
