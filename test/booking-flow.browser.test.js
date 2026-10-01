// Mobile-browser check of the rider booking wizard with Mapbox address
// search and routing (server-side; test/fixtures/fakeMapbox.js stands in
// for api.mapbox.com):
//   - token missing, or Mapbox failing: a clear "temporarily unavailable"
//     message that never blames the rider's address; nothing is booked;
//   - ordinary rider: address suggestions (with Mapbox attribution), route
//     and fare, the normal card form, and no request without authorizing;
//   - App Review rider: same route and fare, simulated payment, no card
//     form, and a flagged review ride with no payment;
//   - the token never reaches the browser.
// Needs Playwright and Chromium; skips without them (for example in CI).
//   NODE_PATH="$(npm root -g)" npx jest test/booking-flow.browser

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, signTestRiderToken } = require("./rideTestHelpers");
const { createFakeMapbox, TEST_TOKEN } = require("./fixtures/fakeMapbox");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}

const describeWithBrowser = chromium ? describe : describe.skip;

jest.setTimeout(180000);

const HOST = "harveytaxiservice.test";
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
const UNAVAILABLE = /Address lookup and fare estimates are temporarily unavailable/;
const BLAME = /couldn't locate this (pickup|destination) address|We couldn't calculate a route/;

function seed() {
  return {
    system_flags: [
      { key: "review_account_login_enabled", value: "true" },
      { key: "rider_history_enabled", value: "true" }
    ],
    riders: [
      makeRider({ id: "RIDER_REAL", email: "real-rider@example.test" }),
      makeRider({ id: "RIDER_REVIEW", email: "review-rider@example.test", is_review_account: true })
    ],
    drivers: [makeDriver({ id: "DRIVER_REVIEW", is_review_account: true, current_lat: 36.163, current_lng: -86.781 })],
    rides: [],
    payments: [],
    driver_offers: [],
    audit_logs: []
  };
}

async function startServer({ token }) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    RIDER_SESSION_SECRET: "test-rider-session-secret",
    DRIVER_SESSION_SECRET: "test-driver-session-secret",
    RIDE_QUOTE_SECRET: "test-ride-quote-secret",
    ADMIN_API_TOKEN: "test-admin-token",
    ENABLE_PAYMENT_GATE: "true",
    ENABLE_RIDER_APPROVAL_GATE: "false"
  };
  for (const name of ["CANONICAL_HOST", "FOUNDATION_HOST", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "MAPBOX_ACCESS_TOKEN"]) {
    delete process.env[name];
  }
  if (token) process.env.MAPBOX_ACCESS_TOKEN = token;

  const mapbox = createFakeMapbox();
  globalThis.fetch = mapbox.fetchImpl;
  mockSupabaseClient = createFakeSupabase(seed());
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { server, mapbox, base: `http://${HOST}:${server.address().port}`, state: mockSupabaseClient._state };
}

