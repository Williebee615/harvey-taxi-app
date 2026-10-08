// HTAF application, optional text-message consent, in a phone-sized
// browser on the foundation domain: the box loads unchecked, applying
// works without it, checking it is recorded as an opt-in, and the page has
// no horizontal scroll. Set HTAF_SMS_SCREENSHOT to save a screenshot of the
// empty applicant section with the consent box (no applicant data).
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-sms-consent.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.HTAF_SMS_ENABLED = "false";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

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
jest.setTimeout(120000);

const FOUNDATION = "harveytransportationfoundation.com";

describeWithBrowser("HTAF application -- optional text-message consent (390px)", () => {
  let server;
  let browser;
  let state;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ htaf_applications: [], htaf_sms_consents: [], audit_logs: [] });
    state = mockSupabaseClient._state;
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${FOUNDATION} 127.0.0.1:${server.address().port}`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function openForm() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === FOUNDATION ? route.continue() : route.abort()));
    await page.goto(`http://${FOUNDATION}/htaf-application.html`, { waitUntil: "load" });
    return page;
  }

  async function fill(page) {
    for (const [id, v] of [
      ["firstName", "Test"], ["lastName", "Applicant"], ["email", "applicant@example.test"], ["phone", "(615) 555-0100"],
      ["county", "Davidson County"], ["city", "Nashville"], ["pickupCity", "Nashville"], ["destination", "Clinic"],
      ["rideDate", "2026-10-20"], ["transportationNeed", "Appointment"]
    ]) {
      await page.fill(`#${id}`, v);
    }
    await page.check("#consent");
  }

  test("loads unchecked; an application without text consent is accepted and recorded as declined", async () => {
    const page = await openForm();
    expect(await page.isChecked("#smsConsent")).toBe(false);
    expect(await page.isVisible("#smsConsentSection")).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (process.env.HTAF_SMS_SCREENSHOT) {
      // Empty form at desktop width: no applicant information in the image,
      // and the phone-width bottom bar (fixed overlay) is hidden for the shot.
      const shot = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
      await shot.route("**/*", (route) => (new URL(route.request().url()).hostname === FOUNDATION ? route.continue() : route.abort()));
      await shot.goto(`http://${FOUNDATION}/htaf-application.html`, { waitUntil: "load" });
      await shot.addStyleTag({ content: ".bottom-nav{display:none!important}" });
      const section = shot.locator(".form-section").first();
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: process.env.HTAF_SMS_SCREENSHOT });
      await shot.close();
    }

    await fill(page);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => /submitted successfully/.test(document.getElementById("applicationStatus").textContent));
    await new Promise((r) => setTimeout(r, 50));
    expect(state.htaf_applications).toHaveLength(1);
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["declined"]);
    expect(page.errors).toEqual([]);
  });

  test("checking the box is recorded as an opt-in with the current wording version", async () => {
    const page = await openForm();
    await fill(page);
    await page.check("#smsConsent");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => /submitted successfully/.test(document.getElementById("applicationStatus").textContent));
    await new Promise((r) => setTimeout(r, 50));
    expect(state.htaf_sms_consents[state.htaf_sms_consents.length - 1]).toMatchObject({ event: "opt_in", consent_version: "htaf-sms-v1", source: "htaf-application-web-form" });
    // The form resets after submitting: the box is unchecked again.
    expect(await page.isChecked("#smsConsent")).toBe(false);
  });
});
