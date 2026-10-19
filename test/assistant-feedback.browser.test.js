// Browser check of answer ratings in the web assistant (rider dashboard;
// the rider apps show this page in a WebView). Desktop Chromium at phone
// size: NOT a device test.
// - An answer with a feedback token shows "Was this helpful?" with thumbs
//   up and down; a tap sends the token and the rating, then says thanks.
// - An answer without a token (ratings off) shows no buttons.
// - Every question carries the same conversation id until Clear chat,
//   which starts a new one.
// The assist and feedback responses are stubbed in the browser.
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/assistant-feedback.browser
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
jest.setTimeout(90000);

const HOST = "harveytaxiservice.test";

describeWithBrowser("web assistant answer ratings", () => {
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
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test("thumbs appear only with a token, send the rating, and the conversation id resets on Clear chat", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const asked = [];
    const rated = [];
    await context.route("**/api/agent/rider/assist", (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      asked.push(body);
      const withToken = asked.length !== 2;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, agent_available: true, reply: `Answer ${asked.length}`, source: "rules", actions: [], sources: [], ...(withToken ? { feedback_token: `tok-${asked.length}` } : {}) })
      });
    });
    await context.route("**/api/agent/rider/feedback", (route) => {
      rated.push(JSON.parse(route.request().postData() || "{}"));
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, saved: true, rating: "up" }) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
    await page.click("[data-testid=hta-launcher]");
    const ask = async (q, count) => {
      await page.fill("#htaPanel input[type=text]", q);
      await page.press("#htaPanel input[type=text]", "Enter");
      await page.waitForFunction((c) => document.querySelectorAll("#htaPanel .hta-bot").length >= c, count, { timeout: 15000 });
    };
    await ask("first", 2);
    await ask("second", 3);
    const rows = await page.$$eval("#htaPanel .hta-bot", (els) => els.map((e) => e.querySelectorAll(".hta-rate button").length));
    // Greeting, answer with token, answer without.
    expect(rows).toEqual([0, 2, 0]);

    await page.click("#htaPanel .hta-rate button[aria-label=Helpful]");
    await page.waitForFunction(() => /Thanks for the feedback/.test(document.querySelector("#htaPanel .hta-rate").textContent), null, { timeout: 10000 });
    expect(rated).toEqual([{ feedback_token: "tok-1", rating: "up" }]);

    expect(asked[0].conversation_id).toMatch(/^c_[A-Za-z0-9]{20}$/);
    expect(asked[1].conversation_id).toBe(asked[0].conversation_id);

    // Clear chat starts a new conversation.
    await page.locator("#htaPanel button", { hasText: /clear/i }).first().click();
    await ask("third", 2);
    expect(asked[2].conversation_id).toMatch(/^c_[A-Za-z0-9]{20}$/);
    expect(asked[2].conversation_id).not.toBe(asked[0].conversation_id);
    expect(errors).toEqual([]);
    await context.close();
  });
});
