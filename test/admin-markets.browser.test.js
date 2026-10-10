// Admin markets preview (public/admin-markets.html): each market's
// settings and a simulated ride per pilot city. Chromium at phone width.
// Writes screenshots to docs/screenshots/markets/ when MARKET_SCREENSHOTS=1.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-markets.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken } = require("./rideTestHelpers");

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
jest.setTimeout(240000);

const HOST = "harveytaxiservice.test";
const SHOTS = process.env.MARKET_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "markets") : null;

describeWithBrowser("admin markets preview (test mode)", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ riders: [makeRider()], drivers: [makeDriver()], rides: [makeRide()], audit_logs: [], system_flags: [] });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test("each pilot market shows its settings and a simulated ride in local currency, km and local time; nothing is saved", async () => {
    const before = JSON.stringify(mockSupabaseClient._state);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-admin-token": "test-admin-token" } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/admin-markets.html`);
    await page.waitForSelector("[data-testid=market-gh-accra]", { timeout: 20000 });
    expect(await page.textContent("[data-testid=market-us-nashville]")).toContain("Live");
    const expected = { "zw-harare": [/US\$|\$/, /CAT/, /999/], "ng-lagos": [/₦|NGN/, /WAT/, /112/], "gh-accra": [/GH₵|GHS/, /GMT/, /112/] };
    for (const [id, [money, tz, sos]] of Object.entries(expected)) {
      const card = `[data-testid=market-${id}]`;
      expect(await page.textContent(card)).toContain("Test mode — not live");
      expect(await page.textContent(card)).not.toContain("911");
      // eslint-disable-next-line no-await-in-loop
      await page.click(`[data-testid=simulate-${id}]`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForSelector(`[data-testid=ride-${id}]`);
      // eslint-disable-next-line no-await-in-loop
      const ride = await page.textContent(`[data-testid=ride-${id}]`);
      expect(ride).toMatch(money);
      expect(ride).toMatch(/ km /);
      expect(ride).toMatch(tz);
      expect(ride).toMatch(sos);
      expect(ride).not.toContain("911");
      expect(ride).toContain("SIMULATED");
      // eslint-disable-next-line no-await-in-loop
      if (SHOTS) await page.locator(card).screenshot({ path: path.join(SHOTS, `${id}.png`) });
    }
    if (SHOTS) await page.locator("[data-testid=market-us-nashville]").screenshot({ path: path.join(SHOTS, "us-nashville.png") });
    expect(JSON.stringify(mockSupabaseClient._state)).toBe(before);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("cash with driver commission: sandbox preview per pilot market; the US has none; nothing is saved", async () => {
    const before = JSON.stringify(mockSupabaseClient._state);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-admin-token": "test-admin-token" } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/admin-markets.html`);
    await page.waitForSelector("[data-testid=market-gh-accra]", { timeout: 20000 });
    expect(await page.$("[data-testid=cash-preview-us-nashville]")).toBeNull();
    for (const id of ["zw-harare", "ng-lagos", "gh-accra"]) {
      const card = `[data-testid=market-${id}]`;
      expect(await page.textContent(card)).toContain("Cash with driver commission (sandbox)");
      expect(await page.textContent(card)).toContain("Unpaid limit: not set");
      // eslint-disable-next-line no-await-in-loop
      await page.click(`[data-testid=cash-preview-${id}]`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForSelector(`[data-testid=cash-preview-result-${id}]`);
      // eslint-disable-next-line no-await-in-loop
      const text = await page.textContent(`[data-testid=cash-preview-result-${id}]`);
      expect(text).toContain("SANDBOX — no money moves");
      expect(text).toMatch(/Test values only/);
      expect(text).toMatch(/blocked: settle/);
      expect(text).toMatch(/never interrupted/);
      expect(text).toMatch(/Duplicate payment prevented/);
      expect(text).toMatch(/ignored \(unverified\)/);
      expect(text).toMatch(/balance now \D*0[.,]00/);
      // eslint-disable-next-line no-await-in-loop
      if (SHOTS) await page.locator(card).screenshot({ path: path.join(SHOTS, `${id}-cash-preview.png`) });
    }
    const res = await page.evaluate(() => fetch("/api/admin/markets/us-nashville/cash-commission-preview", { headers: { "x-admin-token": "test-admin-token" } }).then((r) => r.status));
    expect(res).toBe(404);
    expect(JSON.stringify(mockSupabaseClient._state)).toBe(before);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("without admin access the page shows nothing but the sign-in prompt", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-markets.html`);
    await page.waitForSelector("#loadErr:not([hidden])", { timeout: 20000 });
    expect(await page.$("[data-testid^=market-]")).toBeNull();
    await context.close();
  });
});
