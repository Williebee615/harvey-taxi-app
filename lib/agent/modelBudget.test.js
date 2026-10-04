const {
  createModelBudget,
  costOfUsage,
  worstCaseCallCost,
  worstCaseTurnCost,
  inputTokenBound,
  budgetFromEnv,
  MONTHLY_BUDGET_CEILING_USD,
  MAX_INPUT_TOKENS_PER_CALL
} = require("./modelBudget");
const { resolveModelPolicy, modelEligibility, validateModelSettings } = require("./modelPolicy");
const { handleModelAssist, maybeBilled } = require("./modelAssistant");

const MODEL = "claude-haiku-4-5";

test("every billable token category is priced (Haiku 4.5, USD per million tokens)", () => {
  expect(costOfUsage(MODEL, { input_tokens: 1_000_000 })).toBe(1);
  expect(costOfUsage(MODEL, { output_tokens: 1_000_000 })).toBe(5);
  expect(costOfUsage(MODEL, { cache_read_input_tokens: 1_000_000 })).toBe(0.1);
  // Cache writes: 5-minute $1.25, 1-hour $2.00; without the split, the dearer rate.
  expect(costOfUsage(MODEL, { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } })).toBe(1.25);
  expect(costOfUsage(MODEL, { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } })).toBe(2);
  expect(costOfUsage(MODEL, { cache_creation_input_tokens: 1_000_000 })).toBe(2);
  // Server-tool requests (never sent, but priced): $10 per 1,000 searches.
  expect(costOfUsage(MODEL, { server_tool_use: { web_search_requests: 3 } })).toBe(0.03);
  expect(costOfUsage(MODEL, { input_tokens: 3000, output_tokens: 300 })).toBe(0.0045);
  expect(costOfUsage("unknown-model", { input_tokens: 1 })).toBeNull();
});

test("worst case covers every call, at the dearest input rate and full output cap", () => {
  // 16,000 input tokens x $2/M + 500 output x $5/M = $0.0345 per call; 3 calls.
  expect(worstCaseCallCost(MODEL)).toBe(0.0345);
  expect(worstCaseTurnCost(MODEL)).toBe(0.1035);
});

test("the input ceiling is a guaranteed bound (bytes, not an estimate), including multi-byte text", () => {
  const ascii = { messages: [{ role: "user", content: "a".repeat(100) }] };
  const emoji = { messages: [{ role: "user", content: "😀".repeat(100) }] };
  expect(inputTokenBound(emoji) - inputTokenBound(ascii)).toBe(300); // 4 bytes vs 1 per character
  expect(inputTokenBound({})).toBe(1002); // fixed allowance for the provider's tool instructions
});

test("the budget can be lowered by configuration but never raised above $10", () => {
  expect(MONTHLY_BUDGET_CEILING_USD).toBe(10);
  expect(budgetFromEnv({})).toBe(10);
  expect(budgetFromEnv({ AGENT_MODEL_MONTHLY_BUDGET_USD: "5" })).toBe(5);
  expect(budgetFromEnv({ AGENT_MODEL_MONTHLY_BUDGET_USD: "50" })).toBe(10);
  const db = { reserve: jest.fn(async () => 1), settle: async () => true, totals: async () => ({ committed_usd: 0, held_usd: 0 }) };
  const b = createModelBudget({ budgetUsd: 1000, model: MODEL, db });
  expect(b.status().budget_usd).toBe(10);
  return b.reserve().then(() => expect(db.reserve.mock.calls[0][0]).toMatchObject({ budgetUsd: 10, amountUsd: 0.1035 }));
});

test("fails closed when the database can't reserve; a full budget refuses", async () => {
  const down = createModelBudget({ budgetUsd: 10, model: MODEL, db: { reserve: async () => { throw new Error("db down"); }, settle: async () => true, totals: async () => ({}) } });
  expect(await down.reserve()).toMatchObject({ ok: false, reason: "budget_unknown" });
  const full = createModelBudget({ budgetUsd: 10, model: MODEL, db: { reserve: async () => null, settle: async () => true, totals: async () => ({}) } });
  expect(await full.reserve()).toMatchObject({ ok: false, reason: "monthly_budget_reached" });
});

