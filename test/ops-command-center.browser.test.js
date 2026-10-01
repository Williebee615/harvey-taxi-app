// Operations Command Center in Chromium, driven by the LABELLED TEST CASES
// (test/fixtures/opsScenarios.js). Writes the PR screenshots to
// docs/screenshots/agent-operations/ when OPS_SCREENSHOTS=1. Every
// screenshot carries a "TEST DATA" watermark.
// Needs Playwright and Chromium; skips without them.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "test-staff@example.test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.OPS_CASES_PER_MINUTE = "100000";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { buildSeed, DEMO } = require("./fixtures/opsScenarios");
const { signTestRiderToken, riderAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let chromium = null;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";
const SHOTS = process.env.OPS_SCREENSHOTS === "1" ? path.join(__dirname, "..", "docs", "screenshots", "agent-operations") : null;

async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const layer = document.createElement("div");
    layer.id = "__testDataLabel";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("style", `position:absolute;left:0;top:0;width:100%;height:${document.documentElement.scrollHeight}px;z-index:2147483647;pointer-events:none;overflow:hidden`);
    const tag = document.createElement("div");
    tag.textContent = "TEST DATA - NOT LIVE";
    tag.setAttribute("style", "position:fixed;right:6px;bottom:6px;background:#ffd76a;color:#1a1300;font:800 11px/1 Arial,sans-serif;padding:5px 7px;border-radius:6px");
    const mark = document.createElement("div");
    mark.textContent = Array(400).fill("TEST FIXTURE DATA").join("   ");
    mark.setAttribute("style", "position:absolute;left:-50%;top:-50%;width:200%;height:200%;transform:rotate(-30deg);color:rgba(255,215,106,.10);font:800 26px/2.6 Arial,sans-serif;word-spacing:8px");
    layer.appendChild(mark);
    layer.appendChild(tag);
    document.body.appendChild(layer);
  });
  await page.screenshot({ path: path.join(SHOTS, name), ...options });
  await page.evaluate(() => document.getElementById("__testDataLabel")?.remove());
}

describeWithBrowser("Operations Command Center", () => {
  let server;
  let browser;
  let base;
  let request;
  let app;

  beforeAll(async () => {
    const seed = buildSeed(Date.now());
    seed.system_flags = [
      { key: "ops_assistant_enabled", value: "true" },
      { key: "ops_actions_enabled", value: "true" }
    ];
    mockSupabaseClient = createFakeSupabase(seed);
    mockSupabaseClient.rpc = async (fn) => (fn === "dispatch_ride_atomic" ? { data: null, error: { message: "n/a" } } : { data: null, error: null });
    ({ app } = require("../server"));
    request = require("supertest");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });

    // The three demonstration cases, created through the real API.
    const rider = riderAuthHeaders(signTestRiderToken("TEST-RIDER-A"));
    await request(app).post("/api/ops/rider/cases").set(rider).send({ message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId });
    await request(app).post("/api/admin/ops/cases").set({ "x-admin-token": "test-admin-token" }).send({ ride_id: DEMO.action.rideId, message: DEMO.action.message });
    await request(app).post("/api/ops/rider/cases").set(rider).send({ message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function newPage({ mobile = false, reducedMotion = "no-preference" } = {}) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion,
      extraHTTPHeaders: { "x-admin-token": "test-admin-token" }
    });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    page.on("dialog", (d) => d.accept());
    return page;
  }

  const caseIdFor = (rideId) => mockSupabaseClient._state.agent_ops_cases.find((c) => c.ride_id === rideId).id;

  test("desktop: overview, a complicated investigation, then a staff approval executed and verified", async () => {
    const page = await newPage();
    await page.goto(`${base}/admin-operations.html`);
    await page.waitForSelector(".case");
    expect(await page.textContent("#stats")).toMatch(/Needs human review\s*2/);
    expect(await page.textContent("#statusChips")).toMatch(/Rules-only/);

    await page.click(`[data-case="${caseIdFor(DEMO.complicated.rideId)}"]`);
    await page.waitForSelector(".summary");
    const detail = await page.textContent("#detail");
    expect(detail).toMatch(/1\.42 mi from the pickup point/);
    expect(detail).toMatch(/Evidence disagrees/);
    expect(detail).toMatch(/Hypotheses/);
    expect(detail).toMatch(/POL-CANCEL-NO-FEE/);
    expect(detail).not.toMatch(/\d+%|confidence/i);
    await shot(page, "01-command-center-investigation-desktop.png", { fullPage: true });

    await page.click(`[data-case="${caseIdFor(DEMO.action.rideId)}"]`);
    await page.waitForFunction(() => /Awaiting staff approval/.test(document.getElementById("detail").textContent));
    await shot(page, "02-action-awaiting-approval-desktop.png", { fullPage: true });
    await page.click("#detail [data-approve]");
    await page.waitForFunction(() => /Done and verified/.test(document.getElementById("detail").textContent));
    expect(mockSupabaseClient._state.driver_offers.filter((o) => o.ride_id === DEMO.action.rideId && o.status === "pending")).toHaveLength(1);
    expect(await page.textContent("#feed")).toMatch(/Action verified in the records/);
    await page.waitForSelector("#toast", { state: "hidden", timeout: 8000 });
    await shot(page, "03-action-verified-desktop.png", { fullPage: true });
    expect(page.errors).toEqual([]);
  });

  test("phone: case list and an escalated case, no horizontal scrolling", async () => {
    const page = await newPage({ mobile: true });
    await page.goto(`${base}/admin-operations.html`);
    await page.waitForSelector(".case");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, "04-command-center-phone.png", { fullPage: true });
    await page.click(`[data-case="${caseIdFor(DEMO.escalation.rideId)}"]`);
    await page.waitForSelector(".summary");
    expect(await page.isVisible("#listPanel")).toBe(false);
    expect(await page.textContent("#detail")).toMatch(/Decision boundary: disputed charge/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await shot(page, "05-escalated-case-phone.png", { fullPage: true });
    await page.click("#backBtn");
    expect(await page.isVisible("#listPanel")).toBe(true);
  });

  test("reduced motion: no animation", async () => {
    const page = await newPage({ reducedMotion: "reduce" });
    await page.goto(`${base}/admin-operations.html`);
    await page.waitForSelector(".case");
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector(".case")).animationName);
    expect(anim).toBe("none");
  });

  test("signed out: the page shows the sign-in notice and no data", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/admin-operations.html`);
    await page.waitForSelector("#authNotice:not([hidden])");
    expect(await page.$$(".case")).toHaveLength(0);
  });
});
