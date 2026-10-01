// The real per-IP API limiter, tested with a LOW configured limit (not
// raised), plus proof that a raised limit is ignored outside an isolated
// test environment. Each case loads its own server instance so limiter
// state and configuration don't leak between cases.

const BASE_ENV = {
  NODE_ENV: "test",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RIDER_SESSION_SECRET: "test-rider-session-secret",
  DRIVER_SESSION_SECRET: "test-driver-session-secret",
  RIDE_QUOTE_SECRET: "test-ride-quote-secret",
  ADMIN_API_TOKEN: "test-admin-token"
};

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
const request = require("supertest");

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function loadServer(extraEnv) {
  process.env = { ...ORIGINAL, ...BASE_ENV, ...extraEnv };
  delete process.env.REDIS_URL;
  if (!("HARVEY_ISOLATED_TEST" in extraEnv)) delete process.env.HARVEY_ISOLATED_TEST;
  mockSupabaseClient = createFakeSupabase({ system_flags: [{ key: "rider_auth_ui_enabled", value: "true" }] });
  let app;
  jest.isolateModules(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    ({ app } = require("../server"));
  });
  return app;
}

test("with a low limit, the next request gets a real 429 with Retry-After, and the sign-in config is not answered", async () => {
  const app = loadServer({ API_RATE_LIMIT_PER_MINUTE: "3" });
  for (let i = 0; i < 3; i++) {
    const ok = await request(app).get("/api/rider/auth-ui-config");
    expect(ok.status).toBe(200);
    expect(ok.body.enabled).toBe(true);
  }
  const limited = await request(app).get("/api/rider/auth-ui-config");
  expect(limited.status).toBe(429);
  expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  // The 429 body does not carry an "enabled" answer the client could misread.
  expect(limited.body.enabled).toBeUndefined();
});

test("a raised limit without HARVEY_ISOLATED_TEST=1 is ignored: the default 120 applies", async () => {
  const app = loadServer({ API_RATE_LIMIT_PER_MINUTE: "100000" });
  for (let i = 0; i < 120; i++) {
    expect((await request(app).get("/api/rider/auth-ui-config")).status).toBe(200);
  }
  expect((await request(app).get("/api/rider/auth-ui-config")).status).toBe(429);
});

test("in an explicitly isolated test environment the raised limit applies", async () => {
  const app = loadServer({ API_RATE_LIMIT_PER_MINUTE: "100000", HARVEY_ISOLATED_TEST: "1" });
  for (let i = 0; i < 130; i++) {
    expect((await request(app).get("/api/rider/auth-ui-config")).status).toBe(200);
  }
});

test("payment configuration status is admin-only and contains no key material", async () => {
  const app = loadServer({
    STRIPE_SECRET_KEY: "sk_test_" + "k".repeat(30),
    STRIPE_PUBLISHABLE_KEY: "pk_test_" + "p".repeat(30),
    STRIPE_WEBHOOK_SECRET: "whsec_" + "w".repeat(30),
    ENABLE_PAYMENT_GATE: "true"
  });
  expect((await request(app).get("/api/admin/payments/config-status")).status).toBe(401);
  const res = await request(app).get("/api/admin/payments/config-status").set("x-admin-token", "test-admin-token");
  expect(res.status).toBe(200);
  expect(res.body.payments).toMatchObject({ secret_key_mode: "test", publishable_key_mode: "test", key_modes_match: true, webhook_secret_set: true, live_card_payments_effective: false });
  expect(JSON.stringify(res.body)).not.toMatch(/kkkk|pppp|wwww|sk_test|pk_test|whsec/);
});
