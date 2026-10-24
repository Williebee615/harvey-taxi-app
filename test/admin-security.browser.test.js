// Browser check for the S.A.I. Cyber Defense panel (owner decision
// 2026-10-24): the owner signs in, sees a plain-English alert, blocks
// the address with a click, lifts it, sets up the authenticator from the
// page, saves recovery codes, and the next sign-in asks for the code.
// Credentials here are test fixtures.
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-security.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "test-fixture-admin-password";
delete process.env.ADMIN_API_TOKEN;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const totp = require("../lib/totp");
const securityIntel = require("../lib/securityIntel");

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
const HASH_KEY = totp.deriveKey("test-admin-session-secret", "security-intel-v1");
const ATTACKER = "203.0.113.9";
const SHOTS = process.env.SAI_SCREENSHOT_DIR || null;

describeWithBrowser("Cyber Defense panel", () => {
  let server;
  let browser;
  let base;
  let serverModule;

  beforeAll(async () => {
    const now = new Date().toISOString();
    mockSupabaseClient = createFakeSupabase(
      {
        system_flags: [{ key: "security_intel_enabled", value: "true" }],
        security_events: [
          { kind: "admin_login_failed", severity: "warning", route: "/api/admin/login", ip_hash: securityIntel.keyedHash(HASH_KEY, ATTACKER), ip_masked: "203.0.x.x", count: 7, detail: {}, created_at: now },
          { kind: "rate_limited", severity: "info", route: "rider_session_start_ip", ip_hash: securityIntel.keyedHash(HASH_KEY, "192.0.2.4"), ip_masked: "192.0.x.x", count: 3, detail: {}, created_at: now }
        ],
        security_ip_blocks: [],
        admin_mfa: [],
        audit_logs: [],
        rides: []
      },
      { identity: { security_ip_blocks: "id" } }
    );
    // eslint-disable-next-line global-require
    serverModule = require("../server");
    await serverModule.refreshSecurityState();
    server = await new Promise((resolve) => {
      const s = serverModule.app.listen(0, "127.0.0.1", () => resolve(s));
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

  async function newPage(viewport = { width: 1280, height: 1000 }) {
    const context = await browser.newContext({ viewport });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Repeated failed admin sign-ins" : undefined));
    return { context, page };
  }

  async function signIn(page) {
    await page.goto(`${base}/admin-login.html?next=/admin-security.html`);
    await page.fill("#email", "admin@example.test");
    await page.fill("#password", "test-fixture-admin-password");
    await page.click("#adminLoginForm button[type=submit]");
  }

  test("alert → block → lift, then authenticator setup and a code at the next sign-in", async () => {
    const { context, page } = await newPage();
    await page.goto(`${base}/admin-security.html`);
    await page.waitForSelector("#authNotice:not([hidden])");

    await signIn(page);
    await page.waitForURL(/\/admin-security\.html$/);
    await page.waitForSelector(".alert h3");
    const alerts = await page.textContent("#alerts");
    expect(alerts).toContain("Repeated failed admin sign-ins");
    expect(alerts).toContain("7 failed admin sign-in attempts in 15 minutes from 203.0.x.x.");
    expect(alerts).toContain("Admin sign-in has no second step");
    expect(await page.textContent("#statusGrid")).toContain("Monitoring");
    expect(await page.textContent("#events")).toContain("Failed admin sign-in");
    expect(await page.textContent("#events")).not.toContain(ATTACKER);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sai-panel.png"), fullPage: true });

    // Nothing is blocked until the owner clicks.
    expect(mockSupabaseClient._state.security_ip_blocks).toEqual([]);
    await page.click("button[data-block]");
    await page.waitForSelector("#blocks td");
    expect(await page.textContent("#blocks")).toContain("203.0.x.x");
    expect(mockSupabaseClient._state.security_ip_blocks).toHaveLength(1);
    expect(await page.textContent("#alerts")).toContain("Blocked");
    await page.click("button[data-lift]");
    await page.waitForFunction(() => /No addresses are blocked/.test(document.getElementById("blocks").textContent));

    // Authenticator setup from the page.
    await page.click("#setupBtn");
    await page.waitForSelector("code.key");
    const secret = (await page.textContent("code.key")).replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.fill("#confirmCode", totp.codeAt(secret, totp.stepFor(Date.now())));
    await page.click("#confirmBtn");
    await page.waitForSelector("ol.codes li");
    expect(await page.locator("ol.codes li").count()).toBe(8);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sai-recovery-codes.png"), fullPage: true });
    // The 60-second refresh must not wipe the codes; refresh now to prove it.
    await page.click("#refreshBtn");
    await page.waitForTimeout(300);
    expect(await page.locator("ol.codes li").count()).toBe(8);
    await page.click("#savedBtn");
    await page.waitForFunction(() => /The authenticator is on|Signing in needs your password and a code/.test(document.getElementById("mfaBody").textContent));

    // Next sign-in: password, then the code step.
    await context.clearCookies();
    await signIn(page);
    await page.waitForSelector("#codeForm:not([hidden])");
    expect(page.url()).toMatch(/admin-login\.html/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sai-login-code.png") });
    await page.fill("#code", "000000");
    await page.click("#codeForm button[type=submit]");
    await page.waitForSelector("#codeStatus.show.error");
    await page.fill("#code", totp.codeAt(secret, totp.stepFor(Date.now()) + 1));
    await page.click("#codeForm button[type=submit]");
    await page.waitForURL(/\/admin-security\.html$/);
    await page.waitForSelector("#mfaBody .notice.good");
    expect(await page.textContent("#mfaBody")).toContain("Signing in needs your password and a code");

    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("fits a phone screen without sideways scrolling", async () => {
    // The first test left the authenticator on; its codes for this
    // 30-second window are used up, so switch it off for this layout check.
    mockSupabaseClient._state.admin_mfa = [];
    await serverModule.refreshSecurityState();
    const { context, page } = await newPage({ width: 390, height: 900 });
    await signIn(page);
    await page.waitForURL(/\/admin-security\.html$/);
    await page.waitForSelector(".alert h3");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sai-panel-phone.png"), fullPage: true });
    await context.close();
  });

  test("the HTAF admin's own sign-in asks for the code once the authenticator is on", async () => {
    const secret = totp.generateSecret();
    mockSupabaseClient._state.admin_mfa = [{
      email: "admin@example.test",
      secret_enc: totp.encryptSecret(secret, totp.deriveKey("test-admin-session-secret", "admin-mfa-v1")),
      status: "active",
      last_step: -1,
      recovery_hashes: [],
      activated_at: new Date().toISOString()
    }];
    await serverModule.refreshSecurityState();
    const { context, page } = await newPage();
    // The foundation domain's staff page (served here on the bare address).
    const ipBase = base.replace(HOST, "127.0.0.1");
    // Later routes run first: let the bare-address page through.
    await context.route(/^http:\/\/127\.0\.0\.1:/, (route) => route.continue());
    await page.goto(`${ipBase}/admin-htaf.html`, { waitUntil: "load" });
    await page.waitForSelector("#adminLoginOverlay:not(.hidden)");
    await page.fill("#loginEmail", "admin@example.test");
    await page.fill("#loginPassword", "test-fixture-admin-password");
    await page.click("#loginSubmit");
    await page.waitForSelector("#loginCodeWrap:not(.hidden)");
    expect(await page.textContent("#loginError")).toContain("Enter the code from your authenticator app");
    expect((await context.cookies()).some((c) => c.name === "htaf_admin_session")).toBe(false);
    await page.fill("#loginCode", totp.codeAt(secret, totp.stepFor(Date.now())));
    await page.click("#loginSubmit");
    await page.waitForSelector("#adminLoginOverlay.hidden", { state: "attached" });
    expect((await context.cookies()).some((c) => c.name === "htaf_admin_session")).toBe(true);
    await context.close();
  });
});
