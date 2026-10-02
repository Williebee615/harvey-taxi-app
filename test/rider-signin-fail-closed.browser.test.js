// Regression: a failed sign-in configuration check must never be treated
// as "sign-in disabled". With rider_auth_ui_enabled ON, a 429, a server
// error, a timeout, a network failure or a malformed reply on
// /api/rider/auth-ui-config (or a transient failure of the session check)
// shows a "Try again" state -- never the signed-out rider experience --
// and the retry then reaches the real sign-in screen. Server-side access
// controls are unchanged (asserted separately: rider routes still 401).
// Needs Playwright and Chromium; skips without them.

process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let chromium = null;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";

describeWithBrowser("rider sign-in check fails closed", () => {
  let server;
  let browser;
  let base;
  let app;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      system_flags: [{ key: "rider_auth_ui_enabled", value: "true" }],
      riders: [makeRider()],
      rides: [],
      audit_logs: []
    });
    ({ app } = require("../server"));
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function openWith(failure) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    const riderDataCalls = [];
    page.on("request", (req) => {
      const p = new URL(req.url()).pathname;
      if (/^\/api\/(rider\/(status|history|saved-places|payment-methods)|rides\/(active|history))/.test(p)) riderDataCalls.push(p);
    });
    page.riderDataCalls = riderDataCalls;
    await failure(page);
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    return page;
  }

  const shows = async (page) => ({
    retry: await page.isVisible("#authCheckRetry"),
    signIn: await page.isVisible("#riderAuthOverlay")
  });

  const FAILURES = {
    "429 on the config check": (page) =>
      page.route("**/api/rider/auth-ui-config", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Too many requests." }), headers: { "Retry-After": "30" } })),
    "500 on the config check": (page) => page.route("**/api/rider/auth-ui-config", (r) => r.fulfill({ status: 500, body: "error" })),
    "timeout on the config check": (page) => page.route("**/api/rider/auth-ui-config", (r) => r.abort("timedout")),
    "network failure on the config check": (page) => page.route("**/api/rider/auth-ui-config", (r) => r.abort("failed")),
    "malformed reply on the config check": (page) => page.route("**/api/rider/auth-ui-config", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "<html>proxy page</html>" })),
    "reply without a boolean": (page) => page.route("**/api/rider/auth-ui-config", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })),
    "429 on the session check": (page) => page.route("**/api/rider/session", (r) => r.fulfill({ status: 429, body: "{}" })),
    "503 on the session check": (page) => page.route("**/api/rider/session", (r) => r.fulfill({ status: 503, body: "{}" }))
  };

  test.each(Object.keys(FAILURES))("%s: retry state, no signed-out experience, then sign-in after retry", async (name) => {
    const page = await openWith(FAILURES[name]);
    expect(await shows(page)).toEqual({ retry: true, signIn: false });
    expect(page.riderDataCalls).toEqual([]);
    expect(await page.textContent("#authCheckRetry")).toMatch(/couldn't check your sign-in/);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.click("#authCheckRetryBtn");
    await page.waitForSelector("#riderAuthOverlay", { state: "visible" });
    expect(await shows(page)).toEqual({ retry: false, signIn: true });
    expect(page.errors).toEqual([]);
  });

  test("a real server answer still works: sign-in screen when on, signed-out experience only when the server says off", async () => {
    const on = await openWith(async () => {});
    expect(await shows(on)).toEqual({ retry: false, signIn: true });
    mockSupabaseClient._state.system_flags[0].value = "false";
    const off = await openWith(async () => {});
    expect(await shows(off)).toEqual({ retry: false, signIn: false });
    mockSupabaseClient._state.system_flags[0].value = "true";
  });

  test("server-side access control is independent of the client check", async () => {
    const request = require("supertest");
    expect((await request(app).get("/api/rider/session")).status).toBe(401);
    expect([401, 403]).toContain((await request(app).post("/api/rides/X/cancel").send({})).status);
  });
});
