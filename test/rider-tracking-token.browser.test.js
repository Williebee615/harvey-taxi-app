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
const token = signRideTrackingToken("RIDE_1", deriveTrackingSecret({ quoteSecret: process.env.RIDE_QUOTE_SECRET }));

describeWithBrowser("rider dashboard live tracking with ride tracking tokens", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider({ id: "RIDER_1" })],
      drivers: [makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78, last_seen_at: new Date().toISOString() })],
      rides: [makeRide({ id: "RIDE_1", status: "driver_enroute", rider_id: "RIDER_1", driver_id: "DRIVER_1" })],
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

  async function trackingRun({ withToken }) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (withToken) {
      // What the page stored when this device requested the ride.
      await context.addInitScript((t) => {
        localStorage.setItem("harvey_ride_tracking_tokens", JSON.stringify({ RIDE_1: t }));
      }, token);
    }
    const page = await context.newPage();
    const seen = [];
    page.on("response", (r) => {
      const m = /\/api\/rides\/RIDE_1\/(status|stream)/.exec(r.url());
      if (m) seen.push({ kind: m[1], status: r.status(), token: r.request().headers()["x-ride-tracking-token"] || null, url: r.url() });
    });
    // The page's own tracking deep link ("Open Live Tracking").
    await page.goto(`${base}/rider-dashboard.html?screen=track&ride_id=RIDE_1`);
    await page.waitForTimeout(2500);
    await context.close();
    return seen;
  }

  test("with the stored token, the page's status reads and live stream are allowed", async () => {
    const seen = await trackingRun({ withToken: true });
    const statusReads = seen.filter((r) => r.kind === "status");
    expect(statusReads.length).toBeGreaterThan(0);
    statusReads.forEach((r) => {
      expect(r.status).toBe(200);
      expect(r.token).toBe(token);
    });
    const streams = seen.filter((r) => r.kind === "stream");
    expect(streams.length).toBeGreaterThan(0);
    expect(streams[0].status).toBe(200);
    expect(streams[0].url).toContain(`?t=${encodeURIComponent(token)}`);
  });

  test("without it (another device that only knows the ride id), status and stream are refused", async () => {
    const seen = await trackingRun({ withToken: false });
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((r) => expect(r.status).toBe(404));
  });

  test("captureFrom stores the token from a ride-request response", async () => {
    const context = await browser.newContext();
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/rider-dashboard.html`);
    const stored = await page.evaluate(() => {
      window.HarveyRideTracking.captureFrom({ ok: true, ride: { id: "RIDE_9" }, tracking_token: "abc" });
      return [window.HarveyRideTracking.get("RIDE_9"), window.HarveyRideTracking.headersFor("/api/rides/RIDE_9/status"), window.HarveyRideTracking.headersFor("/api/rides/RIDE_8/status")];
    });
    expect(stored).toEqual(["abc", { "x-ride-tracking-token": "abc" }, {}]);
    await context.close();
  });
});
