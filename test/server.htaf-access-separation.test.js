// HTAF access separation (#134): every HTAF application route requires the
// route's HTAF capability from the admin's admin_roles role. Harvey Taxi
// administrators without an HTAF role are denied by default, and every
// decision is recorded.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

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

const ROLE_EMAILS = {
  super_admin: "owner@harvey.example",
  htaf_caseworker: "caseworker@htaf.example",
  dispatcher: "dispatch@harvey.example",
  support: "support@harvey.example",
  finance: "finance@harvey.example",
  compliance: "compliance@harvey.example",
  board: "board.member@htaf.example",
  volunteer: "volunteer@htaf.example"
};
const NO_ROW_EMAIL = "unlisted@harvey.example";

const APPLICATION = {
  id: "application-1",
  application_code: "HTAF-20260101-ABC123",
  first_name: "PrivateFirst",
  last_name: "PrivateLast",
  email: "applicant@example.test",
  phone: "6155550100",
  status: "submitted",
  program_type: "medical",
  created_at: "2026-01-01T00:00:00.000Z"
};

// Each HTAF route with the capability it requires.
const ROUTES = [
  ["get", "/api/admin/foundation/applications", "htaf.applications.read"],
  ["get", "/api/admin/foundation/applications/application-1", "htaf.applications.read_detail"],
  ["patch", "/api/admin/foundation/applications/application-1", "htaf.applications.update"],
  ["post", "/api/admin/foundation/applications/export", "htaf.applications.export"],
  ["get", "/api/admin/foundation/schema-check", "htaf.applications.read"],
  ["post", "/api/admin/foundation/applications/application-1/triage", "htaf.applications.triage"],
  ["post", "/api/admin/foundation/applications/application-1/create-ride", "htaf.rides.create"],
  ["get", "/api/admin/htaf/assistant-questions", "htaf.applications.read"]
];

function sessionCookie(email) {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}

function seed({ roles = true } = {}) {
  return {
    htaf_applications: [{ ...APPLICATION }],
    admin_roles: roles
      ? Object.entries(ROLE_EMAILS).map(([role, email]) => ({ email, role }))
      : [],
    admin_rbac_shadow_log: [],
    htaf_assistant_questions: [],
    audit_logs: [],
    rides: []
  };
}

function loadApp(env = {}) {
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

const call = (app, method, path, withAuth) => withAuth(request(app)[method](path)).send({ status: "under_review" });
const asSession = (email) => (r) => r.set("Cookie", [sessionCookie(email)]);
const asToken = (r) => r.set("x-admin-token", process.env.ADMIN_API_TOKEN);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const isRbacDenial = (res) => res.status === 403 && /HTAF access requires an HTAF role/.test(res.body.error || "");

let app;
beforeAll(() => {
  mockClient = createFakeSupabase(seed());
  app = loadApp();
});
beforeEach(() => {
  mockClient = createFakeSupabase(seed());
});

describe("roles with HTAF capabilities are allowed on every HTAF route", () => {
  test.each(["super_admin", "htaf_caseworker"])("%s", async (role) => {
    for (const [method, path] of ROUTES) {
      const res = await call(app, method, path, asSession(ROLE_EMAILS[role]));
      expect({ route: `${method} ${path}`, denied: isRbacDenial(res) }).toEqual({ route: `${method} ${path}`, denied: false });
    }
  });

  test("the configured owner identity via the admin token is allowed", async () => {
    for (const [method, path] of ROUTES) {
      const res = await call(app, method, path, asToken);
      expect(isRbacDenial(res)).toBe(false);
    }
  });
});

describe("Harvey Taxi and non-HTAF identities are denied on every HTAF route", () => {
  test.each([
    ["dispatcher (taxi admin)", ROLE_EMAILS.dispatcher],
    ["support (taxi admin)", ROLE_EMAILS.support],
    ["finance (taxi admin)", ROLE_EMAILS.finance],
    ["compliance (taxi admin)", ROLE_EMAILS.compliance],
    ["board member (no routine access)", ROLE_EMAILS.board],
    ["volunteer (no role in the model)", ROLE_EMAILS.volunteer],
    ["signed-in admin with no admin_roles row", NO_ROW_EMAIL]
  ])("%s", async (_label, email) => {
    for (const [method, path] of ROUTES) {
      const res = await call(app, method, path, asSession(email));
      expect({ route: `${method} ${path}`, denied: isRbacDenial(res) }).toEqual({ route: `${method} ${path}`, denied: true });
    }
    // Denied before any application record was read or changed.
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
    expect(mockClient._state.htaf_applications[0].status).toBe("submitted");
  });

  test("a denial never includes application data", async () => {
    const res = await call(app, "get", "/api/admin/foundation/applications", asSession(ROLE_EMAILS.dispatcher));
    const body = JSON.stringify(res.body);
    for (const value of ["PrivateFirst", "PrivateLast", "applicant@example.test", "6155550100", "HTAF-20260101-ABC123"]) {
      expect(body).not.toContain(value);
    }
  });
});

describe("every decision is auditable", () => {
  test("allowed and denied requests are both recorded with identity, route, capability and role", async () => {
    await call(app, "get", "/api/admin/foundation/applications", asSession(ROLE_EMAILS.htaf_caseworker));
    await call(app, "get", "/api/admin/foundation/applications", asSession(ROLE_EMAILS.dispatcher));
    await settle();

    const log = mockClient._state.admin_rbac_shadow_log;
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_email: ROLE_EMAILS.htaf_caseworker,
          route: "GET /api/admin/foundation/applications",
          required_capability: "htaf.applications.read",
          resolved_role: "htaf_caseworker",
          would_allow: true
        }),
        expect.objectContaining({
          actor_email: ROLE_EMAILS.dispatcher,
          resolved_role: "dispatcher",
          would_allow: false
        })
      ])
    );
    expect(JSON.stringify(log)).not.toContain("PrivateFirst");

    const denial = mockClient._state.audit_logs.find((a) => a.action === "htaf_access_denied");
    expect(denial).toMatchObject({
      actor_id: ROLE_EMAILS.dispatcher,
      entity_id: "GET /api/admin/foundation/applications",
      metadata: { capability: "htaf.applications.read", role: "dispatcher" }
    });
  });
});

describe("role lookup failure", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed(), {
      failSelect: (table) => (table === "admin_roles" ? { code: "XX000", message: "db down" } : null)
    });
  });

  test("denies an ordinary HTAF role holder (fails closed)", async () => {
    const res = await call(app, "get", "/api/admin/foundation/applications", asSession(ROLE_EMAILS.htaf_caseworker));
    expect(isRbacDenial(res)).toBe(true);
  });

  test("keeps the configured owner identity working (no lockout)", async () => {
    const res = await call(app, "get", "/api/admin/foundation/applications", asToken);
    expect(isRbacDenial(res)).toBe(false);
  });
});

describe("HTAF_RBAC_ENFORCED=false (emergency rollback)", () => {
  test("lets the request through but still records that it would have been denied", async () => {
    const logOnlyApp = loadApp({ HTAF_RBAC_ENFORCED: "false" });

    const res = await call(logOnlyApp, "get", "/api/admin/foundation/applications", asSession(ROLE_EMAILS.dispatcher));
    await settle();

    expect(isRbacDenial(res)).toBe(false);
    expect(mockClient._state.admin_rbac_shadow_log).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor_email: ROLE_EMAILS.dispatcher, would_allow: false })])
    );
  });
});

describe("unauthenticated requests", () => {
  test("still get 401 from requireAdmin before any role check", async () => {
    for (const [method, path] of ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    }
  });
});
