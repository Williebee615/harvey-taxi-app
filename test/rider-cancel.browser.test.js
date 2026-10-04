// Browser check of rider cancellation in the rider dashboard, the page the
// Harvey Taxi rider iOS and Android apps show in their WebView. Desktop
// Chromium at phone size: NOT a device test.
//
// The exact fee is fetched and shown in the confirmation before anything
// is cancelled (always $0.00 while cancellations are free), the fee shown
// is sent with the cancellation, and the rider can then ask support to
// review the cancelled ride. All data is test fixtures.
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/rider-cancel.browser

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
jest.setTimeout(90000);

const HOST = "harveytaxiservice.test";

describeWithBrowser("rider cancellation in the rider dashboard (rider apps' WebView)", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [
        makeRide({
          id: "TEST-RIDE-CXL",
          rider_id: "RIDER_1",
          driver_id: "DRIVER_1",
          status: "driver_enroute",
          pickup_address: "TEST 2 Main St",
          dropoff_address: "TEST Airport",
          payment_id: null,
          accepted_at: new Date(Date.now() - 5 * 60000).toISOString(),
          created_at: new Date(Date.now() - 10 * 60000).toISOString()
        })
      ],
      driver_offers: [],
      audit_logs: [],
      ride_contact_attempts: [],
      push_subscriptions: [],
      system_flags: [{ key: "agent_assist_enabled", value: "true" }, { key: "agent_kill_switch", value: "false" }]
    });
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

  test("the fee is shown before confirming ($0.00), sent with the cancellation, then a review can be requested", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    await context.addInitScript(() => {
      try {
        localStorage.setItem("harvey_active_ride_id", "TEST-RIDE-CXL");
      } catch (e) {}
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const posts = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/cancel$/.test(new URL(r.url()).pathname)) posts.push(r.postDataJSON());
    });

    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector("#cancelActiveRideBtn:not([hidden])", { timeout: 20000 });

    // Declining the confirmation changes nothing.
    const dialogs = [];
    page.once("dialog", (d) => {
      dialogs.push(d.message());
      d.dismiss();
    });
    await page.click("#cancelActiveRideBtn");
    await page.waitForTimeout(300);
    expect(dialogs[0]).toMatch(/Cancel this ride\?\n\nCancellation fee: \$0\.00\nCancelling this ride is free\./);
    expect(posts).toEqual([]);
    expect(mockSupabaseClient._state.rides[0].status).toBe("driver_enroute");

    // Confirming cancels, sending the fee that was shown.
    page.once("dialog", (d) => d.accept());
    await page.click("#cancelActiveRideBtn");
    await page.waitForSelector("#cancelledRideNotice:not([hidden])");
    expect(await page.textContent("#cancelActiveRideNote")).toBe("Your ride was cancelled. Cancellation fee: $0.00.");
    expect(posts).toEqual([{ reason: "Rider cancelled from ride card", expected_fee_cents: 0 }]);
    const ride = mockSupabaseClient._state.rides[0];
    expect(ride).toMatchObject({ status: "cancelled", cancelled_by_type: "rider", cancellation_category: "rider_cancelled", cancellation_fee_cents: 0, cancellation_fee_shown_cents: 0 });

    // Support review: opens the assistant with the cancelled ride attached;
    // nothing is sent until the rider approves it.
    await page.waitForSelector("#reviewCancelledRideBtn:not([hidden])");
    await page.click("#reviewCancelledRideBtn");
    await page.waitForFunction(() => {
      const t = document.querySelector("[data-testid=hta-handoff-text]");
      return t && !t.disabled && t.value.startsWith("Please review this cancelled ride.");
    });
    expect(await page.inputValue("[data-testid=hta-handoff-text]")).toMatch(/Trip: .+: TEST 2 Main St to TEST Airport/);
    expect(await page.textContent("[data-testid=hta-handoff-ride]")).toMatch(/TEST 2 Main St to TEST Airport/);
    expect(mockSupabaseClient._state.audit_logs.filter((a) => a.action === "agent.case_opened")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await context.close();
  });
});
