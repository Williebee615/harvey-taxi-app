// Claude Haiku assistant (docs/ai-model.md). The Anthropic SDK is replaced
// by a scripted fake: no real API calls, no cost. Covers:
// - off by default; only listed synthetic test accounts get the model;
// - tools run the same role-scoped lookups; buttons come only from them;
// - the reply guard (no invented numbers or "done" claims) and fallback;
// - safety boundaries never reach the model;
// - the $10 monthly budget, durable spending ledger and provider limit;
// - admin settings ("all" refused before privacy approval) and Try console.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
delete process.env.AGENT_MODEL_PUBLIC_APPROVED;
delete process.env.AGENT_MODEL_MONTHLY_BUDGET_USD;
delete process.env.AGENT_LLM_BASE_URL;

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(status, message, error) {
      super(message);
      this.status = status;
      this.error = error;
    }
  }
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  function Anthropic() {
    this.messages = { create: (...args) => mockCreate(...args) };
  }
  Object.assign(Anthropic, { APIError, APIConnectionError, APIConnectionTimeoutError, AuthenticationError, RateLimitError, BadRequestError });
  return { __esModule: true, default: Anthropic };
});

const request = require("supertest");
const Anthropic = require("@anthropic-ai/sdk").default;
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, signTestRiderToken, riderAuthHeaders, makeRider, makeDriver, makeRide } = require("./rideTestHelpers");
const { usageMonth } = require("../lib/agent/modelBudget");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const TEST_RIDER = "TEST-SYNTH-R1";
const TEST_DRIVER = "TEST-SYNTH-D1";

function useFake({ mode = "test_accounts", spent = 0, failLedger = false } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider(), makeRider({ id: TEST_RIDER, phone: "+16155550411", email: "synthetic-rider@example.test" })],
      drivers: [makeDriver(), makeDriver({ id: TEST_DRIVER, phone: "+16155550412" })],
      rides: [makeRide({ id: "TEST-RIDE-M1", rider_id: TEST_RIDER, status: "driver_enroute", driver_name: "TestDriver A.", driver_vehicle: "Test Vehicle", driver_eta_to_pickup_text: "6 min", estimated_fare: 21.5 })],
      driver_offers: [],
      driver_online_sessions: [],
      driver_earnings: [],
      audit_logs: [],
      agent_model_usage: spent ? [{ usage_month: usageMonth(), role: "rider", model: "claude-haiku-4-5", cost_usd: spent, outcome: "answered" }] : [],
      system_flags: [
        { key: "agent_assist_enabled", value: "true" },
        { key: "agent_kill_switch", value: "false" },
        { key: "agent_model_mode", value: mode },
        { key: "agent_model_test_accounts", value: JSON.stringify([`rider:${TEST_RIDER}`, `driver:${TEST_DRIVER}`]) }
      ]
    },
    failLedger ? { failSelect: (table) => (table === "agent_model_usage" ? { message: "ledger unavailable" } : null) } : {}
  );
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => mockCreate.mockReset());

const msg = (stop_reason, content, usage = { input_tokens: 1500, output_tokens: 60 }) => ({ stop_reason, content, usage });
const toolUse = (name, input = {}, id = `tu_${name}`) => msg("tool_use", [{ type: "tool_use", id, name, input }]);
const say = (text) => msg("end_turn", [{ type: "text", text }], { input_tokens: 1800, output_tokens: 40 });
const riderAsk = (message, id = TEST_RIDER) => request(app).post("/api/agent/rider/assist").set(riderAuthHeaders(signTestRiderToken(id))).send({ message });
const ledger = () => currentFake._state.agent_model_usage;
const decisions = () => currentFake._state.audit_logs.filter((a) => a.action === "agent.decision");
const refreshBudget = () => request(app).get("/api/admin/agent/model").set(ADMIN);

test("off by default: with the mode off, nobody gets the model", async () => {
  useFake({ mode: "off" });
  const res = await riderAsk("Where is my driver?");
  expect(res.body.source).not.toBe("model");
  expect(mockCreate).not.toHaveBeenCalled();
  expect(ledger()).toEqual([]);
});

