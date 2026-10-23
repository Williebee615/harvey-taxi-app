// HTAF partner access in the browser (owner decision 2026-10-23): the
// partner portal shows a coordinator only their own clients and sends new
// applications with the client's agreement confirmed; the owner's card in
// the HTAF admin shows and flips the switches.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-partner-access.browser
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
const { signPartnerSession } = require("../lib/htafPartnerAccess");

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

describeWithBrowser("HTAF partner access in the browser", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      system_flags: [{ key: "htaf_partner_access_enabled", value: "true" }],
      htaf_partners: [
        { id: "p1", name: "Safe Haven Shelter", partner_type: "shelter", agreement_ref: "AGR-1", enabled: true, created_at: "2026-10-23T00:00:00Z" },
        { id: "p2", name: "Other Clinic", partner_type: "clinic", agreement_ref: null, enabled: false, created_at: "2026-10-23T00:00:00Z" }
      ],
      htaf_partner_users: [{ id: "u1", partner_id: "p1", phone: "+16155550111", name: "Coordinator One", status: "active", session_version: 0 }],
      htaf_applications: [
        { id: "a1", application_code: "HTAF-OWN-1", first_name: "Own", last_name: "client", email: "own@example.test", status: "under_review", program_type: "medical", ride_date: "2026-11-01", created_at: "2026-10-20T00:00:00Z", partner_id: "p1" },
        { id: "a2", application_code: "HTAF-OTHER-2", first_name: "Other", last_name: "client", email: "other@example.test", status: "submitted", program_type: "medical", created_at: "2026-10-20T00:00:00Z", partner_id: "p2" }
      ],
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

  test("a signed-in coordinator sees only their clients and can send an application", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 1800 } });
    const token = signPartnerSession({ partnerUserId: "u1", partnerId: "p1", sessionVersion: 0, secret: process.env.HTAF_PARTNER_SESSION_SECRET, ttlHours: 1 });
    await context.addCookies([{ name: "htaf_partner_session", value: encodeURIComponent(token), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/htaf-partner.html`, { waitUntil: "load" });
    await page.locator("#portal:not(.hidden)").waitFor();
    const rows = await page.locator("#applicationRows").innerText();
    expect(rows).toContain("HTAF-OWN-1");
    expect(rows).toContain("Own C.");
    expect(rows).toContain("Under review");
    expect(rows).not.toContain("HTAF-OTHER-2");

    for (const [id, value] of [["first_name", "New"], ["last_name", "Client"], ["email", "new@example.test"], ["client_phone", "6155550199"], ["county", "Davidson"], ["city", "Nashville"], ["pickup_city", "Nashville"], ["ride_date", "2026-11-02"], ["destination", "100 Main St"], ["transportation_need", "ride to a job interview"]]) {
      await page.fill(`#${id}`, value);
    }
    await page.click('button:has-text("Send to HTAF")');
    expect(await page.locator("#applyBanner").innerText()).toContain("Confirm that the client agreed");
    await page.check("#client_consent");
    await page.click('button:has-text("Send to HTAF")');
    await page.locator("#applyBanner.ok").waitFor();
    expect(mockClient._state.htaf_applications.find((a) => a.email === "new@example.test")).toMatchObject({ partner_id: "p1" });
    await context.close();
  });

  test("the owner sees both switches and can turn the master switch off", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session(OWNER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-htaf.html#partners`, { waitUntil: "load" });
    await page.locator("#partnerAccessBody:not(.hidden)").waitFor();
    expect(await page.locator("#partnerMasterState").innerText()).toBe("Global Partner Portal: ON");
    expect(await page.locator("#partnerMasterToggle").getAttribute("aria-checked")).toBe("true");
    const list = await page.locator("#partnerList").innerText();
    expect(list).toContain("Safe Haven Shelter (Shelter)");
    expect(list).toContain("Agreement: AGR-1");
    expect(list).toContain("Access: ON");
    expect(list).toContain("Agreement: not recorded");
    expect(list).toContain("Access: OFF");
    expect(list).toContain("phone ending 0111");
    expect(list).not.toContain("+16155550111");
    await page.click("#partnerMasterToggle");
    await page.locator('#partnerMasterState:has-text("Global Partner Portal: OFF")').waitFor();
    expect(mockClient._state.system_flags[0].value).toBe("false");
    await context.close();
  });
});
