// Composition/integration tests proving the sanitized CORS-rejection
// diagnostics actually reach audit_logs end-to-end through the real
// Express app -- lib/corsOrigins.test.js already proves the pure
// parsing/error-building functions in isolation, but only a real
// request through app.use(cors(...)) and the global error handler
// proves nothing upstream re-adds the raw Origin, IP, or User-Agent
// along the way.
//
// This exercises production CORS behavior specifically, so it sets
// NODE_ENV = "production" itself (every other test file in this repo
// already claims NODE_ENV for its own needs at the top of its own
// file, e.g. server.review-accounts.test.js sets "test" -- each file
// is expected to set what it needs rather than assume a prior file's
// value, since Jest workers can run more than one file).

process.env.NODE_ENV = "production";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.RENDER_GIT_COMMIT = "test-build-sha-1234";
// Left unset deliberately, matching the real incident's Render
// configuration: no ALLOWED_ORIGINS/CANONICAL_HOST/FOUNDATION_HOST set,
// so the default allow-list (harveytaxiservice.com + foundation host +
// APP_BASE_URL) is what's under test.
delete process.env.ALLOWED_ORIGINS;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ audit_logs: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function latestCorsAuditRow() {
  const rows = mockSupabaseClient._state.audit_logs || [];
  return rows
    .filter((row) => row.action === "server_error" && row.metadata && row.metadata.message === "CORS origin blocked")
    .pop();
}

describe("CORS rejection -- sanitized diagnostics reach audit_logs", () => {
  test("an allowed origin (the platform's own canonical domain) is not rejected", async () => {
    const res = await request(app).get("/").set("Origin", "https://harveytaxiservice.com");

    expect(res.status).not.toBe(500);
    expect(latestCorsAuditRow()).toBeUndefined();
  });

  test("a disallowed origin is still rejected exactly as before, now with sanitized diagnostics recorded", async () => {
    const res = await request(app)
      .get("/")
      .set("Origin", "https://user:pass@evil.example.com:9999/should/not/appear?q=1#frag");

    expect(res.status).toBe(500);

    const row = latestCorsAuditRow();
    expect(row).toBeDefined();
    expect(row.metadata).toEqual({
      message: "CORS origin blocked",
      path: "/",
      method: "GET",
      origin_scheme: "https",
      origin_hostname: "evil.example.com",
      rejection_reason: "origin_not_in_allowlist",
      build_sha: "test-build-sha-1234"
    });
  });

  test("the audit row never contains the raw Origin, its credentials/port/path/query/fragment, or any secret field", async () => {
    await request(app)
      .get("/")
      .set("Origin", "https://attacker:s3cr3t@rejected.example.com:8443/x?token=abc#y");

    const row = latestCorsAuditRow();
    const serialized = JSON.stringify(row.metadata);

    expect(serialized).not.toContain("attacker");
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).not.toContain("8443");
    expect(serialized).not.toContain("/x?token=abc#y");
    expect(row.metadata.origin_hostname).toBe("rejected.example.com");

    // The row's own ip_address/user_agent columns (populated by the
    // pre-existing auditLog(req) plumbing, unrelated to this fix) are
    // untouched by this change -- what matters here is that the new
    // diagnostic fields this PR adds don't duplicate or leak them into
    // metadata.
    expect(row.metadata.ip_address).toBeUndefined();
    expect(row.metadata.user_agent).toBeUndefined();
  });

  test("a literal null-style Origin is rejected safely and classified distinctly from missing", async () => {
    const res = await request(app).get("/").set("Origin", "null");

    expect(res.status).toBe(500);
    expect(latestCorsAuditRow().metadata.origin_scheme).toBe("null");
    expect(latestCorsAuditRow().metadata.origin_hostname).toBeNull();
  });

  test("a Capacitor/custom-scheme Origin is rejected safely without crashing the middleware", async () => {
    const res = await request(app).get("/").set("Origin", "capacitor://localhost");

    expect(res.status).toBe(500);
    expect(latestCorsAuditRow().metadata).toMatchObject({
      origin_scheme: "capacitor",
      origin_hostname: "localhost",
      rejection_reason: "origin_not_in_allowlist"
    });
  });

  test("a malformed Origin is rejected safely without crashing the middleware", async () => {
    const res = await request(app).get("/").set("Origin", "not-a-url-at-all");

    expect(res.status).toBe(500);
    expect(latestCorsAuditRow().metadata).toMatchObject({
      origin_scheme: "unparseable",
      origin_hostname: null,
      rejection_reason: "origin_not_in_allowlist"
    });
  });
});
