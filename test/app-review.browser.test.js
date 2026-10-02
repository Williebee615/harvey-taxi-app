// Mobile-browser check that the ordinary rider experience and App Review
// mode stay separate: the signed-out screen, the dedicated reviewer
// panel, sign-in, banners, simulated labels, and simulated deletion.
//
// Needs Playwright and a Chromium build; skips without them (CI does not
// install a browser). Run locally with, for example:
//   NODE_PATH="$(npm root -g)" npx jest test/app-review.browser
//
// The pages pick a same-origin API only on Harvey Taxi hostnames, so the
// test serves the app as harveytaxiservice.test (mapped to 127.0.0.1).

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
const { hashReviewPassword } = require("../lib/reviewAccounts");
const { makeRider, makeDriver, makeRide, signTestRiderToken, signTestDriverToken } = require("./rideTestHelpers");

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

jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";
// Test-only fixture, hashed into the fake database. Not a real credential.
const REVIEW_PASSWORD = "browser-test-only-pw-0001";
const EXPLANATION =
  "For authorized Apple App Store and Google Play reviewers only. Review rides, payments, and earnings are simulated.";

function seedState() {
  const creds = hashReviewPassword(REVIEW_PASSWORD);
  return {
    system_flags: [
      { key: "review_account_login_enabled", value: "true" },
      { key: "rider_history_enabled", value: "true" }
    ],
    riders: [
      makeRider({
        id: "RIDER_REVIEW",
        email: "review-rider@example.test",
        phone: "+15555550100",
        is_review_account: true,
        review_password_salt: creds.salt,
        review_password_hash: creds.hash
      }),
      makeRider({ id: "RIDER_REAL", email: "real-rider@example.test", phone: "+16155550111" })
    ],
    drivers: [
      makeDriver({ id: "DRIVER_REVIEW", email: "review-driver@example.test", is_review_account: true }),
      makeDriver({ id: "DRIVER_REAL", email: "real-driver@example.test", phone: "+16155550133" })
    ],
    rides: [
      makeRide({ id: "RIDE_REVIEW_DONE", rider_id: "RIDER_REVIEW", driver_id: "DRIVER_REVIEW", status: "completed", is_review_ride: true, payment_status: "not_required", payment_id: null }),
      makeRide({ id: "RIDE_REAL_DONE", rider_id: "RIDER_REAL", driver_id: "DRIVER_REAL", status: "completed", is_review_ride: false })
    ],
    driver_earnings: [
      { id: "EARN_REVIEW", ride_id: "RIDE_REVIEW_DONE", driver_id: "DRIVER_REVIEW", total_earning: 26, status: "earned" }
    ],
    deletion_requests: [],
    audit_logs: [],
    verification_codes: []
  };
}

