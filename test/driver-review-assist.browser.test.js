// Driver review assistant panel on the Harvey Taxi admin dashboard
// (synthetic drivers, fake database, Chromium): labelled suggestions,
// "not configured" integrations, expired document, duplicate prompt; staff
// mark an item wrong (recorded, removed); no driver changed.
//   NODE_PATH="$(npm root -g)" npx jest test/driver-review-assist.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
delete process.env.PERSONA_API_KEY;
delete process.env.CHECKR_API_KEY;
delete process.env.OPENAI_API_KEY;

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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
const SHOTS = process.env.PAGE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "driver-review-assist") : null;
const DISPATCHER = "dispatch@harvey.example";
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("Admin dashboard: driver review assistant", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      drivers: [
        {
          id: "DRV-SYN-1",
          first_name: "Dana",
          last_name: "Synthetic",
          email: "dana.synthetic@example.test",
          phone: "6155550123",
          created_at: "2026-10-01T00:00:00Z",
          approval_status: "pending",
          status: "pending",
          email_verified: true,
          phone_verified: true,
          drivers_license_number: "TN-SYN-1",
          vehicle_make: "Toyota",
          vehicle_model: "Camry",
          vehicle_year: "2021",
          vehicle_plate: "SYN-123",
          insurance_confirmed: true,
          license_expires_on: day(-5),
          insurance_expires_on: day(200),
          registration_expires_on: day(300),
          accepted_terms: true,
          accepted_background_check_consent: true,
          accepted_driver_policy: true
        },
        { id: "DRV-SYN-2", email: "other@example.test", phone: "+16155550123", created_at: "2026-09-01T00:00:00Z", approval_status: "rejected" }
      ],
      riders: [],
      rides: [],
      htaf_applications: [],
      admin_roles: [{ email: DISPATCHER, role: "dispatcher" }],
      admin_capability_grants: [{ email: DISPATCHER, capability: "drivers.onboarding_review", revoked_at: null }],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      system_flags: [{ key: "driver_review_assist_enabled", value: "true" }]
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test("labelled suggestions; mark wrong; nothing changed", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session(DISPATCHER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });
    const button = page.locator('button:has-text("Review Assistant")').first();
    await button.waitFor();
    await button.click();
    const panel = page.locator("#driverReview-DRV-SYN-1 .review-panel");
    await panel.waitFor();
    const text = await panel.innerText();
    expect(text).toContain("automated suggestions, not a decision");
    expect(text).toContain("staff approve, reject, activate or suspend every driver");
    expect(text).toMatch(/identity persona\s+not configured/i);
    expect(text).toMatch(/background checkr\s+not configured/i);
    expect(text).toContain("The recorded license expiration date has passed.");
    expect(text).toContain("not evidence of fraud");
    expect(text).toContain("DRV-SYN-2");
    expect(text).not.toMatch(/Dana|dana\.synthetic|6155550123|TN-SYN-1|SYN-123/);
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "1-driver-suggestions.png") });

    await panel.locator('li[data-check="possible_duplicate"] button:has-text("Wrong")').click();
    await panel.locator('li[data-check="possible_duplicate"]').waitFor({ state: "detached" });
    expect(mockClient._state.audit_logs.find((a) => a.action === "driver_review_assist_feedback").metadata).toEqual({ engine: "driver-review-assist-v1", check: "possible_duplicate", verdict: "incorrect", reason: null });
    expect(mockClient._state.drivers[0].approval_status).toBe("pending");
    expect(mockClient._log.filter((e) => e.table === "drivers" && e.op !== "select")).toEqual([]);
    await context.close();
  });
});
