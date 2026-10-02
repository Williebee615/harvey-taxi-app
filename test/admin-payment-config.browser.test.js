// Browser check for the admin dashboard's Payment Configuration viewer:
// it uses the dashboard's own signed-in session cookie (no token typed or
// stored in the page), shows only the sanitized payments/stripe_account
// fields, can be copied, and never displays a key.
//
// Needs Playwright and a Chromium build; skips without them (CI does not
// install a browser). Run locally with, for example:
//   NODE_PATH="$(npm root -g)" npx jest test/admin-payment-config.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_" + "k".repeat(30);
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_" + "p".repeat(30);
process.env.STRIPE_WEBHOOK_SECRET = "whsec_" + "w".repeat(30);
process.env.ENABLE_PAYMENT_GATE = "true";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

// GET /v1/account as Stripe returns it, including fields that must never
// reach the page.
jest.mock("stripe", () =>
  function MockStripe() {
    return {
      accounts: {
        retrieve: async () => ({
          id: "acct_TEST123",
          email: "owner@example.test",
          country: "US",
          charges_enabled: true,
          settings: { dashboard: { display_name: "Harvey Taxi2" } },
          business_profile: { support_phone: "+16155550100" }
        })
      },
      paymentIntents: {}
    };
  }
);

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
const SECRET_PATTERN = /sk_test|pk_test|whsec|kkkkkk|pppppp|wwwwww|test-admin-token|example\.test|5550100/;

// Same token format as signAdminSession() in server.js.
function adminSessionValue() {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email: "ops@harveytaxiservice.test", iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("admin dashboard Payment Configuration viewer", () => {
  let server;
  let browser;
  let base;
  let secureBase;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ system_flags: [{ key: "dispatch_paused", value: "false" }] });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    // localhost is a secure context, so the Clipboard API is available
    // there (as it is on the real https site).
    secureBase = `http://localhost:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function newPage({ signedIn, origin = base }) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test|localhost)/, (route) => route.abort());
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    if (signedIn) {
      await context.addCookies([{ name: "htaf_admin_session", value: adminSessionValue(), url: origin }]);
    }
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (err) => page.errors.push(err.message));
    return page;
  }

  test("signed-in admin loads, sees and copies the sanitized configuration", async () => {
    const page = await newPage({ signedIn: true, origin: secureBase });
    await page.goto(`${secureBase}/admin-dashboard.html`);
    await page.waitForFunction(() => document.getElementById("adminSessionStatus").textContent.startsWith("Signed in as"));

    await page.click("#loadPaymentConfigBtn");
    await page.waitForSelector("#paymentConfigJson", { state: "visible" });

    const shown = JSON.parse(await page.textContent("#paymentConfigJson"));
    expect(Object.keys(shown).sort()).toEqual(["payments", "stripe_account"]);
    expect(shown.payments).toMatchObject({
      stripe_client_ready: true,
      secret_key_mode: "test",
      publishable_key_mode: "test",
      key_modes_match: true,
      webhook_secret_set: true,
      payment_gate_enabled: true,
      card_payments_effective: true,
      live_card_payments_effective: false
    });
    expect(shown.stripe_account).toEqual({ id: "acct_TEST123", display_name: "Harvey Taxi2", country: "US", charges_enabled: true });
    expect(await page.textContent("#paymentConfigBadge")).toBe("Test cards on");
    expect(await page.textContent("#paymentConfigSummary")).toMatch(/Secret key mode: test.*Payment gate: yes.*Stripe account: acct_TEST123 \(Harvey Taxi2\)/s);

    // Nothing secret anywhere in the rendered page.
    expect(await page.content()).not.toMatch(SECRET_PATTERN);

    await page.click("#copyPaymentConfigBtn");
    await page.waitForFunction(() => document.getElementById("resultBox").textContent.includes("copied"));
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toEqual(shown);
    expect(copied).not.toMatch(SECRET_PATTERN);
    expect(page.errors).toEqual([]);
  });

  test("without the Clipboard API, Copy selects the text for a manual copy", async () => {
    // A plain-http host is not a secure context, so navigator.clipboard is unavailable.
    const page = await newPage({ signedIn: true });
    await page.goto(`${base}/admin-dashboard.html`);
    await page.waitForFunction(() => document.getElementById("adminSessionStatus").textContent.startsWith("Signed in as"));
    await page.click("#loadPaymentConfigBtn");
    await page.waitForSelector("#paymentConfigJson", { state: "visible" });
    await page.click("#copyPaymentConfigBtn");
    await page.waitForFunction(() => document.getElementById("resultBox").textContent.includes("Text selected"));
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(JSON.parse(selected)).toEqual(JSON.parse(await page.textContent("#paymentConfigJson")));
    expect(page.errors).toEqual([]);
  });

  test("signed out: the viewer asks for sign-in and the endpoint stays admin-only", async () => {
    const page = await newPage({ signedIn: false });
    await page.goto(`${base}/admin-dashboard.html`);
    await page.waitForFunction(() => document.getElementById("adminSessionStatus").textContent.startsWith("Signed out"));

    await page.click("#loadPaymentConfigBtn");
    expect(await page.textContent("#paymentConfigBadge")).toBe("Sign in required");
    expect(await page.isVisible("#paymentConfigJson")).toBe(false);
    expect(await page.isDisabled("#copyPaymentConfigBtn")).toBe(true);

    const direct = await page.evaluate(async () => {
      const res = await fetch("/api/admin/payments/config-status", { credentials: "include" });
      return { status: res.status, body: await res.text() };
    });
    expect(direct.status).toBe(401);
    expect(direct.body).not.toMatch(SECRET_PATTERN);
    expect(page.errors).toEqual([]);
  });
});
