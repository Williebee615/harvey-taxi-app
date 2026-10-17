// Merchant applications on the admin dashboard (merchant portal phase 1a;
// synthetic stores, fake database, Chromium).
//   NODE_PATH="$(npm root -g)" npx jest test/admin-merchants.browser
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


describeWithBrowser("Admin dashboard: merchant applications", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      merchants: [
        { id: "M-SYN-1", business_name: "TEST Synthetic Diner", category: "restaurant", address_line: "100 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Test Owner", contact_email: "diner@example.test", contact_phone: "+16155550100", website: null, prices_differ_from_store: false, status: "pending", created_at: "2026-10-17T00:00:00Z" },
        { id: "M-SYN-2", business_name: "TEST Synthetic Market", category: "grocery", address_line: "200 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Test Grocer", contact_email: "market@example.test", contact_phone: "+16155550101", website: null, prices_differ_from_store: true, status: "pending", created_at: "2026-10-16T00:00:00Z" }
      ],
      drivers: [], riders: [], rides: [], htaf_applications: [], audit_logs: [], system_flags: []
    });
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

  test("lists applications; approve, and reject only with a reason, each audited", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const list = page.locator("#merchantsList");
    await list.locator("text=TEST Synthetic Diner").waitFor();
    expect(await page.locator("#merchantsCount").innerText()).toBe("2");

    page.once("dialog", (d) => d.accept());
    await page.click('button[data-merchant-id="M-SYN-1"][data-merchant-decision="approve"]');
    await page.waitForFunction(() => !document.querySelector('button[data-merchant-id="M-SYN-1"][data-merchant-decision="approve"]'));
    expect(mockClient._state.merchants.find((m) => m.id === "M-SYN-1")).toMatchObject({ status: "approved", reviewed_by: "owner@harvey.example" });
    expect(await page.locator('button[data-merchant-id="M-SYN-1"][data-merchant-decision="suspend"]').count()).toBe(1);

    // A too-short reason is refused in the page; nothing is sent.
    page.once("dialog", (d) => d.accept("no"));
    await page.click('button[data-merchant-id="M-SYN-2"][data-merchant-decision="reject"]');
    await page.waitForFunction(() => /at least 10 characters/.test(document.body.innerText));
    expect(mockClient._state.merchants.find((m) => m.id === "M-SYN-2").status).toBe("pending");

    page.once("dialog", (d) => d.accept("Sells items on the excluded list."));
    await page.click('button[data-merchant-id="M-SYN-2"][data-merchant-decision="reject"]');
    await page.waitForFunction(() => !document.querySelector('button[data-merchant-id="M-SYN-2"]'));
    expect(mockClient._state.merchants.find((m) => m.id === "M-SYN-2")).toMatchObject({ status: "rejected", review_reason: "Sells items on the excluded list." });
    expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(["merchant_approved", "merchant_rejected"]);
    await context.close();
  });
});
