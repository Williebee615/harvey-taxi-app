// Quote-only mode can't reach an external provider, even when provider
// credentials are configured on the server: the provider is never built
// and no outbound request leaves the process.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";
// Credentials present (fake): the configured provider would be Anthropic.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";

const http = require("http");
const https = require("https");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const isLocal = (h) => /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(h || ""));
let outbound;
let app;
let hooks;

beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app, __assistantPilot: hooks } = require("../server"));
});

beforeEach(() => {
  hooks.reset();
  outbound = [];
  for (const mod of [http, https]) {
    const original = mod.request;
    jest.spyOn(mod, "request").mockImplementation(function (...args) {
      const first = args[0];
      const host = typeof first === "string" || first instanceof URL ? new URL(String(first)).hostname : first && (first.hostname || first.host);
      if (!isLocal(host)) outbound.push(String(host));
      return original.apply(this, args);
    });
  }
  if (global.fetch) {
    const originalFetch = global.fetch;
    jest.spyOn(global, "fetch").mockImplementation((url, ...rest) => {
      if (!isLocal(new URL(String(url)).hostname)) outbound.push(String(url));
      return originalFetch(url, ...rest);
    });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.ASSISTANT_PILOT_MODEL_APPROVED;
});

function seed(flags) {
  mockClient = createFakeSupabase({ system_flags: Object.entries(flags).map(([key, value]) => ({ key, value })), audit_logs: [] });
}
const ask = () => request(app).post("/api/assistant/pilot/chat").set("Host", "harveytaxiservice.com").send({ message: "How do I contact Harvey Taxi support?" });

test.each([
  ["model flag absent", { assistant_pilot_harvey_taxi_enabled: "true" }, "true"],
  ["model flag on but server approval missing", { assistant_pilot_harvey_taxi_enabled: "true", assistant_pilot_harvey_taxi_model_enabled: "true" }, undefined],
  ["model flag 'TRUE' (not exactly true)", { assistant_pilot_harvey_taxi_enabled: "true", assistant_pilot_harvey_taxi_model_enabled: "TRUE" }, "true"]
])("%s: quote-only, provider never built, no outbound request", async (_label, flags, approval) => {
  seed(flags);
  if (approval) process.env.ASSISTANT_PILOT_MODEL_APPROVED = approval;
  const res = await ask();
  expect(res.status).toBe(200);
  expect(res.body.mode).toBe("extractive");
  expect(res.body.sources.length).toBeGreaterThan(0);
  expect(hooks.providerState()).toBeUndefined();
  expect(outbound).toEqual([]);
});
