// Harvey Assistant model spending: price table, cost per call, and the
// monthly budget the server enforces before every model turn
// (docs/ai-model.md).
//
// The owner approved at most $10 per calendar month (UTC) across all four
// apps. MONTHLY_BUDGET_CEILING_USD is that ceiling in code: configuration
// can lower the budget but never raise it above the ceiling. Raising it is
// a code change that needs the owner's approval.
//
// Spending is recorded durably (table agent_model_usage, one row per model
// turn), so a server restart does not reset it. The running month total is
// kept in memory and reloaded from the database every few minutes. If the
// total can't be loaded, the model stays off (fail closed).

const MONTHLY_BUDGET_CEILING_USD = 10;

// Claude Haiku 4.5, USD per million tokens. Source: Anthropic pricing page
// (platform.claude.com/docs/en/about-claude/pricing), read 2026-10-04.
const PRICES = Object.freeze({
  "claude-haiku-4-5": Object.freeze({ input: 1.0, output: 5.0, cacheWrite5m: 1.25, cacheRead: 0.1 })
});

// A model turn is capped at MAX_CALLS_PER_TURN calls of at most
// MAX_INPUT_TOKENS_PER_CALL input and MAX_OUTPUT_TOKENS_PER_CALL output
// tokens (lib/agent/modelAssistant.js). Its worst-case cost is reserved
// before the turn starts, so concurrent turns can't overshoot the budget.
const MAX_CALLS_PER_TURN = 3;
const MAX_INPUT_TOKENS_PER_CALL = 12000;
const MAX_OUTPUT_TOKENS_PER_CALL = 500;

function budgetFromEnv(env = process.env) {
  const raw = Number(env.AGENT_MODEL_MONTHLY_BUDGET_USD);
  if (!Number.isFinite(raw) || raw <= 0) return MONTHLY_BUDGET_CEILING_USD;
  return Math.min(raw, MONTHLY_BUDGET_CEILING_USD);
}

function usageMonth(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 7);
}

function costOfUsage(model, usage = {}) {
  const p = PRICES[model];
  if (!p) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_creation_input_tokens) * p.cacheWrite5m +
      n(usage.cache_read_input_tokens) * p.cacheRead) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}

function worstCaseTurnCost(model) {
  const p = PRICES[model];
  if (!p) return Infinity;
  const perCall = (MAX_INPUT_TOKENS_PER_CALL * p.cacheWrite5m + MAX_OUTPUT_TOKENS_PER_CALL * p.output) / 1e6;
  return Math.round(perCall * MAX_CALLS_PER_TURN * 1e6) / 1e6;
}

// loadMonthTotal(month) -> Promise<number>  (sum of cost_usd for the month)
// recordTurn(row)       -> Promise<{ ok }>  (insert one agent_model_usage row)
function createModelBudget({ budgetUsd, model, loadMonthTotal, recordTurn, now = () => Date.now(), refreshMs = 5 * 60 * 1000, log = () => {} }) {
  const budget = Math.min(Number(budgetUsd) || MONTHLY_BUDGET_CEILING_USD, MONTHLY_BUDGET_CEILING_USD);
  const reserveUsd = worstCaseTurnCost(model);
  let month = null;
  let spent = 0;
  let loadedAt = 0;
  let loaded = false;
  let reserved = 0;
  let lastError = null;
  // Set when the provider itself refuses for a spending limit; cleared at
  // the next month.
  let providerLimitMonth = null;
  let refreshing = null;

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const current = usageMonth(now());
      try {
        const total = await loadMonthTotal(current);
        if (!Number.isFinite(Number(total))) throw new Error("month total is not a number");
        month = current;
        spent = Number(total);
        loaded = true;
        lastError = null;
      } catch (err) {
        lastError = err && err.message ? err.message : "load failed";
        log(lastError);
        // A new month with no successful load: unknown spend, stay closed.
        if (month !== current) loaded = false;
      } finally {
        loadedAt = now();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function stale() {
    return !loaded || month !== usageMonth(now()) || now() - loadedAt > refreshMs;
  }

  // Reserves the worst case for one turn. Returns { ok, reason, release }.
  async function reserve() {
    if (stale()) await refresh();
    if (!loaded) return { ok: false, reason: "budget_unknown" };
    if (providerLimitMonth === month) return { ok: false, reason: "provider_spend_limit" };
    if (spent + reserved + reserveUsd > budget) return { ok: false, reason: "monthly_budget_reached" };
    reserved += reserveUsd;
    let released = false;
    return {
      ok: true,
      reason: null,
      release() {
        if (released) return;
        released = true;
        reserved = Math.max(0, reserved - reserveUsd);
      }
    };
  }

  // Adds a finished turn's real cost. The row is written to the database;
  // the in-memory total moves immediately either way.
  async function commit(row) {
    const cost = Number(row.cost_usd) || 0;
    spent += cost;
    try {
      const res = await recordTurn({ ...row, usage_month: month || usageMonth(now()), cost_usd: cost });
      if (!res || res.ok === false) throw new Error((res && res.error) || "insert failed");
      return { ok: true };
    } catch (err) {
      lastError = err && err.message ? err.message : "record failed";
      log(lastError);
      return { ok: false };
    }
  }

  function markProviderLimit() {
    providerLimitMonth = month || usageMonth(now());
  }

  function status() {
    return {
      month: month || usageMonth(now()),
      budget_usd: budget,
      ceiling_usd: MONTHLY_BUDGET_CEILING_USD,
      spent_usd: Math.round(spent * 1e6) / 1e6,
      reserved_usd: Math.round(reserved * 1e6) / 1e6,
      remaining_usd: Math.max(0, Math.round((budget - spent) * 1e6) / 1e6),
      reserve_per_turn_usd: reserveUsd,
      loaded,
      loaded_at: loadedAt ? new Date(loadedAt).toISOString() : null,
      provider_spend_limit_hit: providerLimitMonth === (month || usageMonth(now())),
      last_error: lastError
    };
  }

  return { refresh, reserve, commit, markProviderLimit, status };
}

module.exports = {
  MONTHLY_BUDGET_CEILING_USD,
  PRICES,
  MAX_CALLS_PER_TURN,
  MAX_INPUT_TOKENS_PER_CALL,
  MAX_OUTPUT_TOKENS_PER_CALL,
  budgetFromEnv,
  usageMonth,
  costOfUsage,
  worstCaseTurnCost,
  createModelBudget
};
