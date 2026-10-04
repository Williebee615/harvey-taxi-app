// Browser check of the rider assistant's conversation memory (phase 3).
// This same page runs inside the Harvey Taxi rider iOS and Android apps
// (WebView shell in mobile/); this test is a desktop-Chromium stand-in,
// not a device test.
// - Signed out: recent turns are sent with a follow-up; "Clear chat"
//   empties the panel; nothing is written to browser storage.
// - Signed in: turns are kept in sessionStorage for that account only,
//   restored after a reload, removed by Clear chat and by signing out, and
//   NOT carried into a new session (closing and reopening the app).
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
const { makeRider, makeDriver, signTestRiderToken } = require("./rideTestHelpers");

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

describeWithBrowser("rider assistant: conversation memory and Clear chat", () => {
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

  test("signed out: follow-up carries context; Clear chat resets; no browser storage", async () => {
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

  test("signed in: kept per account for the session, restored on reload, removed by Clear chat and sign-out", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bodies = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/agent/rider/assist")) bodies.push(JSON.parse(r.postData() || "{}"));
    });
    const open = async () => {
      await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
      await page.waitForFunction(() => window.__harveyAssistantAccount && window.__harveyAssistantAccount.id === "RIDER_1", null, { timeout: 20000 });
      await page.click("[data-testid=hta-launcher]");
    };
    const ask = async (q, n) => {
      await page.fill("#htaPanel input[type=text]", q);
      await page.press("#htaPanel input[type=text]", "Enter");
      await page.waitForFunction((count) => document.querySelectorAll("#htaPanel .hta-bot").length >= count, n, { timeout: 15000 });
    };
    const saved = () => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.indexOf("hta_chat:") === 0));

    await page.goto(`${base}/rider-dashboard.html`);
    await open();
    await ask("How long do you keep my data?", 2);
    expect(await saved()).toEqual(["hta_chat:rider:RIDER_1"]);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.indexOf("hta_chat") === 0))).toBe(false);

    // Reload: the conversation is restored and used for a follow-up.
    await page.reload();
    await open();
    expect(await page.textContent("#htaPanel .hta-log")).toContain("How long do you keep my data?");
    await ask("and what about my location?", 3);
    expect(bodies[bodies.length - 1].context[0]).toEqual({ role: "user", text: "How long do you keep my data?" });

    // Closing and reopening the app (a new WebView session, still signed
    // in): session memory does not carry over.
    const reopened = await context.newPage();
    await reopened.goto(`${base}/rider-dashboard.html`);
    await reopened.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
    await reopened.waitForFunction(() => window.__harveyAssistantAccount && window.__harveyAssistantAccount.id === "RIDER_1", null, { timeout: 20000 });
    await reopened.click("[data-testid=hta-launcher]");
    expect(await reopened.$$eval("#htaPanel .hta-msg", (els) => els.length)).toBe(1); // greeting only
    expect(await reopened.evaluate(() => Object.keys(sessionStorage).filter((k) => k.indexOf("hta_chat:") === 0))).toEqual([]);
    await reopened.close();

    // Another account on this device sees none of it.
    await page.evaluate(() => {
      window.__harveyAssistantAccount = { role: "rider", id: "RIDER_OTHER" };
      window.dispatchEvent(new CustomEvent("harvey:assistant-account"));
    });
    expect(await page.$$eval("#htaPanel .hta-msg", (els) => els.length)).toBe(1);
    await page.evaluate(() => {
      window.__harveyAssistantAccount = { role: "rider", id: "RIDER_1" };
      window.dispatchEvent(new CustomEvent("harvey:assistant-account"));
    });
    expect(await page.textContent("#htaPanel .hta-log")).toContain("what about my location?");

    // Clear chat removes this account's saved turns.
    await page.click("[data-testid=hta-clear]");
    expect(await saved()).toEqual([]);
    await ask("How do I contact support?", 2);
    expect(await saved()).toEqual(["hta_chat:rider:RIDER_1"]);

    // Signing out deletes every saved conversation and empties the panel.
    await page.evaluate(() => document.getElementById("riderLogoutBtn").click());
    await page.waitForFunction(() => !Object.keys(sessionStorage).some((k) => k.indexOf("hta_chat:") === 0), null, { timeout: 10000 });
    expect(await page.$$eval("#htaPanel .hta-msg", (els) => els.length)).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });
});
