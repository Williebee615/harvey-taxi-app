// Step 3b part 1 in Chromium at phone width: store list, menu, one-store
// cart kept on the device, and the per-item out-of-stock choice (term 5).
// Fixture data; nothing is ordered.
//   NODE_PATH="$(npm root -g)" npx jest test/store-menu.browser
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ENABLE_MERCHANT_ORDERS = "true";

const { createFakeSupabase } = require("./fakeSupabase");
const { signRiderSession } = require("../lib/riderAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => (mockClient && typeof mockClient[k] === "function" ? mockClient[k].bind(mockClient) : mockClient && mockClient[k]) }) }));
jest.mock("stripe", () => function MockStripe() { return { paymentIntents: {} }; });

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(120000);

const allDay = (id) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ merchant_id: id, day_of_week: d, closed: false, opens_at: "00:00:00", closes_at: "24:00:00" }));
const store = (id, name, category) => ({ id, business_name: name, category, address_line: "1 Test St", city: "Nashville", status: "approved", market: "nashville", pickup_lat: 36.1627, pickup_lng: -86.7816, contact_email: `${id}@example.test`, contact_phone: "+16155550100" });
const item = (id, merchantId, name, price, extra = {}) => ({ id, merchant_id: merchantId, name, section: null, description: null, price_cents: price, available: true, substitutable: false, review_status: "listed", archived_at: null, ...extra });

describeWithBrowser("Store menu and cart (phone width)", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      riders: [{ id: "RIDER_1", first_name: "Ana", session_version: 0, status: "active", approval_status: "approved", access_revoked: false, deleted_at: null }],
      merchants: [store("M1", "TEST Corner Grocer", "grocery"), store("M2", "TEST Hot Chicken", "restaurant")],
      merchant_hours: [...allDay("M1"), ...allDay("M2")],
      catalog_items: [
        item("milk", "M1", "Whole milk", 449, { section: "Dairy", substitutable: true }),
        item("bread", "M1", "Bread", 325, { section: "Bakery", description: "Baked daily" }),
        item("eggs", "M1", "Eggs", 399, { section: "Dairy", available: false }),
        item("beer", "M1", "Craft beer", 1299, { review_status: "held" }),
        item("xss", "M1", "<img src=x onerror=window.__xss=1> Tea", 299, { section: "Drinks" }),
        item("tenders", "M2", "Hot chicken tenders", 1199)
      ]
    });
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

  async function phone(signedIn) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    if (signedIn) await context.addCookies([{ name: "harvey_rider_session", value: signRiderSession({ riderId: "RIDER_1", sessionVersion: 0, secret: process.env.RIDER_SESSION_SECRET, ttlHours: 1 }), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    return { context, page };
  }

  test("signed out: asked to sign in, no stores shown", async () => {
    const { context, page } = await phone(false);
    await page.goto(`${base}/store-menu.html`, { waitUntil: "load" });
    await page.locator("#notice a", { hasText: "Sign in" }).waitFor();
    expect(await page.locator("#storesCard").isHidden()).toBe(true);
    await context.close();
  });

  test("browse, add, choose what happens if out of stock, one store per cart, cart kept on reload", async () => {
    const { context, page } = await phone(true);
    await page.goto(`${base}/store-menu.html`, { waitUntil: "load" });
    await page.locator('.store[data-store="M1"]').waitFor();
    expect(await page.locator(".store").count()).toBe(2);
    expect(await page.locator('.store[data-store="M1"]').innerText()).toMatch(/Grocery · 1 Test St, Nashville · Open until 24:00/);

    await page.locator('.store[data-store="M1"] button').click();
    await page.locator("#menuCard").waitFor();
    const menu = page.locator("#menuItems");
    expect(await menu.innerText()).not.toMatch(/Craft beer/);
    expect(await menu.locator('.item[data-item="eggs"]').innerText()).toMatch(/Out of stock/);
    expect(await menu.locator('.item[data-item="eggs"] button').count()).toBe(0);
    // Store-entered text is shown as text, never run.
    expect(await menu.locator('.item[data-item="xss"]').innerText()).toContain("<img src=x onerror=window.__xss=1> Tea");
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await menu.locator('.item[data-item="milk"] button.add').click();
    await menu.locator('.item[data-item="milk"] button.add').click();
    await menu.locator('.item[data-item="bread"] button.add').click();
    await page.locator('.line[data-line="milk"] select.choice').selectOption("best_match");
    expect(await page.locator("#cartSubtotal").innerText()).toBe("$12.23");
    expect(await page.locator("#groceryNote").isVisible()).toBe(true);
    expect(await page.locator('.line[data-line="bread"]').innerText()).toMatch(/Refunded if out of stock/);
    expect(await page.locator("#checkout").isDisabled()).toBe(true);

    // The cart survives a reload, and the menu reopens from the address.
    await page.reload({ waitUntil: "load" });
    await page.locator("#menuCard").waitFor();
    await page.locator('.line[data-line="milk"]').waitFor();
    expect(await page.locator('.line[data-line="milk"] .count').innerText()).toBe("2");
    expect(await page.locator('.line[data-line="milk"] select.choice').inputValue()).toBe("best_match");

    // A second store: keep the cart, or clear it and start again.
    await page.locator("#backToStores").click();
    await page.locator('.store[data-store="M2"] button').click();
    await page.locator('.item[data-item="tenders"] button.add').waitFor();
    await page.locator('.item[data-item="tenders"] button.add').click();
    await page.locator("#switchCard").waitFor();
    expect(await page.locator("#switchText").innerText()).toMatch(/items from TEST Corner Grocer/);
    await page.locator("#switchCancel").click();
    expect(await page.locator("#cartStore").innerText()).toBe("From TEST Corner Grocer");
    await page.locator('.item[data-item="tenders"] button.add').click();
    await page.locator("#switchConfirm").click();
    expect(await page.locator("#cartStore").innerText()).toBe("From TEST Hot Chicken");
    expect(await page.locator("#cartSubtotal").innerText()).toBe("$11.99");
    expect(await page.locator("#groceryNote").isHidden()).toBe(true);
    expect(await page.locator(".line select.choice").count()).toBe(0);

    // Quantity down to zero removes the line and hides the cart.
    await page.locator('.line[data-line="tenders"] button.minus').click();
    expect(await page.locator("#cartCard").isHidden()).toBe(true);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("an item that stops being available is removed from a saved cart, with a note", async () => {
    const { context, page } = await phone(true);
    await page.goto(`${base}/store-menu.html?store=M1`, { waitUntil: "load" });
    await page.locator('.item[data-item="bread"] button.add').click();
    mockClient._state.catalog_items.find((i) => i.id === "bread").available = false;
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => /removed from your cart: Bread/.test(document.getElementById("cartStatus").textContent));
    expect(await page.locator("#cartCard").isHidden()).toBe(true);
    await context.close();
  });
});