test("test_accounts mode: real (unlisted) accounts and signed-out visitors keep the rules", async () => {
  useFake();
  expect((await riderAsk("Where is my driver?", "RIDER_1")).body.source).not.toBe("model");
  expect((await request(app).post("/api/agent/rider/assist").send({ message: "How long do you keep my data?" })).body.source).not.toBe("model");
  expect(mockCreate).not.toHaveBeenCalled();
});

test("listed test rider: natural reply from the ride-status tool; buttons come from the tool; tokens and cost recorded", async () => {
  useFake();
  await refreshBudget();
  mockCreate.mockResolvedValueOnce(toolUse("get_my_ride_status")).mockResolvedValueOnce(say("Your driver TestDriver A. is on the way in a Test Vehicle and should reach you in about 6 min."));
  const res = await riderAsk("hey, is my driver close?");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ source: "model", intent: "ride_status" });
  expect(res.body.reply).toContain("6 min");
  expect(res.body.actions).toEqual([{ type: "open_tracking", label: "Track ride", href: "/rider-dashboard.html?screen=track&ride_id=TEST-RIDE-M1" }]);

  // The model request: Haiku, bounded output, role-scoped tools only.
  const first = mockCreate.mock.calls[0][0];
  expect(first.model).toBe("claude-haiku-4-5");
  expect(first.max_tokens).toBe(500);
  const toolNames = first.tools.map((t) => t.name);
  expect(toolNames).toEqual(expect.arrayContaining(["get_my_ride_status", "prepare_ride_cancellation", "search_harvey_policies", "prepare_support_request"]));
  expect(toolNames).not.toContain("get_my_earnings");
  // The tool result sent back holds only this rider's own ride facts.
  const toolResult = mockCreate.mock.calls[1][0].messages.at(-1).content[0];
  expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "tu_get_my_ride_status" });
  expect(toolResult.content).toContain("TestDriver A.");

  // Spending ledger: 3,300 input + 100 output tokens at $1 / $5 per million.
  expect(ledger()).toHaveLength(1);
  expect(ledger()[0]).toMatchObject({ role: "rider", actor_id: TEST_RIDER, model: "claude-haiku-4-5", calls: 2, input_tokens: 3300, output_tokens: 100, cost_usd: 0.0038, outcome: "answered" });
  expect(decisions().at(-1).metadata).toMatchObject({ answer_source: "model", model: { used: true, calls: 2, cost_usd: 0.0038, fallback_reason: null } });
});

test("cancellation: the model can only offer the confirmed Cancel button from the tool; a 'done' claim is rejected", async () => {
  useFake();
  mockCreate.mockResolvedValueOnce(toolUse("prepare_ride_cancellation")).mockResolvedValueOnce(say("You can cancel below; there's no fee right now, and nothing changes until you confirm."));
  const ok = await riderAsk("please cancel my ride");
  expect(ok.body.source).toBe("model");
  expect(ok.body.actions[0]).toMatchObject({ type: "cancel_ride", endpoint: "/api/rides/TEST-RIDE-M1/cancel", requires_confirmation: true });
  expect(currentFake._state.rides[0].status).toBe("driver_enroute"); // nothing cancelled

  mockCreate.mockResolvedValueOnce(toolUse("prepare_ride_cancellation")).mockResolvedValueOnce(say("Done! I've cancelled your ride."));
  const claimed = await riderAsk("cancel it now");
  expect(claimed.body.source).not.toBe("model");
  expect(decisions().at(-1).metadata.model).toMatchObject({ used: false, fallback_reason: "guard_claims_completed_action" });
  expect(ledger().at(-1).outcome).toBe("fallback_guard_claims_completed_action"); // cost still counted
});

