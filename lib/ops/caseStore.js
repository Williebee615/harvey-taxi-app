// Case memory: structured case summaries so a rider, driver or staff
// member never has to explain an issue twice.
//
// Stored in public.agent_ops_cases (migration
// supabase/migrations/20261002000000_agent_ops_cases.sql, NOT applied by
// this PR). If the table does not exist yet, the store reports itself
// unavailable and cases are computed without being saved.
//
// What is stored: the structured summary (categories, claims, facts with
// sources, missing information, hypotheses, conflicts, plan, action queue,
// state) and the person's answers to follow-up questions, redacted. Raw
// conversation text is never stored.
//
// Access and isolation:
//   - admins see every case in full;
//   - a rider or driver sees only cases where they are the subject, in a
//     reduced view: no hypotheses, no conflicts about the other party, no
//     driver location data, no internal notes;
//   - a rider never sees a driver's cases and vice versa.
// Retention: expires_at = created + AGENT_CASE_RETENTION_DAYS (default 90,
// 7-365); purgeExpired() deletes past it. deleteForSubject() runs when an
// account is deleted.

const crypto = require("crypto");
const { redactForLog } = require("../agent/escalation");
const { STATE_LABELS } = require("./planner");
const { CATEGORY_LABELS } = require("./intake");

const TABLE = "agent_ops_cases";
const DEFAULT_RETENTION_DAYS = 90;

function retentionDays(env = process.env) {
  const n = Number(env.AGENT_CASE_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 7 && n <= 365 ? Math.round(n) : DEFAULT_RETENTION_DAYS;
}

function newCaseId() {
  return `OPS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function missingTable(error) {
  return Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || ""));
}

function redactAnswers(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (typeof v === "string") out[String(k).slice(0, 40)] = redactForLog(v, 200);
  }
  return out;
}

// The subject's own view of their case.
function subjectView(record) {
  const s = record.summary || {};
  const ownFacts = (s.findings || []).flatMap((f) =>
    (f.facts || []).filter((fact) => !/drivers|location snapshot|heartbeat/i.test(fact.source || "")).map((fact) => fact.text)
  );
  return {
    case_id: record.id,
    state: record.state,
    state_label: STATE_LABELS[record.state] || record.state,
    ride_id: record.ride_id || null,
    issues: (record.categories || []).map((c) => CATEGORY_LABELS[c] || c),
    summary: s.subject_summary || null,
    what_we_found: ownFacts.slice(0, 8),
    questions: (s.follow_ups || []).map((q) => ({ id: q.id, question: q.question, options: q.options || [] })),
    your_actions: (record.queue || []).filter((a) => a.confirm_by === record.subject_role && a.status === "awaiting_confirmation"),
    updated_at: record.updated_at
  };
}

function createCaseStore({ supabase, now = () => Date.now() }) {
  let available = null; // null = unknown until the first call

  async function guard(promise) {
    const result = await promise;
    if (missingTable(result.error)) {
      available = false;
      const err = new Error("Case memory is not installed (migration pending).");
      err.code = "CASE_MEMORY_UNAVAILABLE";
      throw err;
    }
    if (result.error) {
      const err = new Error("Case memory is temporarily unavailable.");
      err.code = "CASE_MEMORY_ERROR";
      throw err;
    }
    available = true;
    return result.data;
  }

  async function create({ subjectRole, subjectId, rideId, state, categories, summary, queue, steps, answers, createdByRole }) {
    const created = new Date(now());
    const record = {
      id: newCaseId(),
      subject_role: subjectRole,
      subject_id: String(subjectId),
      ride_id: rideId ? String(rideId) : null,
      state,
      categories,
      summary,
      queue,
      steps,
      answers: redactAnswers(answers),
      created_by_role: createdByRole,
      version: 1,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
      expires_at: new Date(created.getTime() + retentionDays() * 86400_000).toISOString()
    };
    await guard(supabase.from(TABLE).insert(record));
    return record;
  }

  async function get(id) {
    return guard(supabase.from(TABLE).select("*").eq("id", String(id)).maybeSingle());
  }

  // Optimistic concurrency: the update applies only if nobody else changed
  // the case since it was read, so two staff approving the same action
  // cannot both execute it.
  async function update(record, patch) {
    const next = { ...patch, version: (record.version || 1) + 1, updated_at: new Date(now()).toISOString() };
    if (patch.answers) next.answers = redactAnswers(patch.answers);
    const rows = await guard(
      supabase.from(TABLE).update(next).eq("id", record.id).eq("version", record.version || 1).select("*")
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      const err = new Error("This case was changed by someone else. Reload and try again.");
      err.code = "CASE_CONFLICT";
      throw err;
    }
    return row;
  }

  async function listForAdmin({ limit = 100 } = {}) {
    return guard(supabase.from(TABLE).select("*").order("updated_at", { ascending: false }).limit(limit));
  }

  async function listForSubject(role, id) {
    return guard(supabase.from(TABLE).select("*").eq("subject_role", role).eq("subject_id", String(id)).limit(20));
  }

  async function findOpenForSubjectRide(role, id, rideId) {
    const rows = await guard(
      supabase.from(TABLE).select("*").eq("subject_role", role).eq("subject_id", String(id)).eq("ride_id", String(rideId)).limit(10)
    );
    return (rows || []).find((r) => r.state !== "resolved") || null;
  }

  async function purgeExpired() {
    const cutoff = new Date(now()).toISOString();
    const rows = await guard(supabase.from(TABLE).delete().lt("expires_at", cutoff).select("id"));
    return (rows || []).length;
  }

  async function deleteForSubject(role, id) {
    const rows = await guard(supabase.from(TABLE).delete().eq("subject_role", role).eq("subject_id", String(id)).select("id"));
    return (rows || []).length;
  }

  // Access check + view selection for one record.
  function viewFor(actor, record) {
    if (!record || !actor) return null;
    if (actor.role === "admin") return record;
    if (actor.role === record.subject_role && String(actor.id) === String(record.subject_id)) return subjectView(record);
    return null;
  }

  return {
    create,
    get,
    update,
    listForAdmin,
    listForSubject,
    findOpenForSubjectRide,
    purgeExpired,
    deleteForSubject,
    viewFor,
    isAvailable: () => available
  };
}

module.exports = { TABLE, createCaseStore, subjectView, retentionDays, redactAnswers };
