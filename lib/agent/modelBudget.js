// Harvey Assistant model spending: price table, cost per call, and the
// monthly budget enforced before every model answer (docs/ai-model.md).
//
// Owner-approved: at most $10 per calendar month (UTC) across all four
// apps. MONTHLY_BUDGET_CEILING_USD is that ceiling here, and the database
// function caps it at $10 again; configuration can only lower it.
//
// Every answer is covered by an atomic reservation in the database
// (agent_model_reserve, migration 20261005010000): one per-month lock,
// so simultaneous requests on any number of server instances are checked
// against one shared total. The reservation is the answer's worst case:
//   - every model call it may make (MAX_CALLS_PER_TURN; tool rounds are
//     calls; the SDK never retries on its own: maxRetries is 0),
//   - each call at the input-token ceiling priced at the most expensive
//     input category (1-hour cache write), plus the full output cap.
// The answer then settles the reservation with the real cost; a call
// whose outcome is unknown (timeout, dropped connection, server error) is
// charged at its worst case. An unsettled reservation keeps counting as
// spent. If the database can't be reached, the model stays off.

const MONTHLY_BUDGET_CEILING_USD = 10;

// Claude Haiku 4.5, USD per million tokens. Source: Anthropic pricing page
// (platform.claude.com/docs/en/about-claude/pricing), read 2026-10-04.
// Web search is $10 per 1,000 searches (not used: no server tools are
// sent, but it is priced so nothing billable is ever missed).
const PRICES = Object.freeze({
  "claude-haiku-4-5": Object.freeze({ input: 1.0, output: 5.0, cacheWrite5m: 1.25, cacheWrite1h: 2.0, cacheRead: 0.1, webSearchEach: 0.01 })
});

const MAX_CALLS_PER_TURN = 3;
// Hard input ceiling per call. Checked as UTF-8 bytes of the request plus
// a fixed allowance for the provider's own tool-use instructions and
// message formatting: a token always covers at least one byte, so this is
// a guaranteed upper bound on billed input tokens, not an estimate.
const MAX_INPUT_TOKENS_PER_CALL = 16000;
const PROVIDER_OVERHEAD_TOKENS = 1000;
const MAX_OUTPUT_TOKENS_PER_CALL = 500;

function budgetFromEnv(env = process.env) {
  const raw = Number(env.AGENT_MODEL_MONTHLY_BUDGET_USD);
  if (!Number.isFinite(raw) || raw <= 0) return MONTHLY_BUDGET_CEILING_USD;
  return Math.min(raw, MONTHLY_BUDGET_CEILING_USD);
}

function usageMonth(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 7);
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Cost of one call's reported usage, covering every billable category:
// input, output, cache writes (5-minute and 1-hour; priced at the 1-hour
// rate when the split isn't reported), cache reads, and server-tool
// requests.
function costOfUsage(model, usage = {}) {
  const p = PRICES[model];
  if (!p) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const split = usage.cache_creation || null;
  const write5m = split ? n(split.ephemeral_5m_input_tokens) : 0;
  const write1h = split ? n(split.ephemeral_1h_input_tokens) : n(usage.cache_creation_input_tokens);
  const searches = n(usage.server_tool_use && usage.server_tool_use.web_search_requests);
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      write5m * p.cacheWrite5m +
      write1h * p.cacheWrite1h +
      n(usage.cache_read_input_tokens) * p.cacheRead) /
      1e6 +
    searches * p.webSearchEach;
  return round6(usd);
}

// The most one call can cost: the full input ceiling at the dearest input
// rate, plus the full output cap.
function worstCaseCallCost(model) {
  const p = PRICES[model];
  if (!p) return Infinity;
  const inputRate = Math.max(p.input, p.cacheWrite5m, p.cacheWrite1h);
  return round6((MAX_INPUT_TOKENS_PER_CALL * inputRate + MAX_OUTPUT_TOKENS_PER_CALL * p.output) / 1e6);
}

function worstCaseTurnCost(model) {
  return round6(worstCaseCallCost(model) * MAX_CALLS_PER_TURN);
}

