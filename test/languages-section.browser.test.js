// Languages (owner, 2026-10-13). The home page "Languages" section uses the
// owner's wording, and its tiles switch the language like the selector. One
// language preference (set in Settings or on any translated page) applies
// to every translated page; a page without that translation shows English
// and leaves the preference alone. Chromium; fake database.
//   NODE_PATH="$(npm root -g)" npx jest test/languages-section.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const fs = require("fs");
const path = require("path");
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
const HOST = "harveytaxiservice.test";
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

describe("Languages section wording", () => {
  test("uses the owner's heading and note", () => {
    expect(html).toContain('<h2 id="lang-heading">Languages</h2>');
    expect(html).toContain(
      "Choose a language for available content. Translations are automated and may contain errors. Some screens, support responses, policies, and legal terms are available only in English."
    );
    expect(html).not.toContain("Website languages");
    expect(html).not.toContain("Website text, automatic translation");
  });

  test("has one tile for every language in the selector", () => {
    const options = [...html.matchAll(/<option value="([a-z]{2})">/g)].map((m) => m[1]);
    const tiles = [...html.matchAll(/class="lang-tile" data-lang="([a-z]{2})"/g)].map((m) => m[1]);
    expect(tiles).toEqual(options);
  });
});

describeWithBrowser("Languages section tiles", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ riders: [], drivers: [], rides: [], audit_logs: [], system_flags: [] });
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

  test("tapping a tile switches the language and the selector, and marks the tile", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click('.lang-tile[data-lang="ar"]');
    const ar = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      select: document.getElementById("language-select").value,
      pressed: document.querySelector('.lang-tile[data-lang="ar"]').getAttribute("aria-pressed"),
      enPressed: document.querySelector('.lang-tile[data-lang="en"]').getAttribute("aria-pressed")
    }));
    await page.click('.lang-tile[data-lang="en"]');
    const en = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await context.close();
    expect(ar).toEqual({ lang: "ar", dir: "rtl", select: "ar", pressed: "true", enPressed: "false" });
    expect(en).toEqual({ lang: "en", dir: "ltr" });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: "en-US" });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    return { context, page: await context.newPage() };
  }
  const shown = (page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));

  test("a language chosen in Settings carries to the home page and both sign-up pages", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    await page.selectOption("#languageSelect", "es");
    const settings = await shown(page);
    const results = {};
    for (const p of ["/", "/rider-signup.html", "/driver-signup.html"]) {
      await page.goto(`${base}${p}`, { waitUntil: "load" });
      results[p] = (await shown(page)).lang;
    }
    await context.close();
    expect(settings.lang).toBe("es");
    expect(results).toEqual({ "/": "es", "/rider-signup.html": "es", "/driver-signup.html": "es" });
  });

  test("a language a page doesn't have shows English there, without losing the choice", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    await page.selectOption("#languageSelect", "yo");
    const settings = { ...(await shown(page)), select: await page.$eval("#languageSelect", (el) => el.value) };
    await page.goto(`${base}/rider-signup.html`, { waitUntil: "load" });
    const rider = await shown(page);
    await page.goto(`${base}/`, { waitUntil: "load" });
    const home = await shown(page);
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    const back = await page.$eval("#languageSelect", (el) => el.value);
    await context.close();
    expect(settings).toEqual({ lang: "en", dir: "ltr", select: "yo" });
    expect(rider.lang).toBe("en");
    expect(home.lang).toBe("yo");
    expect(back).toBe("yo");
  });

  test("a tile on the home page updates Settings, and right-to-left follows Arabic", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.click('.lang-tile[data-lang="ar"]');
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    const settings = { ...(await shown(page)), select: await page.$eval("#languageSelect", (el) => el.value) };
    await context.close();
    expect(settings).toEqual({ lang: "ar", dir: "rtl", select: "ar" });
  });

  test("a choice saved by the old sign-up page is still honoured", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.evaluate(() => localStorage.setItem("harvey_rider_language", "fr"));
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    const settings = await shown(page);
    await context.close();
    expect(settings.lang).toBe("fr");
  });
});
