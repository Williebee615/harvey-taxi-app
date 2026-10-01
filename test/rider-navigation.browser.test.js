// Rider dashboard vs booking screen navigation (mobile 390x844, plus a
// desktop launch check):
//   - normal launch, a bare ?mode= and refresh land on the dashboard;
//   - only an explicit action (button, saved place, ?screen=book link)
//     opens the booking screen, with its prefills;
//   - "Back to Dashboard" and browser Back close it without creating a
//     ride or a payment, and Forward/refresh behave;
//   - a completed booking returns to the dashboard with the active ride;
//   - ride tracking (?screen=track, "Open Live Tracking") opens tracking,
//     not a new booking.
// Needs Playwright and Chromium; skips without them (for example in CI).
// Set RIDER_NAV_SCREENSHOT_DIR to also save screenshots of the dashboard
// and the booking screen.

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
const SHOT_DIR = process.env.RIDER_NAV_SCREENSHOT_DIR || "";
async function shot(page, name, options = {}) {
  if (!SHOT_DIR) return;
  // eslint-disable-next-line global-require
  require("fs").mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, ...options });
}
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

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
    saved_places: [
      { id: "PLACE_1", rider_id: "RIDER_REAL", label: "Work", address: "2500 West End Ave, Nashville", lat: 36.1493, lng: -86.81, created_at: new Date().toISOString() }
    ],
    rides: [],
    payments: [],
    driver_offers: [],
    audit_logs: []
  };
}

