// Harvey Taxi Mobile index page: the "Allow AI answers?" notice (PR #210)
// in the shared Harvey Assistant fits small phones, with and without the
// keyboard: the panel stays on screen, nothing scrolls sideways, and
// "Allow AI answers" can be tapped. The assistant and consent routes are
// stubbed in the browser, so no model is called. Chromium at phone sizes:
// NOT a device test. Skips until lib/agent/aiConsent.js (#210) is present.
// Writes screenshots to docs/screenshots/index-assistant/<label>/ when
// INDEX_SCREENSHOTS=<label>.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/index-assistant-consent.browser
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
// The consent notice comes from PR #210 (lib/agent/aiConsent.js). Until that
// lands this file skips; afterwards it runs with no change.
const hasConsent = require("fs").existsSync(require("path").join(__dirname, "..", "lib", "agent", "aiConsent.js"));
const describeWithConsent = chromium && hasConsent ? describe : describe.skip;
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

describeWithConsent("Harvey Taxi Mobile index page: the AI consent notice on small phones", () => {
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


  // eslint-disable-next-line global-require
  const NOTICE = hasConsent ? { required: true, ...require("../lib/agent/aiConsent").consentText("rider") } : null;
  for (const phone of PHONES) {
    test(`${phone.name}: consent notice fits`, async () => {
      const { context, page, errors } = await open(phone);
      await context.route("**/api/agent/rider/ai-consent", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ai_available: true, consent: { granted: false, version: NOTICE.version }, notice: NOTICE }) }));
      await context.route("**/api/agent/rider/assist", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, agent_available: true, reply: "Your ride is on the way. Open Track ride to see your driver.", source: "rules", actions: [], sources: [], ai_consent: NOTICE }) }));
      await page.evaluate(() => window.openHarveyAiChat());
      await page.fill("#htaPanel input[type=text]", "where is my driver?");
      await page.press("#htaPanel input[type=text]", "Enter");
      await page.waitForSelector("[data-testid=hta-consent]", { timeout: 15000 });
      await page.waitForTimeout(500);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-consent.png`) });
      const facts = async () => page.evaluate(() => {
        const p = document.getElementById("htaPanel"); const pr = p.getBoundingClientRect();
        const card = document.querySelector("[data-testid=hta-consent]");
        const allow = document.querySelector("[data-testid=hta-consent-allow]");
        allow.scrollIntoView({ block: "nearest" });
        const ar = allow.getBoundingClientRect(); const cr = card.getBoundingClientRect();
        const hit = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2);
        return { inside: pr.top >= 0 && pr.left >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight, cardWithinPanel: cr.left >= pr.left && cr.right <= pr.right, allowTappable: hit === allow || allow.contains(hit), sideways: p.scrollWidth > p.clientWidth + 1 || document.querySelector("#htaPanel .hta-log").scrollWidth > document.querySelector("#htaPanel .hta-log").clientWidth + 1 };
      });
      const normal = await facts();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-consent-allow.png`) });
      await page.focus("#htaPanel input[type=text]");
      await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
      await page.waitForTimeout(600);
      const kb = await facts();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${phone.name}-consent-keyboard.png`) });
      const want = { inside: true, cardWithinPanel: true, allowTappable: true, sideways: false };
      expect(normal).toEqual(want);
      expect(kb).toEqual(want);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});
