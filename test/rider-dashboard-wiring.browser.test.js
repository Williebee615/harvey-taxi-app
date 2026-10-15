// Rider dashboard wiring in a real browser (synthetic rider, local server):
// the quick support box sends to the same support queue as the assistant
// (POST /api/agent/rider/handoff) and shows the case reference; the status
// refresh uses the readiness route; no request goes to an address the
// server doesn't have. Needs Playwright and Chromium; skips without them.

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, signTestRiderToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";
const ORIGINAL_ENV = { ...process.env };

describeWithBrowser("rider dashboard: support box and status refresh", () => {
  let browser;
  let server;
  let base;
  let spies;

  beforeAll(async () => {
    spies = ["log", "warn", "error", "info"].map((l) => jest.spyOn(console, l).mockImplementation(() => {}));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      RIDER_SESSION_SECRET: "test-rider-session-secret",
      DRIVER_SESSION_SECRET: "test-driver-session-secret",
      RIDE_QUOTE_SECRET: "test-ride-quote-secret",
      ADMIN_API_TOKEN: "test-admin-token"
    };
    for (const n of ["CANONICAL_HOST", "FOUNDATION_HOST", "STRIPE_SECRET_KEY", "SENDGRID_API_KEY"]) delete process.env[n];
    mockSupabaseClient = createFakeSupabase({
      system_flags: [{ key: "agent_assist_enabled", value: "true" }, { key: "rider_history_enabled", value: "true" }],
      riders: [makeRider({ id: "RIDER_DASH", email: "dash-rider@example.test" })],
      rides: [],
      audit_logs: []
    });
    let app;
    jest.isolateModules(() => {
      ({ app } = require("../server"));
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    spies.forEach((s) => s.mockRestore());
    process.env = { ...ORIGINAL_ENV };
  });

  test("support box files a case; status refresh hits the readiness route; no dead addresses", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_DASH")), url: base }]);
    await context.addInitScript(() => {
      localStorage.setItem("harvey_rider_id", "RIDER_DASH");
      localStorage.setItem("harvey_rider_profile", JSON.stringify({ id: "RIDER_DASH", email: "dash-rider@example.test" }));
    });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/rider-dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("sendSupportBtn"));
    await page.waitForTimeout(1500);

    expect(requests).toContain("GET /api/riders/RIDER_DASH/readiness");

    await page.evaluate(() => {
      document.getElementById("quickSupportSubject").value = "Charged twice";
      document.getElementById("quickSupportMessage").value = "I see two holds for one trip on my card.";
      document.getElementById("sendSupportBtn").click();
    });
    const handoff = await page.waitForResponse((r) => r.url().endsWith("/api/agent/rider/handoff"));
    expect(handoff.status()).toBe(200);
    const body = await handoff.json();
    expect(body.message).toMatch(/support queue as case HT-SUP-/);
    await page.waitForFunction(() => document.body.innerText.includes("support queue as case"));

    const cases = mockSupabaseClient._state.audit_logs.filter((a) => a.action === "agent.case_opened");
    expect(cases.length).toBeGreaterThan(0);
    expect(JSON.stringify(cases)).toMatch(/Charged twice/);

    expect(requests.filter((r) => /\/api\/(support\/request|riders\/status|riders\/start-persona)/.test(r))).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
});
