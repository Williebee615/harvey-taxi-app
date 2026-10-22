// Standing owner rule: the admin token is typed per use and never stored.
// The live dispatch map, account-deletion and agent admin pages used to
// keep it in browser storage. They now sign in with the admin session
// cookie (or keep a typed token in page memory only) and remove any value
// an older version saved. Synthetic data, fake database, Chromium.
//   NODE_PATH="$(npm root -g)" npx jest test/admin-token-storage.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("admin pages never keep the admin token in browser storage", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockClient = createFakeSupabase({ drivers: [], riders: [], rides: [], audit_logs: [], system_flags: [], account_deletion_requests: [], driver_offers: [] });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  async function openWithStoredToken(path, { signedIn = true } = {}) {
    const context = await browser.newContext();
    if (signedIn) await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    // What an older version of these pages saved.
    await context.addInitScript(() => {
      if (!window.sessionStorage.getItem("__seeded")) {
        window.localStorage.setItem("harvey_admin_token", "old-stored-token");
        window.sessionStorage.setItem("harvey_agent_elevated_token", "old-stored-token");
        window.sessionStorage.setItem("__seeded", "1");
      }
    });
    const page = await context.newPage();
    const adminCalls = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/admin/")) adminCalls.push({ url: r.url(), token: r.headers()["x-admin-token"] || null });
    });
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    return { context, page, adminCalls };
  }

  test("live dispatch map: signs in with the session, clears the stored token, never prompts or sends one", async () => {
    const { context, page, adminCalls } = await openWithStoredToken("/admin-live-dispatch-map.html");
    await page.waitForFunction(() => window.localStorage.getItem("harvey_admin_token") === null);
    await page.waitForTimeout(1500);
    expect(adminCalls.length).toBeGreaterThan(0);
    expect(adminCalls.every((c) => c.token === null)).toBe(true);
    await context.close();
  });

  test("live dispatch map without a session asks the user to sign in on the dashboard", async () => {
    const { context, page } = await openWithStoredToken("/admin-live-dispatch-map.html", { signedIn: false });
    await page.waitForFunction(() => /sign in on the admin dashboard/i.test(document.body.innerText), null, { timeout: 15000 });
    await context.close();
  });

  test("account deletion: loads with the session; a typed token lives in page memory only", async () => {
    const { context, page, adminCalls } = await openWithStoredToken("/admin-account--deletion.html");
    await page.waitForFunction(() => window.localStorage.getItem("harvey_admin_token") === null);
    await page.waitForTimeout(1000);
    expect(adminCalls.some((c) => c.url.includes("/api/admin/account-deletions"))).toBe(true);
    await page.fill("#tokenInput", "typed-token");
    await page.click("#saveTokenBtn");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => JSON.stringify({ ...window.localStorage }))).not.toMatch(/typed-token/);
    expect(await page.evaluate(() => JSON.stringify({ ...window.sessionStorage }))).not.toMatch(/typed-token/);
    await context.close();
  });

  test("agent page: an older saved elevated token is removed", async () => {
    const { context, page } = await openWithStoredToken("/admin-agent.html");
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.sessionStorage.getItem("harvey_agent_elevated_token"))).toBeNull();
    await context.close();
  });
});
