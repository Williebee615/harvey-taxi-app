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
    riders: [makeRider({ first_name: "Test", last_name: "Rider", email: "test-rider@example.test" })],
    drivers: [
      makeDriver({ first_name: "TestDriver", last_name: "Alpha", last_location_at: ago(1), rating: 4.9 }),
      makeDriver({ id: "DRIVER_2", first_name: "TestDriver", last_name: "Bravo", current_lat: 36.19, current_lng: -86.75, last_location_at: ago(2), rating: 4.7 }),
      makeDriver({ id: "DRIVER_3", first_name: "TestDriver", last_name: "Charlie", online: false }),
      makeDriver({ id: "DRIVER_4", first_name: "TestDriver", last_name: "Delta", checkr_status: "pending", last_location_at: ago(30) })
    ],
    rides: [
      makeRide({ id: "TEST-RIDE-STALLED", rider_id: "RIDER_5", updated_at: ago(9), pickup_address: "TEST pickup 1 (fixture)" }),
      makeRide({ id: "TEST-RIDE-ACTIVE", rider_id: "RIDER_9", driver_id: "DRIVER_9", driver_name: "TestDriver E.", status: "driver_enroute", pickup_address: "TEST pickup 2 (fixture)" }),
      makeRide({ id: "TEST-RIDE-MINE", rider_id: "RIDER_1", driver_id: "DRIVER_8", driver_name: "TestDriver F.", driver_vehicle: "Test Vehicle", status: "driver_assigned", driver_eta_to_pickup_text: "6 min" })
    ],
    driver_offers: [],
    driver_earnings: [{ id: "E1", driver_id: "DRIVER_1", total_earning: 42.75, created_at: ago(120) }],
    audit_logs: [],
    emergency_alerts: []
  };
}

