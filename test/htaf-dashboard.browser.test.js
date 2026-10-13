// HTAF application page "Application Dashboard" (owner, 2026-10-13): shows
// HTAF-wide totals from GET /api/foundation/public-stats (counts only), so
// it follows status changes made in the HTAF admin portal, and shows "—"
// rather than a made-up 0 when the totals can't be read. Chromium; fake
// database; test data only.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-dashboard.browser
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
jest.setTimeout(120000);
const HOST = "harveytaxiservice.test";

const app = (id, status) => ({ id, application_code: `HTAF-TEST${id}`, status, email: `t${id}@example.test` });

describeWithBrowser("HTAF application dashboard", () => {
  let server;
  let browser;
  let base;
  let fake;

  beforeAll(async () => {
    fake = createFakeSupabase({
      htaf_applications: [
        app(1, "submitted"),
        app(2, "under_review"),
        app(3, "pending_documents"),
        app(4, "approved"),
        app(5, "scheduled"),
        app(6, "denied")
      ],
      audit_logs: [],
      system_flags: []
    });
    mockSupabaseClient = fake;
    // eslint-disable-next-line global-require
    const { app: server_ } = require("../server");
    server = await new Promise((resolve) => {
      const s = server_.listen(0, "127.0.0.1", () => resolve(s));
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

  async function readCards(route) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    if (route) await context.route(/\/api\/foundation\/public-stats/, route);
    // A count saved on this device by the old page must be ignored.
    await context.addInitScript(() => {
      try { localStorage.setItem("htaf_total_applications", "42"); } catch (e) { /* ignore */ }
    });
    const page = await context.newPage();
    await page.goto(`${base}/htaf-application.html`, { waitUntil: "load" });
    await page.waitForFunction(() => !/Loading/.test(document.getElementById("statsNote").textContent));
    const r = await page.evaluate(() => ({
      total: document.getElementById("totalApplications").textContent,
      pending: document.getElementById("pendingApplications").textContent,
      approved: document.getElementById("approvedApplications").textContent,
      scheduled: document.getElementById("scheduledRides").textContent,
      note: document.getElementById("statsNote").textContent,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    }));
    await context.close();
    return r;
  }

  test("shows HTAF-wide totals from the application records", async () => {
    const r = await readCards();
    expect([r.total, r.pending, r.approved, r.scheduled]).toEqual(["6", "3", "1", "1"]);
    expect(r.note).toMatch(/^Updated /);
    expect(r.overflow).toBeLessThanOrEqual(1);
  });

  test("an admin status change shows on the next load", async () => {
    const row = fake._state.htaf_applications.find((a) => a.id === 1);
    row.status = "approved";
    const r = await readCards();
    row.status = "submitted";
    expect([r.total, r.pending, r.approved, r.scheduled]).toEqual(["6", "2", "2", "1"]);
  });

  test("shows a dash, not 0, when the totals can't be read", async () => {
    const r = await readCards((route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
    expect([r.total, r.pending, r.approved, r.scheduled]).toEqual(["—", "—", "—", "—"]);
    expect(r.note).toContain("unavailable");
  });
});
