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
        { id: "M-SYN-2", business_name: "TEST Synthetic Market", category: "grocery", address_line: "200 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Test Grocer", contact_email: "market@mailinator.com", contact_phone: "+16155550101", website: null, prices_differ_from_store: true, status: "pending", created_at: "2026-10-16T00:00:00Z" }
      ],
      catalog_items: [
        { id: "I-SYN-1", merchant_id: "M-SYN-1", name: "Rum cake", section: "Bakery", price_cents: 1499, available: true, substitutable: false, review_status: "held", review_flags: ["alcohol"], archived_at: null, updated_at: "2026-10-17T01:00:00Z" },
        { id: "I-SYN-2", merchant_id: "M-SYN-1", name: "Vodka", section: null, price_cents: 2000, available: true, substitutable: false, review_status: "held", review_flags: ["alcohol"], archived_at: null, updated_at: "2026-10-17T02:00:00Z" },
        { id: "I-SYN-3", merchant_id: "M-SYN-1", name: "Whole milk", section: "Dairy", price_cents: 449, available: true, substitutable: true, review_status: "listed", review_flags: [], archived_at: null, updated_at: "2026-10-17T03:00:00Z" },
        { id: "I-SYN-4", merchant_id: "M-SYN-1", name: "<img src=x onerror=window.__xss=1> Tea", section: null, price_cents: 299, available: false, substitutable: false, review_status: "listed", review_flags: [], archived_at: null, updated_at: "2026-10-17T04:00:00Z" },
        { id: "I-SYN-5", merchant_id: "M-SYN-1", name: "Removed item", section: null, price_cents: 100, available: true, substitutable: false, review_status: "listed", review_flags: [], archived_at: "2026-10-17T05:00:00Z", updated_at: "2026-10-17T05:00:00Z" }
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
    // Review flags show on the flagged application only, as hints.
    const flagged = list.locator(".item", { hasText: "TEST Synthetic Market" }).locator(".merchant-flags");
    expect(await flagged.innerText()).toMatch(/throwaway-inbox/);
    expect(await list.locator(".item", { hasText: "TEST Synthetic Diner" }).innerText()).not.toMatch(/throwaway-inbox/);

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

  test("held catalog items: allow, or keep hidden only with a reason, each audited", async () => {
    mockClient._state.audit_logs.length = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const list = page.locator("#heldItemsList");
    await list.locator("text=Rum cake").waitFor();
    expect(await page.locator("#heldItemsCount").innerText()).toBe("2");
    expect(await list.innerText()).toMatch(/TEST Synthetic Diner/);
    expect(await list.innerText()).toMatch(/Possible: Alcohol/);
    expect(await list.innerText()).not.toMatch(/Whole milk/);

    await page.click('button[data-held-item="I-SYN-1"][data-held-decision="allow"]');
    await page.waitForFunction(() => !document.querySelector('button[data-held-item="I-SYN-1"]'));
    expect(mockClient._state.catalog_items.find((i) => i.id === "I-SYN-1")).toMatchObject({ review_status: "listed", reviewed_by: "owner@harvey.example" });

    page.once("dialog", (d) => d.accept("no"));
    await page.click('button[data-held-item="I-SYN-2"][data-held-decision="block"]');
    await page.waitForFunction(() => /at least 10 characters/.test(document.body.innerText));
    expect(mockClient._state.catalog_items.find((i) => i.id === "I-SYN-2").review_status).toBe("held");

    page.once("dialog", (d) => d.accept("Alcohol is excluded (term 3)."));
    await page.click('button[data-held-item="I-SYN-2"][data-held-decision="block"]');
    await page.waitForFunction(() => /No items waiting for review/.test(document.getElementById("heldItemsList").textContent));
    expect(mockClient._state.catalog_items.find((i) => i.id === "I-SYN-2")).toMatchObject({ review_status: "blocked", review_reason: "Alcohol is excluded (term 3)." });
    expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(["catalog_item_allowed", "catalog_item_blocked"]);
    await context.close();
  });

  test("staff view a store's full catalog, read-only", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    // Only stores that can have a catalog get the button (M-SYN-2 was rejected above).
    const btn = page.locator('button[data-merchant-catalog="M-SYN-1"]');
    await btn.waitFor();
    expect(await page.locator('button[data-merchant-catalog="M-SYN-2"]').count()).toBe(0);
    const before = JSON.stringify(mockClient._state.catalog_items);
    const auditBefore = mockClient._state.audit_logs.length;

    await btn.click();
    const panel = page.locator('.merchant-catalog[data-catalog-for="M-SYN-1"]');
    await panel.locator("table").waitFor();
    expect(await btn.getAttribute("aria-expanded")).toBe("true");
    expect(await panel.locator(".catalog-counts").innerText()).toMatch(/4 items • 3 listed • 0 held • 1 hidden • 1 out of stock/);
    expect(await panel.locator("tbody tr").count()).toBe(4);
    expect(await panel.innerText()).not.toMatch(/Removed item/);
    const vodka = panel.locator('tr[data-catalog-item="I-SYN-2"]');
    expect(await vodka.innerText()).toMatch(/hidden by staff/i);
    expect(await vodka.innerText()).toMatch(/Hidden by owner@harvey\.example .*Alcohol is excluded \(term 3\)\./);
    expect(await panel.locator('tr[data-catalog-item="I-SYN-1"]').innerText()).toMatch(/Allowed by owner@harvey\.example/);
    // Store-entered text is shown as text, never run as HTML.
    expect(await panel.locator('tr[data-catalog-item="I-SYN-4"]').innerText()).toContain("<img src=x onerror=window.__xss=1> Tea");
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // No buttons that change items in the panel.
    expect(await panel.locator("button, input").count()).toBe(0);

    await btn.click();
    expect(await panel.isHidden()).toBe(true);
    expect(JSON.stringify(mockClient._state.catalog_items)).toBe(before);
    expect(mockClient._state.audit_logs.length).toBe(auditBefore);
    await context.close();
  });

  test("staff import a store's CSV: preview first, then import; flagged items held", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const box = page.locator('.staff-import[data-import-for="M-SYN-1"]');
    await box.waitFor();
    expect(await page.locator('.staff-import[data-import-for="M-SYN-2"]').count()).toBe(0);
    await box.locator("summary").click();
    // Import before preview is refused in the page.
    expect(await box.locator('button[data-staff-import="run"]').isHidden()).toBe(true);
    await box.locator(".staff-import-file").setInputFiles({ name: "store.csv", mimeType: "text/csv", buffer: Buffer.from("name,price,section\nRye bread,4.25,Bakery\nWhole milk,4.79,Dairy\nCigarettes,12,\nOops,,\n") });
    const before = mockClient._state.catalog_items.length;
    await box.locator('button[data-staff-import="preview"]').click();
    await box.locator('button[data-staff-import="run"]').waitFor();
    const preview = await box.locator(".staff-import-status").innerText();
    expect(preview).toMatch(/Will add 2, update 1\./);
    expect(preview).toMatch(/1 will be held for review: Cigarettes/);
    expect(preview).toMatch(/line 5/);
    expect(mockClient._state.catalog_items.length).toBe(before);

    page.once("dialog", (d) => d.accept());
    await box.locator('button[data-staff-import="run"]').click();
    await page.waitForFunction(() => /^Added 2, updated 1\./.test(document.querySelector('.staff-import[data-import-for="M-SYN-1"] .staff-import-status').textContent));
    const live = mockClient._state.catalog_items.filter((i) => i.merchant_id === "M-SYN-1" && !i.archived_at);
    expect(live.find((i) => i.name === "Rye bread")).toMatchObject({ price_cents: 425, review_status: "listed", created_by: null });
    expect(live.find((i) => i.name === "Cigarettes")).toMatchObject({ review_status: "held", review_flags: ["tobacco_vape"] });
    expect(live.find((i) => i.name === "Whole milk").price_cents).toBe(479);
    expect(mockClient._state.audit_logs.filter((a) => a.action === "catalog_imported_by_staff")).toHaveLength(1);
    // The held list refreshes with the new item.
    await page.locator("#heldItemsList").locator("text=Cigarettes").waitFor();
    await context.close();
  });

  test("staff set a store's pickup pin from a pasted Google Maps link; audited", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: session("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const row = page.locator("#merchantsList .item", { hasText: "TEST Synthetic Diner" }).locator(".merchant-pin");
    await row.waitFor();
    expect(await row.innerText()).toMatch(/not set\. The store can't take orders until it has one\./);
    expect(await row.locator("a", { hasText: "Open address in Google Maps" }).getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("100 Test Ave, Nashville, TN, 37203"));

    page.once("dialog", (d) => d.accept("40.7128, -74.0060"));
    await row.locator('button[data-merchant-pin="M-SYN-1"]').click();
    await page.waitForFunction(() => /isn't in Tennessee/.test(document.body.innerText));

    page.once("dialog", (d) => d.accept("https://www.google.com/maps/place/Diner/@36.158812,-86.778344,17z"));
    await page.locator('button[data-merchant-pin="M-SYN-1"]').click();
    await page.waitForFunction(() => /36\.158812, -86\.778344 \(confirmed by owner@harvey\.example/.test(document.getElementById("merchantsList").innerText));
    expect(mockClient._state.merchants.find((m) => m.id === "M-SYN-1")).toMatchObject({ pickup_lat: 36.158812, pickup_lng: -86.778344, pickup_pin_confirmed_by: "owner@harvey.example" });
    expect(mockClient._state.audit_logs.map((a) => a.action)).toContain("merchant_pickup_pin_set");
    await context.close();
  });
});
