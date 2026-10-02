// Browser check for public/admin-login.html: it signs in through the real
// POST /api/admin/login (HttpOnly session cookie), redirects only to a
// same-site admin page, and shows the server's error on a bad password.
// Earlier it posted to /api/admin-login, which does not exist, so signing
// in there never worked.
//
// Needs Playwright and a Chromium build; skips without them (CI does not
// install a browser). Run locally with, for example:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-login-page.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "ops@harveytaxiservice.test";
process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}

const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";

describeWithBrowser("admin-login.html", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ system_flags: [{ key: "dispatch_paused", value: "false" }], audit_logs: [] });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    return { context, page };
  }

  async function signIn(page, password) {
    await page.fill("#email", process.env.ADMIN_EMAIL);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
  }

  test("wrong password shows the server error and sets no session", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/admin-login.html`);
    await signIn(page, "wrong-password");
    await page.waitForSelector("#statusMessage.show");
    expect(await page.textContent("#statusMessage")).toMatch(/Invalid admin email or password/);
    expect(await page.inputValue("#password")).toBe("");
    expect((await context.cookies()).find((c) => c.name === "htaf_admin_session")).toBeUndefined();
    expect(page.url()).toBe(`${base}/admin-login.html`);
  });

  test("correct password sets the HttpOnly session and opens the dashboard signed in", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/admin-login.html`);
    await signIn(page, process.env.ADMIN_PASSWORD);
    await page.waitForURL(`${base}/admin-dashboard.html`);
    const cookie = (await context.cookies()).find((c) => c.name === "htaf_admin_session");
    expect(cookie).toBeDefined();
    expect(cookie.httpOnly).toBe(true);
    await page.waitForFunction(() => document.getElementById("adminSessionStatus").textContent.startsWith("Signed in as"));
    // The password never lands in browser storage.
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(process.env.ADMIN_PASSWORD || "correct-horse");
    expect(page.errors).toEqual([]);
  });

  test("?next= returns to a same-site admin page only", async () => {
    const ok = await newPage();
    await ok.page.goto(`${base}/admin-login.html?next=/admin-agent.html`);
    await signIn(ok.page, process.env.ADMIN_PASSWORD);
    await ok.page.waitForURL(`${base}/admin-agent.html`);

    for (const next of ["//evil.example/admin.html", "https://evil.example/", "/rider-dashboard.html", "javascript:alert(1)"]) {
      const { page } = await newPage();
      await page.goto(`${base}/admin-login.html?next=${encodeURIComponent(next)}`);
      await signIn(page, process.env.ADMIN_PASSWORD);
      await page.waitForURL(`${base}/admin-dashboard.html`);
    }
  });
});
