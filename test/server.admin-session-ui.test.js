// /api/health returns deployment detail (integrations, feature flags,
// table preflight) only to an authenticated admin; public callers get
// up/down only. The admin dashboard asks the server whether it is signed
// in before requesting any admin data, and offers a real sign-out.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ system_flags: [{ key: "dispatch_paused", value: "false" }] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

// Same token format as signAdminSession() in server.js.
function adminSessionCookie() {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email: "ops@example.test", iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}

describe("GET /api/health", () => {
  test("public callers get up/down only -- no integrations, feature flags or table preflight", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("database");
    expect(res.body).not.toHaveProperty("integrations");
    expect(res.body).not.toHaveProperty("features");
    expect(res.body).not.toHaveProperty("preflight");
  });

  test("an invalid admin token or forged cookie is treated as public", async () => {
    const byToken = await request(app).get("/api/health").set("x-admin-token", "wrong");
    const byCookie = await request(app).get("/api/health").set("Cookie", ["htaf_admin_session=forged.value"]);

    for (const res of [byToken, byCookie]) {
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("integrations");
    }
  });

  test.each([
    ["admin session cookie", (r) => r.set("Cookie", [adminSessionCookie()])],
    ["admin token", (r) => r.set("x-admin-token", process.env.ADMIN_API_TOKEN)]
  ])("an admin (%s) gets the full detail", async (_label, withAdmin) => {
    const res = await withAdmin(request(app).get("/api/health"));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("integrations");
    expect(res.body).toHaveProperty("features");
    expect(res.body).toHaveProperty("preflight");
  });
});

describe("GET /api/admin/session and POST /api/admin/logout", () => {
  test("session reports signed out without a cookie, and signed in with one", async () => {
    const out = await request(app).get("/api/admin/session");
    const inn = await request(app).get("/api/admin/session").set("Cookie", [adminSessionCookie()]);

    expect(out.body).toMatchObject({ ok: true, authenticated: false });
    expect(out.body).not.toHaveProperty("admin");
    expect(inn.body).toMatchObject({ ok: true, authenticated: true, admin: { email: "ops@example.test" } });
  });

  test("logout clears the session cookie", async () => {
    const res = await request(app).post("/api/admin/logout").set("Cookie", [adminSessionCookie()]);
    const setCookie = (res.headers["set-cookie"] || []).join(";");

    expect(res.status).toBe(200);
    expect(setCookie).toMatch(/htaf_admin_session=;|htaf_admin_session=.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
  });
});

describe("admin-dashboard.html session handling", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin-dashboard.html"), "utf8");
  const script = html.slice(html.lastIndexOf("<script>"));

  test("has a Sign Out control wired to the server logout", () => {
    expect(html).toMatch(/id="adminLogoutBtn"[^>]*>Sign Out</);
    expect(script).toContain('$("adminLogoutBtn").onclick=adminLogout;');
    expect(script).toMatch(/fetch\(API_BASE \+ "\/api\/admin\/logout", \{ method:"POST", credentials:"include" \}\)/);
  });

  test("checks the session before loading any admin data", () => {
    expect(script).toContain('fetch(API_BASE + "/api/admin/session"');
    expect(script).toContain("refreshSession().then(signedIn=>{ if(signedIn) loadDashboard(); });");
    // No unconditional loadDashboard() at start-up any more.
    expect(script).not.toMatch(/^loadDashboard\(\);$/m);
    expect(script).toMatch(/if\(signedIn && state\.auto\) loadDashboard\(\);/);
  });

  test("shows who is signed in and hides the password form while signed in", () => {
    expect(script).toContain('"Signed in as " + email');
    expect(script).toContain('$("adminLoginFields").style.display = state.signedIn ? "none" : "";');
  });

  test("drops rendered data when a session ends", () => {
    expect(script).toContain("if (wasSignedIn && !state.signedIn) window.location.reload();");
  });

  test("never persists the admin password", () => {
    expect(script).not.toMatch(/localStorage\.setItem\(\s*["']harvey_admin_password/);
  });

  // Browser behaviour is covered in admin-payment-config.browser.test.js
  // (skipped in CI without Chromium); these checks always run.
  test("Payment Configuration viewer uses the session via api() and shows only allow-listed fields", () => {
    expect(html).toMatch(/id="loadPaymentConfigBtn"[^>]*>Load Payment Configuration</);
    expect(script).toContain('await api("/api/admin/payments/config-status"');
    expect(script).toContain("if(!state.signedIn){");
    expect(script).toContain('const STRIPE_ACCOUNT_FIELDS = ["id","display_name","country","charges_enabled","error"];');
    expect(script).toMatch(/pre\.textContent = JSON\.stringify\(clean, null, 2\);/);
    // No token or key handling client-side.
    expect(script).not.toMatch(/x-admin-token|ADMIN_API_TOKEN|localStorage\.setItem\(\s*["'][^"']*(token|stripe|payment)/i);
  });
});
