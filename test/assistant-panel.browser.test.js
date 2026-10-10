// Harvey Assistant panel on phones: the rider dashboard (shown in the
// rider iOS and Android apps' WebView) and the web driver dashboard.
// Chromium at 360x640 with touch: NOT a device test; the keyboard is
// approximated by shrinking the page, as Android WebViews do.
// Writes screenshots to docs/screenshots/assistant-panel/<label>/ when
// PANEL_SCREENSHOTS=<label>.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/assistant-panel.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken, signTestDriverToken } = require("./rideTestHelpers");

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
jest.setTimeout(240000);

const HOST = "harveytaxiservice.test";
const SHOTS = process.env.PANEL_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "assistant-panel", process.env.PANEL_SCREENSHOTS) : null;
let testIp = 0;
const nextIpHeaders = () => ({ "X-Forwarded-For": `198.51.100.${(testIp = (testIp % 250) + 1)}` });
const PHONE = { width: 360, height: 640 };

// The driver app's one-tap questions, read from its source so the web
// assistant can't drift from it.
function driverAppQuickPrompts() {
  const text = fs.readFileSync(path.join(__dirname, "..", "driver-app", "src", "assistant.js"), "utf8");
  const block = text.slice(text.indexOf("QUICK_PROMPTS"), text.indexOf("]);", text.indexOf("QUICK_PROMPTS")));
  return Array.from(block.matchAll(/label: '([^']+)', message: (?:'([^']+)'|"([^"]+)")/g)).map((m) => [m[1], m[2] || m[3]]);
}

describeWithBrowser("Harvey Assistant panel on phones (rider apps' WebView, web driver dashboard)", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [makeRide({ id: "RIDE_PANEL_1", status: "driver_enroute", driver_id: "DRIVER_1", driver_name: "Test Driver", driver_vehicle: "Test Vehicle" })],
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
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  async function open(role) {
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: nextIpHeaders() });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (role === "rider") {
      await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    } else {
      const token = signTestDriverToken("DRIVER_1");
      await context.addInitScript(([t]) => {
        localStorage.setItem("harvey_driver_token", t);
        localStorage.setItem("harvey_driver_id", "DRIVER_1");
      }, [token]);
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const sent = [];
    page.on("request", (r) => {
      if (r.url().includes(`/api/agent/${role}/assist`)) sent.push(JSON.parse(r.postData() || "{}").message);
    });
    await page.goto(`${base}/${role}-dashboard.html`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 30000 });
    if (role === "rider") await page.waitForFunction(() => window.__harveyAssistantAccount && window.__harveyAssistantAccount.id === "RIDER_1", null, { timeout: 20000 });
    await page.click("[data-testid=hta-launcher]");
    await page.waitForTimeout(500);
    return { context, page, errors, sent };
  }

  const panelFacts = (page) =>
    page.evaluate(() => {
      const p = document.getElementById("htaPanel");
      const r = p.getBoundingClientRect();
      const log = p.querySelector(".hta-log").getBoundingClientRect();
      const chips = p.querySelector("[data-testid=hta-chips]");
      const ban = p.querySelector(".hta-911");
      return {
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        sideways: p.scrollWidth > p.clientWidth + 1,
        compact: p.classList.contains("hta-compact"),
        chipsShown: Boolean(chips) && getComputedStyle(chips).display !== "none",
        chipLabels: chips ? Array.from(chips.querySelectorAll("button")).map((b) => b.textContent) : [],
        title: p.querySelector(".hta-title strong") && p.querySelector(".hta-title strong").textContent,
        subtitle: p.querySelector(".hta-title span") && p.querySelector(".hta-title span").textContent,
        emergencyText: ban.textContent,
        emergencyOneLine: ban.getBoundingClientRect().height < 34,
        logShare: Math.round((log.height / r.height) * 100),
        // Header text on one line each, nothing cut off.
        headerFits: Array.from(p.querySelectorAll(".hta-title strong, .hta-title span, .hta-clear")).every((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().height < 34)
      };
    });

  test("rider: title, one-tap questions that send the right wording, Support opens the request editor", async () => {
    const { context, page, errors, sent } = await open("rider");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rider-open.png") });
    const f = await panelFacts(page);
    expect(f).toMatchObject({ inside: true, sideways: false, compact: false, chipsShown: true, title: "Harvey Assistant", subtitle: "Your rides and account", headerFits: true });
    expect(f.chipLabels).toEqual(["Where's my driver?", "My fare", "Book a ride", "Cancel my ride", "Lost item", "Support"]);
    expect(f.emergencyText).toBe("Emergency? Call 911 first. This assistant cannot send help.");

    await page.click("[data-testid=hta-chip]:has-text(\"Where's my driver?\")");
    await page.waitForFunction(() => document.querySelectorAll("#htaPanel .hta-bot").length >= 2);
    await page.click("[data-testid=hta-chip]:has-text('Lost item')");
    await page.waitForFunction(() => document.querySelectorAll("#htaPanel .hta-bot").length >= 3);
    expect(sent).toEqual(["Where is my driver?", "I left something in the car"]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rider-answers.png") });

    await page.click("[data-testid=hta-chip]:has-text('Support')");
    await page.waitForSelector("[data-testid=hta-handoff]");
    expect(sent).toHaveLength(2); // Support asks nothing; it opens the editor
    expect(errors).toEqual([]);
    await context.close();
  });

  test("rider, keyboard up (page resized as on Android): compact, 911 still on one line, conversation keeps the room", async () => {
    const { context, page, errors } = await open("rider");
    await page.focus("#htaPanel input[type=text]");
    await page.setViewportSize({ width: PHONE.width, height: 352 });
    await page.waitForTimeout(600);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rider-keyboard.png") });
    const f = await panelFacts(page);
    expect(f).toMatchObject({ inside: true, sideways: false, compact: true, chipsShown: false, emergencyOneLine: true, headerFits: true });
    expect(f.emergencyText).toContain("Emergency? Call 911 first.");
    expect(f.logShare).toBeGreaterThanOrEqual(30);
    // Back to full height: the one-tap questions return.
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(600);
    expect((await panelFacts(page)).chipsShown).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("web driver dashboard: the same one-tap questions as the driver app", async () => {
    const { context, page, errors, sent } = await open("driver");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "driver-open.png") });
    const f = await panelFacts(page);
    const expected = driverAppQuickPrompts();
    expect(expected.length).toBeGreaterThanOrEqual(7);
    expect(f.chipLabels).toEqual(expected.map(([label]) => label));
    expect(f.subtitle).toBe("Your trips and account");
    await page.click("[data-testid=hta-chip]:has-text('Earnings')");
    await page.waitForFunction(() => document.querySelectorAll("#htaPanel .hta-bot").length >= 2);
    expect(sent).toEqual([expected.find(([label]) => label === "Earnings")[1]]);
    expect(errors).toEqual([]);
    await context.close();
  });
});