describeWithBrowser("Rider booking wizard with Mapbox (mobile 390x844)", () => {
  let browser;
  let logSpies;

  beforeAll(async () => {
    logSpies = ["log", "warn", "error", "info"].map((l) => jest.spyOn(console, l).mockImplementation(() => {}));
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    logSpies.forEach((s) => s.mockRestore());
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // Everything the browser received, for the token-leak check.
  async function newPage(base, riderId) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([
      { name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken(riderId)), url: base }
    ]);
    const page = await context.newPage();
    page.errors = [];
    page.received = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    page.on("response", async (res) => {
      try {
        page.received.push(await res.text());
      } catch {
        // redirects / aborted bodies
      }
    });
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForSelector("#confirmServiceBtn", { state: "visible" });
    await page.click("#confirmServiceBtn");
    await page.fill("#riderName", "Test Rider");
    await page.fill("#riderEmail", "test-rider@example.test");
    await page.fill("#riderPhone", "6155550111");
    return page;
  }

  async function bookToEstimate(page) {
    // Type, pick the suggestion (attribution shown), continue.
    await page.type("#pickupAddress", "501 Broad", { delay: 20 });
    await page.waitForSelector("#pickupAddressSuggestions .geo-suggestion", { state: "visible" });
    expect(await page.textContent("#pickupAddressSuggestions .geo-attribution")).toMatch(/© Mapbox.*© OpenStreetMap.*Improve this map/);
    await page.dispatchEvent("#pickupAddressSuggestions .geo-suggestion", "mousedown");
    expect(await page.inputValue("#pickupAddress")).toMatch(/^501 Broadway, Nashville/);
    await page.click("#stagePickupContinueBtn");
    await page.waitForSelector("#destinationAddress", { state: "visible" });
    await page.fill("#destinationAddress", "1 Terminal Dr");
    await page.click("#stageDestinationContinueBtn");
    await page.waitForSelector("#stageDetailsContinueBtn", { state: "visible" });
    expect(await page.inputValue("#destinationAddress")).toMatch(/^1 Terminal Drive, Nashville/);
    await page.click("#stageDetailsContinueBtn");
    await page.waitForSelector("#estimateBtn", { state: "visible" });
    await page.click("#estimateBtn");
    await page.waitForFunction(() => /DISTANCE 5\.2/.test(document.getElementById("wizardStageReview").innerText.replace(/\s+/g, " ")));
  }

  const text = (page, id) => page.evaluate((i) => document.getElementById(i).innerText.replace(/\s+/g, " "), id);
  const expectNoTokenInBrowser = async (page) => {
    expect(page.received.join("\n")).not.toContain(TEST_TOKEN);
    expect(await page.content()).not.toContain(TEST_TOKEN);
  };

  describe("MAPBOX_ACCESS_TOKEN missing", () => {
    let ctx;
    beforeAll(async () => {
      ctx = await startServer({ token: null });
    });
    afterAll(() => new Promise((resolve) => ctx.server.close(resolve)));

    test("clear temporary-unavailability message, address not blamed, nothing booked", async () => {
      const page = await newPage(ctx.base, "RIDER_REAL");
      await page.fill("#pickupAddress", "501 Broadway, Nashville");
      await page.click("#stagePickupContinueBtn");
      await page.waitForTimeout(500);
      const wizard = await text(page, "rideWizardOverlay");
      expect(wizard).toMatch(UNAVAILABLE);
      expect(wizard).not.toMatch(BLAME);
      expect(await page.isVisible("#wizardStagePickup")).toBe(true);
      expect(ctx.mapbox.calls).toHaveLength(0);
      expect(ctx.state.rides).toHaveLength(0);
      expect(page.errors).toEqual([]);
    });
  });

  describe("MAPBOX_ACCESS_TOKEN configured", () => {
    let ctx;
    beforeAll(async () => {
      ctx = await startServer({ token: TEST_TOKEN });
    });
    beforeEach(() => ctx.mapbox.reset());
    afterAll(() => new Promise((resolve) => ctx.server.close(resolve)));

    test("Mapbox failing (token rejected): same clear message, address not blamed", async () => {
      const page = await newPage(ctx.base, "RIDER_REAL");
      ctx.mapbox.setMode("http_401");
      await page.fill("#pickupAddress", "501 Broadway, Nashville");
      await page.click("#stagePickupContinueBtn");
      await page.waitForTimeout(500);
      const wizard = await text(page, "rideWizardOverlay");
      expect(wizard).toMatch(UNAVAILABLE);
      expect(wizard).not.toMatch(BLAME);
      expect(ctx.state.rides).toHaveLength(0);
      await expectNoTokenInBrowser(page);
    });

    test("ordinary rider: suggestions, route and fare, card form, no request without authorization", async () => {
      const page = await newPage(ctx.base, "RIDER_REAL");
      await bookToEstimate(page);
      const review = await text(page, "wizardStageReview");
      expect(review).toMatch(/ESTIMATED TIME 14/);
      expect(review).toMatch(/Total \$\d+\.\d{2}/);
      expect(review).toMatch(/© Mapbox/);

      // Stored addresses come from permanent results only.
      const resolveCalls = ctx.mapbox.calls.filter((c) => c.path.endsWith("/forward") && c.params.autocomplete === "false");
      expect(resolveCalls.length).toBeGreaterThanOrEqual(2);
      for (const c of resolveCalls) expect(c.params.permanent).toBe("true");

      await page.click("#stageReviewContinueBtn");
      await page.waitForSelector("#authorizePaymentBtn", { state: "visible" });
      expect(await page.isVisible("#newCardField")).toBe(true);
      expect(await text(page, "wizardStagePayment")).not.toMatch(/Simulated payment/);
      expect(await page.isVisible("#rideWizardOverlay .app-review-banner")).toBe(false);

      await page.click("#stagePaymentContinueBtn").catch(() => {});
      await page.waitForTimeout(400);
      expect(await page.isVisible("#wizardStageDispatch")).toBe(false);
      expect(await page.evaluate(() => document.getElementById("requestRideBtn").disabled)).toBe(true);
      expect(ctx.state.rides).toHaveLength(0);
      expect(ctx.state.payments).toHaveLength(0);
      expect(page.errors).toEqual([]);
      await expectNoTokenInBrowser(page);
    });

    test("App Review rider: same route and fare, simulated payment, no card form, flagged ride, no payment", async () => {
      const page = await newPage(ctx.base, "RIDER_REVIEW");
      await bookToEstimate(page);

      await page.click("#stageReviewContinueBtn");
      await page.waitForSelector("#authorizePaymentBtn", { state: "visible" });
      expect(await page.isVisible("#newCardField")).toBe(false);
      await page.click("#authorizePaymentBtn");
      await page.waitForTimeout(400);
      expect(await text(page, "wizardStagePayment")).toMatch(/Simulated payment — App Review mode\. No card is charged\./);

      await page.click("#stagePaymentContinueBtn");
      await page.waitForSelector("#requestRideBtn", { state: "visible" });
      await page.click("#requestRideBtn");
      await page.waitForFunction(() => /submitted/i.test(document.getElementById("rideWizardOverlay").innerText));

      expect(ctx.state.rides).toHaveLength(1);
      const ride = ctx.state.rides[0];
      expect(ride).toMatchObject({ rider_id: "RIDER_REVIEW", is_review_ride: true, payment_status: "not_required", payment_id: null });
      expect(ride.pickup_address).toMatch(/^501 Broadway, Nashville/);
      expect(Number(ride.estimated_distance_miles)).toBeCloseTo(5.2, 1);
      expect(ctx.state.payments).toHaveLength(0);
      expect(page.errors).toEqual([]);
      await expectNoTokenInBrowser(page);
    });
  });
});
