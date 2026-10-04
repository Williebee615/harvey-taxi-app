// Browser check of the rider support handoff (phase 4) in the rider
// dashboard, the page the Harvey Taxi rider iOS and Android apps show in
// their WebView. Desktop Chromium at phone size: NOT a device test.
// Writes local screenshots to docs/screenshots/ai-phase4/ when
// HANDOFF_SCREENSHOTS=1.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.SUPPORT_EMAIL = "support@example.test";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken } = require("./rideTestHelpers");

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
const SHOTS = process.env.HANDOFF_SCREENSHOTS === "1" ? path.join(__dirname, "..", "docs", "screenshots", "ai-phase4") : null;

async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.id = "__testDataLabel";
    tag.textContent = "LOCAL TEST SERVER - DESKTOP CHROMIUM - NOT A DEVICE";
    tag.setAttribute("style", "position:fixed;left:6px;top:6px;z-index:2147483647;background:#ffd76a;color:#1a1300;font:800 11px/1 Arial,sans-serif;padding:5px 7px;border-radius:6px");
    document.body.appendChild(tag);
  });
  await page.screenshot({ path: path.join(SHOTS, name) });
  await page.evaluate(() => document.getElementById("__testDataLabel")?.remove());
}

describeWithBrowser("rider assistant: support handoff", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [
        makeRide({ id: "TEST-RIDE-LOST", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "completed", pickup_address: "TEST 1 Broadway", dropoff_address: "TEST BNA", created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), completed_at: new Date(Date.now() - 2 * 3600e3).toISOString() })
      ],
      audit_logs: [],
      system_flags: [{ key: "agent_assist_enabled", value: "true" }, { key: "agent_kill_switch", value: "false" }]
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

  async function openPanel({ signedIn, question = "What is the cancellation fee?", button = "Send a request to support" }) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (signedIn) await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
    if (signedIn) await page.waitForFunction(() => window.__harveyAssistantAccount && window.__harveyAssistantAccount.id === "RIDER_1", null, { timeout: 20000 });
    await page.click("[data-testid=hta-launcher]");
    await page.fill("#htaPanel input[type=text]", question);
    await page.press("#htaPanel input[type=text]", "Enter");
    await page.waitForSelector(`#htaPanel button:has-text('${button}')`, { timeout: 15000 });
    return { context, page };
  }

  const cases = (category = "support_request") => mockSupabaseClient._state.audit_logs.filter((a) => a.action === "agent.case_opened" && (a.metadata || {}).category === category);

  test("signed in: review, edit, send; reference shown only after the server confirms", async () => {
    const { context, page } = await openPanel({ signedIn: true });
    await page.click("#htaPanel button:has-text('Send a request to support')");
    await page.waitForFunction(() => {
      const t = document.querySelector("[data-testid=hta-handoff-text]");
      return t && !t.disabled && t.value.includes("What is the cancellation fee?");
    });
    expect(cases()).toHaveLength(0); // nothing sent yet
    await page.fill("[data-testid=hta-handoff-text]", "I need help from Harvey Taxi support.\n\nWhat I asked the assistant:\n- What is the cancellation fee?\n\nMore details: test fixture request.");
    await shot(page, "rider-handoff-review.png");
    await page.click("[data-testid=hta-handoff-send]");
    await page.waitForFunction(() => /support queue as case HT-SUP-\d{8}-[A-Z0-9]{6}/.test(document.querySelector("#htaPanel .hta-log").textContent));
    expect(await page.$("[data-testid=hta-handoff]")).toBeNull();
    const [row] = cases();
    expect(row.metadata).toMatchObject({ reporter_role: "rider", reporter_id: "RIDER_1", approved_by_user: true });
    expect(row.metadata.summary).toContain("test fixture request");
    expect(await page.textContent("#htaPanel .hta-log")).toContain(row.entity_id);
    await shot(page, "rider-handoff-sent.png");
    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("cancel sends nothing; signed out can't send and is asked to sign in", async () => {
    const before = cases().length;
    const signedIn = await openPanel({ signedIn: true });
    await signedIn.page.click("#htaPanel button:has-text('Send a request to support')");
    await signedIn.page.waitForSelector("[data-testid=hta-handoff-cancel]");
    await signedIn.page.click("[data-testid=hta-handoff-cancel]");
    await signedIn.page.waitForFunction(() => document.querySelector("#htaPanel .hta-log").textContent.includes("Not sent. Nothing was shared with support."));
    expect(cases()).toHaveLength(before);
    await signedIn.context.close();

    const { context, page } = await openPanel({ signedIn: false });
    await page.click("#htaPanel button:has-text('Send a request to support')");
    await page.waitForFunction(() => /Please sign in first/.test(document.querySelector("[data-testid=hta-handoff]").textContent));
    expect(await page.isDisabled("[data-testid=hta-handoff-send]")).toBe(true);
    expect(cases()).toHaveLength(before);
    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("lost item: the report names the rider's own trip, can be linked to it, and a double tap creates one case", async () => {
    const { context, page } = await openPanel({ signedIn: true, question: "I left my phone in the car", button: "Report a lost item" });
    const sends = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/agent/rider/handoff")) sends.push(JSON.parse(r.postData() || "{}")); });
    await page.click("#htaPanel button:has-text('Report a lost item')");
    await page.waitForFunction(() => {
      const t = document.querySelector("[data-testid=hta-handoff-text]");
      return t && !t.disabled && t.value.startsWith("Lost item report.");
    });
    expect(await page.inputValue("[data-testid=hta-handoff-text]")).toContain("TEST 1 Broadway to TEST BNA");
    expect(await page.textContent("[data-testid=hta-handoff-ride]")).toContain("Attach this trip for support");
    await page.fill("[data-testid=hta-handoff-text]", (await page.inputValue("[data-testid=hta-handoff-text]")).replace("Item: ", "Item: black phone (test fixture)"));
    await shot(page, "rider-lost-item-review.png");
    // Double tap: the button is disabled after the first tap.
    await page.dblclick("[data-testid=hta-handoff-send]");
    await page.waitForFunction(() => /support queue as case HT-SUP-/.test(document.querySelector("#htaPanel .hta-log").textContent));
    const lost = cases("lost_item");
    expect(lost).toHaveLength(1);
    expect(lost[0].metadata).toMatchObject({ ride_id: "TEST-RIDE-LOST", reporter_id: "RIDER_1" });
    expect(sends.length).toBe(1);
    expect(sends[0]).toMatchObject({ kind: "lost_item", ride_id: "TEST-RIDE-LOST", approved: true, request_id: expect.any(String) });
    await shot(page, "rider-lost-item-sent.png");
    expect(page.errors).toEqual([]);
    await context.close();
  });
});
