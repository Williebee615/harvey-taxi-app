// Step 3b in Chromium at phone width: store list, menu, one-store cart
// kept on the device, the per-item out-of-stock choice (term 5), and
// checkout through a test-card authorization. Fixture data; Stripe.js,
// Stripe and the routing service are fakes (test mode only).
//   NODE_PATH="$(npm root -g)" npx jest test/store-menu.browser
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ORDERS_STRIPE_PUBLISHABLE_KEY = "pk_test_orders";
process.env.ENABLE_MERCHANT_ORDERS = "true";
process.env.ORDERS_TEST_TAX_RATE_BPS = "1000";
process.env.MAPBOX_ACCESS_TOKEN = require("./fixtures/fakeMapbox").TEST_TOKEN;

const { createFakeSupabase } = require("./fakeSupabase");
const { signRiderSession } = require("../lib/riderAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => (mockClient && typeof mockClient[k] === "function" ? mockClient[k].bind(mockClient) : mockClient && mockClient[k]) }) }));
const mockIntents = new Map();
jest.mock("stripe", () =>
  function MockStripe() {
    return {
      paymentIntents: {
        create: async (params) => {
          const intent = { id: `pi_test_${mockIntents.size + 1}`, amount: params.amount, status: "requires_payment_method", metadata: params.metadata, livemode: false, client_secret: `secret_${mockIntents.size + 1}` };
          mockIntents.set(intent.id, intent);
          return intent;
        },
        retrieve: async (id) => mockIntents.get(id),
        cancel: async (id) => Object.assign(mockIntents.get(id), { status: "canceled" })
      }
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

const allDay = (id) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ merchant_id: id, day_of_week: d, closed: false, opens_at: "00:00:00", closes_at: "24:00:00" }));
const store = (id, name, category) => ({ id, business_name: name, category, address_line: "1 Test St", city: "Nashville", status: "approved", market: "nashville", pickup_lat: 36.1627, pickup_lng: -86.7816, contact_email: `${id}@example.test`, contact_phone: "+16155550100" });
const item = (id, merchantId, name, price, extra = {}) => ({ id, merchant_id: merchantId, name, section: null, description: null, price_cents: price, available: true, substitutable: false, review_status: "listed", archived_at: null, ...extra });

describeWithBrowser("Store menu and cart (phone width)", () => {
  let server;
  let browser;
  let base;
  let realFetch;
  const mapbox = require("./fixtures/fakeMapbox").createFakeMapbox();

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
      ],
      orders: [], order_items: [], order_events: [], audit_logs: [],
      rides: [{ id: "RIDE-OQ", status: "driver_enroute", delivery_stage: "enroute_store", delivery_pin: "4821" }]
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    realFetch = globalThis.fetch;
    // The server's routing calls go to the fake; the browser's are its own.
    globalThis.fetch = (url, init) => (/api\.mapbox\.com/.test(String(url)) ? mapbox.fetchImpl(url, init) : realFetch(url, init));
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
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
    expect(await page.locator("#checkout").isEnabled()).toBe(true);

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

  test("checkout: delivery fee from the store, tip, server totals with tax and the grocery hold, test card, order sent to the store", async () => {
    mockClient._state.catalog_items.find((i) => i.id === "bread").available = true;
    const { context, page } = await phone(true);
    // Stand-in for Stripe.js (js.stripe.com is blocked in tests). Confirming
    // the card marks the fake PaymentIntent authorized, as Stripe would.
    await page.exposeFunction("__authorize", (secret) => {
      const intent = [...mockIntents.values()].find((i) => i.client_secret === secret);
      intent.status = "requires_capture";
    });
    await context.addInitScript(() => {
      window.Stripe = (key) => ({
        _key: key,
        elements: ({ clientSecret }) => ({ _secret: clientSecret, create: () => ({ mount: (sel) => { document.querySelector(sel).textContent = "[test card form]"; } }) }),
        confirmPayment: async ({ elements }) => { await window.__authorize(elements._secret); return { paymentIntent: { status: "requires_capture" } }; }
      });
    });
    await page.goto(`${base}/store-menu.html?store=M1`, { waitUntil: "load" });
    await page.locator('.item[data-item="milk"] button.add').click();
    await page.locator('.item[data-item="bread"] button.add').click();
    await page.locator('.line[data-line="milk"] select.choice').selectOption("contact");
    await page.locator("#checkout").click();
    await page.locator("#checkoutCard").waitFor();
    expect(await page.locator("#placeOrder").isDisabled()).toBe(true);

    await page.locator("#addrInput").fill("501 Broadway, Nashville");
    await page.locator("#addrFind").click();
    await page.waitForFunction(() => /Delivering to 501 Broadway/.test(document.getElementById("addrLabel").textContent));
    expect(await page.locator("#addrLabel").innerText()).toMatch(/about 5\.2 miles/);
    const fee = await page.locator("#pvFee").innerText();
    expect(fee).toMatch(/^\$\d+\.\d\d$/);
    expect(await page.locator("#pvItems").innerText()).toBe("$7.74");
    // D3: the tip is optional and nothing is chosen in advance.
    expect(await page.locator('input[name="tip"]:checked').count()).toBe(0);
    expect(await page.locator("#pvTip").innerText()).toBe("$0.00");
    await page.locator('input[name="tip"][value="20"]').check();
    expect(await page.locator("#pvTip").innerText()).toBe("$1.55");
    await page.locator('input[name="tip"][value="custom"]').check();
    await page.locator("#tipCustom").fill("5");
    expect(await page.locator("#pvTip").innerText()).toBe("$5.00");
    await page.locator("#notesInput").fill("Leave at the door");

    await page.locator("#placeOrder").click();
    await page.locator("#payCard").waitFor();
    const order = mockClient._state.orders[0];
    expect(order).toMatchObject({ status: "pending_payment", items_subtotal_cents: 774, tip_cents: 500, rider_notes: "Leave at the door", order_type: "grocery", dropoff_address: "501 Broadway, Nashville, Tennessee 37203, United States" });
    expect(mockClient._state.order_items.find((i) => i.name === "Whole milk").substitution_choice).toBe("contact");
    // The pay screen shows the server's figures, including tax and the hold.
    expect(await page.locator("#payItems").innerText()).toBe("$7.74");
    // Tax is rounded per line: $0.45 + $0.33.
    expect(await page.locator("#payTax").innerText()).toBe("$0.78");
    expect(await page.locator("#payFee").innerText()).toBe(fee);
    expect(await page.locator("#payTotal").innerText()).toBe("$" + ((order.items_subtotal_cents + order.tax_cents + order.delivery_fee_cents + order.tip_cents) / 100).toFixed(2));
    expect(await page.locator("#payHoldNote").innerText()).toContain("$" + (order.authorized_cents / 100).toFixed(2));
    await page.waitForFunction(() => !document.getElementById("payButton").disabled);

    await page.locator("#payButton").click();
    await page.locator("#placedCard").waitFor();
    expect(await page.locator("#placedStatus").innerText()).toMatch(/Sent to the store/);
    expect(mockClient._state.orders[0].status).toBe("placed");
    expect(await page.evaluate(() => localStorage.getItem("harvey_store_cart_v1"))).toBeNull();
    expect(await page.locator("#placedCancel").isVisible()).toBe(true);

    // The order page survives a reload; the rider can still cancel (D2).
    await page.reload({ waitUntil: "load" });
    await page.locator("#placedCard").waitFor();
    page.once("dialog", (d) => d.accept());
    await page.locator("#placedCancel").click();
    await page.waitForFunction(() => /You cancelled this order/.test(document.getElementById("placedStatus").textContent));
    expect(mockIntents.get(order.payment_intent_id).status).toBe("canceled");

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(page.errors).toEqual([]);
    await context.close();
  });

  test("checkout: an address the routing service can't reach gives a clear message and no way to pay", async () => {
    const { context, page } = await phone(true);
    await page.goto(`${base}/store-menu.html?store=M2`, { waitUntil: "load" });
    await page.locator('.item[data-item="tenders"] button.add').click();
    await page.locator("#checkout").click();
    mapbox.setMode("no_route");
    await page.locator("#addrInput").fill("2500 West End Ave");
    await page.locator("#addrFind").click();
    await page.waitForFunction(() => /couldn't find a driving route/.test(document.getElementById("checkoutStatus").textContent));
    expect(await page.locator("#placeOrder").isDisabled()).toBe(true);
    mapbox.reset();
    await context.close();
  });

  test("contact me first: the rider sees the store's suggestion on the order screen and accepts it (step 3c-2)", async () => {
    const now = Date.now();
    mockClient._state.orders.push({
      id: "oq", order_number: "HT-QQQQQQ", merchant_id: "M1", rider_id: "RIDER_1", ride_id: "RIDE-OQ", status: "accepted", order_type: "grocery", prep_minutes: 15,
      placed_at: new Date(now - 300000).toISOString(), accepted_at: new Date(now - 240000).toISOString(), items_subtotal_cents: 898, tax_cents: 90, tax_rate_bps: 1000,
      delivery_fee_cents: 1150, tip_cents: 0, authorized_cents: 3000, captured_cents: 0, refunded_cents: 0, livemode: false, created_at: new Date(now - 300000).toISOString()
    });
    mockClient._state.order_items.push({
      id: "q1", order_id: "oq", name: "Whole milk", unit_price_cents: 449, quantity: 2, tax_cents: 90, substitution_choice: "contact", fulfilment: "out_of_stock",
      substitute_name: "2% milk", substitute_price_cents: 429, substitution_asked_at: new Date(now - 60000).toISOString(), substitution_expires_at: new Date(now + 360000).toISOString()
    });
    const { context, page } = await phone(true);
    await page.goto(`${base}/store-menu.html?order=oq`, { waitUntil: "load" });
    const q = page.locator('.question[data-item="q1"]');
    await q.waitFor();
    // Step 3c-3: the rider's own delivery PIN, shown once a driver has the trip.
    expect(await page.locator("#deliveryPin").innerText()).toBe("Your delivery PIN is 4821. Give it to your driver at handoff.");
    expect(await q.innerText()).toMatch(/Whole milk is out of stock\. The store suggests 2% milk at \$4\.29 each \(× 2\)\. Answer by/);
    await q.locator("button.answer-substitute").click();
    await page.waitForFunction(() => /substitute accepted/.test(document.getElementById("placedNote").textContent));
    expect(await page.locator(".question").count()).toBe(0);
    expect(mockClient._state.order_items.find((i) => i.id === "q1")).toMatchObject({ fulfilment: "substituted", substitution_answer: "substitute" });
    expect(await page.locator("#placedTotal").innerText()).toMatch(/now comes to about \$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(page.errors).toEqual([]);
    await context.close();
  });
});
