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

  async function open(pathname) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
});
