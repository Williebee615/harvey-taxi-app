// Audit-log IP retention (docs/data-retention-policy.md §2, §4): clear the
// IP address and user agent on audit rows older than 90 days. The rows are
// kept; only those two fields are cleared. Owner decision 2026-10-22:
// built switched off. Pure rules here; server.js does the reads and writes.

const RETENTION_FLAG = "audit_ip_retention_enabled";
// A legal hold, dispute, claim or regulator request pauses every run
// (policy §1). Staff set this flag to "true"; nothing clears it automatically.
const LEGAL_HOLD_FLAG = "retention_legal_hold";
const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;
// At most this many batches a run, so one run can't hold the table long.
const MAX_BATCHES = 20;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function cutoffIso(nowMs = Date.now(), days = RETENTION_DAYS) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

// Whether a run may write. Returns { ok } or { ok: false, reason }.
function runGate({ enabled, legalHold }) {
  if (legalHold === "true") return { ok: false, reason: "legal_hold" };
  if (enabled !== "true") return { ok: false, reason: "switched_off" };
  return { ok: true };
}

// The audit record of a run: counts only, never the cleared values.
function runRecord({ cleared, cutoff, mode, trigger }) {
  return {
    actor_type: "system",
    actor_id: "retention",
    action: "retention_audit_ip_cleared",
    entity_type: "audit_logs",
    metadata: { cleared, cutoff, retention_days: RETENTION_DAYS, mode, trigger }
  };
}

module.exports = {
  RETENTION_FLAG,
  LEGAL_HOLD_FLAG,
  RETENTION_DAYS,
  BATCH_SIZE,
  MAX_BATCHES,
  SWEEP_INTERVAL_MS,
  cutoffIso,
  runGate,
  runRecord
};