test("invented numbers fall back to the rules answer", async () => {
  useFake();
  mockCreate.mockResolvedValueOnce(toolUse("get_my_fare")).mockResolvedValueOnce(say("Your fare is $45.00."));
  const res = await riderAsk("how much is my ride?");
  expect(res.body.source).not.toBe("model");
  expect(res.body.reply).toContain("$21.50");
  expect(decisions().at(-1).metadata.model.fallback_reason).toBe("guard_ungrounded_number");
});

test("policy questions use approved pages with sources; nothing found is a gap with a support offer", async () => {
  useFake();
  mockCreate
    .mockResolvedValueOnce(toolUse("search_harvey_policies", { query: "data retention" }))
    .mockResolvedValueOnce(say("Our Privacy Policy says Harvey Taxi keeps information only as long as reasonably needed to run the service and meet legal duties."));
  const found = await riderAsk("how long do you keep my data?");
  expect(found.body.source).toBe("model");
  expect(found.body.sources[0]).toMatchObject({ title: "Privacy Policy" });

  mockCreate
    .mockResolvedValueOnce(msg("tool_use", [
      { type: "tool_use", id: "a", name: "search_harvey_policies", input: { query: "airport flat rate" } },
      { type: "tool_use", id: "b", name: "prepare_support_request", input: { kind: "general" } }
    ]))
    .mockResolvedValueOnce(say("I don't have approved Harvey Taxi information on airport flat rates. You can send a request to support below."));
  const gap = await riderAsk("is there an airport flat rate?");
  expect(gap.body).toMatchObject({ source: "model", knowledge_gap: true });
  expect(gap.body.actions).toEqual([{ type: "support_handoff", kind: "general", label: "Send a request to support", requires_confirmation: true }]);
});

test("safety boundaries never reach the model", async () => {
  useFake();
  const res = await riderAsk("my driver is threatening me");
  expect(mockCreate).not.toHaveBeenCalled();
  expect(res.body.escalation).toMatchObject({ category: "emergency" });
  expect(res.body.reply).toMatch(/911/);
});

test("driver test account: hours tool; found item adds the lost-item support button", async () => {
  useFake();
  mockCreate.mockResolvedValueOnce(toolUse("prepare_support_request", { kind: "lost_item" })).mockResolvedValueOnce(say("Tap Report a found item to send support the details; nothing goes until you confirm."));
  const res = await request(app)
    .post("/api/agent/driver/assist")
    .set(driverAuthHeaders(signTestDriverToken(TEST_DRIVER)))
    .send({ message: "a rider left a bag in my car", client: "driver_app", platform: "ios" });
  expect(res.body.source).toBe("model");
  expect(res.body.actions).toEqual([{ type: "support_handoff", kind: "lost_item", label: "Report a found item", requires_confirmation: true }]);
  const toolNames = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
  expect(toolNames).toEqual(expect.arrayContaining(["get_my_hours", "get_my_ride_offers", "get_my_earnings"]));
  expect(toolNames).not.toContain("prepare_ride_cancellation");
  expect(ledger().at(-1)).toMatchObject({ role: "driver", actor_id: TEST_DRIVER, app_target: "driver_ios_app" });
});

test("follow-ups: the device's recent turns are sent as conversation", async () => {
  useFake();
  mockCreate.mockResolvedValueOnce(say("Yes, the same applies to drivers."));
  await request(app)
    .post("/api/agent/rider/assist")
    .set(riderAuthHeaders(signTestRiderToken(TEST_RIDER)))
    .send({ message: "and for drivers?", context: [{ role: "user", text: "Do you share my data?" }, { role: "assistant", text: "Only as our Privacy Policy describes." }] });
  expect(mockCreate.mock.calls[0][0].messages).toEqual([
    { role: "user", content: "Do you share my data?" },
    { role: "assistant", content: "Only as our Privacy Policy describes." },
    { role: "user", content: "and for drivers?" }
  ]);
});

test("errors and timeouts fall back to the rules answer", async () => {
  useFake();
  mockCreate.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError(undefined, "timed out"));
  const res = await riderAsk("where is my driver?");
  expect(res.status).toBe(200);
  expect(res.body.source).not.toBe("model");
  expect(res.body.reply).toMatch(/on the way to pickup/);
  expect(decisions().at(-1).metadata.model).toMatchObject({ used: false, fallback_reason: "timeout" });
});

