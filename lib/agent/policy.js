// Harvey Taxi AI Agent Manager -- operating mode, feature flags and the
// admin-configurable rules. Pure functions only: server.js reads the
// system_flags rows and passes them in, so the decisions about "what is the
// agent allowed to do right now" are unit-tested without a database.
//
// Safety posture (approved scope for the initial implementation):
//   - every flag defaults OFF; a missing row or a failed read means OFF.
//   - the kill switch wins over every other flag.
//   - "automation" is only effective when shadow mode is NOT also on, the
//     master assist/automation flags are both on, the specific action flag
//     is on, and the kill switch is off. Nothing in this PR turns it on.

const AGENT_FLAG_KEYS = Object.freeze({
  ASSIST: "agent_assist_enabled",
  SHADOW: "agent_shadow_mode_enabled",
  AUTOMATION: "agent_automation_enabled",
  AUTO_REDISPATCH: "agent_auto_redispatch_enabled",
  KILL_SWITCH: "agent_kill_switch",
  RULES: "agent_rules"
});

const { SPECIALIST_FLAG_KEYS } = require("./specialists");

const BOOLEAN_FLAG_KEYS = Object.freeze([
  AGENT_FLAG_KEYS.ASSIST,
  AGENT_FLAG_KEYS.SHADOW,
  AGENT_FLAG_KEYS.AUTOMATION,
  AGENT_FLAG_KEYS.AUTO_REDISPATCH,
  AGENT_FLAG_KEYS.KILL_SWITCH,
  // Specialist agents (lib/agent/specialists.js): each off unless "true".
  ...SPECIALIST_FLAG_KEYS
]);

// Flags whose *enabling* moves the agent toward live operational actions.
// Turning one of these on requires elevated admin credentials; turning any
// flag off (or the kill switch on) is allowed for every admin, so stopping
// automation is never harder than starting it.
const ELEVATED_ENABLE_FLAGS = Object.freeze([
  AGENT_FLAG_KEYS.AUTOMATION,
  AGENT_FLAG_KEYS.AUTO_REDISPATCH
]);

const DEFAULT_RULES = Object.freeze({
  // Candidate search radius for recommendations (miles).
  recommendation_radius_miles: 15,
  // How many ranked candidates to show per ride.
  max_candidates: 5,
  // Drivers with a recorded rating below this are flagged, not excluded.
  min_driver_rating: 4.2,
  // A paid ride waiting this long with no driver and no live offer is
  // "stalled" and becomes a redispatch candidate.
  stalled_ride_minutes: 3,
  // Hard cap: the agent never redispatches a ride that already had this
  // many dispatch attempts; a human takes over instead.
  max_auto_redispatch_attempts: 3,
  // Minimum gap between two agent redispatches of the same ride.
  redispatch_cooldown_seconds: 90,
  // Driver location older than this is treated as unknown.
  max_location_age_minutes: 10,
  // Assistant requests allowed per UTC day (docs/ai-usage.md): per signed-
  // in rider or driver, per anonymous visitor, and in total.
  assist_daily_limit_per_account: 100,
  assist_daily_limit_visitor: 30,
  assist_daily_limit_global: 5000
});

const RULE_BOUNDS = Object.freeze({
  recommendation_radius_miles: [1, 50],
  max_candidates: [1, 10],
  min_driver_rating: [0, 5],
  stalled_ride_minutes: [1, 60],
  max_auto_redispatch_attempts: [0, 5],
  redispatch_cooldown_seconds: [30, 3600],
  max_location_age_minutes: [1, 120],
  assist_daily_limit_per_account: [1, 10000],
  assist_daily_limit_visitor: [1, 1000],
  assist_daily_limit_global: [10, 1000000]
});

