// Assistant usage accounting and limits (docs/ai-usage.md): requests are
// counted per account / visitor and in total per UTC day, in memory; over
// a limit the assistant answers 429 with a safe reply and one audit row
// per account per day; admins see usage; booking is unaffected.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, makeRider, makeDriver } = require("./rideTestHelpers");

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

function useFake(rules) {
  currentFake = createFakeSupabase({
    riders: [makeRider()],
    drivers: [makeDriver(), makeDriver({ id: "DRIVER_2", phone: "+16155550202" })],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    driver_online_sessions: [],
    audit_logs: [],
    system_flags: [
      { key: "agent_assist_enabled", value: "true" },
      { key: "agent_kill_switch", value: "false" },
      ...(rules ? [{ key: "agent_rules", value: JSON.stringify(rules) }] : [])
    ]
  });
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const driverAsk = (id) =>
  request(app).post("/api/agent/driver/assist").set(driverAuthHeaders(signTestDriverToken(id))).send({ message: "How do I contact support?", client: "driver_app" });

test("per-account limit: refused with a safe reply after the limit; one audit row; other accounts unaffected", async () => {
  useFake({ assist_daily_limit_per_account: 2, assist_daily_limit_visitor: 50, assist_daily_limit_global: 1000 });
  expect((await driverAsk("DRIVER_1")).status).toBe(200);
  expect((await driverAsk("DRIVER_1")).status).toBe(200);
  const third = await driverAsk("DRIVER_1");
  expect(third.status).toBe(429);
  expect(third.body).toMatchObject({ limited: true, reason: "account_daily_limit", actions: [] });
  expect(third.body.reply).toMatch(/today's limit.*Booking, your trips and support still work.*911/);
  expect((await driverAsk("DRIVER_1")).status).toBe(429);
  const limited = currentFake._state.audit_logs.filter((a) => a.action === "agent.usage_limited");
  expect(limited).toHaveLength(1);
  expect(limited[0]).toMatchObject({ actor_type: "driver", actor_id: "DRIVER_1", metadata: { reason: "account_daily_limit" } });
  // A refused request writes no decision row.
  expect(currentFake._state.audit_logs.filter((a) => a.action === "agent.decision" && a.actor_id === "DRIVER_1")).toHaveLength(2);
  expect((await driverAsk("DRIVER_2")).status).toBe(200);
});

test("admin usage: live counters, 7-day summary, limits; requests not called tokens", async () => {
  useFake({ assist_daily_limit_per_account: 2 });
  await request(app).post("/api/agent/rider/assist").send({ message: "How long do you keep my data?" });
  await request(app).post("/api/agent/rider/assist").send({ message: "What is the cancellation fee?" });
  const res = await request(app).get("/api/admin/agent/usage").set(ADMIN);
  expect(res.status).toBe(200);
  expect(res.body.measured).toMatch(/Assistant requests.*Claude model is off, so every answer is rules-based and no model tokens are used/);
  expect(res.body.limits.per_account_daily).toBe(2);
  expect(res.body.today_live.requests_today).toBeGreaterThanOrEqual(2);
  expect(res.body.history.unit).toBe("assistant_requests");
  expect(res.body.history.totals).toMatchObject({ model_calls: 0, model_tokens: null });
  const today = res.body.history.daily[res.body.history.daily.length - 1];
  expect(today).toMatchObject({ answered_from_knowledge: 1, knowledge_gaps: 1 });
  expect(res.body.history.recent_gaps[0].question).toContain("cancellation fee");
});

test("admin usage requires admin credentials", async () => {
  useFake();
  expect((await request(app).get("/api/admin/agent/usage")).status).toBe(401);
  expect((await request(app).get("/api/admin/agent/usage").set(driverAuthHeaders(signTestDriverToken("DRIVER_1")))).status).toBe(401);
});

test("limits are admin-editable through the existing rules, with bounds", async () => {
  useFake();
  const okRes = await request(app).post("/api/admin/agent/rules").set(ADMIN).send({ rules: { assist_daily_limit_per_account: 50 } });
  expect(okRes.status).toBe(200);
  expect(okRes.body.rules.assist_daily_limit_per_account).toBe(50);
  const bad = await request(app).post("/api/admin/agent/rules").set(ADMIN).send({ rules: { assist_daily_limit_global: 0 } });
  expect(bad.status).toBe(400);
});

test("usage is counted per app: rider iOS/Android apps by user-agent tag, driver apps by platform, others as web", async () => {
  useFake();
  const ask = (path, ua, body = {}) => {
    const r = request(app).post(path).set("User-Agent", ua);
    return path.includes("driver") ? r.set(driverAuthHeaders(signTestDriverToken("DRIVER_1"))).send({ message: "How do I contact support?", ...body }) : r.send({ message: "How do I contact support?", ...body });
  };
  await ask("/api/agent/rider/assist", "Mozilla/5.0 (iPhone) Mobile/15E148 HarveyTaxiRider/1.0.2 (ios)");
  await ask("/api/agent/rider/assist", "Mozilla/5.0 (Linux; Android 14; wv) HarveyTaxiRider/1.0.2 (android)");
  await ask("/api/agent/rider/assist", "Mozilla/5.0 Safari", { client: "driver_app", platform: "ios" });
  await ask("/api/agent/driver/assist", "okhttp", { client: "driver_app", platform: "android" });
  await ask("/api/agent/driver/assist", "Expo", { client: "driver_app", platform: "ios" });
  const targets = currentFake._state.audit_logs.filter((a) => a.action === "agent.decision").map((a) => a.metadata.app_target);
  expect(targets).toEqual(["rider_ios_app", "rider_android_app", "rider_web", "driver_android_app", "driver_ios_app"]);
  const res = await request(app).get("/api/admin/agent/usage").set(ADMIN);
  expect(res.body.history.totals.by_target).toMatchObject({ rider_ios_app: 1, rider_android_app: 1, rider_web: 1, driver_android_app: 1, driver_ios_app: 1 });
  expect(res.body.today_live.by_target.rider_ios_app).toBeGreaterThanOrEqual(1);
});
