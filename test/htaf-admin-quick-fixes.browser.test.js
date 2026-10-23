// HTAF admin quick fixes (owner approval 2026-10-23): plain wording
// instead of internal labels, no "Schedule Ride" while HTAF ride creation
// is switched off, a document request that says it does not contact the
// applicant, and a search Clear button with a "filtered" count.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-admin-quick-fixes.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
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
const CASEWORKER = "caseworker@htaf.example";

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("HTAF admin: quick fixes", () => {
  let server;
  let browser;
  let base;

  const application = (id, code, county) => ({
    id,
    application_code: code,
    first_name: "Syn",
    last_name: "Thetic",
    email: `${id}@example.test`,
    phone: "",
    county,
    pickup_city: "Nashville",
    destination: "Synthetic Destination",
    ride_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    transportation_need: "ride",
    program_type: "medical",
    applicant_type: "self",
    status: "submitted",
    submitted_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86400000).toISOString()
  });

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      htaf_applications: [application("syn-a", "HTAF-20261011-SYN101", "Davidson"), application("syn-b", "HTAF-20261011-SYN102", "Williamson")],
      admin_roles: [{ email: CASEWORKER, role: "htaf_caseworker" }],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      rides: [],
      htaf_assistant_questions: [],
      system_flags: []
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

  test("plain wording, no Schedule Ride while booking is off, honest document request, search Clear", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2200 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session(CASEWORKER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-htaf.html`, { waitUntil: "load" });
    await page.locator(".queue-item").first().waitFor();

    // No internal jargon anywhere on the page.
    expect(await page.content()).not.toMatch(/Phase 11|Server J|requireAdmin/);

    // Search left with "TN" (browser autofill) hides everything; the count
    // says so and Clear brings the records back.
    expect(await page.locator("#queueCount").innerText()).toBe("2 records");
    await page.fill("#searchInput", "TN");
    expect(await page.locator("#queueCount").innerText()).toBe("0 of 2 records (filtered)");
    await page.click("#clearFiltersButton");
    expect(await page.inputValue("#searchInput")).toBe("");
    expect(await page.locator("#queueCount").innerText()).toBe("2 records");

    // Ride booking is switched off: no Schedule Ride button.
    await page.locator(".queue-item").first().click();
    const actions = page.locator(".detail-actions");
    await actions.waitFor();
    expect(await actions.locator('button:has-text("Schedule Ride")').count()).toBe(0);
    expect(await actions.innerText()).toContain("Ride booking: not available yet");

    // The document request says plainly that nobody is contacted.
    await actions.locator('button:has-text("Record Document Request")').click();
    const modal = page.locator("#requestDocsModal");
    expect(await modal.innerText()).toContain("This does not contact the applicant.");
    expect(await modal.innerText()).not.toMatch(/Send a document request|Send Request/);
    await context.close();
  });
});
