// The tip and rating page (owner decisions 2026-10-22) in Chromium at phone
// width: switched off it says so; switched on, an App Review trip takes a
// simulated tip (no card) and a rating once. Fixture data only.
//   NODE_PATH="$(npm root -g)" npx jest test/tip-driver.browser
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ORDERS_STRIPE_PUBLISHABLE_KEY = "pk_test_orders";
const { createFakeSupabase } = require("./fakeSupabase");
const { signRiderSession } = require("../lib/riderAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => (mockClient && typeof mockClient[k] === "function" ? mockClient[k].bind(mockClient) : mockClient && mockClient[k]) }) }));
jest.mock("stripe", () => function MockStripe() { return { paymentIntents: { create: async () => { throw new Error("no card in this test"); } } }; });

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

describeWithBrowser("Tip and rate your driver (phone width)", () => {
  let server;
  let browser;
  let base;

  function seed(flags) {
    mockClient = createFakeSupabase({
      riders: [{ id: "RIDER_1", first_name: "Ana", session_version: 0, status: "active", approval_status: "approved", access_revoked: false, deleted_at: null }],
      drivers: [{ id: "DRIVER_1", first_name: "Sam", last_name: "Ortiz" }],
      rides: [{ id: "RIDE-T1", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "completed", is_review_ride: true, tip_amount: null, completed_at: new Date(Date.now() - 3600000).toISOString() }],
      driver_earnings: [{ id: "E1", ride_id: "RIDE-T1", driver_id: "DRIVER_1", driver_base_earning: 20, tip_amount: 0, total_earning: 20, payout_amount: 20 }],
      ride_tips: [],
      driver_ratings: [],
      audit_logs: [],
      push_subscriptions: [],
      system_flags: Object.entries(flags).map(([key, value]) => ({ key, value }))
    }, { uniqueColumns: { driver_ratings: ["ride_id"] } });
  }

  beforeAll(async () => {
    seed({});
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  async function phone() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addCookies([{ name: "harvey_rider_session", value: signRiderSession({ riderId: "RIDER_1", sessionVersion: 0, secret: process.env.RIDER_SESSION_SECRET, ttlHours: 1 }), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.goto(`${base}/tip-driver.html?type=ride&id=RIDE-T1`, { waitUntil: "load" });
    return { context, page };
  }

  test("switched off: the page loads and says tipping isn't available; no rating form", async () => {
    seed({});
    const { context, page } = await phone();
    await page.waitForFunction(() => /isn't available/.test(document.getElementById("tipStatus").textContent));
    expect(await page.isVisible("#tipButton")).toBe(false);
    expect(await page.isVisible("#rateCard")).toBe(false);
    expect(await page.textContent("#title")).toBe("Your driver, Sam");
    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("switched on, App Review trip: simulated tip, then a rating, each once", async () => {
    seed({ ride_tips_enabled: "true", driver_ratings_enabled: "true" });
    const { context, page } = await phone();
    await page.waitForSelector("#tipChips button");
    expect(await page.isVisible("#simNotice")).toBe(true);
    expect(await page.locator("#tipChips button").allTextContents()).toEqual(["$2", "$5", "$10", "Custom"]);

    await page.click("#tipChips button:has-text('Custom')");
    await page.fill("#tipCustom", "7.50");
    await page.click("#tipButton");
    await page.waitForFunction(() => /7\.50 tip was added \(simulated\)/.test(document.getElementById("tipIntro").textContent));
    expect(mockClient._state.ride_tips[0]).toMatchObject({ status: "simulated", amount_cents: 750 });
    expect(mockClient._state.driver_earnings[0]).toMatchObject({ tip_amount: 7.5, total_earning: 27.5 });

    await page.click("#stars button[aria-label='4 stars']");
    // Chosen stars are gold; the rest are visibly dimmer.
    const colors = await page.$$eval("#stars button", (bs) => bs.map((b) => getComputedStyle(b).color));
    expect(colors.slice(0, 4).every((c) => c === "rgb(255, 217, 114)")).toBe(true);
    expect(colors[4]).not.toBe("rgb(255, 217, 114)");
    await page.click("#tagChips button:has-text('Friendly')");
    await page.fill("#comment", "Kind and careful.");
    await page.click("#rateButton");
    await page.waitForFunction(() => /Thanks for rating/.test(document.getElementById("rateStatus").textContent));
    expect(mockClient._state.driver_ratings[0]).toMatchObject({ stars: 4, tags: ["friendly"], comment: "Kind and careful.", counted: false });

    // Coming back shows what was done, with nothing to repeat.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => /You tipped \$7\.50/.test(document.getElementById("tipIntro").textContent));
    await page.waitForFunction(() => /rated this trip 4 of 5/.test(document.getElementById("rateStatus").textContent));
    expect(page.errors).toEqual([]);
    await context.close();
  });
});
