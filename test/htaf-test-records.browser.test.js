// HTAF test records in the admin (owner decision 2026-10-23), in Chromium.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-test-records.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.HTAF_PARTNER_SESSION_SECRET = "test-htaf-partner-secret";
delete process.env.OPENAI_API_KEY;

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");

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
const OWNER = "owner@harvey.example";

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("HTAF test records in the admin", () => {
  let server;
  let browser;
  let base;
  const row = (id, extra) => ({ id, application_code: `HTAF-SYN-${id}`, first_name: "Syn", last_name: id, email: `${id}@gmail.com`, phone: "", county: "Davidson", program_type: "medical", status: "submitted", ride_date: "2026-10-28", created_at: new Date(Date.now() - 86400000).toISOString(), ...extra });

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      htaf_applications: [row("t1", { is_test: true, test_marked_by: OWNER, test_marked_at: "2026-10-23T19:00:00Z" }), row("r1", { is_test: false }), row("r2", { is_test: false })],
      htaf_assistant_questions: [],
      htaf_partners: [],
      htaf_partner_users: [],
      system_flags: [],
      admin_roles: [{ email: OWNER, role: "super_admin" }],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      rides: []
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

  test("tests are hidden and left out of counts; they can be shown and marked", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2000 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session(OWNER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-htaf.html`, { waitUntil: "load" });
    await page.locator(".queue-item").first().waitFor();
    expect(await page.locator(".queue-item").count()).toBe(2);
    expect(await page.locator("#metricTotal").innerText()).toBe("2");
    await page.locator('#syncPillText:has-text("Connected (2 records)")').waitFor();
    await page.check("#showTestRecords");
    await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 3);
    expect(await page.locator("#queueList").innerText()).toContain("TEST RECORD");
    // Mark a real one as a test.
    await page.uncheck("#showTestRecords");
    await page.locator(".queue-item.active").waitFor();
    await page.click('button:has-text("Mark as test record")');
    await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 1);
    expect(mockClient._state.htaf_applications.filter((a) => a.is_test).length).toBe(2);
    expect(await page.locator("#metricTotal").innerText()).toBe("1");
    await context.close();
  });
});
