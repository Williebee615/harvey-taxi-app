// Mobile-browser check of the rider booking wizard with and without the
// Google Maps browser key:
//   - key missing: /api/maps-key returns 503 and the wizard says address
//     lookup and fare estimates are unavailable;
//   - key set: an ordinary rider routes, gets an estimate and must
//     authorize a card before requesting; an App Review rider routes and
//     gets an estimate, the payment is simulated and the ride request goes
//     through without any payment.
//
// Google's script is replaced by test/fixtures/google-maps-stub.js and the
// key is a fixture string, so no network or real key is involved.
// Needs Playwright and Chromium; skips without them, for example in CI.
//   NODE_PATH="$(npm root -g)" npx jest test/booking-flow.browser

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, signTestRiderToken } = require("./rideTestHelpers");

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
const MAPS_STUB = path.join(__dirname, "fixtures", "google-maps-stub.js");
const ORIGINAL_ENV = { ...process.env };

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

async function startServer(mapsKey) {
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
  delete process.env.CANONICAL_HOST;
  delete process.env.FOUNDATION_HOST;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  if (mapsKey) process.env.GOOGLE_MAPS_BROWSER_KEY = mapsKey;
  else delete process.env.GOOGLE_MAPS_BROWSER_KEY;

  mockSupabaseClient = createFakeSupabase(seed());
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { server, base: `http://${HOST}:${server.address().port}`, state: mockSupabaseClient._state };
}

describeWithBrowser("Rider booking wizard and the Google Maps key (mobile)", () => {
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
  });

  async function openWizardAs(base, riderId, { stopAfterPickup = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route(/maps\.googleapis\.com\/maps\/api\/js/, (route) =>
      route.fulfill({ contentType: "text/javascript", path: MAPS_STUB })
    );
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)(?!maps\.googleapis\.com)/, (route) => route.abort());
    await context.addCookies([
      { name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken(riderId)), url: base }
    ]);
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForSelector("#confirmServiceBtn", { state: "visible" });
    await page.click("#confirmServiceBtn");
    await page.fill("#riderName", "Test Rider");
    await page.fill("#riderEmail", "test-rider@example.test");
    await page.fill("#riderPhone", "6155550111");
    await page.fill("#pickupAddress", "501 Broadway, Nashville, TN");
    await page.click("#stagePickupContinueBtn");
    if (stopAfterPickup) {
      await page.waitForTimeout(800);
      return page;
    }
    await page.waitForSelector("#destinationAddress", { state: "visible" });
    await page.fill("#destinationAddress", "1 Terminal Dr, Nashville, TN");
    await page.click("#stageDestinationContinueBtn");
    await page.waitForSelector("#stageDetailsContinueBtn", { state: "visible" });
    await page.click("#stageDetailsContinueBtn");
    await page.waitForSelector("#estimateBtn", { state: "visible" });
    await page.click("#estimateBtn");
    await page.waitForTimeout(1200);
    return page;
  }

  const stageText = (page, id) => page.evaluate((i) => document.getElementById(i).innerText.replace(/\s+/g, " "), id);

  describe("GOOGLE_MAPS_BROWSER_KEY missing", () => {
    let ctx;
    beforeAll(async () => {
      ctx = await startServer(null);
    });
    afterAll(async () => {
      await new Promise((resolve) => ctx.server.close(resolve));
    });

    test("the wizard says lookup and estimates are unavailable, with no estimate or ride", async () => {
      const page = await openWizardAs(ctx.base, "RIDER_REAL", { stopAfterPickup: true });
      const mapsKey = await page.evaluate(async () => (await fetch("/api/maps-key")).status);
      expect(mapsKey).toBe(503);
      expect(await page.evaluate(() => window.__HARVEY_MAPS_CONFIG_ERROR__)).toBe(true);
      const body = await page.evaluate(() => document.getElementById("rideWizardOverlay").innerText);
      expect(body).toMatch(/Address lookup and fare estimates are temporarily unavailable/);
      expect(body).not.toMatch(/We couldn't calculate a route|couldn't locate this pickup address/);
      // The rider stays on the pickup step; nothing is estimated or booked.
      expect(await page.isVisible("#wizardStagePickup")).toBe(true);
      expect(await page.isDisabled("#stageReviewContinueBtn")).toBe(true);
      expect(ctx.state.rides).toHaveLength(0);
      expect(page.errors).toEqual([]);
    });
  });

  describe("GOOGLE_MAPS_BROWSER_KEY configured", () => {
    let ctx;
    beforeAll(async () => {
      ctx = await startServer("fixture-browser-key-789");
    });
    afterAll(async () => {
      await new Promise((resolve) => ctx.server.close(resolve));
    });

    test("ordinary rider: routes, gets an estimate, and must authorize a card before requesting", async () => {
      const page = await openWizardAs(ctx.base, "RIDER_REAL");
      const review = await stageText(page, "wizardStageReview");
      expect(review).toMatch(/DISTANCE 5\.2/);
      expect(review).toMatch(/ESTIMATED TIME 14/);
      expect(review).toMatch(/Total \$\d+\.\d{2}/);

      await page.click("#stageReviewContinueBtn");
      await page.waitForSelector("#authorizePaymentBtn", { state: "visible" });
      const payment = await stageText(page, "wizardStagePayment");
      expect(payment).toMatch(/Card Details/);
      expect(payment).not.toMatch(/Simulated payment/);
      expect(await page.isVisible("#newCardField")).toBe(true);
      expect(await page.isVisible("#rideWizardOverlay .app-review-banner")).toBe(false);

      // Without a card authorization the rider cannot move on or request.
      await page.click("#stagePaymentContinueBtn").catch(() => {});
      await page.waitForTimeout(400);
      expect(await page.isVisible("#wizardStageDispatch")).toBe(false);
      expect(await page.evaluate(() => document.getElementById("requestRideBtn").disabled)).toBe(true);
      expect(ctx.state.rides).toHaveLength(0);
      expect(ctx.state.payments).toHaveLength(0);
      expect(page.errors).toEqual([]);
    });

    test("App Review rider: routes and estimates normally; payment is simulated and the ride is requested", async () => {
      const page = await openWizardAs(ctx.base, "RIDER_REVIEW");
      expect(await stageText(page, "wizardStageReview")).toMatch(/DISTANCE 5\.2/);

      await page.click("#stageReviewContinueBtn");
      await page.waitForSelector("#authorizePaymentBtn", { state: "visible" });
      await page.click("#authorizePaymentBtn");
      await page.waitForTimeout(500);
      expect(await stageText(page, "wizardStagePayment")).toMatch(/Simulated payment — App Review mode\. No card is charged\./);
      // No card form is shown to App Review riders.
      expect(await page.isVisible("#newCardField")).toBe(false);

      await page.click("#stagePaymentContinueBtn");
      await page.waitForSelector("#requestRideBtn", { state: "visible" });
      await page.click("#requestRideBtn");
      await page.waitForFunction(() => /submitted/i.test(document.getElementById("rideWizardOverlay").innerText));

      expect(ctx.state.rides).toHaveLength(1);
      expect(ctx.state.rides[0]).toMatchObject({
        rider_id: "RIDER_REVIEW",
        is_review_ride: true,
        payment_status: "not_required",
        payment_id: null
      });
      expect(Number(ctx.state.rides[0].estimated_distance_miles)).toBeCloseTo(5.2, 1);
      expect(ctx.state.payments).toHaveLength(0);
      expect(page.errors).toEqual([]);
    });
  });
});
