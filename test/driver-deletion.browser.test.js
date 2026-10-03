// Driver account deletion on the website's settings page without a driver
// session in the browser -- the case inside the Harvey Taxi rider app,
// which no longer opens the driver dashboard. The texted code (the driver
// app's own phone sign-in) proves the phone number; the session it returns
// is used for the deletion request only and never stored in the browser.
//
// Needs Playwright and Chromium; skips without them (CI has no browser).
//   NODE_PATH="$(npm root -g)" npx jest test/driver-deletion.browser
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, key) => mockSupabaseClient && mockSupabaseClient[key] }) }));

const mockTwilio = { sends: [], checks: [], checkStatus: "approved" };
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: { create: async (p) => (mockTwilio.sends.push(p), { sid: "VEtest", status: "pending" }) },
        verificationChecks: { create: async (p) => (mockTwilio.checks.push(p), { status: mockTwilio.checkStatus }) }
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
jest.setTimeout(90000);
const HOST = "harveytaxiservice.test";

describeWithBrowser("driver deletion with a texted code (no driver session in the browser)", () => {
  let server;
  let browser;
  let base;

  function reset() {
    mockTwilio.sends = [];
    mockTwilio.checks = [];
    mockTwilio.checkStatus = "approved";
    mockSupabaseClient = createFakeSupabase({
      drivers: [makeDriver({ id: "DRIVER_A", phone: "(615) 555-0201", online: false })],
      riders: [],
      deletion_requests: [],
      driver_push_tokens: [],
      audit_logs: [],
      system_flags: []
    });
  }

  beforeAll(async () => {
    reset();
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

  async function openDeletion() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/settings.html?account=driver#account-deletion`, { waitUntil: "load" });
    await page.waitForFunction(() => /not signed in as a driver/.test(document.getElementById("deletionIdentity").textContent));
    return page;
  }
  const notice = (page) => page.textContent("#deletionNotice");

  test("phone code proves the driver; the request is filed; nothing is stored in the browser", async () => {
    reset();
    const page = await openDeletion();
    expect(await page.isVisible("#deletionSmsFields")).toBe(true);
    expect(await page.getAttribute("#deletionPhone", "placeholder")).toMatch(/driver account/);
    await page.fill("#deletionPhone", "615-555-0201");
    await page.click("button[onclick='sendAccountDeletionCode()']");
    await page.waitForFunction(() => /a code is on its way/.test(document.getElementById("deletionNotice").textContent));
    expect(mockTwilio.sends).toEqual([expect.objectContaining({ to: "+16155550201", channel: "sms" })]);

    await page.fill("#deletionCode", "123456");
    await page.fill("#deletionConfirmText", "DELETE");
    await page.click("button[onclick='requestAccountDeletion()']");
    await page.waitForFunction(() => /submitted|received|request/i.test(document.getElementById("deletionNotice").textContent) && !/Submitting/.test(document.getElementById("deletionNotice").textContent));
    expect(mockSupabaseClient._state.deletion_requests).toEqual([expect.objectContaining({ user_id: "DRIVER_A" })]);
    expect(await page.evaluate(() => localStorage.getItem("harvey_driver_token"))).toBeNull();
    await page.context().close();
  });

  test("a wrong code files nothing", async () => {
    reset();
    mockTwilio.checkStatus = "pending";
    const page = await openDeletion();
    await page.fill("#deletionPhone", "615-555-0201");
    await page.fill("#deletionCode", "000000");
    await page.fill("#deletionConfirmText", "DELETE");
    await page.click("button[onclick='requestAccountDeletion()']");
    await page.waitForFunction(() => /Invalid or expired code|didn't work/.test(document.getElementById("deletionNotice").textContent));
    expect(mockSupabaseClient._state.deletion_requests).toEqual([]);
    await page.context().close();
  });

  test("an unknown number gets the same answer and no text", async () => {
    reset();
    const page = await openDeletion();
    await page.fill("#deletionPhone", "615-555-0999");
    await page.click("button[onclick='sendAccountDeletionCode()']");
    await page.waitForFunction(() => /a code is on its way/.test(document.getElementById("deletionNotice").textContent));
    expect(mockTwilio.sends).toEqual([]);
    expect(await notice(page)).toMatch(/If that number is on a driver account/);
    await page.context().close();
  });
});