describeWithBrowser("App Review mode stays separate from the ordinary rider flow (mobile)", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase(seedState());
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    base = `http://${HOST}:${port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    const state = mockSupabaseClient._state;
    const fresh = seedState();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, fresh);
  });

  async function newPage({ riderId, driverId } = {}) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    });
    // Third-party scripts (Maps, fonts, analytics) are irrelevant here.
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (riderId) {
      await context.addCookies([
        { name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken(riderId)), url: base }
      ]);
    }
    if (driverId) {
      const token = signTestDriverToken(driverId);
      await context.addInitScript(
        ([t, id]) => {
          localStorage.setItem("harvey_driver_token", t);
          localStorage.setItem("harvey_driver_id", id);
        },
        [token, driverId]
      );
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.errors = errors;
    return page;
  }

  const visible = (page, selector) => page.isVisible(selector);

  async function openRiderDashboard(page) {
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForFunction(() => document.readyState === "complete");
    await page.waitForTimeout(800);
  }

  test("signed-out visitor: App Review Access is its own card; booking flow has no reviewer UI", async () => {
    const page = await newPage();
    await openRiderDashboard(page);

    expect(await visible(page, "#appReviewAccess")).toBe(true);
    expect(await page.textContent("#appReviewAccess")).toContain(EXPLANATION);
    expect(await visible(page, "#appReviewPanel")).toBe(false);
    expect(await visible(page, ".app-review-banner")).toBe(false);

    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForTimeout(300);
    expect(await visible(page, "#rideWizardOverlay")).toBe(true);
    const wizardText = await page.textContent("#rideWizardOverlay");
    expect(wizardText).not.toMatch(/App Review Sign-In|reviewer/i);
    expect(await page.isVisible("#rideWizardOverlay .app-review-banner")).toBe(false);
    expect(page.errors).toEqual([]);
  });

  test("App Review Sign-In opens only the dedicated panel; Back returns to regular booking", async () => {
    const page = await newPage();
    await openRiderDashboard(page);

    await page.click("#appReviewSignInBtn");
    expect(await visible(page, "#appReviewPanel")).toBe(true);
    expect(await page.textContent("#appReviewPanel")).toContain(EXPLANATION);
    expect(await visible(page, "#riderAuthOverlay")).toBe(false);
    expect(await visible(page, "#riderAuthOverlay .auth-tabs")).toBe(false);
    expect(await visible(page, "#authTabPhone")).toBe(false);
    expect(await visible(page, "#authPhoneInput")).toBe(false);
    expect(await visible(page, "#rideWizardOverlay")).toBe(false);

    await page.fill("#appReviewEmail", "someone@example.test");
    await page.click("text=Back to regular booking");
    expect(await visible(page, "#appReviewPanel")).toBe(false);
    expect(await visible(page, "#appReviewAccess")).toBe(true);
    expect(await page.inputValue("#appReviewEmail")).toBe("");
    expect(await visible(page, ".app-review-banner")).toBe(false);
  });

  test("an ordinary rider's email is refused in the reviewer panel", async () => {
    const page = await newPage();
    await openRiderDashboard(page);
    await page.click("#appReviewSignInBtn");
    await page.fill("#appReviewEmail", "real-rider@example.test");
    await page.fill("#appReviewPassword", REVIEW_PASSWORD);
    await page.click("#appReviewSubmitBtn");
    await page.waitForSelector("#appReviewError:not([hidden])");
    expect(await page.textContent("#appReviewError")).toBe("Invalid reviewer credentials.");
    expect(await visible(page, ".app-review-banner")).toBe(false);
    const session = await page.evaluate(async () => (await fetch("/api/rider/session", { credentials: "include" })).status);
    expect(session).toBe(401);
  });

  test("a review flag set in the browser is not trusted by the server", async () => {
    const page = await newPage();
    await openRiderDashboard(page);
    const status = await page.evaluate(async () => {
      window.HarveyReviewMode = true;
      const res = await fetch("/api/review/rider/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-requested-with": "harvey-rider-app" },
        body: JSON.stringify({ email: "real-rider@example.test", password: "x", is_review_account: true, review_mode: true })
      });
      return res.status;
    });
    expect(status).toBe(401);
  });

  test("reviewer: signs in through the panel, sees banners and simulated labels everywhere", async () => {
    const page = await newPage();
    await openRiderDashboard(page);
    await page.click("#appReviewSignInBtn");
    await page.fill("#appReviewEmail", "review-rider@example.test");
    await page.fill("#appReviewPassword", REVIEW_PASSWORD);
    await page.click("#appReviewSubmitBtn");
    await page.waitForSelector("#appReviewBanner:not([hidden])");

    expect(await visible(page, "#appReviewPanel")).toBe(false);
    expect(await visible(page, "#appReviewAccess")).toBe(false);
    expect(await page.textContent("#appReviewBanner")).toMatch(/App Review mode/);

    await page.waitForSelector(".sim-tag", { timeout: 5000 });
    expect(await page.textContent(".sim-tag")).toBe("Simulated");

    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForTimeout(300);
    expect(await page.isVisible("#rideWizardOverlay .app-review-banner")).toBe(true);
    expect(page.errors).toEqual([]);
  });

  test("ordinary signed-in rider: no banner, no App Review card, no simulated labels", async () => {
    const page = await newPage({ riderId: "RIDER_REAL" });
    await openRiderDashboard(page);
    await page.waitForTimeout(800);
    expect(await visible(page, ".app-review-banner")).toBe(false);
    expect(await visible(page, "#appReviewAccess")).toBe(false);
    expect(await page.$(".sim-tag")).toBeNull();
    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForTimeout(300);
    expect(await page.isVisible("#rideWizardOverlay .app-review-banner")).toBe(false);
  });

  test("reviewer deletion is clearly simulated and keeps the account", async () => {
    const page = await newPage({ riderId: "RIDER_REVIEW" });
    await page.goto(`${base}/settings.html?account=rider#account-deletion`, { waitUntil: "load" });
    await page.waitForSelector("#settingsReviewBanner:not([hidden])");
    expect(await page.textContent("#deletionIdentity")).toMatch(/deletion is simulated/);
    await page.fill("#deletionConfirmText", "DELETE");
    await page.click("button[onclick='requestAccountDeletion()']");
    await page.waitForFunction(() => /App Review mode/.test(document.getElementById("deletionNotice").textContent));
    const rider = mockSupabaseClient._state.riders.find((r) => r.id === "RIDER_REVIEW");
    expect(rider.deleted_at).toBeFalsy();
    expect(rider.access_revoked).toBe(false);
    expect(mockSupabaseClient._state.deletion_requests).toEqual([
      expect.objectContaining({ user_id: "RIDER_REVIEW", status: "review_simulated" })
    ]);
  });

  test("ordinary rider's deletion page shows no review banner or simulated wording", async () => {
    const page = await newPage({ riderId: "RIDER_REAL" });
    await page.goto(`${base}/settings.html?account=rider#account-deletion`, { waitUntil: "load" });
    await page.waitForFunction(() => /signed in/.test(document.getElementById("deletionIdentity").textContent));
    expect(await visible(page, "#settingsReviewBanner")).toBe(false);
    expect(await page.textContent("#deletionIdentity")).not.toMatch(/simulated/i);
  });

  test("review driver: banner and simulated earnings; ordinary driver: neither", async () => {
    const reviewPage = await newPage({ driverId: "DRIVER_REVIEW" });
    await reviewPage.goto(`${base}/driver-dashboard.html`, { waitUntil: "load" });
    await reviewPage.waitForSelector("#appReviewBanner:not([hidden])", { timeout: 10000 });
    expect(await reviewPage.textContent("#appReviewBanner")).toMatch(/App Review mode/);
    await reviewPage.waitForFunction(() => /\(simulated\)/.test(document.body.innerText));

    const realPage = await newPage({ driverId: "DRIVER_REAL" });
    await realPage.goto(`${base}/driver-dashboard.html`, { waitUntil: "load" });
    await realPage.waitForTimeout(1500);
    expect(await realPage.isVisible("#appReviewBanner")).toBe(false);
    expect(await realPage.evaluate(() => /\(simulated\)/.test(document.body.innerText))).toBe(false);
  });
});
