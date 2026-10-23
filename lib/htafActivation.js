// HTAF ride transfer activation gate (#135, #137). (The AI triage gate, #136, was removed 2026-10-14.)
//
// Turning it on takes more than its feature flag: the approval
// record that authorizes it must be present in the environment too. The
// flag alone is ignored -- the action stays off, and the missing items
// are reported -- so an operator can't enable a transfer of applicant
// data to a transportation provider without
// recording who approved it, when, and under which agreement/review.
//
// Approval values are references (document IDs, minute numbers, names,
// dates), not secrets; they are safe to log and are attached to every
// audit row the action writes. See docs/htaf-activation-checklist.md.
//
// Pure: takes an env-like object, no I/O.

const RIDE_CREATION_APPROVALS = Object.freeze([
  // Executed HTAF-transportation provider services and data-processing
  // agreement covering the 12 points in #137.
  "HTAF_PROVIDER_AGREEMENT_REF",
  // Conflict-of-interest / board approval of that agreement (#135).
  "HTAF_CONFLICT_REVIEW_REF",
  "HTAF_RIDE_TRANSFER_APPROVED_BY",
  "HTAF_RIDE_TRANSFER_APPROVED_AT"
]);


const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function flagOn(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function text(value) {
  return String(value ?? "").trim();
}

// An approval date must be a real calendar date that is not in the future.
function validApprovalDate(value, now) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return false;
  const time = Date.parse(raw);
  return Number.isFinite(time) && time <= now;
}

function evaluate(env, flagName, approvalNames, now, extraRequirement) {
  const requested = flagOn(env[flagName]);
  const approvals = {};
  const missing = [];

  for (const name of approvalNames) {
    const value = text(env[name]);
    const ok = name.endsWith("_APPROVED_AT") ? validApprovalDate(value, now) : value.length > 0;
    if (ok) approvals[name] = value;
    else missing.push(name);
  }

  if (!requested) {
    return { enabled: false, requested: false, reason: `${flagName} is off`, missing, approvals };
  }
  if (missing.length) {
    return {
      enabled: false,
      requested: true,
      reason: `approval record incomplete: ${missing.join(", ")}`,
      missing,
      approvals
    };
  }
  if (extraRequirement && !extraRequirement.met) {
    return { enabled: false, requested: true, reason: extraRequirement.reason, missing, approvals };
  }
  return { enabled: true, requested: true, reason: "enabled with a complete approval record", missing, approvals };
}

// The external AI triage gate (HTAF_AI_TRIAGE_ENABLED) was removed with the
// route it guarded (2026-10-14); setting that variable now has no effect.
function resolveHtafActivation(env = {}, { now = Date.now() } = {}) {
  return {
    rideCreation: evaluate(env, "HTAF_RIDE_CREATION_ENABLED", RIDE_CREATION_APPROVALS, now)
  };
}

// HTAF ride assistance switches (docs/htaf-ride-funding-design.md §8;
// owner decision 2026-10-23: build the switches only, all off). Both need
// their flag AND a complete approval record, like ride creation above.
// No ride-assistance feature exists yet, so even a complete record leaves
// both off: FUNDING_FEATURE_BUILT changes only in the PR that builds it,
// after counsel and the HTAF board answer brief §F. Invoicing also needs
// funding on, and never charges or sends anything by itself.
const FUNDING_APPROVALS = Object.freeze([
  "HTAF_PROVIDER_AGREEMENT_REF",
  "HTAF_CONFLICT_REVIEW_REF",
  "HTAF_RATE_CARD_APPROVAL_REF",
  "HTAF_FUNDING_APPROVED_BY",
  "HTAF_FUNDING_APPROVED_AT"
]);

const FUNDING_FEATURE_BUILT = false;
const NOT_BUILT = "no HTAF ride assistance feature is built yet (design only)";

function resolveHtafFunding(env = {}, { now = Date.now(), featureBuilt = FUNDING_FEATURE_BUILT } = {}) {
  const funding = evaluate(env, "HTAF_FUNDING_ENABLED", FUNDING_APPROVALS, now, {
    met: featureBuilt,
    reason: NOT_BUILT
  });
  const invoicing = evaluate(env, "HTAF_INVOICING_ENABLED", FUNDING_APPROVALS, now, {
    met: funding.enabled,
    reason: featureBuilt ? "HTAF ride assistance (HTAF_FUNDING_ENABLED) is not on" : NOT_BUILT
  });
  return { funding, invoicing: { ...invoicing, chargesHtaf: false } };
}

module.exports = {
  FUNDING_APPROVALS,
  RIDE_CREATION_APPROVALS,
  resolveHtafActivation,
  resolveHtafFunding
};
