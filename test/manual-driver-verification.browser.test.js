// Manual driver verification on the admin dashboard (synthetic drivers,
// fake database, Chromium). Owner decision 2026-10-17: admins verify
// drivers manually. Email/phone go through the contact-verification
// override (ordinary admin sign-in); ID/background go through the
// compliance override, which needs the admin token typed per use (never
// stored), a reason and a documentation confirmation. Each records an
// audit entry with the change.
//   NODE_PATH="$(npm root -g)" npx jest test/manual-driver-verification.browser
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

const calls = [];
function applyOverride(kind) {
  return (args, state) => {
    calls.push({ kind, args });
    const d = state.drivers.find((x) => x.id === args.p_driver_id);
    if (!d) return { data: null, error: { message: "not found" } };
    if (args.p_email_verified !== null && args.p_email_verified !== undefined) d.email_verified = args.p_email_verified;
    if (args.p_phone_verified !== null && args.p_phone_verified !== undefined) d.phone_verified = args.p_phone_verified;
    if (args.p_persona_verified !== null && args.p_persona_verified !== undefined) d.persona_verified = args.p_persona_verified;
    if (args.p_checkr_status) d.checkr_status = args.p_checkr_status;
    state.audit_logs.push({ action: args.p_action, actor_id: args.p_actor_id, metadata: args.p_metadata, entity_id: d.id });
    return { data: d, error: null };
  };
}

describeWithBrowser("Admin dashboard: manual driver verification", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase(
      {
        drivers: [
          { id: "DRV-SYN-1", first_name: "Dana", last_name: "Synthetic", email: "dana.synthetic@example.test", created_at: "2026-10-01T00:00:00Z", approval_status: "approved", status: "approved", checkr_status: "not_started", email_verified: false, phone_verified: false, persona_verified: false, vehicle_make: "Toyota", vehicle_model: "Camry", vehicle_year: "2021" }
        ],
        riders: [],
        rides: [],
        htaf_applications: [],
        audit_logs: [],
        system_flags: []
      },
      { rpc: { apply_driver_contact_verification_override: applyOverride("contact"), apply_driver_compliance_override: applyOverride("compliance") } }
    );
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

  test("shows what each driver still needs and records manual checks with an audit entry", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const row = page.locator(".verify-row").first();
    await row.waitFor();
    expect(await row.innerText()).toMatch(/✗ Email[\s\S]*✗ Phone[\s\S]*✗ ID[\s\S]*✗ Background/);

    // The row says "approved", but nothing is verified: staff see the real
    // setup state, and the driver isn't counted as active (2026-10-18).
    const card = page.locator("#pendingDriversList .item").first();
    expect(await card.locator(".badge").first().textContent()).toBe("Unverified");
    expect(await card.innerText()).toMatch(/Still needed: email, phone, identity, background check/);
    expect(await page.locator("#pendingDriversList").innerText()).not.toMatch(/\bapproved\b/i);
    expect(await page.textContent("#activeDriversCount")).toBe("0");

    // Email + phone: ordinary admin sign-in, no token needed.
    await page.locator('button:has-text("Manual verification")').first().click();
    const dialog = page.locator("#manualVerifyDialog");
    await dialog.waitFor();
    expect(await page.locator("#mvElevated").isHidden()).toBe(true);
    await page.check("#mvEmail");
    await page.check("#mvPhone");
    await page.fill("#mvReason", "Called the driver and confirmed both by reading back the codes.");
    await page.click("#mvSave");
    await dialog.waitFor({ state: "hidden" });
    expect(calls.at(-1)).toMatchObject({ kind: "contact", args: { p_driver_id: "DRV-SYN-1", p_email_verified: true, p_phone_verified: true, p_action: "driver_contact_verification_override" } });
    expect(calls.at(-1).args.p_metadata.reason).toContain("Called the driver");
    await page.waitForFunction(() => /✓ Email[\s\S]*✓ Phone/.test(document.querySelector(".verify-row").innerText));
    await page.waitForFunction(() => document.querySelector("#pendingDriversList .item .badge").textContent === "Pending Setup");

    // ID + background: refused without the documentation confirmation and token.
    await page.locator('button:has-text("Manual verification")').first().click();
    await page.check("#mvIdentity");
    await page.check("#mvBackground");
    expect(await page.locator("#mvElevated").isVisible()).toBe(true);
    await page.fill("#mvReason", "Reviewed TN license in person; county and national checks and MVR clear.");
    await page.click("#mvSave");
    expect(await page.locator("#mvError").innerText()).toMatch(/equivalent documentation/);
    await page.check("#mvDocs");
    await page.click("#mvSave");
    expect(await page.locator("#mvError").innerText()).toMatch(/admin token/);
    const before = calls.length;

    // A wrong token is refused by the server; nothing changes.
    await page.fill("#mvToken", "wrong-token");
    await page.click("#mvSave");
    await page.waitForFunction(() => /Not saved/.test(document.getElementById("mvError").innerText));
    expect(calls.length).toBe(before);
    expect(await page.inputValue("#mvToken")).toBe("");

    // The right token records both, with the reason and documentation flag.
    await page.fill("#mvToken", "test-admin-token");
    await page.click("#mvSave");
    await dialog.waitFor({ state: "hidden" });
    const last = calls.at(-1);
    expect(last).toMatchObject({ kind: "compliance", args: { p_driver_id: "DRV-SYN-1", p_persona_verified: true, p_checkr_status: "clear", p_action: "driver_compliance_override" } });
    expect(last.args.p_metadata).toMatchObject({ reviewed_documentation: true, admin_auth_method: "admin_token" });
    await page.waitForFunction(() => /✓ ID[\s\S]*✓ Background/.test(document.querySelector(".verify-row").innerText));
    expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(["driver_contact_verification_override", "driver_compliance_override"]);

    // The token is never kept in the page or browser storage.
    expect(await page.inputValue("#mvToken")).toBe("");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("test-admin-token");
    await context.close();
  });
});
