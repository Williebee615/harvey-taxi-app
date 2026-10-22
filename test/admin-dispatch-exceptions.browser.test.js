// Dispatch Exceptions card on the admin dashboard (console v1; synthetic
// rides and drivers, fake database, Chromium). Staff reassign with a note.
//   NODE_PATH="$(npm root -g)" npx jest test/admin-dispatch-exceptions.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, makeRide } = require("./rideTestHelpers");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const PICKUP = { pickup_lat: 36.1627, pickup_lng: -86.7816 };

describeWithBrowser("Admin dashboard: dispatch exceptions", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockClient = createFakeSupabase({
      drivers: [
        makeDriver({ id: "DRV-LIVE", first_name: "Sam", last_name: "Ortiz", online: true, last_seen_at: ago(1), current_lat: 36.17, current_lng: -86.78 }),
        makeDriver({ id: "DRV-OFF", first_name: "Dana", last_name: "Cole", online: false, last_seen_at: ago(40) })
      ],
      rides: [makeRide({ id: "RIDE-SYN-1", rider_name: "Test Rider", status: "driver_enroute", driver_id: "DRV-OFF", accepted_at: ago(30), driver_eta_to_pickup_minutes: 6, pickup_address: "100 Test Ave", dropoff_address: "200 Test Ave", ...PICKUP })],
      driver_offers: [], riders: [], audit_logs: [], system_flags: [], push_subscriptions: [], merchants: [], htaf_applications: []
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
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

  test("shows the exception with a suggested driver; reassigning needs a note and is audited", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });
    const list = page.locator("#dispatchExceptionsList");
    await list.locator("text=RIDE-SYN-1").waitFor();
    const text = await list.innerText();
    expect(text).toMatch(/Assigned driver is offline/);
    expect(text).toMatch(/later than the ETA/);
    expect(await page.locator("#dispatchExceptionsSummary").innerText()).toMatch(/1 critical/);
    // Cancelling the note prompt sends nothing.
    page.once("dialog", (d) => d.dismiss());
    await page.click('button[data-reassign-driver="DRV-LIVE"]');
    expect(mockClient._state.rides[0].driver_id).toBe("DRV-OFF");
    // A too-short note is refused by the server; nothing changes.
    page.once("dialog", (d) => d.accept("no"));
    await page.click('button[data-reassign-driver="DRV-LIVE"]');
    await page.waitForFunction(() => /at least 5 characters/.test(document.body.innerText));
    expect(mockClient._state.rides[0].driver_id).toBe("DRV-OFF");
    page.once("dialog", (d) => d.accept("Assigned driver offline for 40 minutes"));
    await page.click('button[data-reassign-driver="DRV-LIVE"]');
    await page.waitForFunction(() => /Ride reassigned/.test(document.body.innerText));
    expect(mockClient._state.rides[0]).toMatchObject({ driver_id: "DRV-LIVE", status: "driver_assigned", dispatch_status: "admin_reassigned" });
    const audit = mockClient._state.audit_logs.find((a) => a.action === "dispatch_ride_reassigned");
    expect(audit).toMatchObject({ actor_id: "owner@harvey.example", metadata: expect.objectContaining({ note: "Assigned driver offline for 40 minutes" }) });
    expect(errors).toEqual([]);
    await context.close();
  });
});
