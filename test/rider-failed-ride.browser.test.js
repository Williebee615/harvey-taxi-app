// Browser check: a ride that ends as "failed" (no driver available) tells
// the rider plainly that it was cancelled and they were not charged.
//
// (Setup shared with rider-tracking-token.browser.test.js.) Originally:
// Browser check that the rider dashboard keeps live tracking working under
// the ride-access rules (lib/rideAccess.js): the tracking token from the
// ride-request response is stored, the page's own request helpers send it
// to GET /api/rides/:id/status, and its EventSource URL carries it to the
// stream. Without the token the same calls are refused.
//
// Needs Playwright and Chromium; skips without them (CI has no browser).
//   NODE_PATH="$(npm root -g)" npx jest test/rider-tracking-token.browser

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
const { makeRider, makeDriver, makeRide } = require("./rideTestHelpers");
const { signRideTrackingToken, deriveTrackingSecret } = require("../lib/rideAccess");

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
const token = signRideTrackingToken("RIDE_FAILED", deriveTrackingSecret({ quoteSecret: process.env.RIDE_QUOTE_SECRET }));

describeWithBrowser("rider page: failed ride", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider({ id: "RIDER_1" })],
      drivers: [makeDriver({ id: "DRIVER_1" })],
      rides: [makeRide({ id: "RIDE_FAILED", status: "failed", dispatch_status: "max_attempts_reached", rider_id: "RIDER_1", driver_id: null })],
      system_flags: []
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

  test("shows 'No driver available' and that the rider was not charged", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addInitScript((t) => {
      localStorage.setItem("harvey_ride_tracking_tokens", JSON.stringify({ RIDE_FAILED: t }));
    }, token);
    const page = await context.newPage();
    await page.goto(`${base}/rider-dashboard.html?screen=track&ride_id=RIDE_FAILED`);
    await page.waitForFunction(() => /You have not been charged/.test(document.body.innerText), null, { timeout: 15000 });
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toMatch(/No driver was available for this ride, so it was cancelled\. You have not been charged\. Please book again\./);
    expect(await page.textContent("#dispatchStateText")).toBe("No driver available");
    expect(await page.getAttribute("#noticeBox", "class")).toMatch(/warning/);
    await context.close();
  });
});
