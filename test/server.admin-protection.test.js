// Every admin API route must refuse a request that carries no admin
// session or token, and must not read or change data while refusing.
// The admin HTML pages are public shells, so this server-side check is
// what actually protects admin data and actions. Routes are discovered
// from the running app, so a new admin route is covered automatically.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;
let fake;

beforeAll(() => {
  fake = createFakeSupabase({
    drivers: [{ id: "DRV-1", approval_status: "pending", status: "pending_verification" }],
    riders: [{ id: "RIDER-1" }],
    rides: [{ id: "RIDE-1", status: "completed" }],
    system_flags: [],
    audit_logs: []
  });
  mockSupabaseClient = fake;
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

// Sign-in, sign-out and the "am I signed in?" check have to work without
// a session; they are checked separately below.
// The authenticator step (verify-code) needs a signed challenge from a
// correct password instead; test/server.security-intel.test.js covers it.
const PUBLIC_ADMIN_AUTH_ROUTES = new Set(["post /api/admin/login", "post /api/admin/login/verify-code", "post /api/admin/logout", "get /api/admin/session"]);

// Each request comes from its own address, so the general per-address
// API rate limit (120 a minute) never answers before the auth check does.
let callerIp = 0;
const nextIp = () => { callerIp += 1; return `10.20.${Math.floor(callerIp / 250)}.${(callerIp % 250) + 1}`; };

function adminRoutes() {
  const routes = [];
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      if (typeof p !== "string" || !p.startsWith("/api/admin")) continue;
      for (const method of Object.keys(layer.route.methods)) {
        if (PUBLIC_ADMIN_AUTH_ROUTES.has(`${method} ${p}`)) continue;
        routes.push({ method, path: p.replace(/:([A-Za-z_]+)/g, "TEST_$1") });
      }
    }
  }
  return routes;
}

describe("admin API routes require admin authentication", () => {
  const routes = () => adminRoutes();

  test("there are admin routes to check", () => {
    expect(routes().length).toBeGreaterThan(40);
  });

  test("every admin route refuses a request with no credentials and changes nothing", async () => {
    const before = JSON.stringify(fake._state);
    const allowed = [];
    for (const { method, path } of routes()) {
      const res = await request(app)[method](path).set("CF-Connecting-IP", nextIp()).send({ status: "approved", driver_id: "DRV-1", value: "true" });
      if (![401, 403].includes(res.status)) allowed.push(`${method.toUpperCase()} ${path} -> ${res.status}`);
    }
    expect(allowed).toEqual([]);
    const after = JSON.parse(JSON.stringify(fake._state));
    // Refusals may log a failed attempt; nothing else may change.
    delete after.audit_logs;
    const beforeState = JSON.parse(before);
    delete beforeState.audit_logs;
    expect(after).toEqual(beforeState);
  });

  test("the session check reports signed out without a session", async () => {
    const res = await request(app).get("/api/admin/session").set("CF-Connecting-IP", nextIp());
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test("sign-in with wrong details does not sign in", async () => {
    const res = await request(app).post("/api/admin/login").set("CF-Connecting-IP", nextIp()).send({ email: "x@example.test", password: "wrong" });
    expect(res.status).not.toBe(200);
    expect(res.headers["set-cookie"] || []).toEqual([]);
  });

  test("a wrong admin token is refused too", async () => {
    const res = await request(app).get("/api/admin/drivers").set("CF-Connecting-IP", nextIp()).set("x-admin-token", "not-the-token");
    expect([401, 403]).toContain(res.status);
  });
});

describe("admin pages", () => {
  test("carry a noindex header", async () => {
    const res = await request(app).get("/admin-dashboard.html");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("the home page has no admin link", async () => {
    const res = await request(app).get("/");
    expect(res.text).not.toMatch(/href="[^"]*admin[^"]*"/i);
  });
});
