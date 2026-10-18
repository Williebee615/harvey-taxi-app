// Just-in-Time booking on the rider dashboard (owner decision 2026-10-18),
// in a phone-sized browser. Off: the page is unchanged ("Complete Rider
// Setup", rider fields in the booking screen). On: "Where to?", no rider
// fields before "Confirm Ride", and the phone sheet signs the visitor up
// with a texted code (Twilio is a fake here; no SMS is sent).
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/jit-booking.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PERSONA = "false";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const mockTwilio = { sends: [], checks: [] };
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: {
          create: async (params) => {
            mockTwilio.sends.push(params);
            return { sid: "VEtest", status: "pending" };
          }
        },
        verificationChecks: {
          create: async (params) => {
            mockTwilio.checks.push(params);
            return { status: params.code === "246810" ? "approved" : "pending" };
          }
        }
      })
    },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
);

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

function seedState(jit) {
  return {
    system_flags: jit ? [{ key: "jit_booking_enabled", value: "true" }] : [],
    riders: [],
    drivers: [],
    rides: [],
    audit_logs: [],
    verification_codes: []
  };
}

describeWithBrowser("Just-in-Time booking on the rider dashboard (mobile)", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase(seedState(false));
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
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function reseed(jit) {
    const state = mockSupabaseClient._state;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, seedState(jit));
    mockTwilio.sends = [];
    mockTwilio.checks = [];
  }

  async function openDashboard() {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HarveyJitBooking === "boolean");
    await page.waitForTimeout(600);
    return { context, page, errors };
  }

  const heroButton = (page) => page.evaluate(() => {
    const b = document.getElementById("heroRequestRideBtn");
    return { text: b.textContent.trim(), action: b.dataset.action };
  });

  test("off (default): the page is unchanged", async () => {
    reseed(false);
    const { context, page, errors } = await openDashboard();
    expect(await page.evaluate(() => window.HarveyJitBooking)).toBe(false);
    expect(await heroButton(page)).toEqual({ text: "Complete Rider Setup", action: "setup" });
    expect(await page.isVisible("#jitResumeBanner")).toBe(false);
    expect(await page.evaluate(() => document.body.classList.contains("jit-booking"))).toBe(false);

    await page.evaluate(() => window.HarveyRideWizard.open({ mode: "driver" }));
    await page.waitForTimeout(500);
    // The rider fields are not hidden by Just-in-Time rules (the stage
    // itself may not be showing yet, so check the fields' own style).
    expect(await page.evaluate(() =>
      [...document.querySelectorAll("[data-jit-hide]")].map((el) => getComputedStyle(el).display)
    )).not.toContain("none");
    expect((await page.textContent("#stageReviewContinueBtn")).trim()).toMatch(/Continue to Payment/);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("on: 'Where to?' with no setup warning; booking asks for no rider details", async () => {
    reseed(true);
    const { context, page, errors } = await openDashboard();
    expect(await heroButton(page)).toEqual({ text: "Where to?", action: "ride" });
    expect(await page.textContent("#heroTitle")).not.toMatch(/Finish rider setup/);
    expect(await page.isVisible("#jitResumeBanner")).toBe(false);

    await page.click("#heroRequestRideBtn");
    await page.waitForSelector("#rideWizardOverlay:not([hidden])");
    await page.waitForTimeout(500);
    expect(await page.isVisible("#riderName")).toBe(false);
    expect(await page.isVisible("#riderPhone")).toBe(false);
    expect(await page.isVisible("#riderEmail")).toBe(false);
    expect(await page.isVisible("#pickupMap")).toBe(true);
    expect((await page.textContent("#stageReviewContinueBtn")).trim()).toBe("Confirm Ride");
    // Nothing is asked of a signed-out visitor before Confirm Ride.
    expect(await page.isVisible("#jitSheet")).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("on: the phone sheet signs a new rider up and approves them; then booking continues", async () => {
    reseed(true);
    const { context, page, errors } = await openDashboard();

    await page.evaluate(() => {
      window.__jitDone = 0;
      window.HarveyJitSheet.open(() => { window.__jitDone += 1; });
    });
    expect(await page.isVisible("#jitSheet")).toBe(true);
    expect(await page.getAttribute("#jitCode", "autocomplete")).toBe("one-time-code");

    // One thing at a time: a missing name is caught before any text is sent.
    await page.fill("#jitPhone", "6155550199");
    await page.click("#jitSendCodeBtn");
    expect(await page.textContent("#jitPhoneError")).toMatch(/first name/);
    expect(mockTwilio.sends).toHaveLength(0);

    await page.fill("#jitFirstName", "ana");
    await page.click("#jitSendCodeBtn");
    await page.waitForSelector("#jitCodeForm:not([hidden])");
    expect(mockTwilio.sends).toEqual([{ to: "+16155550199", channel: "sms" }]);
    expect(await page.textContent("#jitPhoneEcho")).toBe("(615) 555-0199");

    // The banner remembers an unfinished booking.
    expect(await page.evaluate(() => localStorage.getItem("harvey_jit_booking_started"))).toBe("1");

    await page.fill("#jitCode", "111111");
    await page.click("#jitVerifyBtn");
    await page.waitForFunction(() => !document.getElementById("jitCodeError").hidden);
    expect(mockSupabaseClient._state.riders).toHaveLength(0);

    await page.fill("#jitCode", "246810");
    await page.click("#jitVerifyBtn");
    await page.waitForFunction(() => document.getElementById("jitSheet").hidden);
    expect(await page.evaluate(() => window.__jitDone)).toBe(1);

    const riders = mockSupabaseClient._state.riders;
    expect(riders).toHaveLength(1);
    expect(riders[0]).toMatchObject({ first_name: "ana", phone: "6155550199", approval_status: "approved", sms_verified: true });
    expect(mockSupabaseClient._state.audit_logs.map((a) => a.action)).toContain("rider_auto_approved");

    expect(await page.evaluate(() => window.HarveyRiderSession && window.HarveyRiderSession.phone)).toBe("6155550199");
    expect(await page.evaluate(() => localStorage.getItem("harvey_jit_booking_started"))).toBeNull();
    await page.waitForFunction(() => document.getElementById("heroRequestRideBtn").textContent.trim() === "Request a Ride");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("on: a visitor who left at the phone step sees the owner-approved prompt", async () => {
    reseed(true);
    const { context, page, errors } = await openDashboard();
    await page.evaluate(() => localStorage.setItem("harvey_jit_booking_started", "1"));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HarveyJitBooking === "boolean");
    await page.waitForSelector("#jitResumeBanner:not([hidden])");
    expect((await page.textContent("#jitResumeBanner")).trim()).toBe("Finish setup to book in one tap");
    expect(await page.textContent("body")).not.toMatch(/\$5|first-ride credit/i);
    await page.click("#jitResumeBanner button");
    await page.waitForSelector("#rideWizardOverlay:not([hidden])");
    expect(errors).toEqual([]);
    await context.close();
  });
});
