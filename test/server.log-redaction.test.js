// The global error handler and the audit-log failure warning write only
// structured, allowlisted fields (lib/safeLog.js): no raw messages, query
// strings, bodies, headers or Postgres details, in the server log or in
// audit_logs.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const PII = ["jane.doe@example.test", "6155550100", "615-555-0100", "Jane", "Oak Street", "Bearer", "secret-token", "search=", "duplicate key"];
const DB_ERROR = { code: "23505", message: "duplicate key value violates unique constraint \"x\" Key (email)=(jane.doe@example.test) already exists. Jane Doe, 12 Oak Street, 615-555-0100", details: "Key (email)=(jane.doe@example.test) already exists." };

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

test("server error: only error code, class, route template and method, in both console and audit_logs", async () => {
  mockClient = createFakeSupabase({ htaf_applications: [], audit_logs: [], admin_roles: [] }, { failSelect: (table) => (table === "htaf_applications" ? DB_ERROR : null) });
  const errors = [];
  const spy = jest.spyOn(console, "error").mockImplementation((...args) => errors.push(JSON.stringify(args)));
  try {
    const res = await request(app)
      .get("/api/admin/foundation/applications?search=jane.doe@example.test&phone=6155550100&name=Jane")
      .set("x-admin-token", "test-admin-token")
      .set("Authorization", "Bearer secret-token");
    expect(res.status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  await new Promise((r) => setTimeout(r, 20));
  const logged = errors.join("\n");
  const audit = JSON.stringify(mockClient._state.audit_logs.filter((a) => a.action === "server_error"));
  expect(logged).toContain("SERVER ERROR");
  expect(audit).toContain("server_error");
  for (const text of [logged, audit]) {
    for (const value of PII) expect(text).not.toContain(value);
    expect(text).toContain("db_23505");
    expect(text).toContain("/api/admin/foundation/applications");
  }
});

test("audit-log write failure warning carries only the action and an error code", async () => {
  mockClient = createFakeSupabase(
    { htaf_applications: [], audit_logs: [], admin_roles: [] },
    { failSelect: (table) => (table === "htaf_applications" ? DB_ERROR : null), failInsert: (table) => (table === "audit_logs" ? DB_ERROR : null) }
  );
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  const warnings = [];
  const spy = jest.spyOn(console, "warn").mockImplementation((...args) => warnings.push(JSON.stringify(args)));
  try {
    await request(app).get("/api/admin/foundation/applications").set("x-admin-token", "test-admin-token");
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    spy.mockRestore();
    quiet.mockRestore();
  }
  const skipped = warnings.filter((w) => w.includes("Audit log skipped"));
  expect(skipped.length).toBeGreaterThan(0);
  expect(skipped.join("")).toContain("db_23505");
  for (const w of skipped) for (const value of PII) expect(w).not.toContain(value);
});

test("the server_error audit row has exactly the allowlisted metadata keys and no IP or user agent", async () => {
  mockClient = createFakeSupabase({ htaf_applications: [], audit_logs: [], admin_roles: [] }, { failSelect: (table) => (table === "htaf_applications" ? DB_ERROR : null) });
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await request(app).get("/api/admin/foundation/applications?x=1").set("x-admin-token", "test-admin-token").set("User-Agent", "JaneDoeBrowser");
  } finally {
    quiet.mockRestore();
  }
  await new Promise((r) => setTimeout(r, 20));
  const row = mockClient._state.audit_logs.find((a) => a.action === "server_error");
  expect(Object.keys(row.metadata).sort()).toEqual(["error_class", "error_code", "method", "route"]);
  expect(row.ip_address == null).toBe(true);
  expect(row.user_agent == null).toBe(true);
});
