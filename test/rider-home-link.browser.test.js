// Rider dashboard "Home" (owner report, 2026-10-12): on the website it goes
// to the site's home page; inside the rider app (user agent tagged
// "HarveyTaxiRider/<version> (ios|android)") the dashboard stays the home
// screen. "Rider" always stays on the dashboard. Chromium; fake database.
//   NODE_PATH="$(npm root -g)" npx jest test/rider-home-link.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
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
const APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 HarveyTaxiRider/1.0.2 (ios)";

describeWithBrowser("rider dashboard Home button", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ riders: [], drivers: [], rides: [], audit_logs: [], system_flags: [] });
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
      await new Promise((r) => server.close(r));
    }
  });

  async function openDashboard(userAgent) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(userAgent ? { userAgent } : {}) });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    return { context, page };
  }

  test("on the website, the bottom-nav Home goes to the home page", async () => {
    const { context, page } = await openDashboard();
    await Promise.all([page.waitForURL(`${base}/`), page.click('.bottom-nav .nav-btn:has-text("Home")')]);
    const path = new URL(page.url()).pathname;
    await context.close();
    expect(path).toBe("/");
  });

  test("on the website, the top Home chip goes to the home page too", async () => {
    const { context, page } = await openDashboard();
    await Promise.all([page.waitForURL(`${base}/`), page.click('.top-chip[data-action="home"]')]);
    await context.close();
  });

  test("on the website, Rider stays on the dashboard", async () => {
    const { context, page } = await openDashboard();
    await page.click('.bottom-nav .nav-btn:has-text("Rider")');
    await page.waitForTimeout(500);
    const path = new URL(page.url()).pathname;
    await context.close();
    expect(path).toBe("/rider-dashboard.html");
  });

  test("inside the rider app, Home stays on the dashboard", async () => {
    const { context, page } = await openDashboard(APP_UA);
    await page.click('.bottom-nav .nav-btn:has-text("Home")');
    await page.waitForTimeout(500);
    const path = new URL(page.url()).pathname;
    await context.close();
    expect(path).toBe("/rider-dashboard.html");
  });
});
