// Store portal in Chromium: sign in with a texted code (fake Twilio
// Verify; nothing is sent), set the week's hours, sign out. Fixture data.
//   NODE_PATH="$(npm root -g)" npx jest test/merchant-portal.browser
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";

const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
const mockSends = [];
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: { services: () => ({
      verifications: { create: async (p) => { mockSends.push(p); return { status: "pending" }; } },
      verificationChecks: { create: async (p) => ({ status: p.code === "246810" ? "approved" : "pending" }) }
    }) },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
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

describeWithBrowser("Store portal", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase(
      {
        merchants: [{ id: "M1", business_name: "TEST Fixture Grocer", category: "grocery", address_line: "100 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Owner", contact_phone: "+16155550123", contact_email: "o@example.test", status: "approved", created_at: "2026-10-17T00:00:00Z" }],
        merchant_users: [{ id: "U1", merchant_id: "M1", phone: "+16155550123", name: "Test Owner", role: "owner", status: "active", session_version: 0 }],
        merchant_hours: [],
        catalog_items: [],
        audit_logs: []
      },
      { rpc: { bump_merchant_user_session_version: (args, state) => { const u = state.merchant_users.find((x) => x.id === args.p_user_id); u.session_version += 1; return { data: u.session_version, error: null }; } } }
    );
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
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

  test("sign in, save hours, sign out (phone width)", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/merchant-portal.html`, { waitUntil: "load" });

    await page.fill("#phone", "(615) 555-0123");
    await page.click("#sendCode");
    await page.locator("#codeForm").waitFor();
    expect(mockSends).toEqual([{ to: "+16155550123", channel: "sms" }]);

    await page.fill("#code", "000000");
    await page.click("#verify");
    await page.waitForFunction(() => /Invalid or expired code/.test(document.getElementById("signInStatus").textContent));

    await page.fill("#code", "246810");
    await page.click("#verify");
    await page.locator("#storeCard").waitFor();
    expect(await page.locator("#storeName").innerText()).toBe("TEST Fixture Grocer");
    expect(await page.evaluate(() => document.cookie)).not.toContain("harvey_merchant_session");

    // New stores start open 09:00-21:00 every day. Close Sunday; Monday 10:00-18:00.
    await page.locator('#hoursRows tr[data-day="0"] .closed').check();
    expect(await page.locator('#hoursRows tr[data-day="0"] .opens').isDisabled()).toBe(true);
    const monday = page.locator('#hoursRows tr[data-day="1"]');
    await monday.locator(".opens").fill("10:00");
    await monday.locator(".closes").fill("18:00");
    await page.click("#saveHours");
    await page.waitForFunction(() => /Hours saved/.test(document.getElementById("hoursStatus").textContent));
    expect(mockClient._state.merchant_hours.find((h) => h.day_of_week === 1)).toMatchObject({ opens_at: "10:00", closes_at: "18:00", closed: false });
    expect(mockClient._state.merchant_hours.find((h) => h.day_of_week === 0)).toMatchObject({ closed: true });

    // A closing time before the opening time is refused with the day named.
    await monday.locator(".closes").fill("08:00");
    await page.click("#saveHours");
    await page.waitForFunction(() => /Monday: closing time must be after/.test(document.getElementById("hoursStatus").textContent));

    // Catalog: a clean item is listed; a possibly-excluded one is held for review.
    await page.locator("#catalogCard").waitFor();
    await page.fill("#itemName", "Whole milk");
    await page.fill("#itemPrice", "4.49");
    await page.fill("#itemSection", "Dairy");
    await page.check("#itemSubstitutable");
    await page.click("#addItem");
    await page.waitForFunction(() => /Whole milk added\./.test(document.getElementById("itemStatus").textContent));
    await page.fill("#itemName", "Craft beer");
    await page.fill("#itemPrice", "12.99");
    await page.click("#addItem");
    await page.waitForFunction(() => /after a Harvey Taxi review/.test(document.getElementById("itemStatus").textContent));
    await page.waitForFunction(() => document.querySelectorAll("#itemRows tr").length === 2);
    expect(mockClient._state.catalog_items.map((i) => [i.name, i.price_cents, i.review_status, i.substitutable])).toEqual([["Whole milk", 449, "listed", true], ["Craft beer", 1299, "held", false]]);

    // Edit a price in the table.
    const milk = page.locator("#itemRows tr", { hasText: "Whole milk" });
    await milk.locator(".p").fill("4.99");
    await milk.locator(".save").click();
    await page.waitForFunction(() => /Whole milk saved\./.test(document.getElementById("itemStatus").textContent));
    expect(mockClient._state.catalog_items.find((i) => i.name === "Whole milk").price_cents).toBe(499);

    // Onboarding kit: the guide and both downloads.
    await page.locator("#importGuide summary").click();
    expect(await page.locator("#importGuide").innerText()).toMatch(/CSV \(UTF-8\)/);
    for (const id of ["#templateLink", "#exampleLink"]) {
      const href = await page.locator(id).getAttribute("href");
      const body = await page.evaluate(async (h) => (await fetch(h)).text(), href);
      expect(body.startsWith("name,price,section,description,available,substitutable")).toBe(true);
    }

    // CSV: preview first (nothing changes), then import.
    await page.setInputFiles("#csvFile", { name: "items.csv", mimeType: "text/csv", buffer: Buffer.from("name,price,section\nBread,3.25,Bakery\nwhole milk,5.10,Dairy\nEggs,abc,\n") });
    await page.click("#previewImport");
    await page.locator("#runImport").waitFor();
    expect(await page.locator("#importStatus").innerText()).toMatch(/line 4/);
    expect(mockClient._state.catalog_items).toHaveLength(2);
    await page.click("#runImport");
    await page.waitForFunction(() => document.querySelectorAll("#itemRows tr").length === 3);
    expect(mockClient._state.catalog_items.find((i) => i.name === "Bread")).toMatchObject({ price_cents: 325, review_status: "listed" });
    expect(mockClient._state.catalog_items.find((i) => i.name === "Whole milk").price_cents).toBe(510);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.click("#signOut");
    await page.locator("#signInCard").waitFor();
    expect(mockClient._state.merchant_users[0].session_version).toBe(1);
    await page.reload();
    await page.locator("#signInCard").waitFor();
    expect(await page.locator("#storeCard").isHidden()).toBe(true);
    expect(await page.locator("#catalogCard").isHidden()).toBe(true);
    await context.close();
  });
});
