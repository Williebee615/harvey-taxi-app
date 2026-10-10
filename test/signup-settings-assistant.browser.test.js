// Rider sign-up and Settings: the old Harvey AI widget (ai-support-widget.js,
// which called /api/ai/support, OpenAI) is replaced by the shared Harvey
// Assistant. On small phones nothing floating covers a control or text,
// nothing scrolls sideways, and the chat fits including the keyboard.
// Chromium at phone sizes: NOT a device test. Writes screenshots to
// docs/screenshots/signup-settings-assistant/<label>/ when
// PAGE_SCREENSHOTS=<label> (screenshots are taken before the checks, so a
// "before" run on the old pages still records them).
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/signup-settings-assistant.browser
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
const LABEL = process.env.PAGE_SCREENSHOTS || "";
const SHOTS = LABEL ? path.join(__dirname, "..", "docs", "screenshots", "signup-settings-assistant", LABEL) : null;
let testIp = 0;
const nextIpHeaders = () => ({ "X-Forwarded-For": `198.51.100.${(testIp = (testIp % 250) + 1)}` });
const PHONES = [
  { name: "android-360x640", width: 360, height: 640 },
  { name: "iphone-se-375x667", width: 375, height: 667 },
  { name: "android-412x915", width: 412, height: 915 }
];

