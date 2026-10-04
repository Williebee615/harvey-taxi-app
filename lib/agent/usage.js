// Harvey Assistant usage accounting and limits (docs/ai-usage.md).
//
// Unit: one assistant REQUEST (a question sent to /api/agent/*/assist).
// Phase 1 calls no AI model, so there are no model tokens to count; the
// meter never labels requests as tokens. If a model is added later, the
// provider's reported token counts are recorded alongside, per request.
//
// Counting is in server memory, per UTC day: zero database reads or
// writes per request (the existing per-request audit row is the durable
// record the admin dashboard summarizes). Trade-off: counts restart when
// the server restarts and are per server instance, so a limit can allow
// slightly more than configured after a restart. That is acceptable for
// abuse and spending control on a single Render instance; a durable
// counter would add a database write per request.

const crypto = require("crypto");

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Who a request is counted against. Signed-in riders and drivers by
// account; anyone else by a salted hash of their IP address (the address
// itself is never kept).
function usageKey({ role, actorId, ip, salt = "" }) {
  if (actorId) return `${role === "driver" ? "driver" : "rider"}:${actorId}`;
  const hash = crypto.createHash("sha256").update(`${salt}|${ip || "unknown"}`).digest("hex").slice(0, 16);
  return `visitor:${hash}`;
}

// Which of Harvey's apps a request came from, for reporting only (never
// for permissions: role and account come from the verified session).
// - Rider iOS / Android apps: the WebView shell (mobile/) adds
//   "HarveyTaxiRider/<version> (ios|android)" to its user agent.
// - Driver iOS / Android apps: send client "driver_app" and their platform.
// Self-reported by the client, so a label, not proof.
const APP_TARGETS = Object.freeze(["rider_ios_app", "rider_android_app", "rider_web", "driver_ios_app", "driver_android_app", "driver_web"]);
const RIDER_APP_UA = /\bHarveyTaxiRider\/[\w.-]{1,20} \((ios|android)\)/;

function appTarget({ role, client, platform, userAgent }) {
  if (role === "driver") {
    if (client === "driver_app" && (platform === "ios" || platform === "android")) return `driver_${platform}_app`;
    return "driver_web";
  }
  const m = RIDER_APP_UA.exec(String(userAgent || ""));
  return m ? `rider_${m[1]}_app` : "rider_web";
}

const emptyTargets = () => Object.fromEntries(APP_TARGETS.map((t) => [t, 0]));

function createUsageMeter({ now = () => Date.now() } = {}) {
  let day = utcDay(now());
  let perKey = new Map();
  let total = 0;
  let blocked = 0;
  let blockedKeys = new Set();
  const byRole = { rider: 0, driver: 0, visitor: 0 };
  let byTarget = emptyTargets();

  function roll() {
    const today = utcDay(now());
    if (today === day) return;
    day = today;
    perKey = new Map();
    total = 0;
    blocked = 0;
    blockedKeys = new Set();
    byRole.rider = 0;
    byRole.driver = 0;
    byRole.visitor = 0;
    byTarget = emptyTargets();
  }

  // limits: { per_account, visitor, global } requests per UTC day.
  // Returns { allowed, reason, first_block_today }.
  function check(key, limits) {
    roll();
    const used = perKey.get(key) || 0;
    const kind = key.split(":")[0];
    const own = kind === "visitor" ? limits.visitor : limits.per_account;
    let reason = null;
    if (total >= limits.global) reason = "global_daily_limit";
    else if (used >= own) reason = kind === "visitor" ? "visitor_daily_limit" : "account_daily_limit";
    if (!reason) return { allowed: true, reason: null, first_block_today: false };
    blocked += 1;
    const first = !blockedKeys.has(key);
    blockedKeys.add(key);
    return { allowed: false, reason, first_block_today: first };
  }

  function record(key, target) {
    roll();
    if (target && byTarget[target] !== undefined) byTarget[target] += 1;
    perKey.set(key, (perKey.get(key) || 0) + 1);
    total += 1;
    const kind = key.split(":")[0];
    if (byRole[kind] !== undefined) byRole[kind] += 1;
  }

  // For the admin dashboard. Account ids are shown; visitor keys are
  // already hashes.
  function snapshot({ top = 10 } = {}) {
    roll();
    const busiest = [...perKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([key, requests]) => ({ key, requests }));
    return {
      day,
      requests_today: total,
      by_role: { ...byRole },
      by_target: { ...byTarget },
      blocked_today: blocked,
      blocked_accounts_today: blockedKeys.size,
      busiest
    };
  }

  return { check, record, snapshot };
}