describeWithBrowser("Rider dashboard is home; booking is a separate screen", () => {
  let server;
  let browser;
  let base;
  let state;
  let logSpies;

  beforeAll(async () => {
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
      ENABLE_RIDER_APPROVAL_GATE: "false",
      MAPBOX_ACCESS_TOKEN: TEST_TOKEN
    };
    for (const name of ["CANONICAL_HOST", "FOUNDATION_HOST", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"]) {
      delete process.env[name];
    }
    globalThis.fetch = createFakeMapbox().fetchImpl;
    logSpies = ["log", "warn", "error", "info"].map((l) => jest.spyOn(console, l).mockImplementation(() => {}));
    mockSupabaseClient = createFakeSupabase(seed());
    state = mockSupabaseClient._state;
    let app;
    jest.isolateModules(() => {
      ({ app } = require("../server"));
    });
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
    logSpies.forEach((s) => s.mockRestore());
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  beforeEach(() => {
    const fresh = seed();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, fresh);
  });

  async function newPage(riderId, viewport = { width: 390, height: 844 }) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([
      { name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken(riderId)), url: base }
    ]);
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    return page;
  }

  async function goto(page, path) {
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(900);
  }

  const wizardOpen = (page) => page.evaluate(() => !document.getElementById("rideWizardOverlay").hidden);
  const path = (page) => page.evaluate(() => location.pathname + location.search);
  // The first step ("choose a service") isn't a .wizard-step element.
  const visibleStage = (page) =>
    page.evaluate(() => {
      const step = [...document.querySelectorAll("#rideWizardOverlay .wizard-step")].find((el) => el.offsetParent);
      if (step) return step.dataset.stage;
      return document.getElementById("confirmServiceBtn")?.offsetParent ? "confirm" : null;
    });

  test("normal launch shows the dashboard with Request a Ride; wizard closed", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/rider-dashboard.html");
    expect(await wizardOpen(page)).toBe(false);
    expect(await page.isVisible("#heroRequestRideBtn")).toBe(true);
    expect(await page.textContent("#heroRequestRideBtn")).toMatch(/Request a Ride/);
    await shot(page, "01-dashboard-mobile");
    expect(page.errors).toEqual([]);
  });

  test("desktop launch also lands on the dashboard", async () => {
    const page = await newPage("RIDER_REAL", { width: 1280, height: 800 });
    await goto(page, "/rider-dashboard.html");
    expect(await wizardOpen(page)).toBe(false);
    expect(await page.isVisible("#heroRequestRideBtn")).toBe(true);
    await shot(page, "05-dashboard-desktop");
  });

  test("a bare ?mode= stays on the dashboard and is cleaned from the URL", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/rider-dashboard.html?mode=food");
    expect(await wizardOpen(page)).toBe(false);
    expect(await path(page)).toBe("/rider-dashboard.html");
  });

  test("Request a Ride opens booking; Back to Dashboard and browser Back close it without booking", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/rider-dashboard.html");

    await page.click("#heroRequestRideBtn");
    await page.waitForTimeout(400);
    expect(await wizardOpen(page)).toBe(true);
    expect(await path(page)).toBe("/rider-dashboard.html?screen=book&mode=driver");
    expect(await page.isVisible(".top-actions .wizard-close-link")).toBe(true);
    expect(await page.textContent(".top-actions .wizard-close-link")).toMatch(/Back to Dashboard/);
    await shot(page, "02-booking-screen-mobile");

    await page.click(".top-actions .wizard-close-link");
    await page.waitForTimeout(300);
    expect(await wizardOpen(page)).toBe(false);
    expect(await path(page)).toBe("/rider-dashboard.html");

    // Forward re-opens a fresh booking screen; Back closes it again.
    await page.goForward();
    await page.waitForTimeout(400);
    expect(await wizardOpen(page)).toBe(true);
    await page.goBack();
    await page.waitForTimeout(300);
    expect(await wizardOpen(page)).toBe(false);
    expect(await path(page)).toBe("/rider-dashboard.html");

    expect(state.rides).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
    expect(page.errors).toEqual([]);
  });

  test("deep link ?screen=book opens booking with prefills; Back goes to the dashboard; refresh keeps the screen", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/rider-dashboard.html?screen=book&mode=driver&ride_type=scheduled&ai_destination=1%20Terminal%20Dr");
    expect(await wizardOpen(page)).toBe(true);
    // A prefilled booking skips "choose a service" and starts at pickup.
    expect(await visibleStage(page)).toBe("pickup");
    expect(await page.inputValue("#destinationAddress")).toBe("1 Terminal Dr");
    expect(await page.inputValue("#rideType")).toBe("scheduled");

    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(900);
    expect(await wizardOpen(page)).toBe(true);

    await page.goBack();
    await page.waitForTimeout(300);
    expect(await wizardOpen(page)).toBe(false);
    expect(await path(page)).toBe("/rider-dashboard.html");
    expect(state.rides).toHaveLength(0);
  });

  test("a saved place opens booking with that destination, nothing submitted", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/rider-dashboard.html");
    const savedPlace = '[data-launch-address="2500 West End Ave, Nashville"]';
    await page.waitForSelector(savedPlace);
    await page.click(savedPlace);
    await page.waitForTimeout(400);
    expect(await wizardOpen(page)).toBe(true);
    expect(await page.inputValue("#destinationAddress")).toBe("2500 West End Ave, Nashville");
    expect(state.rides).toHaveLength(0);
  });

  test("old request links redirect once to the booking or tracking screen", async () => {
    const page = await newPage("RIDER_REAL");
    await goto(page, "/request-food.html");
    expect(await path(page)).toBe("/rider-dashboard.html?screen=book&mode=food");
    expect(await wizardOpen(page)).toBe(true);
  });

  test("reviewer: leaving after a (simulated) payment step requests nothing and says so", async () => {
    const page = await newPage("RIDER_REVIEW");
    await goto(page, "/rider-dashboard.html");
    await page.click("#heroRequestRideBtn");
    await bookThroughPayment(page);
    await page.goBack();
    await page.waitForTimeout(400);
    expect(await wizardOpen(page)).toBe(false);
    expect(await page.textContent("#systemNotice")).toMatch(/no ride was requested/);
    expect(state.rides).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
  });

  test("reviewer: a completed booking returns to the dashboard with the active ride; tracking reopens it", async () => {
    const page = await newPage("RIDER_REVIEW");
    await goto(page, "/rider-dashboard.html");
    // Marker survives only an in-page return (no reload that would leave
    // the booking URL behind in Back history).
    await page.evaluate(() => {
      window.__sameDocument = true;
    });
    await page.click("#heroRequestRideBtn");
    await bookThroughPayment(page);
    await page.click("#stagePaymentContinueBtn");
    await page.waitForSelector("#requestRideBtn", { state: "visible" });
    await page.click("#requestRideBtn");
    await page.waitForSelector("#htafDonationSkipBtn", { state: "visible" });
    await page.click("#htafDonationSkipBtn");
    await page.waitForTimeout(800);

    expect(await wizardOpen(page)).toBe(false);
    expect(await path(page)).toBe("/rider-dashboard.html");
    expect(await page.evaluate(() => window.__sameDocument === true)).toBe(true);
    expect(await page.evaluate(() => history.state?.harveyScreen ?? null)).toBe(null);
    expect(state.rides).toHaveLength(1);
    const rideId = state.rides[0].id;
    await page.waitForSelector("#activeRequestSection", { state: "visible" });
    expect(await page.textContent("#activeRequestIdText")).toBe(rideId);
    await shot(page, "03-dashboard-active-ride-mobile");

    await page.click("#openLiveTrackingBtn");
    await page.waitForTimeout(500);
    expect(await wizardOpen(page)).toBe(true);
    expect(await path(page)).toBe(`/rider-dashboard.html?screen=track&mode=driver&ride_id=${rideId}`);
    expect(await visibleStage(page)).toBe("dispatch");
    // Tracking never offers to request (or reset into) a new booking.
    expect(await page.isVisible("#requestRideBtn")).toBe(false);
    expect(await page.isVisible("#resetFlowBtn")).toBe(false);
    expect(await page.isVisible("#stageDispatchBackBtn")).toBe(false);
    await shot(page, "04-tracking-screen-mobile");

    await page.goBack();
    await page.waitForTimeout(400);
    expect(await wizardOpen(page)).toBe(false);
    expect(state.rides).toHaveLength(1);

    // A ride notification link opens tracking, not a new booking.
    await goto(page, `/rider-dashboard.html?screen=track&ride_id=${rideId}`);
    expect(await wizardOpen(page)).toBe(true);
    expect(await visibleStage(page)).toBe("dispatch");
    expect(await page.isVisible("#requestRideBtn")).toBe(false);
    expect(state.rides).toHaveLength(1);
    expect(page.errors).toEqual([]);
  });

  async function bookThroughPayment(page) {
    await page.waitForSelector("#confirmServiceBtn", { state: "visible" });
    await page.click("#confirmServiceBtn");
    await page.fill("#riderName", "Test Rider");
    await page.fill("#riderEmail", "test-rider@example.test");
    await page.fill("#riderPhone", "6155550111");
    await page.fill("#pickupAddress", "501 Broadway, Nashville");
    await page.click("#stagePickupContinueBtn");
    await page.waitForSelector("#destinationAddress", { state: "visible" });
    await page.fill("#destinationAddress", "1 Terminal Dr");
    await page.click("#stageDestinationContinueBtn");
    await page.waitForSelector("#stageDetailsContinueBtn", { state: "visible" });
    await page.click("#stageDetailsContinueBtn");
    await page.waitForSelector("#estimateBtn", { state: "visible" });
    await page.click("#estimateBtn");
    await page.waitForFunction(() => /DISTANCE 5\.2/.test(document.getElementById("wizardStageReview").innerText.replace(/\s+/g, " ")));
    await page.click("#stageReviewContinueBtn");
    await page.waitForSelector("#authorizePaymentBtn", { state: "visible" });
    await page.click("#authorizePaymentBtn");
    await page.waitForTimeout(400);
  }
});