describeWithBrowser("Rider sign-up and Settings: the chat on small phones", () => {
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

  async function open(phone, url) {
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
    await page.goto(`${base}${url}`);
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
      const tabs = Array.from(document.querySelectorAll(".bottom-nav .nav-btn")).filter(vis);
      const tabsFit = tabs.every((t) => t.scrollWidth <= t.clientWidth + 1);
      return { sideways: document.documentElement.scrollWidth > innerWidth + 1, covered, oldWidget: Boolean(document.querySelector(".harvey-ai-launch, [data-harvey-ai-root], .harvey-ai-panel")), newLauncher: vis(document.querySelector("[data-testid=hta-launcher]")), navAssistant: vis(document.querySelector("[data-testid=nav-assistant]")), tabs: tabs.length, tabsFit };
    });

  // Scrolls the whole page; at every step no floating element (assistant
  // button, teaser) overlaps any text. Returns the overlaps found.
  const textUnderFloaters = (page) =>
    page.evaluate(async () => {
      const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
      const hits = new Set();
      const H = document.scrollingElement.scrollHeight;
      for (let y = 0; y <= H; y += 60) {
        document.scrollingElement.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(r));
        const floaters = ["[data-testid=hta-launcher]", "#aiTeaserBubble", ".harvey-ai-launch"].map((q) => document.querySelector(q)).filter(vis);
        for (const f of floaters) {
          const b = f.getBoundingClientRect();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            if (!n.textContent.trim() || f.contains(n) || n.parentElement.closest("#htaPanel, .welcome-banner, .bottom-nav")) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const q of range.getClientRects()) {
              if (q.width >= 1 && q.right > b.left && q.left < b.right && q.bottom > b.top && q.top < b.bottom) { hits.add(n.textContent.trim().slice(0, 30)); break; }
            }
          }
        }
      }
      document.scrollingElement.scrollTop = 0;
      return Array.from(hits);
    });

  const PAGES = [
    // Settings opens the assistant from its bottom-nav tab on phones.
    { name: "settings", url: "/settings.html", openWith: "[data-testid=nav-assistant]" },
    // Sign-up has no bottom nav: the round launcher, which hides while a
    // form field is focused.
    { name: "rider-signup", url: "/rider-signup.html", openWith: "[data-testid=hta-launcher]" }
  ];

  for (const pg of PAGES) {
    for (const phone of PHONES) {
      test(`${pg.name} on ${phone.name}: Harvey Assistant, nothing covered, chat fits with the keyboard`, async () => {
        const { context, page, errors, calls } = await open(phone, pg.url);
        const shot = async (what) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${pg.name}-${phone.name}-${what}.png`) }); };
        await shot("page");
        await page.evaluate(() => { document.scrollingElement.scrollTop = 1e9; });
        await page.waitForTimeout(600);
        await shot("page-end");
        const end = await pageFacts(page);
        await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
        await page.waitForTimeout(400);
        const top = await pageFacts(page);
        const textHits = await textUnderFloaters(page);
        await page.waitForTimeout(300);

        // Open the old way if the old widget is there (before run), else
        // the new entry point.
        if (top.oldWidget) {
          await page.evaluate(() => window.openHarveyAiChat());
          await page.waitForTimeout(800);
          await shot("chat");
        }
        expect(top.oldWidget).toBe(false);
        await page.tap(pg.openWith);
        await page.waitForTimeout(800);
        await shot("chat");
        expect(await page.evaluate(() => document.getElementById("htaPanel").classList.contains("open"))).toBe(true);
        const onTop = await page.evaluate(() => {
          const p = document.getElementById("htaPanel");
          return [".hta-head", ".hta-911", "input[type=text]"].map((sel) => {
            const r = p.querySelector(sel).getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
            return p.contains(hit) ? "ok" : `${sel} under ${hit && (hit.className || hit.tagName)}`;
          });
        });

        await page.fill("#htaPanel input[type=text]", "How do I book a ride?");
        await page.press("#htaPanel input[type=text]", "Enter");
        await page.waitForFunction(() => document.querySelectorAll("#htaPanel .hta-bot").length >= 2, null, { timeout: 15000 });
        await shot("chat-answer");
        await page.focus("#htaPanel input[type=text]");
        await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
        await page.waitForTimeout(600);
        await shot("chat-keyboard");
        const kb = await page.evaluate(() => {
          const p = document.getElementById("htaPanel").getBoundingClientRect();
          const input = document.querySelector("#htaPanel input[type=text]").getBoundingClientRect();
          const panel = document.getElementById("htaPanel");
          return { inside: p.top >= 0 && p.left >= 0 && p.right <= innerWidth && p.bottom <= innerHeight, inputVisible: input.top >= 0 && input.bottom <= innerHeight, sideways: panel.scrollWidth > panel.clientWidth + 1, emergency: panel.querySelector(".hta-911").textContent };
        });

        const navTabs = pg.name === "settings" ? { navAssistant: true, newLauncher: false, tabsFit: true } : { newLauncher: true };
        expect(top).toMatchObject({ sideways: false, covered: [], ...navTabs });
        expect(end).toMatchObject({ sideways: false, covered: [] });
        expect(textHits).toEqual([]);
        expect(onTop).toEqual(["ok", "ok", "ok"]);
        expect(kb).toMatchObject({ inside: true, inputVisible: true, sideways: false });
        expect(kb.emergency).toContain("Call 911");
        expect(calls.legacy).toBe(0); // nothing goes to /api/ai/support (OpenAI)
        expect(calls.assist).toEqual(["How do I book a ride?"]);
        expect(errors).toEqual([]);
        await context.close();
      });
    }
  }

  test("sign-up: the launcher steps aside while a form field is focused; settings keeps its own launcher on wider screens", async () => {
    const { context, page } = await open(PHONES[0], "/rider-signup.html");
    // A sign-up form field (not the assistant's own input).
    await page.locator("input[type=email]:visible, input[type=text]:visible").filter({ hasNot: page.locator("#htaPanel") }).first().focus();
    expect(await page.evaluate(() => !document.getElementById("htaPanel").contains(document.activeElement) && document.activeElement.tagName)).toBe("INPUT");
    await page.waitForTimeout(400);
    expect(await page.isVisible("[data-testid=hta-launcher]")).toBe(false);
    await context.close();
    const desk = await open({ name: "desktop", width: 1280, height: 900 }, "/settings.html");
    expect(await desk.page.isVisible("[data-testid=hta-launcher]")).toBe(true);
    expect(await desk.page.isVisible("[data-testid=nav-assistant]")).toBe(false);
    await desk.page.click("button:has-text('Ask AI Support')");
    await desk.page.waitForTimeout(600);
    expect(await desk.page.evaluate(() => document.getElementById("htaPanel").classList.contains("open"))).toBe(true);
    expect(desk.calls.legacy).toBe(0);
    await desk.context.close();
  });
});