// Screenshots carry a fixed banner so fixture data can never be mistaken
// for live operations.
async function labelAsTestData(page) {
  await page.evaluate(() => {
    const layer = document.createElement("div");
    layer.id = "__testDataLabel";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden");
    const tag = document.createElement("div");
    tag.textContent = "TEST DATA - NOT LIVE";
    tag.setAttribute("style", "position:absolute;right:6px;bottom:6px;background:#ffd76a;color:#1a1300;font:800 11px/1 Arial,sans-serif;padding:5px 7px;border-radius:6px;opacity:.95");
    const mark = document.createElement("div");
    mark.textContent = Array(40).fill("TEST FIXTURE DATA").join("   ");
    mark.setAttribute("style", "position:absolute;left:-50%;top:-50%;width:200%;height:200%;transform:rotate(-30deg);color:rgba(255,215,106,.13);font:800 26px/2.6 Arial,sans-serif;word-spacing:8px;white-space:normal");
    layer.appendChild(mark);
    layer.appendChild(tag);
    document.body.appendChild(layer);
  });
}
async function shot(page, name, options = {}) {
  if (!SHOTS) return;
  await labelAsTestData(page);
  await page.screenshot({ path: path.join(SHOTS, name), ...options });
  await page.evaluate(() => document.getElementById("__testDataLabel")?.remove());
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
    expect(await page.textContent("#rides")).toContain("TEST-RIDE-STALLED");
    expect(await page.textContent("#alerts")).toMatch(/waiting longer than/);
    expect(await page.textContent("#plan")).toContain("redispatch");
    expect(await page.textContent("#drivers")).toContain("Not ready");
    expect(await page.textContent("#modelStatus")).toMatch(/^Not checked\./);

    await page.click('button[data-rec="TEST-RIDE-STALLED"]');
    await page.waitForSelector("#recPanel", { state: "visible" });
    expect(await page.textContent("#recRows")).toMatch(/TestDriver A\..*TestDriver B\./s);
    expect(await page.textContent("#recExcluded")).toMatch(/offline|compliance_not_ready/);

    // automation toggles need the elevated token in the browser
    expect(await page.isDisabled('button[data-flag="agent_automation_enabled"]')).toBe(false); // header token = elevated in this test
    await shot(page, "admin-command-center-desktop.png", { fullPage: true });

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
    await shot(page, "admin-command-center-mobile.png", { fullPage: true });

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
    expect(await page.textContent(".hta-log")).toMatch(/accepted by your driver.*TestDriver F\..*6 min/s);

    await page.fill(".hta-form input", "cancel my ride");
    await page.click(".hta-form button");
    await page.waitForSelector(".hta-actions .hta-danger");
    expect(mockSupabaseClient._state.rides.find((r) => r.id === "TEST-RIDE-MINE").status).toBe("driver_assigned");
    await shot(page, "rider-assistant-cancel-confirmation.png");

    await page.fill(".hta-form input", "there was an accident and someone is injured");
    await page.click(".hta-form button");
    await page.waitForSelector(".hta-urgent");
    expect(await page.textContent(".hta-urgent")).toMatch(/call 911/);
    expect(await page.getAttribute(".hta-urgent a[href='tel:911']", "href")).toBe("tel:911");
    await shot(page, "rider-assistant-emergency.png");
    expect(page.errors).toEqual([]);
  });

  test("phone layout: launcher clear of bottom navigation, hidden while open; 911 banner outside the scrolling list; input visible with a short viewport", async () => {
    const page = await newPage({ mobile: true, riderId: "RIDER_1" });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector(".hta-btn");
    await page.waitForTimeout(400);
    // The launcher must not overlap anything fixed to the bottom of the screen.
    const overlap = await page.evaluate(() => {
      const b = document.querySelector(".hta-btn").getBoundingClientRect();
      const hits = [];
      for (const n of document.querySelectorAll("body *")) {
        if (n.closest(".hta-btn, .hta-panel")) continue;
        const cs = getComputedStyle(n);
        if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
        const r = n.getBoundingClientRect();
        if (r.width < innerWidth * 0.5 || Math.abs(r.bottom - innerHeight) > 2) continue;
        if (b.bottom > r.top && b.top < r.bottom) hits.push(n.tagName + "." + n.className);
      }
      return hits;
    });
    expect(overlap).toEqual([]);
    await shot(page, "rider-assistant-launcher-mobile.png");

    await page.click(".hta-btn");
    expect(await page.isVisible(".hta-btn")).toBe(false);
    for (const q of ["where is my driver?", "how much is my fare", "cancel my ride", "what can you do?"]) {
      await page.fill(".hta-form input", q);
      await page.click(".hta-form button");
      await page.waitForTimeout(250);
    }
    const geometry = await page.evaluate(() => {
      const banner = document.querySelector(".hta-911");
      const log = document.querySelector(".hta-log");
      const input = document.querySelector(".hta-form input");
      const panel = document.querySelector(".hta-panel");
      return {
        bannerInsideLog: log.contains(banner),
        bannerBottom: banner.getBoundingClientRect().bottom,
        logTop: log.getBoundingClientRect().top,
        logScrolls: log.scrollHeight > log.clientHeight,
        inputBottom: input.getBoundingClientRect().bottom,
        panelBottom: panel.getBoundingClientRect().bottom,
        vh: innerHeight
      };
    });
    expect(geometry.bannerInsideLog).toBe(false);
    expect(geometry.bannerBottom).toBeLessThanOrEqual(geometry.logTop);
    expect(geometry.inputBottom).toBeLessThanOrEqual(geometry.vh);
    expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.vh);
    await shot(page, "rider-assistant-open-mobile.png");

    // A shorter visible viewport (as with an on-screen keyboard): the sheet
    // shrinks and the input stays on screen.
    await page.setViewportSize({ width: 390, height: 480 });
    await page.waitForTimeout(300);
    const short = await page.evaluate(() => ({
      inputBottom: document.querySelector(".hta-form input").getBoundingClientRect().bottom,
      bannerVisible: document.querySelector(".hta-911").getBoundingClientRect().top >= 0,
      vh: innerHeight
    }));
    expect(short.inputBottom).toBeLessThanOrEqual(short.vh);
    expect(short.bannerVisible).toBe(true);
    await shot(page, "rider-assistant-short-viewport.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click(".hta-close");
    expect(await page.isVisible(".hta-btn")).toBe(true);
    expect(page.errors).toEqual([]);
  });

  test("assistant links open the booking screen and ride tracking", async () => {
    const page = await newPage({ mobile: true, riderId: "RIDER_1" });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector(".hta-btn");
    await page.click(".hta-btn");
    await page.fill(".hta-form input", "where is my driver?");
    await page.click(".hta-form button");
    const track = await page.waitForSelector('.hta-actions a:has-text("Track ride")');
    expect(await track.getAttribute("href")).toBe("/rider-dashboard.html?screen=track&ride_id=TEST-RIDE-MINE");
    await page.fill(".hta-form input", "I need a ride to the airport");
    await page.click(".hta-form button");
    const book = await page.waitForSelector('.hta-actions a:has-text("Open booking")');
    expect(await book.getAttribute("href")).toBe("/rider-dashboard.html?screen=book&mode=driver");
    await book.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => !document.getElementById("rideWizardOverlay").hidden)).toBe(true);
  });

  test("driver assistant answers from the driver's own data", async () => {
    const page = await newPage({ mobile: true, driverId: "DRIVER_1" });
    await page.goto(`${base}/driver-dashboard.html`);
    await page.waitForSelector(".hta-btn");
    await page.click(".hta-btn");
    await page.fill(".hta-form input", "how much have I earned?");
    await page.click(".hta-form button");
    await page.waitForFunction(() => /\$42\.75/.test(document.querySelector(".hta-log").textContent));
    await shot(page, "driver-assistant-earnings.png");
  });

  test("assistant renders nothing when the flag is off", async () => {
    mockSupabaseClient._state.system_flags.find((f) => f.key === "agent_assist_enabled").value = "false";
    const page = await newPage({ mobile: true, riderId: "RIDER_1" });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForTimeout(800);
    expect(await page.$(".hta-btn")).toBeNull();
  });
});
