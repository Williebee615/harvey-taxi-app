// HTAF review assistant panel in the HTAF admin page (synthetic data,
// fake database, Chromium): labelled as automated suggestions, staff can
// mark an item wrong (it disappears and is recorded), copy chosen
// follow-up questions into the notes box, and nothing changes the
// application's status.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-review-assist.browser
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
const SHOTS = process.env.PAGE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "htaf-review-assist") : null;
const CASEWORKER = "caseworker@htaf.example";

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("HTAF admin: review assistant panel", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      htaf_applications: [
        {
          id: "syn-incomplete",
          application_code: "HTAF-20261011-SYN002",
          first_name: "Ivy",
          last_name: "",
          email: "ivy.synthetic@example.test",
          phone: "",
          county: "Davidsn",
          pickup_city: "",
          destination: "Synthetic Clinic",
          ride_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          transportation_need: "ride",
          program_type: "medical",
          applicant_type: "caregiver",
          status: "submitted",
          submitted_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          created_at: new Date(Date.now() - 2 * 86400000).toISOString()
        }
      ],
      admin_roles: [{ email: CASEWORKER, role: "htaf_caseworker" }],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      rides: [],
      htaf_assistant_questions: [],
      system_flags: [{ key: "htaf_review_assist_enabled", value: "true" }]
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

  test("labelled suggestions; mark wrong; copy questions to notes; status unchanged", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 2200 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session(CASEWORKER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-htaf.html`, { waitUntil: "load" });
    await page.locator(".queue-item").first().click();
    await page.locator('button:has-text("Review Assistant")').click();
    const panel = page.locator("#triagePanel");
    await panel.locator("text=Not a decision").first().waitFor();

    const text = await panel.innerText();
    expect(text).toContain("Review Assistant: automated suggestions, not a decision");
    expect(text).toContain("a person approves or denies every application");
    expect(text).toContain("may be misspelled");
    expect(text).not.toMatch(/Ivy|ivy\.synthetic|Synthetic Clinic/);
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, "1-suggestions.png") });

    // Staff mark the county suggestion wrong: it disappears and is recorded.
    await panel.locator('li[data-check="county_not_recognized"] button:has-text("Wrong")').click();
    await panel.locator('li[data-check="county_not_recognized"]').waitFor({ state: "detached" });
    const fb = mockClient._state.audit_logs.find((a) => a.action === "htaf_review_assist_feedback");
    expect(fb.metadata).toEqual({ engine: "htaf-review-assist-v1", check: "county_not_recognized", verdict: "incorrect" });

    // Copy one chosen question into the notes box (not saved, not sent).
    await panel.locator('input[data-question="missing_pickup"]').check();
    await panel.locator('button:has-text("Copy selected to notes")').click();
    const notes = await page.locator("#adminNotes").inputValue();
    expect(notes).toContain("Where will the ride start (city or town)?");
    expect(notes).not.toContain("What date do you need the ride?");
    if (SHOTS) await page.locator("#triagePanel").screenshot({ path: path.join(SHOTS, "2-after-staff-actions.png") });

    expect(mockClient._state.htaf_applications[0].status).toBe("submitted");
    expect(mockClient._log.filter((e) => e.table === "htaf_applications" && e.op !== "select")).toEqual([]);
    await context.close();
  });
});
