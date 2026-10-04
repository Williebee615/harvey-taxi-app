// Browser check for admin sign-in: /admin-login.html posts to the real
// session route (/api/admin/login), rejects wrong credentials, keeps the
// HttpOnly session across reloads and pages, returns the admin to the page
// that sent them (same site only), and opens the Claude model panel on
// /admin-agent.html. Credentials here are test fixtures.
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-login.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "test-fixture-admin-password";
delete process.env.ADMIN_API_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver } = require("./rideTestHelpers");
const { modelBudgetRpc } = require("./agentModelBudgetFake");

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

describeWithBrowser("admin sign-in", () => {
  let server;
  let browser;
  let base;
  let ip = 10;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase(
      {
        riders: [makeRider()],
        drivers: [makeDriver()],
        rides: [],
        driver_offers: [],
        audit_logs: [],
        agent_model_usage: [],
        system_flags: [
          { key: "agent_assist_enabled", value: "true" },
          { key: "agent_kill_switch", value: "false" },
          { key: "agent_model_mode", value: "test_accounts" },
          { key: "agent_model_test_accounts", value: JSON.stringify(["rider:RIDER_GPLAY_REVIEWER", "driver:DRIVER_GPLAY_REVIEWER"]) }
        ]
      },
      { rpc: modelBudgetRpc() }
    );
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

  // Each context gets its own client IP so the sign-in limit is per test.
  async function newContext() {
    ip += 1;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${ip}` } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    return context;
  }

  async function newPage(context) {
    const page = await context.newPage();
    page.errors = [];
    page.requests = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    page.on("request", (req) => page.requests.push(`${req.method()} ${new URL(req.url()).pathname}`));
    return page;
  }

  async function signIn(page, password) {
    await page.fill("#email", "admin@example.test");
    await page.fill("#password", password);
    await page.click("button[type=submit]");
  }

  test("signed out, the Command Center's Sign in link returns to it after sign-in; wrong password is rejected", async () => {
    const context = await newContext();
    const page = await newPage(context);

    await page.goto(`${base}/admin-agent.html`);
    await page.waitForSelector("#authNotice:not([hidden])");
    expect(await page.textContent("#claudeStatus")).toBe("Model status is unavailable right now.");
    await page.click("#authNotice a");
    await page.waitForURL(/\/admin-login\.html\?next=\/admin-agent\.html$/);

    await signIn(page, "wrong-password");
    await page.waitForSelector("#statusMessage.show.error");
    expect(await page.textContent("#statusMessage")).toBe("Invalid admin email or password.");
    expect(await page.inputValue("#password")).toBe("");
    expect(page.url()).toMatch(/\/admin-login\.html/);
    expect((await context.cookies()).some((c) => c.name === "htaf_admin_session")).toBe(false);

    await signIn(page, "test-fixture-admin-password");
    await page.waitForURL(/\/admin-agent\.html$/);
    await page.waitForFunction(() => /Mode: test_accounts/.test((document.getElementById("claudeStatus") || {}).textContent));
    expect(await page.isHidden("#authNotice")).toBe(true);
    expect(await page.textContent("#claudeStatus")).toMatch(/^Not connected: no API key is set on the server/);
    expect(await page.textContent("#modelBudget")).toMatch(/Monthly budget\$10\.00/);
    expect(await page.inputValue("#modelMode")).toBe("test_accounts");
    expect(await page.evaluate(() => document.getElementById("modelModeAll").disabled)).toBe(true);
    expect(await page.inputValue("#modelAccounts")).toBe("rider:RIDER_GPLAY_REVIEWER\ndriver:DRIVER_GPLAY_REVIEWER");

    // Free connection check is reachable from the panel (no key in this test server).
    await page.click("#claudeCheckBtn");
    await page.waitForFunction(() => /No API key is set/.test(document.getElementById("claudeCheckOut").textContent));

    // The session is an HttpOnly cookie, never browser storage.
    const cookie = (await context.cookies()).find((c) => c.name === "htaf_admin_session");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toMatch(/password|test-fixture/i);
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/htaf_admin_session/);

    // Persists across a reload and to other admin pages.
    await page.reload();
    await page.waitForFunction(() => /Mode: test_accounts/.test((document.getElementById("claudeStatus") || {}).textContent));
    expect(await page.isHidden("#authNotice")).toBe(true);
    const other = await newPage(context);
    await other.goto(`${base}/admin-login.html?next=/admin-knowledge.html`);
    await other.waitForURL(/\/admin-knowledge\.html$/);

    // The broken route is never called.
    expect(page.requests.filter((r) => r.includes("/api/admin-login"))).toEqual([]);
    expect(page.requests).toContain("POST /api/admin/login");
    expect(page.errors).toEqual([]);

    // Sign-out ends the session.
    await page.evaluate(() => fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }));
    await page.reload();
    await page.waitForSelector("#authNotice:not([hidden])");
    await context.close();
  });

  test("next only goes to a page on this site", async () => {
    for (const next of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
      const context = await newContext();
      const page = await newPage(context);
      await page.goto(`${base}/admin-login.html?next=${encodeURIComponent(next)}`);
      await signIn(page, "test-fixture-admin-password");
      await page.waitForURL(/\/admin-dashboard\.html$/);
      expect(new URL(page.url()).host).toBe(new URL(base).host);
      await context.close();
    }
  });
});
