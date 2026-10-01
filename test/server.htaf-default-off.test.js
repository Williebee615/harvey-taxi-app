// HTAF ride creation (applicant data copied into rides) and HTAF AI
// triage (application facts sent to OpenAI) are off unless the operator
// explicitly enables them, which requires the provider agreement,
// governance approval and privacy review tracked in #135-#137.
//
// Off: the route must fail closed before touching the application --
// no read, no ride write, no RPC, no provider call -- and record the
// blocked attempt by ID only.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

// server.js captures its client once at load; forward every call to
// whichever fake the current test installed.
let mockClient;
const mockProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = mockClient[prop];
      return typeof value === "function" ? value.bind(mockClient) : value;
    }
  }
);
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const PRIVATE = {
  id: "application-1",
  first_name: "PrivateFirstName",
  last_name: "PrivateLastName",
  phone: "+15555550177",
  pickup_city: "123 Private Street",
  destination: "Private Clinic",
  status: "approved"
};
const PRIVATE_VALUES = ["PrivateFirstName", "PrivateLastName", "+15555550177", "123 Private Street", "Private Clinic"];
const BODY_VALUE = "Body-supplied private address";

function seed() {
  return { htaf_applications: [{ ...PRIVATE }], rides: [], audit_logs: [] };
}

// Loads a fresh copy of server.js with the given environment, since the
// flags are read once at start-up.
function loadApp(env) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let app;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    ({ app } = require("../server"));
  });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return app;
}

const post = (app, action) =>
  request(app)
    .post(`/api/admin/foundation/applications/application-1/${action}`)
    .set("x-admin-token", process.env.ADMIN_API_TOKEN)
    .send({ pickup: BODY_VALUE });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("with the flags unset (the default)", () => {
  let app;

  beforeAll(() => {
    mockClient = createFakeSupabase(seed());
    app = loadApp({
      HTAF_RIDE_CREATION_ENABLED: undefined,
      HTAF_AI_TRIAGE_ENABLED: undefined,
      OPENAI_API_KEY: "sk-test-not-used"
    });
  });

  beforeEach(() => {
    mockClient = createFakeSupabase(seed());
    mockClient.rpc = jest.fn(async () => ({ data: null, error: null }));
  });

  test.each([
    ["create-ride", "HTAF ride creation is paused", "htaf_ride_creation_blocked"],
    ["triage", "HTAF AI triage is disabled", "htaf_ai_triage_blocked"]
  ])("%s fails closed before reading the application", async (action, message, auditAction) => {
    const res = await post(app, action);
    await settle();

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain(message);

    // Nothing about the application was read, and nothing was written or
    // transferred anywhere.
    expect(mockClient._log.filter((e) => e.table !== "audit_logs")).toEqual([]);
    expect(mockClient.rpc).not.toHaveBeenCalled();
    expect(mockClient._state.rides).toEqual([]);

    // The response never echoes applicant or request data.
    const body = JSON.stringify(res.body);
    for (const value of PRIVATE_VALUES.concat(BODY_VALUE)) expect(body).not.toContain(value);

    // The blocked attempt is audited by ID only.
    const audit = mockClient._state.audit_logs.find((a) => a.action === auditAction);
    expect(audit).toBeDefined();
    expect(audit.entity_id).toBe("application-1");
    const auditJson = JSON.stringify(audit);
    for (const value of PRIVATE_VALUES.concat(BODY_VALUE)) expect(auditJson).not.toContain(value);
  });

  test("the admin health detail reports both actions as off", async () => {
    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);

    expect(res.body.features).toMatchObject({ htaf_ride_creation: false, htaf_ai_triage: false });
  });

  test.each(["false", "0", "off", ""])('HTAF_RIDE_CREATION_ENABLED="%s" stays off', async (value) => {
    const offApp = loadApp({ HTAF_RIDE_CREATION_ENABLED: value });
    const res = await post(offApp, "create-ride");

    expect(res.status).toBe(403);
  });
});

describe("with the flags enabled", () => {
  test("HTAF_RIDE_CREATION_ENABLED=true lets the request past the gate to the normal flow", async () => {
    mockClient = createFakeSupabase({ htaf_applications: [], rides: [], audit_logs: [] });
    const app = loadApp({ HTAF_RIDE_CREATION_ENABLED: "true" });

    const res = await post(app, "create-ride");

    // Past the gate: the application lookup runs (and finds nothing).
    expect(res.status).not.toBe(403);
    expect(mockClient._log.some((e) => e.table === "htaf_applications")).toBe(true);
  });

  test("HTAF_AI_TRIAGE_ENABLED=true without an AI provider key still fails closed", async () => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp({ HTAF_AI_TRIAGE_ENABLED: "true", OPENAI_API_KEY: undefined });

    const res = await post(app, "triage");
    await settle();

    expect(res.status).toBe(403);
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
    const audit = mockClient._state.audit_logs.find((a) => a.action === "htaf_ai_triage_blocked");
    expect(audit.metadata.reason).toBe("no AI provider configured");
  });
});
