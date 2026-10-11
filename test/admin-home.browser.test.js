// Admin Home (public/admin-home.html): the driver list shows real names and
// approves through PATCH /api/admin/drivers/:id/approve (the old
// POST /api/admin/approve-driver no longer exists). Chromium; fake database.
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-home.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver } = require("./rideTestHelpers");

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

describeWithBrowser("Admin Home: driver list and approval", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      drivers: [
        makeDriver({ id: "DRIVER_OK", first_name: "Morgan", last_name: "Blake", approval_status: "approved" }),
        makeDriver({ id: "DRIVER_PENDING", first_name: "Jordan", last_name: "Reed", email: "jordan@example.test", approval_status: "pending", status: "pending", online: false }),
        makeDriver({ id: "DRIVER_NONAME", first_name: null, last_name: null, email: "noname@example.test", approval_status: "pending", status: "pending", online: false }),
        makeDriver({ id: "DRIVER_XSS", first_name: "<img src=x onerror=window.__xss=1>", last_name: "", email: "x@example.test", approval_status: "pending", status: "pending", online: false })
      ],
      riders: [],
      rides: [],
      audit_logs: [],
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

  test("names show, approved drivers have no button, Approve uses the real route and approves", async () => {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-admin-token": "test-admin-token" } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    const calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (r.url().includes("/api/admin/")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-home.html`);
    await page.waitForSelector("[data-driver-id=DRIVER_PENDING]");

    const text = await page.textContent("#drivers");
    expect(text).toContain("Jordan Reed");
    expect(text).toContain("Morgan Blake");
    expect(text).toContain("(no name on file)");
    expect(text).not.toContain("null");
    expect(await page.$("[data-driver-id=DRIVER_OK] [data-approve]")).toBeNull();
    // Names are shown as text, never run as HTML.
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.textContent("[data-driver-id=DRIVER_XSS]")).toContain("<img src=x");

    await page.click("[data-driver-id=DRIVER_PENDING] [data-approve]");
    await page.waitForFunction(() => !document.querySelector("[data-driver-id=DRIVER_PENDING] [data-approve]"));
    expect(calls).toContain("PATCH /api/admin/drivers/DRIVER_PENDING/approve");
    expect(calls.some((c) => c.includes("approve-driver"))).toBe(false);
    const row = mockSupabaseClient._state.drivers.find((d) => d.id === "DRIVER_PENDING");
    expect(row.approval_status).toBe("approved");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("without admin access it says so and approves nothing", async () => {
    const context = await browser.newContext();
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-home.html`);
    await page.waitForFunction(() => document.getElementById("drivers").textContent.trim().length > 0);
    expect(await page.$("[data-approve]")).toBeNull();
    await context.close();
  });
});
