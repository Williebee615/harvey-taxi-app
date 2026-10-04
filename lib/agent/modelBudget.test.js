const { createModelBudget, costOfUsage, worstCaseTurnCost, budgetFromEnv, MONTHLY_BUDGET_CEILING_USD } = require("./modelBudget");
const { resolveModelPolicy, modelEligibility, validateModelSettings } = require("./modelPolicy");

const MODEL = "claude-haiku-4-5";

test("Haiku 4.5 cost from provider usage (published prices, USD per million tokens)", () => {
  expect(costOfUsage(MODEL, { input_tokens: 1_000_000 })).toBe(1);
  expect(costOfUsage(MODEL, { output_tokens: 1_000_000 })).toBe(5);
  expect(costOfUsage(MODEL, { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(1.35, 6);
  expect(costOfUsage(MODEL, { input_tokens: 3000, output_tokens: 300 })).toBe(0.0045);
  expect(costOfUsage("unknown-model", { input_tokens: 1 })).toBeNull();
  expect(worstCaseTurnCost(MODEL)).toBe(0.0525);
});

test("the budget can be lowered by configuration but never raised above $10", () => {
  expect(MONTHLY_BUDGET_CEILING_USD).toBe(10);
  expect(budgetFromEnv({})).toBe(10);
  expect(budgetFromEnv({ AGENT_MODEL_MONTHLY_BUDGET_USD: "5" })).toBe(5);
  expect(budgetFromEnv({ AGENT_MODEL_MONTHLY_BUDGET_USD: "50" })).toBe(10);
  expect(budgetFromEnv({ AGENT_MODEL_MONTHLY_BUDGET_USD: "-1" })).toBe(10);
  const b = createModelBudget({ budgetUsd: 1000, model: MODEL, loadMonthTotal: async () => 0, recordTurn: async () => ({ ok: true }) });
  expect(b.status().budget_usd).toBe(10);
});

test("fails closed when spending can't be loaded", async () => {
  const b = createModelBudget({ budgetUsd: 10, model: MODEL, loadMonthTotal: async () => { throw new Error("db down"); }, recordTurn: async () => ({ ok: true }) });
  const r = await b.reserve();
  expect(r).toMatchObject({ ok: false, reason: "budget_unknown" });
  expect(b.status()).toMatchObject({ loaded: false, last_error: "db down" });
});

test("reservations stop concurrent turns from overshooting; commits add real cost", async () => {
  let t = Date.parse("2026-10-20T12:00:00Z");
  const rows = [];
  const b = createModelBudget({ budgetUsd: 0.12, model: MODEL, now: () => t, loadMonthTotal: async () => 0, recordTurn: async (row) => { rows.push(row); return { ok: true }; } });
  const a = await b.reserve();
  const c = await b.reserve();
  const d = await b.reserve(); // 3 x 0.0525 > 0.12
  expect([a.ok, c.ok, d.ok]).toEqual([true, true, false]);
  expect(d.reason).toBe("monthly_budget_reached");
  a.release();
  await b.commit({ cost_usd: 0.004, outcome: "answered" });
  expect(rows[0]).toMatchObject({ usage_month: "2026-10", cost_usd: 0.004 });
  expect(b.status()).toMatchObject({ spent_usd: 0.004, reserved_usd: 0.0525 });
  c.release();
  expect((await b.reserve()).ok).toBe(true);
});

test("a provider spending-limit refusal blocks the model until the next month", async () => {
  let t = Date.parse("2026-10-20T12:00:00Z");
  const b = createModelBudget({ budgetUsd: 10, model: MODEL, now: () => t, loadMonthTotal: async () => 0, recordTurn: async () => ({ ok: true }) });
  await b.refresh();
  b.markProviderLimit();
  expect(await b.reserve()).toMatchObject({ ok: false, reason: "provider_spend_limit" });
  t = Date.parse("2026-11-01T00:01:00Z");
  expect((await b.reserve()).ok).toBe(true);
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