function flagIsOn(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

// rows: [{ key, value }] from system_flags (any extra rows are ignored).
function resolveAgentFlags(rows) {
  const byKey = new Map((rows || []).map((row) => [row && row.key, row && row.value]));
  const flags = {};
  for (const key of BOOLEAN_FLAG_KEYS) {
    flags[key] = flagIsOn(byKey.get(key));
  }
  return flags;
}

// The single source of truth for what the agent may do right now.
function resolveAgentMode(flags, { dispatchPaused = false } = {}) {
  const f = flags || {};
  const killed = Boolean(f[AGENT_FLAG_KEYS.KILL_SWITCH]);
  const assist = !killed && Boolean(f[AGENT_FLAG_KEYS.ASSIST]);
  const shadow = !killed && Boolean(f[AGENT_FLAG_KEYS.SHADOW]);
  const automationRequested =
    Boolean(f[AGENT_FLAG_KEYS.AUTOMATION]) && Boolean(f[AGENT_FLAG_KEYS.AUTO_REDISPATCH]);
  const autoRedispatch = !killed && !shadow && !dispatchPaused && automationRequested;

  let mode = "off";
  if (killed) mode = "killed";
  else if (autoRedispatch) mode = "automation";
  else if (shadow) mode = "shadow";
  else if (assist) mode = "assist";

  return {
    mode,
    kill_switch: killed,
    assist_enabled: assist,
    shadow_enabled: shadow,
    // Recommendations are computed on request for admins in every mode
    // except a kill; they never change platform state.
    recommendations_enabled: !killed,
    auto_redispatch_enabled: autoRedispatch,
    automation_blocked_reason: killed
      ? "kill_switch"
      : !automationRequested
        ? "automation_flags_off"
        : shadow
          ? "shadow_mode_on"
          : dispatchPaused
            ? "dispatch_paused"
            : null
  };
}

// Validates an admin's request to change one flag.
function evaluateFlagChange({ key, enable, adminMethod }) {
  if (!BOOLEAN_FLAG_KEYS.includes(key)) {
    return { ok: false, status: 400, error: "Unknown agent flag." };
  }
  if (typeof enable !== "boolean") {
    return { ok: false, status: 400, error: "enabled must be true or false." };
  }
  if (enable && ELEVATED_ENABLE_FLAGS.includes(key) && adminMethod !== "admin_token") {
    return {
      ok: false,
      status: 403,
      error: "Enabling agent automation requires elevated admin authorization."
    };
  }
  // Specialists answer real riders and drivers, so switching one on also
  // needs the elevated admin token; switching off never does.
  if (enable && SPECIALIST_FLAG_KEYS.includes(key) && adminMethod !== "admin_token") {
    return {
      ok: false,
      status: 403,
      error: "Switching on a specialist agent requires elevated admin authorization."
    };
  }
  return { ok: true, value: enable ? "true" : "false" };
}

function parseStoredRules(raw) {
  if (!raw) return { ...DEFAULT_RULES };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = validateRules(parsed, { partial: true });
    return { ...DEFAULT_RULES, ...(result.ok ? result.rules : {}) };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

// Unknown keys are rejected (not silently dropped) so an admin typo is
// visible; values must be finite numbers inside RULE_BOUNDS.
function validateRules(input, { partial = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Rules must be an object."] };
  }
  const errors = [];
  const rules = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(RULE_BOUNDS, key)) {
      errors.push(`Unknown rule: ${String(key).slice(0, 60)}`);
      continue;
    }
    const num = typeof value === "number" ? value : Number(value);
    const [min, max] = RULE_BOUNDS[key];
    if (!Number.isFinite(num) || num < min || num > max) {
      errors.push(`${key} must be between ${min} and ${max}.`);
      continue;
    }
    rules[key] = num;
  }
  if (!partial) {
    for (const key of Object.keys(DEFAULT_RULES)) {
      if (!(key in rules)) errors.push(`Missing rule: ${key}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, rules };
}

module.exports = {
  AGENT_FLAG_KEYS,
  BOOLEAN_FLAG_KEYS,
  ELEVATED_ENABLE_FLAGS,
  DEFAULT_RULES,
  RULE_BOUNDS,
  flagIsOn,
  resolveAgentFlags,
  resolveAgentMode,
  evaluateFlagChange,
  parseStoredRules,
  validateRules
};
