// Mobile layout check for HTAF's public pages at phone widths: no
// horizontal overflow, footer and legal links present, and no file
// input rendered on the application page.
//
// Needs Playwright and a Chromium build. CI does not install a browser,
// so this suite skips there; run it locally with Playwright available
// (for example NODE_PATH="$(npm root -g)" npx jest test/htaf-mobile).
// Set HTAF_SCREENSHOT_DIR to also save a full-page screenshot per page
// and width.

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

const FOUNDATION = "harveytransportationfoundation.com";
const WIDTHS = [360, 390];
const PAGES = [
  ["home", "/"],
  ["apply", "/htaf-application.html"],
  ["contact", "/contact.html"],
  ["leadership", "/leadership.html"],
  ["privacy", "/privacy.html"],
  ["terms", "/terms.html"],
  ["service-providers", "/service-providers.html"]
];

const SCREENSHOT_DIR = process.env.HTAF_SCREENSHOT_DIR || "";

jest.setTimeout(120000);

describeWithBrowser("HTAF pages at mobile widths", () => {
  let server;
  let browser;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({});
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    // Resolve the foundation hostname to the local server so the
    // Host-based routing is exercised exactly as in production.
    browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${FOUNDATION} 127.0.0.1:${port}`]
    });
    if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const cases = PAGES.flatMap(([name, urlPath]) => WIDTHS.map((width) => [name, urlPath, width]));

  test.each(cases)("%s (%s) at %ipx", async (name, urlPath, width) => {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    // Only the local server is reachable; third-party requests (fonts)
    // are dropped so the check is deterministic and offline.
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === FOUNDATION ? route.continue() : route.abort();
    });

    const res = await page.goto(`http://${FOUNDATION}${urlPath}`, { waitUntil: "load" });
    expect(res.status()).toBe(200);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      footerText: (document.querySelector("footer") || {}).innerText || "",
      legalLinks: [...document.querySelectorAll("footer a")].map((a) => a.href)
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.fileInputs).toBe(0);
    expect(metrics.footerText).toContain("501(c)(3) public charity · EIN 41-5115030");
    expect(metrics.legalLinks).toEqual(
      expect.arrayContaining([
        `https://${FOUNDATION}/privacy.html`,
        `https://${FOUNDATION}/terms.html`,
        `https://${FOUNDATION}/service-providers.html`
      ])
    );

    if (SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${name}-${width}.jpg`),
        fullPage: true,
        type: "jpeg",
        quality: 60
      });
    }
    await context.close();
  });
});
