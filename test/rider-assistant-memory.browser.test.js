// Browser check of the rider assistant's conversation memory (phase 3):
// recent turns are sent with a follow-up; "Clear chat" empties the panel
// and the memory; nothing is written to browser storage.
//
// Needs Playwright and Chromium; skips without them (CI has no browser).
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

describeWithBrowser("rider assistant: page-only memory and Clear chat", () => {
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

  test("follow-up carries context; Clear chat resets; no browser storage", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    const bodies = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/agent/rider/assist")) bodies.push(JSON.parse(r.postData() || "{}"));
    });
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
    const storageBefore = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).concat(Object.keys(sessionStorage))));
    await page.click("[data-testid=hta-launcher]");
    const ask = async (q, n) => {
      await page.fill("#htaPanel input[type=text]", q);
      await page.press("#htaPanel input[type=text]", "Enter");
      await page.waitForFunction((count) => document.querySelectorAll("#htaPanel .hta-bot").length >= count, n, { timeout: 15000 });
    };
    await ask("How long do you keep my data?", 2);
    await ask("and what about my location?", 3);
    expect(bodies[0].context).toEqual([]);
    expect(bodies[1].context[0]).toEqual({ role: "user", text: "How long do you keep my data?" });
    expect(bodies[1].context[1].role).toBe("assistant");
    expect(bodies[1].context[1].text).toMatch(/^From our Privacy Policy/);

    await page.click("[data-testid=hta-clear]");
    expect(await page.$$eval("#htaPanel .hta-msg", (els) => els.length)).toBe(1); // greeting only
    await ask("How do I contact support?", 2);
    expect(bodies[2].context).toEqual([]);

    const storageAfter = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).concat(Object.keys(sessionStorage))));
    expect(storageAfter).toBe(storageBefore);
    await context.close();
  });
});
