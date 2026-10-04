// Harvey Taxi AI Agent Manager -- accountability records.
//
// Uses the existing public.audit_logs table (actor_type, actor_id, action,
// entity_type, entity_id, metadata jsonb) so the feature needs no schema
// change. Every agent row has an action starting "agent." and a metadata
// `record_type` that keeps recommendations, shadow ("would have") results
// and executed actions clearly apart.
//
// Sensitive-data rule: raw user messages, phone numbers, emails, exact
// coordinates and payment details are never written. Only a short
// redacted excerpt is stored, and only on a human-review case, where a
// staff member needs context to act.

const crypto = require("crypto");
const { redactForLog } = require("./escalation");

const AGENT_ACTIONS = Object.freeze({
  DECISION: "agent.decision",
  RECOMMENDATION: "agent.recommendation",
  SHADOW: "agent.shadow_decision",
  EXECUTED: "agent.action_executed",
  CASE_OPENED: "agent.case_opened",
  CASE_RESOLVED: "agent.case_resolved",
  OVERRIDE: "agent.override",
  FLAG_CHANGED: "agent.flag_changed",
  RULES_CHANGED: "agent.rules_changed",
  USAGE_LIMITED: "agent.usage_limited",
  // Support handoff: whether the email copy to support went out.
  HANDOFF_EMAIL: "agent.handoff_email"
});

const RECORD_TYPES = Object.freeze({
  RECOMMENDATION: "recommendation",
  SHADOW: "shadow_only_not_executed",
  EXECUTED: "executed_action",
  ANSWER: "assistance_answer",
  CASE: "human_review_case",
  ADMIN: "admin_change"
});

function newCaseId() {
  return `CASE-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function cleanToolCalls(toolCalls) {
  return (toolCalls || []).slice(0, 20).map((t) => ({
    tool: String(t.tool || "").slice(0, 60),
    ok: Boolean(t.ok),
    rows: Number.isFinite(t.rows) ? t.rows : 0,
    ms: Number.isFinite(t.ms) ? t.ms : null
  }));
}

function assistDecisionEntry({ role, actorId, result, mode, message = "", appTarget = null, model = null }) {
  const d = result.decision || {};
  const gap = result.knowledge_gap === true;
  return {
    actor_type: role === "driver" ? "driver" : "rider",
    actor_id: actorId || null,
    action: AGENT_ACTIONS.DECISION,
    entity_type: "agent_conversation",
    entity_id: null,
    metadata: {
      record_type: RECORD_TYPES.ANSWER,
      mode,
      intent: result.intent,
      policy: d.policy || null,
      tool_calls: cleanToolCalls(d.tool_calls),
      outcome: d.outcome || null,
      executed: false,
      proposed_actions: (result.actions || []).map((a) => a.type),
      answer_source: result.source,
      model_rejected_reason: d.model_rejected_reason || null,
      escalation: result.escalation ? result.escalation.category : null,
      authenticated: Boolean(actorId),
      app_target: appTarget,
      // Model turn (Claude Haiku): tokens, cost and, when the rules
      // answered instead, why. Null when the model wasn't tried.
      model: model
        ? {
            used: Boolean(model.used),
            model: model.model || null,
            calls: Number(model.calls) || 0,
            input_tokens: Number(model.input_tokens) || 0,
            output_tokens: Number(model.output_tokens) || 0,
            cache_read_input_tokens: Number(model.cache_read_input_tokens) || 0,
            cache_creation_input_tokens: Number(model.cache_creation_input_tokens) || 0,
            cost_usd: Number(model.cost_usd) || 0,
            // Calls whose outcome was unknown (timeout, dropped connection,
            // server error); each is charged at its worst case.
            uncertain_calls: Number(model.uncertain_calls) || 0,
            fallback_reason: model.fallback_reason || null,
            // Already sanitized by claudeClient.providerErrorOf.
            provider_error: model.provider_error
              ? {
                  status: model.provider_error.status ?? null,
                  type: model.provider_error.type ?? null,
                  message: model.provider_error.message ? String(model.provider_error.message).slice(0, 240) : null,
                  request_id: model.provider_error.request_id ?? null
                }
              : null
          }
        : null,
      knowledge_sources: Array.isArray(d.knowledge_sources) ? d.knowledge_sources.slice(0, 3) : [],
      knowledge_gap: gap,
      // A question approved knowledge couldn't answer is a to-do for
      // staff (add an approved answer), so a short redacted excerpt is
      // kept for those only, like a human-review case.
      question_excerpt: gap ? redactForLog(message) : null
    }
  };
}

function caseOpenedEntry({ caseId, role, actorId, escalation, message, source }) {
  return {
    actor_type: "agent",
    actor_id: "agent-manager",
    action: AGENT_ACTIONS.CASE_OPENED,
    entity_type: "agent_case",
    entity_id: caseId,
    metadata: {
      record_type: RECORD_TYPES.CASE,
      category: escalation.category,
      severity: escalation.severity,
      reporter_role: role,
      reporter_id: actorId || null,
      source: source || "assist",
      excerpt: redactForLog(message, 160),
      executed: false
    }
  };
}

function caseResolvedEntry({ caseId, admin, resolution, note }) {
  return {
    actor_type: "admin",
    actor_id: admin && admin.email ? admin.email : "admin",
    action: AGENT_ACTIONS.CASE_RESOLVED,
    entity_type: "agent_case",
    entity_id: caseId,
    metadata: {
      record_type: RECORD_TYPES.ADMIN,
      resolution,
      note: redactForLog(note || "", 300),
      human_override: true
    }
  };
}

// rows: audit_logs rows with action agent.case_opened / agent.case_resolved
function summarizeCases(rows) {
  const resolved = new Map();
  const emails = new Map();
  for (const row of rows || []) {
    if (row.action === AGENT_ACTIONS.CASE_RESOLVED) resolved.set(row.entity_id, row);
    if (row.action === AGENT_ACTIONS.HANDOFF_EMAIL) emails.set(row.entity_id, (row.metadata || {}).status || null);
  }
  const cases = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (row.action !== AGENT_ACTIONS.CASE_OPENED) continue;
    // Two instances can race to open the same deterministic case id; show it once.
    if (seen.has(row.entity_id)) continue;
    seen.add(row.entity_id);
    const done = resolved.get(row.entity_id);
    const m = row.metadata || {};
    cases.push({
      case_id: row.entity_id,
      category: m.category || null,
      severity: m.severity || null,
      reporter_role: m.reporter_role || null,
      reporter_id: m.reporter_id || null,
      ride_id: m.ride_id || null,
      excerpt: m.excerpt || "",
      // Support handoff: the full summary the user approved.
      summary: m.summary || null,
      source: m.source || null,
      app_target: m.app_target || null,
      // Support handoff: case saved (this row) vs. email copy
      // ("accepted" by the email service, "not_configured", "failed").
      email_status: m.source === "handoff" ? emails.get(row.entity_id) || "unknown" : null,
      opened_at: row.created_at || null,
      status: done ? "resolved" : "open",
      resolution: done ? (done.metadata || {}).resolution || null : null,
      resolved_by: done ? done.actor_id : null,
      resolved_at: done ? done.created_at : null
    });
  }
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return cases.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const s = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    if (s) return s;
    return String(b.opened_at || "").localeCompare(String(a.opened_at || ""));
  });
}

module.exports = {
  AGENT_ACTIONS,
  RECORD_TYPES,
  newCaseId,
  cleanToolCalls,
  assistDecisionEntry,
  caseOpenedEntry,
  caseResolvedEntry,
  summarizeCases
};
