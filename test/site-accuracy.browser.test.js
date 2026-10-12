// Public pages on phones: no sideways scrolling at 360 and 390 px, basic
// accessibility (page language, one main heading, named links and
// buttons, image alt text), and the home page's driver snapshot shown
// only for a real, positive count. Chromium; fake database.
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/site-accuracy.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

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
jest.setTimeout(180000);
const HOST = "harveytaxiservice.test";

const PAGES = [
  "/",
  "/foundation.html",
  "/htaf-application.html",
  "/driver-signup.html",
  "/rider-signup.html",
  "/support.html",
  "/privacy.html",
  "/terms.html"
];

describeWithBrowser("public pages on phones", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ drivers: [], rides: [], riders: [], system_flags: [], audit_logs: [] });
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

  async function openPage(path, width, routeSnapshot) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    if (routeSnapshot) {
      await context.route(/\/api\/public\/mission-control/, (route) =>
        route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ...routeSnapshot }) })
      );
    }
    const page = await context.newPage();
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    return { page, context };
  }

  for (const width of [360, 390]) {
    test.each(PAGES)(`%s has no sideways scrolling at ${width}px`, async (path) => {
      const { page, context } = await openPage(path, width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await context.close();
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test.each(PAGES)("%s passes basic accessibility checks", async (path) => {
    const { page, context } = await openPage(path, 390);
    const report = await page.evaluate(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const name = (el) =>
        (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.value || "")
          .trim() ||
        [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join("").trim();
      return {
        lang: document.documentElement.lang,
        h1: [...document.querySelectorAll("h1")].filter(visible).length,
        unnamed: [...document.querySelectorAll("a[href], button")]
          .filter(visible)
          .filter((el) => !name(el))
          .map((el) => el.outerHTML.slice(0, 80)),
        imgNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src)
      };
    });
    await context.close();
    expect(report.lang).toMatch(/^en/);
    expect(report.h1).toBeGreaterThanOrEqual(1);
    expect(report.unnamed).toEqual([]);
    expect(report.imgNoAlt).toEqual([]);
  });

  test("home page hides the driver snapshot when no driver is online", async () => {
    const { page, context } = await openPage("/", 390, { online_drivers: 0, avg_wait_minutes: null });
    const hidden = await page.$eval("#mission-control", (el) => el.hidden);
    await context.close();
    expect(hidden).toBe(true);
  });

  test("home page shows a real count when drivers are online", async () => {
    const { page, context } = await openPage("/", 390, { online_drivers: 3, avg_wait_minutes: 7 });
    await page.waitForFunction(() => !document.getElementById("mission-control").hidden);
    const text = await page.$eval("#mission-control", (el) => el.innerText);
    await context.close();
    expect(text).toContain("3");
    expect(text).toContain("7 min");
  });

  for (const width of [360, 390]) {
    test(`with Larger Text on at ${width}px, the assistant button sits in the bottom bar and covers nothing`, async () => {
      const { page, context } = await openPage("/", width);
      await page.click("#text-toggle");
      await page.waitForSelector(".harvey-ai-launch", { state: "visible", timeout: 10000 });
      const r = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect().toJSON();
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const launch = box(document.querySelector(".harvey-ai-launch"));
        const nav = box(document.querySelector(".bottom-nav"));
        const navButtons = [...document.querySelectorAll(".bottom-nav .nav-btn")].map(box);
        const teaser = document.getElementById("aiTeaserBubble");
        return {
          largeText: document.body.classList.contains("large-text"),
          insideBar: launch.top >= nav.top - 1 && launch.bottom <= nav.bottom + 1,
          coversNavButton: navButtons.some((b) => hit(b, launch)),
          navLabelsFit: [...document.querySelectorAll(".bottom-nav .nav-btn")].every((b) => b.scrollWidth <= b.clientWidth + 1),
          teaserShown: !!teaser && getComputedStyle(teaser).display !== "none",
          overflow: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      await context.close();
      expect(r.largeText).toBe(true);
      expect(r.insideBar).toBe(true);
      expect(r.coversNavButton).toBe(false);
      expect(r.navLabelsFit).toBe(true);
      expect(r.teaserShown).toBe(false);
      expect(r.overflow).toBeLessThanOrEqual(1);
    });
  }

  test("the welcome note sits in the page and is gone after about 4 seconds", async () => {
    const { page, context } = await openPage("/", 390);
    const shown = await page.$eval(".welcome-banner", (el) => getComputedStyle(el).position);
    await page.waitForSelector(".welcome-banner", { state: "detached", timeout: 7000 });
    await context.close();
    expect(shown).not.toBe("fixed");
  });

  test("waitlist buttons open an email to support with a subject", async () => {
    const { page, context } = await openPage("/", 390);
    const hrefs = await page.$$eval('a[data-intent^="waitlist_"]', (els) => els.map((e) => e.getAttribute("href")));
    await context.close();
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) expect(href).toMatch(/^mailto:support@harveytaxiservice\.com\?subject=Waitlist/);
  });
});
