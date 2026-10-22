// Browser check of merchant-apply.html (owner decision 2026-10-22: two
// paths on one page). Desktop Chromium at phone size: NOT a device test.
// - Partnership path is shown first; #delivery opens the delivery pilot.
// - "Application Received" appears only after the server accepts the
//   inquiry; on an error the message is shown and the entries are kept.
// - No sideways scrolling at phone width.
// The submit responses are stubbed in the browser; nothing is stored.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/merchant-apply-page.browser
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

describeWithBrowser("merchant-apply.html: two paths, confirmation only after success", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ audit_logs: [] });
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

  async function open(hash = "") {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/merchant-apply.html${hash}`);
    return { context, page, errors };
  }

  test("partnership inquiry: error keeps the entries; success shows Application Received", async () => {
    const { context, page, errors } = await open();
    const replies = [
      { status: 503, body: { ok: false, error: "Partnership inquiries aren't open yet. Please email support@harveytaxiservice.com." } },
      { status: 201, body: { ok: true, received: true, inquiry: { id: "P1", status: "new" } } }
    ];
    const sent = [];
    await context.route("**/api/partnerships/inquiries", (route) => {
      sent.push(JSON.parse(route.request().postData()));
      const r = replies[sent.length - 1];
      route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
    });
    expect(await page.isVisible("#partnershipForm")).toBe(true);
    expect(await page.isVisible("#merchantApplyForm")).toBe(false);
    expect(await page.textContent("h1")).toContain("Let's Move Business Forward.");

    await page.fill('[name="organization_name"]', "Test Hotel Group");
    await page.selectOption('[name="business_type"]', "llc");
    await page.selectOption('[name="industry"]', "hospitality");
    await page.fill('#partnershipForm [name="contact_name"]', "Test Contact");
    await page.fill('#partnershipForm [name="contact_email"]', "contact@example.test");
    await page.fill('#partnershipForm [name="contact_phone"]', "6155550100");
    await page.check('[name="interests"][value="transportation_partnership"]');
    await page.fill('[name="message"]', "We'd like to discuss transportation options for our guests.");
    await page.check('#partnershipForm [name="consent"]');

    await page.click("#partnershipSubmit");
    await page.waitForFunction(() => /aren't open yet/.test(document.querySelector("#partnershipStatus").textContent));
    expect(await page.isVisible("#partnershipReceived")).toBe(false);
    expect(await page.inputValue('[name="organization_name"]')).toBe("Test Hotel Group");

    await page.click("#partnershipSubmit");
    await page.waitForSelector("#partnershipReceived", { state: "visible" });
    expect(await page.textContent("#partnershipReceived")).toContain("Application Received");
    expect(await page.isVisible("#partnershipForm")).toBe(false);
    expect(sent[1]).toMatchObject({ organization_name: "Test Hotel Group", interests: ["transportation_partnership"], consent: true });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("#delivery opens the delivery pilot path with its notice and exclusions", async () => {
    const { context, page, errors } = await open("#delivery");
    expect(await page.isVisible("#merchantApplyForm")).toBe(true);
    expect(await page.isVisible("#partnershipForm")).toBe(false);
    expect(await page.textContent("#deliveryPanel")).toContain("Delivery isn't live yet");
    expect(await page.$$eval("#excludedItems li", (els) => els.length)).toBeGreaterThan(0);
    await page.click('[data-path="partnership"]');
    expect(await page.isVisible("#partnershipForm")).toBe(true);
    expect(await page.isVisible("#merchantApplyForm")).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });
});
