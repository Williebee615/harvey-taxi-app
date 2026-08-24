// Composition/integration test for the RENDER_EXTERNAL_HOSTNAME CORS
// fix, through the real Express app and the real `cors` package --
// lib/corsOrigins.test.js already proves isAllowedOrigin/
// buildDefaultAllowedOrigins in isolation, but only a real request
// through app.use(cors(...)) proves the actual response still carries
// Access-Control-Allow-Credentials for this newly-allowed origin (i.e.
// that fixing the allow-list gap didn't touch the separate
// `credentials: true` CORS option in server.js).
//
// Its own file, with its own RENDER_EXTERNAL_HOSTNAME set at import
// time, for the same reason server.review-login-ratelimit.test.js is
// its own file: server.js is require()'d once per file in `beforeAll`,
// so a distinct env-var scenario needs a distinct file rather than
// mutating process.env after another file already required it.

process.env.NODE_ENV = "production";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.RENDER_GIT_COMMIT = "test-build-sha-5678";
process.env.RENDER_EXTERNAL_HOSTNAME = "harvey-taxi-app-2.onrender.com";
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

describe("CORS -- RENDER_EXTERNAL_HOSTNAME origin fix, through the real app", () => {
  test("the service's own Render-assigned origin is allowed, with credentialed CORS headers intact", async () => {
    const res = await request(app).get("/").set("Origin", "https://harvey-taxi-app-2.onrender.com");

    expect(res.status).not.toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBe("https://harvey-taxi-app-2.onrender.com");
    // Confirms the pre-existing `credentials: true` cors() option is
    // untouched by this fix -- a credentialed fetch() from this origin
    // still works exactly as it does for the canonical domain.
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("an unrelated onrender.com service is still rejected -- no wildcard introduced", async () => {
    const res = await request(app).get("/").set("Origin", "https://some-other-app.onrender.com");

    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("the canonical domain is still allowed, with the same credentialed headers, alongside the Render origin", async () => {
    const res = await request(app).get("/").set("Origin", "https://harveytaxiservice.com");

    expect(res.status).not.toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBe("https://harveytaxiservice.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
