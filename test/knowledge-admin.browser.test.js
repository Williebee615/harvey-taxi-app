// Browser check for admin-managed knowledge (docs/ai-knowledge.md, phase
// 2): an admin writes a draft, approves it, and it appears on the public
// /policies.html page and in the rider assistant with a source link.
// Writes local screenshots to docs/screenshots/ai-phase2/ when
// KB_SCREENSHOTS=1. The article is a test fixture, not a Harvey policy.
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/knowledge-admin.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "admin@example.test";
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver } = require("./rideTestHelpers");

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
const SHOTS = process.env.KB_SCREENSHOTS === "1" ? path.join(__dirname, "..", "docs", "screenshots", "ai-phase2") : null;

async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const toast = document.getElementById("toast");
    if (toast) toast.style.display = "none";
    const tag = document.createElement("div");
    tag.id = "__testDataLabel";
    tag.textContent = "LOCAL TEST SERVER - TEST FIXTURE DATA - NOT LIVE";
    tag.setAttribute("style", "position:fixed;right:6px;bottom:6px;z-index:2147483647;background:#ffd76a;color:#1a1300;font:800 11px/1 Arial,sans-serif;padding:5px 7px;border-radius:6px");
    document.body.appendChild(tag);
  });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  await page.evaluate(() => document.getElementById("__testDataLabel")?.remove());
}

describeWithBrowser("admin-managed knowledge UI", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase(
      {
        riders: [makeRider()],
        drivers: [makeDriver()],
        rides: [],
        audit_logs: [],
        knowledge_articles: [],
        system_flags: [
          { key: "agent_assist_enabled", value: "true" },
          { key: "agent_kill_switch", value: "false" }
        ]
      },
      { identity: { knowledge_articles: "id" } }
    );
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
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function newPage({ admin = false, mobile = false } = {}) {
    const headers = admin ? { "x-admin-token": "test-admin-token" } : {};
    const context = await browser.newContext(
      mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: headers } : { viewport: { width: 1280, height: 900 }, extraHTTPHeaders: headers }
    );
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    return page;
  }

  test("draft -> approve -> public page and assistant source; signed-out admin sees sign-in notice", async () => {
    const empty = await newPage();
    await empty.goto(`${base}/policies.html`);
    await empty.waitForSelector(".empty");
    expect(await empty.textContent("#articles")).toMatch(/No additional answers have been published yet/);

    const page = await newPage({ admin: true });
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-knowledge.html`);
    await page.waitForSelector("#needed li");
    expect(await page.textContent("#needed")).toMatch(/Cancellation fees.*Driver insurance requirements/s);

    await page.fill('[data-testid="kb-title"]', "Umbrella loans (test fixture)");
    await page.fill('[data-testid="kb-slug"]', "test-umbrella-loans");
    await page.fill('[data-testid="kb-body"]', "Test fixture wording: riders may borrow a spare umbrella from the driver and hand it back at drop-off.");
    await page.click('[data-testid="kb-save"]');
    await page.waitForSelector('[data-testid="kb-article-test-umbrella-loans"] .s-draft');
    await shot(page, "admin-knowledge-draft.png");

    await page.click("button[data-approve]");
    await page.waitForSelector('[data-testid="kb-article-test-umbrella-loans"] .s-approved');
    expect(await page.textContent("#indexStatus")).toMatch(/using 1 approved article/);

    const pub = await newPage({ mobile: true });
    await pub.goto(`${base}/policies.html#test-umbrella-loans`);
    await pub.waitForSelector("article#test-umbrella-loans");
    expect(await pub.textContent("article#test-umbrella-loans")).toMatch(/borrow a spare umbrella.*Approved .*Version 1/s);
    expect(await pub.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await shot(pub, "policies-page-mobile.png");

    const ask = await pub.evaluate(async () => (await fetch("/api/agent/rider/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Can I borrow an umbrella?" }) })).json());
    expect(ask.sources[0].url).toBe("/policies.html#test-umbrella-loans");

    // Editing the approved article puts it back to draft.
    await page.click("button[data-edit]");
    await page.fill('[data-testid="kb-body"]', "Test fixture wording, edited: riders may borrow a spare umbrella from the driver.");
    await page.click('[data-testid="kb-save"]');
    await page.waitForSelector('[data-testid="kb-article-test-umbrella-loans"] .s-draft');
    expect(await page.textContent("#indexStatus")).toMatch(/using 0 approved article/);

    const anon = await newPage();
    await anon.goto(`${base}/admin-knowledge.html`);
    await anon.waitForSelector("#authNotice:not([hidden])");

    expect([...empty.errors, ...page.errors, ...pub.errors]).toEqual([]);
  });
});
