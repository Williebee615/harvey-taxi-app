// POST /api/admin/login: the route /admin-login.html uses. Correct
// credentials set an HttpOnly session cookie that requireAdmin accepts;
// wrong ones are refused with no cookie; sign-in attempts are limited per
// IP. Credentials are test fixtures.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "test-fixture-admin-password";
delete process.env.ADMIN_API_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { createFakeSupabase } = require("./fakeSupabase");
const { modelBudgetRpc } = require("./agentModelBudgetFake");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const request = require("supertest");

let app;
let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1)}`;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase(
    {
      audit_logs: [],
      agent_model_usage: [],
      system_flags: [
        { key: "agent_assist_enabled", value: "true" },
        { key: "agent_model_mode", value: "test_accounts" },
        { key: "agent_model_test_accounts", value: JSON.stringify(["rider:RIDER_GPLAY_REVIEWER"]) }
      ]
    },
    { rpc: modelBudgetRpc() }
  );
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const login = (body, from = nextIp()) => request(app).post("/api/admin/login").set("X-Forwarded-For", from).send(body);
const GOOD = { email: "admin@example.test", password: "test-fixture-admin-password" };

test("correct credentials: HttpOnly session cookie, accepted by the session check and the Claude model endpoint", async () => {
  const res = await login(GOOD);
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(JSON.stringify(res.body)).not.toContain(GOOD.password);
  const cookie = res.headers["set-cookie"].find((c) => c.startsWith("htaf_admin_session="));
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  expect(cookie).toMatch(/Path=\//);
  const jar = cookie.split(";")[0];

  const session = await request(app).get("/api/admin/session").set("Cookie", jar);
  expect(session.body.authenticated).toBe(true);

  const model = await request(app).get("/api/admin/agent/model").set("Cookie", jar);
  expect(model.status).toBe(200);
  expect(model.body.mode).toBe("test_accounts");
  expect(model.body.public_approved).toBe(false);
  expect(model.body.budget.budget_usd).toBeLessThanOrEqual(10);
});

test("wrong password, wrong email or empty body: 401 and no session cookie", async () => {
  for (const body of [{ ...GOOD, password: "wrong" }, { ...GOOD, email: "someone@example.test" }, {}]) {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid admin email or password.");
    expect((res.headers["set-cookie"] || []).some((c) => /^htaf_admin_session=[^;]+/.test(c))).toBe(false);
  }
  const model = await request(app).get("/api/admin/agent/model");
  expect(model.status).toBe(401);
});

test("a forged session cookie is refused", async () => {
  const res = await request(app).get("/api/admin/agent/model").set("Cookie", "htaf_admin_session=eyJzdWIiOiJ4In0.deadbeef");
  expect(res.status).toBe(401);
});

test("sign-in attempts are limited to 10 per IP per 15 minutes, even with the right password", async () => {
  const from = nextIp();
  for (let i = 0; i < 10; i += 1) {
    const res = await login({ ...GOOD, password: `guess-${i}` }, from);
    expect(res.status).toBe(401);
  }
  const blocked = await login(GOOD, from);
  expect(blocked.status).toBe(429);
  expect(blocked.headers["set-cookie"]).toBeUndefined();
  // Other IPs are unaffected.
  expect((await login(GOOD)).status).toBe(200);
});

test("the old, never-implemented /api/admin-login path is not a sign-in route", async () => {
  const res = await request(app).post("/api/admin-login").send(GOOD);
  expect(res.status).toBe(404);
  expect(res.headers["set-cookie"]).toBeUndefined();
});

test("30 sign-in attempts from all IPs together per 15 minutes, so varying X-Forwarded-For doesn't get around the limit", async () => {
  let status = 0;
  let attempts = 0;
  while (status !== 429 && attempts < 40) {
    attempts += 1;
    status = (await login({ ...GOOD, password: `spray-${attempts}` })).status;
  }
  expect(status).toBe(429);
  expect(attempts).toBeLessThanOrEqual(30);
  const blocked = await login(GOOD);
  expect(blocked.status).toBe(429);
  expect(blocked.headers["set-cookie"]).toBeUndefined();
});