// Guaranteed upper bound on a request's billed input tokens.
function inputTokenBound(request) {
  return Buffer.byteLength(JSON.stringify(request), "utf8") + PROVIDER_OVERHEAD_TOKENS;
}

// db.reserve({ month, budgetUsd, amountUsd, role, actorId }) -> id | null
// db.settle({ reservationId, costUsd, ... }) -> boolean
// db.totals(month) -> { committed_usd, held_usd }
function createModelBudget({ budgetUsd, model, db, now = () => Date.now(), log = () => {} }) {
  const budget = Math.min(Number(budgetUsd) || MONTHLY_BUDGET_CEILING_USD, MONTHLY_BUDGET_CEILING_USD);
  const reserveUsd = worstCaseTurnCost(model);
  let providerLimitMonth = null;
  let lastTotals = null;
  let lastError = null;

  async function refresh() {
    const month = usageMonth(now());
    try {
      const t = await db.totals(month);
      lastTotals = { month, committed: Number(t.committed_usd) || 0, held: Number(t.held_usd) || 0, at: new Date(now()).toISOString() };
      lastError = null;
    } catch (err) {
      lastError = err && err.message ? err.message : "totals unavailable";
      log(lastError);
    }
  }

  // One atomic reservation in the database. Returns { ok, reason, settle }.
  async function reserve({ role = null, actorId = null } = {}) {
    const month = usageMonth(now());
    if (providerLimitMonth === month) return { ok: false, reason: "provider_spend_limit" };
    let id;
    try {
      id = await db.reserve({ month, budgetUsd: budget, amountUsd: reserveUsd, role, actorId });
    } catch (err) {
      lastError = err && err.message ? err.message : "reserve failed";
      log(lastError);
      return { ok: false, reason: "budget_unknown" };
    }
    if (id === null || id === undefined) return { ok: false, reason: "monthly_budget_reached" };
    let settled = false;
    return {
      ok: true,
      reason: null,
      reservationId: id,
      // Settles with the real cost (or $0 if no call was made). If this
      // fails, the reservation stays held at its full amount.
      async settle(row) {
        if (settled) return { ok: false };
        settled = true;
        try {
          // The real cost is recorded as is, never capped: the bounds keep
          // it within the reservation, and if they ever didn't, the ledger
          // must still show what was actually spent.
          const ok = await db.settle({ reservationId: id, ...row, costUsd: Number(row.costUsd) || 0 });
          if (!ok) throw new Error("reservation was not open");
          return { ok: true };
        } catch (err) {
          lastError = err && err.message ? err.message : "settle failed";
          log(lastError);
          return { ok: false };
        }
      }
    };
  }

  function markProviderLimit() {
    providerLimitMonth = usageMonth(now());
  }

  function status() {
    const month = usageMonth(now());
    const t = lastTotals && lastTotals.month === month ? lastTotals : null;
    const spent = t ? t.committed : null;
    const held = t ? t.held : null;
    return {
      month,
      budget_usd: budget,
      ceiling_usd: MONTHLY_BUDGET_CEILING_USD,
      spent_usd: spent === null ? null : round6(spent),
      held_usd: held === null ? null : round6(held),
      remaining_usd: spent === null ? null : Math.max(0, round6(budget - spent - held)),
      reserve_per_turn_usd: reserveUsd,
      loaded: Boolean(t),
      loaded_at: t ? t.at : null,
      provider_spend_limit_hit: providerLimitMonth === month,
      last_error: lastError
    };
  }

  return { refresh, reserve, markProviderLimit, status };
}

module.exports = {
  MONTHLY_BUDGET_CEILING_USD,
  PRICES,
  MAX_CALLS_PER_TURN,
  MAX_INPUT_TOKENS_PER_CALL,
  MAX_OUTPUT_TOKENS_PER_CALL,
  PROVIDER_OVERHEAD_TOKENS,
  budgetFromEnv,
  usageMonth,
  costOfUsage,
  worstCaseCallCost,
  worstCaseTurnCost,
  inputTokenBound,
  createModelBudget
};