test("settle records the real cost exactly once, never capped; a failed settle leaves the reservation held", async () => {
  const settled = [];
  const db = { reserve: async () => 7, settle: async (row) => { settled.push(row); return true; }, totals: async () => ({}) };
  const b = createModelBudget({ budgetUsd: 10, model: MODEL, db });
  const hold = await b.reserve({ role: "rider", actorId: "R1" });
  expect(await hold.settle({ costUsd: 0.2 })).toEqual({ ok: true }); // above the reservation: still recorded as is
  expect(await hold.settle({ costUsd: 0.2 })).toEqual({ ok: false });
  expect(settled).toEqual([expect.objectContaining({ reservationId: 7, costUsd: 0.2 })]);
  const failing = createModelBudget({ budgetUsd: 10, model: MODEL, db: { reserve: async () => 8, settle: async () => { throw new Error("db down"); }, totals: async () => ({}) } });
  const h2 = await failing.reserve();
  expect(await h2.settle({ costUsd: 0.01 })).toEqual({ ok: false });
  expect(failing.status().last_error).toBe("db down");
});

test("a provider spending-limit refusal blocks the model until the next month", async () => {
  let t = Date.parse("2026-10-20T12:00:00Z");
  const b = createModelBudget({ budgetUsd: 10, model: MODEL, now: () => t, db: { reserve: async () => 1, settle: async () => true, totals: async () => ({}) } });
  b.markProviderLimit();
  expect(await b.reserve()).toMatchObject({ ok: false, reason: "provider_spend_limit" });
  t = Date.parse("2026-11-01T00:01:00Z");
  expect((await b.reserve()).ok).toBe(true);
});

test("possibly-billed failures are charged at the worst case; rejected requests at $0", () => {
  for (const k of ["timeout", "connection", "api_500", "api_529", "unknown"]) expect(maybeBilled(k)).toBe(true);
  for (const k of ["auth", "bad_request", "rate_limited", "spend_limit", "api_404"]) expect(maybeBilled(k)).toBe(false);
});

test("a turn never makes more than 3 calls, each under the input ceiling", async () => {
  const create = jest.fn(async () => ({ message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "get_booking_help", input: {} }], usage: { input_tokens: 2000, output_tokens: 50 } } }));
  const out = await handleModelAssist({ role: "rider", actor: { id: "R1" }, message: "how do I book a ride", tools: { invoke: async () => [] }, claude: { model: MODEL, create } });
  expect(out).toMatchObject({ ok: false, reason: "too_many_tool_calls", calls: 3 });
  expect(create).toHaveBeenCalledTimes(3);
  for (const [req] of create.mock.calls) expect(inputTokenBound(req)).toBeLessThanOrEqual(MAX_INPUT_TOKENS_PER_CALL);
  expect(out.cost_usd).toBe(costOfUsage(MODEL, { input_tokens: 6000, output_tokens: 150 }));
});

test("a request that could exceed the input ceiling is never sent", async () => {
  const create = jest.fn();
  // 3-byte characters at every length cap: 6 context turns of 500 and a
  // 1,000-character message push the byte bound past the ceiling.
  const huge = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "中".repeat(500) }));
  const out = await handleModelAssist({ role: "rider", actor: { id: "R1" }, message: "中".repeat(1000), tools: { invoke: async () => [] }, claude: { model: MODEL, create }, context: huge });
  expect(create).not.toHaveBeenCalled();
  expect(out).toMatchObject({ ok: false, reason: "input_too_large", cost_usd: 0 });
});

test("model policy: off by default; test accounts only; 'all' needs the owner's privacy approval", () => {
  expect(resolveModelPolicy([]).mode).toBe("off");
  const rows = [{ key: "agent_model_mode", value: "all" }, { key: "agent_model_test_accounts", value: '["rider:R1","driver:D1","bogus"]' }];
  const unapproved = resolveModelPolicy(rows, { env: {} });
  expect(unapproved).toMatchObject({ stored_mode: "all", mode: "test_accounts", public_approved: false, test_accounts: ["rider:R1", "driver:D1"] });
  expect(modelEligibility(unapproved, { role: "rider", actor: { id: "R1" } }).eligible).toBe(true);
  expect(modelEligibility(unapproved, { role: "rider", actor: { id: "R2" } }).eligible).toBe(false);
  expect(modelEligibility(unapproved, { role: "driver", actor: { id: "R1" } }).eligible).toBe(false);
  expect(modelEligibility(unapproved, { role: "rider", actor: null }).eligible).toBe(false);
  const approved = resolveModelPolicy(rows, { env: { AGENT_MODEL_PUBLIC_APPROVED: "true" } });
  expect(modelEligibility(approved, { role: "rider", actor: { id: "anyone" } }).eligible).toBe(true);
  expect(modelEligibility(approved, { role: "rider", actor: null }).eligible).toBe(false);
  expect(validateModelSettings({ mode: "all" }, { env: {} }).ok).toBe(false);
  expect(validateModelSettings({ mode: "all" }, { env: { AGENT_MODEL_PUBLIC_APPROVED: "true" } }).ok).toBe(true);
});
