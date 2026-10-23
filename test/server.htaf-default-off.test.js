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
    ["create-ride", "HTAF ride creation is paused", "htaf_ride_creation_blocked"]
  ])("%s fails closed before reading the application", async (action, message, auditAction) => {
    const res = await post(app, action);
    await settle();

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain(message);

    // Nothing about the application was read, and nothing was written or
    // transferred anywhere. The only other tables touched are the HTAF
    // permission check's own: the admin's role and its decision log.
    const PERMISSION_CHECK_TABLES = new Set(["audit_logs", "admin_roles", "admin_rbac_shadow_log"]);
    expect(mockClient._log.filter((e) => !PERMISSION_CHECK_TABLES.has(e.table))).toEqual([]);
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

  test("the admin health detail reports ride creation off and no AI triage", async () => {
    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);

    expect(res.body.features).toMatchObject({ htaf_ride_creation: false });
    expect(res.body.features).not.toHaveProperty("htaf_ai_triage");
  });

  test.each(["false", "0", "off", ""])('HTAF_RIDE_CREATION_ENABLED="%s" stays off', async (value) => {
    const offApp = loadApp({ HTAF_RIDE_CREATION_ENABLED: value });
    const res = await post(offApp, "create-ride");

    expect(res.status).toBe(403);
  });
});

const RIDE_APPROVALS = {
  HTAF_PROVIDER_AGREEMENT_REF: "AGR-TEST-001",
  HTAF_CONFLICT_REVIEW_REF: "Board minutes test item 1",
  HTAF_RIDE_TRANSFER_APPROVED_BY: "Test Board",
  HTAF_RIDE_TRANSFER_APPROVED_AT: "2026-01-01"
};
const TRIAGE_APPROVALS = {
  HTAF_AI_PRIVACY_REVIEW_REF: "PRIV-TEST-001",
  HTAF_AI_TRIAGE_APPROVED_BY: "Test Reviewer",
  HTAF_AI_TRIAGE_APPROVED_AT: "2026-01-01"
};

describe("with a flag set but no approval record", () => {
  test.each([
    ["create-ride", { HTAF_RIDE_CREATION_ENABLED: "true" }, "htaf_ride_creation_blocked"]
  ])("%s stays blocked and the audit row names the missing approvals", async (action, env, auditAction) => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp(env);

    const res = await post(app, action);
    await settle();

    expect(res.status).toBe(403);
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
    const audit = mockClient._state.audit_logs.find((a) => a.action === auditAction);
    expect(audit.metadata.reason).toMatch(/^approval record incomplete: /);
  });

  test("the admin health detail lists the missing approvals", async () => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp({ HTAF_RIDE_CREATION_ENABLED: "true" });

    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);

    expect(res.body.features.htaf_ride_creation).toBe(false);
    expect(res.body.htaf_activation.ride_creation).toMatchObject({
      enabled: false,
      missing_approvals: Object.keys(RIDE_APPROVALS)
    });
  });
});

describe("with a flag set and a complete approval record", () => {
  test("create-ride passes the gate to the normal flow", async () => {
    mockClient = createFakeSupabase({ htaf_applications: [], rides: [], audit_logs: [] });
    const app = loadApp({ HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS });

    const res = await post(app, "create-ride");

    // Past the gate: the application lookup runs (and finds nothing).
    expect(res.status).not.toBe(403);
    expect(mockClient._log.some((e) => e.table === "htaf_applications")).toBe(true);
  });

  test("a created ride's audit row carries the approval record that authorized it", async () => {
    mockClient = createFakeSupabase(seed());
    mockClient.rpc = jest.fn(async () => ({
      data: [{ outcome: "created", ride: { id: "RIDE-TEST-1" } }],
      error: null
    }));
    const app = loadApp({ HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS });

    const res = await post(app, "create-ride");
    await settle();

    expect(res.status).toBe(201);
    const audit = mockClient._state.audit_logs.find((a) => a.action === "htaf_application_converted_to_ride");
    expect(audit.metadata.approval).toEqual(RIDE_APPROVALS);
  });

  test("the removed external AI triage rejects every invocation, whatever the settings", async () => {
    for (const env of [
      {},
      { HTAF_AI_TRIAGE_ENABLED: "true" },
      { HTAF_AI_TRIAGE_ENABLED: "true", OPENAI_API_KEY: "sk-test-not-used", ...TRIAGE_APPROVALS },
      { HTAF_AI_TRIAGE_ENABLED: "true", OPENAI_API_KEY: "sk-test-not-used", HTAF_RBAC_ENFORCED: "false", ...TRIAGE_APPROVALS }
    ]) {
      mockClient = createFakeSupabase(seed());
      const app = loadApp(env);
      for (const method of ["post", "get", "put", "patch"]) {
        const res = await request(app)[method]("/api/admin/foundation/applications/application-1/triage").set("x-admin-token", process.env.ADMIN_API_TOKEN).send({});
        expect(res.status).toBe(404);
      }
      expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
    }
    // The route, its OpenAI call and its configuration are gone from the code.
    // eslint-disable-next-line global-require
    const source = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
    expect(source).not.toMatch(/applications\/:id\/triage"/);
    expect(source).not.toMatch(/HTAF_AI_TRIAGE_ENABLED|triageHtafApplication|buildHtafTriageFacts/);
  });

  test("the admin health detail shows the approval record in effect", async () => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp({ HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS });

    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);

    expect(res.body.features.htaf_ride_creation).toBe(true);
    expect(res.body.htaf_activation.ride_creation).toMatchObject({ enabled: true, approvals: RIDE_APPROVALS });
  });
});

describe("HTAF ride assistance switches (design only, nothing built)", () => {
  const FUNDING_RECORD = {
    HTAF_PROVIDER_AGREEMENT_REF: "AGR-2026-001",
    HTAF_CONFLICT_REVIEW_REF: "Board minutes 2026-09-30 item 4",
    HTAF_RATE_CARD_APPROVAL_REF: "Board minutes 2026-09-30 item 5",
    HTAF_FUNDING_APPROVED_BY: "Board of Directors",
    HTAF_FUNDING_APPROVED_AT: "2026-09-30"
  };

  test("the admin health detail reports both off by default", async () => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp({});
    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);
    expect(res.body.htaf_activation.ride_assistance).toMatchObject({ enabled: false, reason: "HTAF_FUNDING_ENABLED is off" });
    expect(res.body.htaf_activation.ride_assistance_invoicing).toMatchObject({ enabled: false, charges_htaf: false });
  });

  test("both flags and a complete record still leave them off while nothing is built", async () => {
    mockClient = createFakeSupabase(seed());
    const app = loadApp({ HTAF_FUNDING_ENABLED: "true", HTAF_INVOICING_ENABLED: "true", ...FUNDING_RECORD });
    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);
    expect(res.body.htaf_activation.ride_assistance).toMatchObject({ enabled: false, missing_approvals: [] });
    expect(res.body.htaf_activation.ride_assistance.reason).toMatch(/design only/);
    expect(res.body.htaf_activation.ride_assistance_invoicing).toMatchObject({ enabled: false, charges_htaf: false });
  });
});
