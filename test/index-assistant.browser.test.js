// Harvey Taxi Mobile index page (the page the rider apps open first): its
// chat is the shared Harvey Assistant, it fits small phones including the
// keyboard, nothing floating covers a control, and nothing goes to the old
// /api/ai/support (OpenAI) endpoint. Chromium at phone sizes: NOT a device
// test. Writes screenshots to docs/screenshots/index-assistant/<label>/
// when INDEX_SCREENSHOTS=<label>.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/index-assistant.browser
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
jest.setTimeout(240000);

const HOST = "harveytaxiservice.test";
const LABEL = process.env.INDEX_SCREENSHOTS || "";
const SHOTS = LABEL ? path.join(__dirname, "..", "docs", "screenshots", "index-assistant", LABEL) : null;
let testIp = 0;
const nextIpHeaders = () => ({ "X-Forwarded-For": `198.51.100.${(testIp = (testIp % 250) + 1)}` });
const PHONES = [
  { name: "android-360x640", width: 360, height: 640 },
  { name: "iphone-se-375x667", width: 375, height: 667 },
  { name: "android-412x915", width: 412, height: 915 }
];

describeWithBrowser("Harvey Taxi Mobile index page: the chat on small phones", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [],
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

  async function open(phone) {
    const context = await browser.newContext({ viewport: { width: phone.width, height: phone.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: nextIpHeaders() });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls = { legacy: 0, assist: [] };
    page.on("request", (r) => {
      if (r.url().includes("/api/ai/support")) calls.legacy += 1;
      if (r.url().includes("/api/agent/rider/assist")) calls.assist.push(JSON.parse(r.postData() || "{}").message);
    });
    await page.goto(`${base}/`);
    await page.waitForTimeout(2500);
    return { context, page, errors, calls };
  }

  // Floating things (assistant button, teaser) never sit on a control's
  // centre; content never scrolls sideways.
  const pageFacts = (page) =>
    page.evaluate(() => {
      const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
      const floaters = ["[data-testid=hta-launcher]", "#aiTeaserBubble", ".harvey-ai-launch"].map((s) => document.querySelector(s)).filter(vis);
      const controls = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")).filter((c) => vis(c) && !floaters.some((f) => f === c || f.contains(c)) && !c.closest("#htaPanel"));
      const covered = [];
      for (const f of floaters) {
        const fr = f.getBoundingClientRect();
        for (const c of controls) {
          const r = c.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= innerHeight) continue;
          const cx = (r.left + r.right) / 2; const cy = (r.top + r.bottom) / 2;
          if (cx >= fr.left && cx <= fr.right && cy >= fr.top && cy <= fr.bottom) covered.push(`${f.id || f.className} over ${(c.innerText || c.getAttribute("aria-label") || c.tagName).trim().slice(0, 30)}`);
        }
      }
      return { sideways: document.documentElement.scrollWidth > innerWidth + 1, covered, oldWidget: Boolean(document.querySelector(".harvey-ai-launch, [data-harvey-ai-root], .harvey-ai-panel")), newLauncher: vis(document.querySelector("[data-testid=hta-launcher]")) };
    });

  for (const phone of PHONES) {
    test(`${phone.name}: one assistant, nothing covering controls, the chat fits including the keyboard`, async () => {
      const { context, page, errors, calls } = await open(phone);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-page.png`) });
      // Scrolled to the bottom: the last controls are reachable.
      await page.evaluate(() => { document.scrollingElement.scrollTop = 1e9; });
      await page.waitForTimeout(800);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-page-end.png`) });
      const end = await pageFacts(page);
      await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
      await page.waitForTimeout(500);
      const top = await pageFacts(page);

      // Open the chat the way the page does ("Open AI Support").
      await page.evaluate(() => window.openHarveyAiChat());
      await page.waitForTimeout(800);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-chat.png`) });
      const panelVisible = await page.evaluate(() => { const p = document.getElementById("htaPanel"); return Boolean(p && p.classList.contains("open")); });
      expect(panelVisible).toBe(true);
      // Nothing on the page (welcome toast, teaser) sits over the panel's
      // header, 911 line or input.
      const onTop = await page.evaluate(() => {
        const p = document.getElementById("htaPanel");
        return ["header, .hta-head", ".hta-911", "input[type=text]"].map((sel) => {
          const n = p.querySelector(sel);
          if (!n) return `${sel}: missing`;
          const r = n.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
          return p.contains(hit) ? "ok" : `${sel} under ${hit && (hit.className || hit.tagName)}`;
        });
      });
      expect(onTop).toEqual(["ok", "ok", "ok"]);

      await page.fill("#htaPanel input[type=text]", "How do I book a ride?");
      await page.press("#htaPanel input[type=text]", "Enter");
      await page.waitForFunction(() => document.querySelectorAll("#htaPanel .hta-bot").length >= 2, null, { timeout: 15000 });
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-chat-answer.png`) });

      await page.focus("#htaPanel input[type=text]");
      await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
      await page.waitForTimeout(600);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-chat-keyboard.png`) });
      const kb = await page.evaluate(() => {
        const p = document.getElementById("htaPanel").getBoundingClientRect();
        const input = document.querySelector("#htaPanel input[type=text]").getBoundingClientRect();
        const banner = document.querySelector("#htaPanel .hta-911");
        return { inside: p.top >= 0 && p.left >= 0 && p.right <= innerWidth && p.bottom <= innerHeight, inputVisible: input.top >= 0 && input.bottom <= innerHeight, sideways: document.getElementById("htaPanel").scrollWidth > document.getElementById("htaPanel").clientWidth + 1, emergency: banner && banner.textContent };
      });

      expect(top).toMatchObject({ sideways: false, covered: [], oldWidget: false, newLauncher: true });
      expect(end).toMatchObject({ sideways: false, covered: [] });
      expect(kb).toMatchObject({ inside: true, inputVisible: true, sideways: false });
      expect(kb.emergency).toContain("Call 911");
      expect(calls.legacy).toBe(0); // nothing goes to /api/ai/support (OpenAI)
      expect(calls.assist).toEqual(["How do I book a ride?"]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("desktop: the teaser bubble and the Open AI Support button open Harvey Assistant; phones hide the teaser", async () => {
    const phone = await open(PHONES[0]);
    expect(await phone.page.isVisible("#aiTeaserBubble")).toBe(false);
    await phone.context.close();
    const { context, page, calls } = await open({ name: "desktop", width: 1280, height: 900 });
    await page.dispatchEvent("#aiTeaserBubble", "click"); // it floats (animation), so no "stable" tap
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.getElementById("htaPanel").classList.contains("open"))).toBe(true);
    await page.evaluate(() => window.HarveyAssistant.close());
    await page.click("button:has-text('Open AI Support')");
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.getElementById("htaPanel").classList.contains("open"))).toBe(true);
    expect(calls.legacy).toBe(0);
    await context.close();
  });
});
