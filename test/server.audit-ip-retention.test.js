// Audit-log IP retention (owner decision 2026-10-22: built switched off).
// Clears IP address and user agent on audit rows older than 90 days and
// keeps the rows; does nothing while switched off or under a legal hold;
// the admin view only counts.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.setTimeout(60_000);

const ADMIN = { "x-admin-token": "test-admin-token" };
const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
let app;
let runAuditIpRetention;
let ip = 0;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app, runAuditIpRetention } = require("../server"));
});

function rows() {
  return [
    { id: 1, action: "driver_signup_created", ip_address: "203.0.113.1", user_agent: "UA", metadata: {}, created_at: daysAgo(120) },
    { id: 2, action: "htaf_application_created", ip_address: null, user_agent: "UA", metadata: {}, created_at: daysAgo(95) },
    { id: 3, action: "ride_estimate_created", ip_address: "203.0.113.3", user_agent: "UA", metadata: {}, created_at: daysAgo(30) },
    { id: 4, action: "login", ip_address: null, user_agent: null, metadata: {}, created_at: daysAgo(200) }
  ];
}

function reset(flags = []) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, { audit_logs: rows(), system_flags: flags });
}

const flag = (key, value) => ({ key, value });
const audit = () => mockSupabaseClient._state.audit_logs;
const call = (path, headers) => request(app).get(path).set("X-Forwarded-For", `10.94.0.${++ip}`).set(headers || {});

test("switched off by default: nothing changes", async () => {
  reset();
  const result = await runAuditIpRetention();
  expect(result).toMatchObject({ skipped: true, reason: "switched_off" });
  expect(audit()).toEqual(rows());
});

test("a legal hold pauses it even when switched on", async () => {
  reset([flag("audit_ip_retention_enabled", "true"), flag("retention_legal_hold", "true")]);
  expect(await runAuditIpRetention()).toMatchObject({ skipped: true, reason: "legal_hold" });
  expect(audit()).toEqual(rows());
});

test("switched on: clears IP and user agent older than 90 days, keeps the rows, records counts only", async () => {
  reset([flag("audit_ip_retention_enabled", "true")]);
  const result = await runAuditIpRetention({ trigger: "test" });
  expect(result.cleared).toBe(2);
  const byId = Object.fromEntries(audit().map((r) => [r.id, r]));
  expect(byId[1]).toMatchObject({ ip_address: null, user_agent: null, action: "driver_signup_created" });
  expect(byId[2]).toMatchObject({ ip_address: null, user_agent: null });
  expect(byId[3]).toMatchObject({ ip_address: "203.0.113.3", user_agent: "UA" });
  const record = audit().find((r) => r.action === "retention_audit_ip_cleared");
  expect(record.metadata).toMatchObject({ cleared: 2, retention_days: 90, mode: "live", trigger: "test" });
  expect(JSON.stringify(record.metadata)).not.toMatch(/203\.0\.113/);
  // A second run finds nothing and writes no record.
  expect((await runAuditIpRetention()).cleared).toBe(0);
  expect(audit().filter((r) => r.action === "retention_audit_ip_cleared")).toHaveLength(1);
});

test("admin view is staff-only and counts without changing anything", async () => {
  reset();
  expect((await call("/api/admin/retention/audit-ip")).status).toBe(401);
  const res = await call("/api/admin/retention/audit-ip", ADMIN);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ enabled: false, legal_hold: false, retention_days: 90, eligible: 2, last_run: null });
  expect(audit()).toEqual(rows());
});