test("budget: when this month's recorded spending leaves less than one turn's maximum, the model isn't called", async () => {
  useFake({ spent: 9.97 });
  const status = await refreshBudget();
  expect(status.body.budget).toMatchObject({ budget_usd: 10, ceiling_usd: 10, spent_usd: 9.97, reserve_per_turn_usd: 0.0525 });
  const res = await riderAsk("where is my driver?");
  expect(res.body.source).not.toBe("model");
  expect(mockCreate).not.toHaveBeenCalled();
  expect(decisions().at(-1).metadata.model).toMatchObject({ used: false, fallback_reason: "monthly_budget_reached" });
});

test("budget: if the ledger can't be read, the model stays off (fail closed)", async () => {
  useFake({ failLedger: true });
  // Force a fresh load in a new month window: a failed load after a good
  // one keeps the last total, so check status reports the error.
  const status = await refreshBudget();
  expect(status.body.budget.last_error).toMatch(/ledger unavailable/);
});

test("admin: settings validated; 'all' refused before the privacy approval; Try only for listed test accounts", async () => {
  useFake({ mode: "off" });
  await refreshBudget();
  const all = await request(app).post("/api/admin/agent/model").set(ADMIN).send({ mode: "all" });
  expect(all.status).toBe(400);
  expect(all.body.error).toMatch(/privacy disclosure/);
  expect((await request(app).post("/api/admin/agent/model").set(ADMIN).send({ test_accounts: ["not valid"] })).status).toBe(400);
  const set = await request(app).post("/api/admin/agent/model").set(ADMIN).send({ mode: "test_accounts", test_accounts: [`rider:${TEST_RIDER}`] });
  expect(set.status).toBe(200);
  expect(set.body).toMatchObject({ mode: "test_accounts", configured: true, model: "claude-haiku-4-5", test_accounts: [`rider:${TEST_RIDER}`] });
  expect((await request(app).post("/api/admin/agent/model").send({ mode: "off" })).status).toBe(401);

  expect((await request(app).post("/api/admin/agent/model/try").set(ADMIN).send({ role: "rider", actor_id: "RIDER_1", message: "hi" })).status).toBe(403);
  mockCreate.mockResolvedValueOnce(say("Hi! How can I help with your ride today?"));
  const tried = await request(app).post("/api/admin/agent/model/try").set(ADMIN).send({ role: "rider", actor_id: TEST_RIDER, message: "hi" });
  expect(tried.status).toBe(200);
  expect(tried.body).toMatchObject({ source: "model", model: { used: true, calls: 1 } });
  expect(tried.body.budget.spent_usd).toBeGreaterThan(0);
});

test("usage dashboard reports model tokens and cost separately from requests", async () => {
  useFake();
  mockCreate.mockResolvedValueOnce(say("Hi there! Ask me about your ride."));
  await riderAsk("hello");
  const res = await request(app).get("/api/admin/agent/usage").set(ADMIN);
  expect(res.body.measured).toMatch(/model tokens and cost.*listed test accounts only/);
  expect(res.body.history.totals).toMatchObject({ model_calls: 1, model_turns: 1, model_tokens: { input: 1800, output: 40 }, model_cost_usd: 0.002 });
  expect(res.body.model).toMatchObject({ provider: "anthropic", mode: "test_accounts", public_approved: false });
});

test("provider spending limit: falls back and stops calling the model for the rest of the month", async () => {
  useFake();
  await refreshBudget();
  mockCreate.mockRejectedValueOnce(new Anthropic.BadRequestError(400, "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."));
  const first = await riderAsk("where is my driver?");
  expect(first.body.source).not.toBe("model");
  const second = await riderAsk("where is my driver now?");
  expect(second.body.source).not.toBe("model");
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(decisions().at(-1).metadata.model.fallback_reason).toBe("provider_spend_limit");
});
