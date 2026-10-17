// HTAF Assistant widget on HTAF's pages, phone width, foundation domain:
// hidden while off; when on, answers with a source, reports gaps with
// support links, refuses status lookups; nothing stored in the browser.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-assistant.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

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
jest.setTimeout(120000);

const FOUNDATION = "harveytransportationfoundation.com";

describeWithBrowser("HTAF Assistant widget (390px)", () => {
  let server;
  let browser;
  let flags;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ system_flags: [{ key: "htaf_assist_enabled", value: "false" }], htaf_assistant_questions: [] });
    flags = mockSupabaseClient._state.system_flags;
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${FOUNDATION} 127.0.0.1:${server.address().port}`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function open(pathname, viewport = { width: 390, height: 844 }) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === FOUNDATION ? route.continue() : route.abort()));
    await page.goto(`http://${FOUNDATION}${pathname}`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    return page;
  }

  async function askAndWait(page, q) {
    const before = await page.locator('[data-testid="htaf-assist-bot"]').count();
    await page.fill('[data-testid="htaf-assist-input"]', q);
    await page.click('[data-testid="htaf-assist-send"]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="htaf-assist-bot"]').length > n, before);
    return page.locator('[data-testid="htaf-assist-bot"]').last().innerText();
  }

  test("while off, no assistant appears", async () => {
    flags[0].value = "false";
    const page = await open("/");
    expect(await page.locator('[data-testid="htaf-assist-open"]').count()).toBe(0);
  });

  test.each(["/", "/htaf-application.html", "/contact.html"])("when on, %s shows 'Ask HTAF' and answers from HTAF's pages", async (pathname) => {
    flags[0].value = "true";
    const page = await open(pathname);
    await page.click('[data-testid="htaf-assist-open"]');
    expect(await page.locator("#htafAssistPanel").innerText()).toMatch(/can't see applications, book rides, send texts or make decisions/);

    const programs = await askAndWait(page, "What programs do you offer?");
    expect(programs).toMatch(/Veteran Assistance/);
    expect(programs).toMatch(/Source: HTAF home page — Programs/);

    const gap = await askAndWait(page, "Do you have wheelchair vans?");
    expect(gap).toMatch(/I don't have approved HTAF information/);
    expect(gap).toMatch(/Email WillieHtaf@harveytransportationfoundation\.com/);

    const status = await askAndWait(page, "What's the status of my application?");
    expect(status).toMatch(/Application status is private/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => /htaf.?assist|chat/i.test(k)))).toEqual([]);
    expect(page.errors).toEqual([]);
  });

  test("answers are shown as text, never as HTML", async () => {
    flags[0].value = "true";
    const page = await open("/contact.html");
    await page.click('[data-testid="htaf-assist-open"]');
    await askAndWait(page, '<img src=x onerror="window.__pwned=1"> what is this');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#htafAssistPanel img").count()).toBe(0);
  });

  // The floating button must never sit on top of the 501(c)(3) status
  // lines (owner report 2026-10-17: it covered the home page badge on a
  // phone). Checked at the top, mid-page and the bottom of each page.
  const coverage = (page) =>
    page.evaluate(() => {
      const btn = document.querySelector('[data-testid="htaf-assist-open"]');
      const b = btn.getBoundingClientRect();
      // Stepping aside is a short fade, so read the state the page has
      // chosen rather than sampling the fade mid-way.
      const visible = !btn.classList.contains("htaf-assist-yield");
      const covered = [...document.querySelectorAll("[data-htaf-keep-clear]")].filter((e) => {
        const r = e.getBoundingClientRect();
        return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      }).length;
      return { visible, covered };
    });

  test.each([
    ["/", 360, 740],
    ["/", 390, 844],
    ["/", 412, 915],
    ["/contact.html", 360, 740],
    ["/htaf-application.html", 360, 740]
  ])("%s at %ipx x %ipx: 'Ask HTAF' never covers the 501(c)(3) status lines", async (pathname, width, height) => {
    flags[0].value = "true";
    const page = await open(pathname, { width, height });
    expect(await page.locator("[data-htaf-keep-clear]").count()).toBeGreaterThan(0);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += 120) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(60);
      const c = await coverage(page);
      expect({ y, coversWhileVisible: c.visible && c.covered > 0 }).toEqual({ y, coversWhileVisible: false });
    }
    expect(page.errors).toEqual([]);
  });

  test("360px home: the button steps aside over the badge, comes back after scrolling, and stays while the panel is open", async () => {
    flags[0].value = "true";
    const page = await open("/", { width: 360, height: 740 });
    // At the top of the page the button would cover the badge (the reported case).
    expect(await coverage(page)).toEqual({ visible: false, covered: 1 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="htaf-assist-open"]')).visibility === "hidden");
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="htaf-assist-open"]')).visibility === "visible" && !document.querySelector('[data-testid="htaf-assist-open"]').classList.contains("htaf-assist-yield"));
    await page.click('[data-testid="htaf-assist-open"]');
    expect(await page.locator("#htafAssistPanel").isVisible()).toBe(true);
    // With the panel open the button is how you close it, so it stays.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    expect((await coverage(page)).visible).toBe(true);
  });
});
