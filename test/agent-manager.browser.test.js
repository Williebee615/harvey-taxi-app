// Browser check for the AI Agent Manager: the admin command center and the
// rider/driver assistant widget. Also writes the PR screenshots to
// docs/screenshots/ai-agent-manager/ when AGENT_SCREENSHOTS=1.
//
// Needs Playwright and a Chromium build; skips without them (CI does not
// install a browser). Run locally with, for example:
//   NODE_PATH="$(npm root -g)" npx jest test/agent-manager.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.AGENT_LLM_BASE_URL = "http://127.0.0.1:9/v1";
process.env.AGENT_LLM_MODEL = "phi-3.5-mini-instruct-q4_k_m";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.OPENAI_API_KEY;

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken, signTestDriverToken } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

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
const SHOTS = process.env.AGENT_SCREENSHOTS === "1" ? path.join(__dirname, "..", "docs", "screenshots", "ai-agent-manager") : null;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();

function seedState() {
  return {
    system_flags: [
      { key: "agent_assist_enabled", value: "true" },
      { key: "agent_shadow_mode_enabled", value: "true" },
      { key: "agent_automation_enabled", value: "false" },
      { key: "agent_auto_redispatch_enabled", value: "false" },
      { key: "agent_kill_switch", value: "false" }
    ],
    riders: [makeRider()],
    drivers: [
      makeDriver({ last_location_at: ago(1), rating: 4.9 }),
      makeDriver({ id: "DRIVER_2", first_name: "Ola", last_name: "Grant", current_lat: 36.19, current_lng: -86.75, last_location_at: ago(2), rating: 4.7 }),
      makeDriver({ id: "DRIVER_3", first_name: "Sam", last_name: "Ortiz", online: false }),
      makeDriver({ id: "DRIVER_4", first_name: "Lee", last_name: "Park", checkr_status: "pending", last_location_at: ago(30) })
    ],
    rides: [
      makeRide({ id: "RIDE_STALLED", rider_id: "RIDER_5", updated_at: ago(9), pickup_address: "501 Broadway, Nashville" }),
      makeRide({ id: "RIDE_ACTIVE", rider_id: "RIDER_9", driver_id: "DRIVER_9", driver_name: "Kim R.", status: "driver_enroute", pickup_address: "1 Music Sq W" }),
      makeRide({ id: "RIDE_MINE", rider_id: "RIDER_1", driver_id: "DRIVER_8", driver_name: "Ann L.", driver_vehicle: "Toyota Camry", status: "driver_assigned", driver_eta_to_pickup_text: "6 min" })
    ],
    driver_offers: [],
    driver_earnings: [{ id: "E1", driver_id: "DRIVER_1", total_earning: 42.75, created_at: ago(120) }],
    audit_logs: [],
    emergency_alerts: []
  };
}

