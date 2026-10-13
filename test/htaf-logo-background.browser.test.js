// HTAF logo as a faint background on harveytransportationfoundation.com
// (owner request, 2026-10-13): the image is served on HTAF's domain, sits
// behind the page content (never over it, never catching taps), stays
// centred while scrolling, causes no sideways scroll on phones, and is
// hidden in high-contrast mode. Chromium; fake database.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-logo-background.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.FOUNDATION_HOST = "harveytransportationfoundation.test";
delete process.env.CANONICAL_HOST;

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
const HOST = "harveytransportationfoundation.test";
const SHOTS = process.env.PAGE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "htaf-logo") : null;

test("the logo file is a small transparent WebP", () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "public", "htaf-logo.webp"));
  expect(buf.slice(0, 4).toString()).toBe("RIFF");
  expect(buf.slice(8, 12).toString()).toBe("WEBP");
  expect(buf.length).toBeLessThan(150 * 1024);
});

describeWithBrowser("HTAF home page background logo", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ audit_logs: [], system_flags: [], htaf_applications: [] });
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

  async function open(viewport, isMobile) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
    await context.route(/^https?:\/\/(?!harveytransportationfoundation\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const logo = page.waitForResponse((r) => r.url().endsWith("/htaf-logo.webp"));
    await page.goto(`${base}/`, { waitUntil: "load" });
    return { context, page, logo: await logo };
  }

  const layer = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.body, "::after");
    return { image: cs.backgroundImage, position: cs.position, zIndex: cs.zIndex, pointer: cs.pointerEvents, opacity: Number(cs.opacity), display: cs.display };
  });

  for (const [name, viewport, isMobile] of [["phone 360", { width: 360, height: 780 }, true], ["phone 390", { width: 390, height: 844 }, true], ["desktop", { width: 1280, height: 800 }, false]]) {
    test(`${name}: logo served on HTAF's domain, behind content, no sideways scroll`, async () => {
      const { context, page, logo } = await open(viewport, isMobile);
      expect(logo.status()).toBe(200);
      expect(logo.headers()["content-type"]).toMatch(/image\/webp/);

      const l = await layer(page);
      expect(l.image).toContain("/htaf-logo.webp");
      expect(l).toMatchObject({ position: "fixed", zIndex: "-1", pointer: "none" });
      expect(l.opacity).toBeGreaterThan(0.05);
      expect(l.opacity).toBeLessThanOrEqual(0.15);

      // Content is on top: the element at the screen centre is page content,
      // and buttons still take taps.
      const top = await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return el && el !== document.body && el !== document.documentElement;
      });
      expect(top).toBe(true);
      await expect(page.locator('.hero-actions a:has-text("Partner With Us")').isVisible()).resolves.toBe(true);

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, `${name.replace(" ", "-")}-top.png`) });
        await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#programs").scrollIntoView(); });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, `${name.replace(" ", "-")}-programs.png`) });
      }
      await context.close();
    });
  }

  for (const [pagePath, shot] of [["/", "header-home"], ["/htaf-application.html", "header-application"]]) {
    test(`${pagePath}: the header shows the HTAF logo, not the "HT" fallback`, async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await context.route(/^https?:\/\/(?!harveytransportationfoundation\.test)/, (route) => route.abort());
      const page = await context.newPage();
      await page.goto(`${base}${pagePath}`, { waitUntil: "load" });
      const mark = await page.evaluate(() => {
        const box = document.querySelector(".brand-mark");
        const img = box.querySelector("img");
        return {
          text: box.textContent.trim(),
          loaded: !!img && img.complete && img.naturalWidth > 0,
          src: img && img.getAttribute("src"),
          bg: getComputedStyle(box).backgroundImage
        };
      });
      expect(mark).toEqual({ text: "", loaded: true, src: "/htaf-logo-192.webp", bg: "none" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shot}.png`), clip: { x: 0, y: 0, width: 390, height: 260 } });
      await context.close();
    });
  }

  test("hidden in high-contrast mode", async () => {
    const { context, page } = await open({ width: 390, height: 844 }, true);
    await page.evaluate(() => document.body.classList.add("high-contrast"));
    expect((await layer(page)).display).toBe("none");
    await context.close();
  });
});