// Summarizes the durable record (audit_logs rows with action
// "agent.decision" or "agent.usage_limited") for the admin dashboard.
// rows: [{ created_at, action, actor_type, actor_id, metadata }].
function summarizeUsage(rows, { days = 7, now = Date.now() } = {}) {
  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) dayList.push(utcDay(now - i * 24 * 60 * 60 * 1000));
  const perDay = new Map(
    dayList.map((d) => [d, { day: d, requests: 0, rider: 0, driver: 0, signed_in: 0, answered_from_knowledge: 0, knowledge_gaps: 0, escalations: 0, limited_accounts: 0, by_target: emptyTargets() }])
  );
  const outcomes = {};
  const intents = {};
  const answerSources = {};
  const recentGaps = [];
  const accounts = new Set();
  let modelCalls = 0;
  const modelTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let modelCost = 0;
  let modelTurns = 0;
  const modelFallbacks = {};
  for (const row of rows || []) {
    const d = perDay.get(String(row.created_at || "").slice(0, 10));
    if (!d) continue;
    const m = row.metadata || {};
    if (row.action === "agent.usage_limited") {
      d.limited_accounts += 1;
      continue;
    }
    if (row.action !== "agent.decision") continue;
    d.requests += 1;
    if (row.actor_type === "driver") d.driver += 1;
    else d.rider += 1;
    if (m.app_target && d.by_target[m.app_target] !== undefined) d.by_target[m.app_target] += 1;
    if (m.authenticated) {
      d.signed_in += 1;
      if (row.actor_id) accounts.add(`${row.actor_type}:${row.actor_id}`);
    }
    if (m.outcome === "answered_from_knowledge") d.answered_from_knowledge += 1;
    if (m.knowledge_gap) {
      d.knowledge_gaps += 1;
      if (m.question_excerpt) recentGaps.push({ at: row.created_at, role: row.actor_type, question: m.question_excerpt });
    }
    if (m.escalation) d.escalations += 1;
    if (m.answer_source === "model") modelCalls += 1;
    if (m.model) {
      modelTurns += 1;
      modelTokens.input += Number(m.model.input_tokens) || 0;
      modelTokens.output += Number(m.model.output_tokens) || 0;
      modelTokens.cache_read += Number(m.model.cache_read_input_tokens) || 0;
      modelTokens.cache_write += Number(m.model.cache_creation_input_tokens) || 0;
      modelCost += Number(m.model.cost_usd) || 0;
      if (m.model.fallback_reason) modelFallbacks[m.model.fallback_reason] = (modelFallbacks[m.model.fallback_reason] || 0) + 1;
    }
    outcomes[m.outcome || "unknown"] = (outcomes[m.outcome || "unknown"] || 0) + 1;
    intents[m.intent || "unknown"] = (intents[m.intent || "unknown"] || 0) + 1;
    answerSources[m.answer_source || "unknown"] = (answerSources[m.answer_source || "unknown"] || 0) + 1;
  }
  const daily = dayList.map((d) => perDay.get(d));
  return {
    unit: "assistant_requests",
    days,
    totals: {
      requests: daily.reduce((n, d) => n + d.requests, 0),
      signed_in_accounts: accounts.size,
      knowledge_gaps: daily.reduce((n, d) => n + d.knowledge_gaps, 0),
      escalations: daily.reduce((n, d) => n + d.escalations, 0),
      by_target: daily.reduce((acc, d) => {
        for (const t of APP_TARGETS) acc[t] += d.by_target[t];
        return acc;
      }, emptyTargets()),
      // Requests answered by the model (others fell back to the rules).
      model_calls: modelCalls,
      // Requests where the model was tried (answered or fell back).
      model_turns: modelTurns,
      // Provider-reported tokens and Harvey-computed cost; null until the
      // model has been used at all.
      model_tokens: modelTurns ? modelTokens : null,
      model_cost_usd: Math.round(modelCost * 1e6) / 1e6,
      model_fallbacks: modelFallbacks
    },
    daily,
    outcomes,
    intents,
    answer_sources: answerSources,
    recent_gaps: recentGaps.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25)
  };
}

module.exports = { APP_TARGETS, appTarget, utcDay, usageKey, createUsageMeter, summarizeUsage };