describeWithBrowser("AI Agent Manager UI", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase(seedState());
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
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    const state = mockSupabaseClient._state;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, seedState());
  });

  async function newPage({ mobile = false, admin = false, riderId, driverId } = {}) {
    const context = await browser.newContext(
      mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: admin ? { "x-admin-token": "test-admin-token" } : {} }
        : { viewport: { width: 1360, height: 900 }, extraHTTPHeaders: admin ? { "x-admin-token": "test-admin-token" } : {} }
    );
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (riderId) {
      await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken(riderId)), url: base }]);
    }
    if (driverId) {
      const token = signTestDriverToken(driverId);
      await context.addInitScript(([t, id]) => {
        localStorage.setItem("harvey_driver_token", t);
        localStorage.setItem("harvey_driver_id", id);
      }, [token, driverId]);
    }
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    return page;
  }

  test("admin command center: live data, recommendations, shadow evaluation, kill switch", async () => {
    const page = await newPage({ admin: true });
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-agent.html`);
    await page.waitForSelector("#rides tr td");
    expect(await page.textContent("#modeBadge")).toBe("Shadow mode");
    expect(await page.textContent("#rides")).toContain("RIDE_STALLED");
    expect(await page.textContent("#alerts")).toMatch(/waiting longer than/);
    expect(await page.textContent("#plan")).toContain("redispatch");
    expect(await page.textContent("#drivers")).toContain("Not ready");
    expect(await page.textContent("#modelStatus")).toMatch(/Self-hosted model/);

    await page.click('button[data-rec="RIDE_STALLED"]');
    await page.waitForSelector("#recPanel", { state: "visible" });
    expect(await page.textContent("#recRows")).toMatch(/Morgan B\..*Ola G\./s);
    expect(await page.textContent("#recExcluded")).toMatch(/offline|compliance_not_ready/);

    // automation toggles need the elevated token in the browser
    expect(await page.isDisabled('button[data-flag="agent_automation_enabled"]')).toBe(false); // header token = elevated in this test
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "admin-command-center-desktop.png"), fullPage: true });

    await page.click("#evaluateBtn");
    await page.waitForFunction(() => document.querySelector("#decisions").textContent.includes("Shadow (not executed)"));
    expect(mockSupabaseClient._state.driver_offers).toHaveLength(0);

    await page.click("#killBtn");
    await page.waitForFunction(() => document.querySelector("#modeBadge").textContent === "Kill switch engaged");
    expect(page.errors).toEqual([]);
  });

  test("admin command center on a phone, and a signed-out admin sees the sign-in notice", async () => {
    const page = await newPage({ admin: true, mobile: true });
    await page.goto(`${base}/admin-agent.html`);
    await page.waitForSelector("#rides tr td");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "admin-command-center-mobile.png"), fullPage: true });

    const anon = await newPage();
    await anon.goto(`${base}/admin-agent.html`);
    await anon.waitForSelector("#authNotice:not([hidden])");
  });

  test("rider assistant: grounded status, confirmation-gated cancel, emergency 911", async () => {
    const page = await newPage({ mobile: true, riderId: "RIDER_1" });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector(".hta-btn");
    await page.click(".hta-btn");
    await page.fill(".hta-form input", "where is my driver?");
    await page.click(".hta-form button");
    await page.waitForFunction(() => document.querySelectorAll(".hta-bot").length >= 2);
    expect(await page.textContent(".hta-log")).toMatch(/accepted by your driver.*Ann L\..*6 min/s);

    await page.fill(".hta-form input", "cancel my ride");
    await page.click(".hta-form button");
    await page.waitForSelector(".hta-actions .hta-danger");
    expect(mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_MINE").status).toBe("driver_assigned");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rider-assistant-cancel-confirmation.png") });

    await page.fill(".hta-form input", "there was an accident and someone is injured");
    await page.click(".hta-form button");
    await page.waitForSelector(".hta-urgent");
    expect(await page.textContent(".hta-urgent")).toMatch(/call 911/);
    expect(await page.getAttribute(".hta-urgent a[href='tel:911']", "href")).toBe("tel:911");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rider-assistant-emergency.png") });
    expect(page.errors).toEqual([]);
  });

  test("driver assistant answers from the driver's own data", async () => {
    const page = await newPage({ mobile: true, driverId: "DRIVER_1" });
    await page.goto(`${base}/driver-dashboard.html`);
    await page.waitForSelector(".hta-btn");
    await page.click(".hta-btn");
    await page.fill(".hta-form input", "how much have I earned?");
    await page.click(".hta-form button");
    await page.waitForFunction(() => /\$42\.75/.test(document.querySelector(".hta-log").textContent));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "driver-assistant-earnings.png") });
  });

  test("assistant renders nothing when the flag is off", async () => {
    mockSupabaseClient._state.system_flags.find((f) => f.key === "agent_assist_enabled").value = "false";
    const page = await newPage({ mobile: true, riderId: "RIDER_1" });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForTimeout(800);
    expect(await page.$(".hta-btn")).toBeNull();
  });
});
