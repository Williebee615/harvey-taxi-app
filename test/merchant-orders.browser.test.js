// Phase 3a orders in Chromium: the store inbox (accept, settle items
// (step 3c-2), ready, reject) and
// the staff orders list (history, cancel). Fixture data; Stripe and the
// database are fakes (test mode only).
//   NODE_PATH="$(npm root -g)" npx jest test/merchant-orders.browser
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ENABLE_MERCHANT_ORDERS = "true";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");
const { signMerchantSession } = require("../lib/merchantAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => (mockClient && typeof mockClient[k] === "function" ? mockClient[k].bind(mockClient) : mockClient && mockClient[k]) }) }));
const mockIntents = new Map();
const mockCancelled = [];
jest.mock("stripe", () =>
  function MockStripe() {
    return {
      paymentIntents: {
        retrieve: async (id) => mockIntents.get(id),
        cancel: async (id) => {
          mockCancelled.push(id);
          mockIntents.get(id).status = "canceled";
          return mockIntents.get(id);
        }
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

function adminSession(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  return `${encoded}.${crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex")}`;
}

const order = (id, number, extra = {}) => ({
  id, order_number: number, merchant_id: "M1", rider_id: "RIDER_1", ride_id: null, status: "placed", order_type: "grocery", prep_minutes: null,
  placed_at: new Date().toISOString(), accepted_at: null, ready_at: null, cancelled_at: null, cancel_reason: null,
  items_subtotal_cents: 1223, tax_cents: 0, tax_rate_bps: 0, delivery_fee_cents: 1150, tip_cents: 200, authorized_cents: 2756,
  captured_cents: 0, refunded_cents: 0, payment_intent_id: `pi_${id}`, livemode: false, client_order_key: `key-${id}-123`, rider_notes: "Ring the bell",
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra
});

describeWithBrowser("Store orders inbox and staff orders list", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    for (const id of ["o1", "o2", "o3"]) mockIntents.set(`pi_${id}`, { id: `pi_${id}`, status: "requires_capture", metadata: { order_id: id } });
    mockClient = createFakeSupabase({
      merchants: [{ id: "M1", business_name: "TEST Fixture Grocer", category: "grocery", address_line: "100 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Owner", contact_phone: "+16155550123", contact_email: "o@example.test", status: "approved", created_at: "2026-10-17T00:00:00Z" }],
      merchant_users: [{ id: "U1", merchant_id: "M1", phone: "+16155550123", name: "Test Owner", role: "owner", status: "active", session_version: 0 }],
      merchant_hours: [],
      catalog_items: [],
      riders: [{ id: "RIDER_1", first_name: "Ana", last_name: "Lopez", email: "ana@example.test", phone: "+16155550111" }],
      orders: [order("o1", "HT-AAAAAA"), order("o2", "HT-BBBBBB")],
      order_items: [
        { id: "i1", order_id: "o1", catalog_item_id: null, name: "Whole milk", unit_price_cents: 449, quantity: 2, tax_cents: 0, substitution_choice: "best_match", fulfilment: "pending" },
        { id: "i2", order_id: "o1", catalog_item_id: null, name: "Bread", unit_price_cents: 325, quantity: 1, tax_cents: 0, substitution_choice: "refund", fulfilment: "pending" }
      ],
      order_events: [],
      audit_logs: [], drivers: [], rides: [], htaf_applications: [], system_flags: []
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

  test("store: new orders are flagged; accept with a prep time, mark ready, reject with a reason (phone width)", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await context.addCookies([{ name: "harvey_merchant_session", value: signMerchantSession({ merchantUserId: "U1", merchantId: "M1", sessionVersion: 0, secret: process.env.MERCHANT_SESSION_SECRET, ttlHours: 1 }), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/merchant-portal.html`, { waitUntil: "load" });

    await page.locator("#ordersCard").waitFor();
    const first = page.locator('.order[data-id="o1"]');
    await first.waitFor();
    expect(await page.title()).toMatch(/^\(2\) /);
    expect(await page.locator("#ordersBadge").innerText()).toBe("2 new");
    const text = await first.innerText();
    expect(text).toMatch(/HT-AAAAAA · Ana/);
    expect(text).toMatch(/2 × Whole milk \(your best match if out of stock\)/);
    expect(text).toMatch(/Note: Ring the bell/);
    expect(await page.locator("#ordersCard").innerText()).not.toMatch(/Lopez|ana@example|5550111/);

    await first.locator("select.prep").selectOption("20");
    await first.locator("button.accept").click();
    await page.waitForFunction(() => /HT-AAAAAA: Accepted/.test(document.getElementById("ordersStatus").textContent));
    expect(mockClient._state.orders.find((o) => o.id === "o1")).toMatchObject({ status: "accepted", prep_minutes: 20 });
    // Step 3c-2: ready is refused until every item is settled.
    await page.locator('.order[data-id="o1"] button.ready').click();
    await page.waitForFunction(() => /Still to do: Whole milk, Bread/.test(document.getElementById("ordersStatus").textContent));
    // Milk (best match): the store substitutes, entering name and price.
    const answers = ["2% milk", "4.29"];
    const onDialog = (d) => d.accept(answers.shift());
    page.on("dialog", onDialog);
    await page.locator('.order[data-id="o1"] li[data-item="i1"] button.sub').click();
    await page.waitForFunction(() => /Substituted: 2% milk at \$4\.29 each/.test(document.querySelector('.order[data-id="o1"] li[data-item="i1"]').textContent));
    page.off("dialog", onDialog);
    // Bread (refund if out of stock) can't be substituted.
    expect(await page.locator('.order[data-id="o1"] li[data-item="i2"] button.sub').count()).toBe(0);
    await page.locator('.order[data-id="o1"] li[data-item="i2"] button.oos').click();
    await page.waitForFunction(() => /Out of stock: not charged/.test(document.querySelector('.order[data-id="o1"] li[data-item="i2"]').textContent));
    expect(mockClient._state.order_items.find((i) => i.id === "i1")).toMatchObject({ fulfilment: "substituted", substitute_name: "2% milk", substitute_price_cents: 429 });
    expect(mockClient._state.order_items.find((i) => i.id === "i2").fulfilment).toBe("refunded");
    await page.locator('.order[data-id="o1"] button.ready').click();
    await page.waitForFunction(() => /HT-AAAAAA: Ready for pickup/.test(document.getElementById("ordersStatus").textContent));

    page.once("dialog", (d) => d.accept("Closing early tonight"));
    await page.locator('.order[data-id="o2"] button.reject').click();
    await page.waitForFunction(() => /HT-BBBBBB: Rejected/.test(document.getElementById("ordersStatus").textContent));
    expect(mockClient._state.orders.find((o) => o.id === "o2")).toMatchObject({ status: "rejected", cancel_reason: "Closing early tonight" });
    expect(mockCancelled).toEqual(["pi_o2"]);
    await page.waitForFunction(() => !/^\(/.test(document.title));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  });

  test("staff: orders list with history; cancel needs a reason of 10+ characters and releases the hold", async () => {
    mockClient._state.orders.push(order("o3", "HT-CCCCCC", { status: "accepted", prep_minutes: 10, accepted_at: new Date(Date.now() - 40 * 60000).toISOString() }));
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addCookies([{ name: "htaf_admin_session", value: adminSession("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });

    const list = page.locator("#ordersAdminList");
    await list.locator("text=HT-CCCCCC").waitFor();
    expect(await page.locator("#ordersAdminSub").innerText()).toMatch(/Ordering is on \(Stripe test key for orders\)/);
    // Open orders only by default: o1 (ready) and o3 (accepted); o2 was rejected.
    expect(await list.innerText()).not.toMatch(/HT-BBBBBB/);
    expect(await list.locator('.item[data-order-id="o3"]').innerText()).toMatch(/Past its preparation time/);

    await list.locator('button[data-order-detail="o1"]').click();
    await page.locator('.order-detail[data-detail-for="o1"] ol').waitFor();
    expect(await page.locator('.order-detail[data-detail-for="o1"]').innerText()).toMatch(/placed → accepted by merchant_user[\s\S]*accepted → ready by merchant_user/);

    page.once("dialog", (d) => d.accept("short"));
    await list.locator('button[data-order-cancel="o3"]').click();
    await page.waitForFunction(() => /at least 10 characters/.test(document.body.innerText));
    expect(mockClient._state.orders.find((o) => o.id === "o3").status).toBe("accepted");

    page.once("dialog", (d) => d.accept("Store asked us to cancel this order."));
    await list.locator('button[data-order-cancel="o3"]').click();
    await page.waitForFunction(() => !document.querySelector('button[data-order-cancel="o3"]'));
    expect(mockClient._state.orders.find((o) => o.id === "o3")).toMatchObject({ status: "cancelled_by_staff", cancel_reason: "Store asked us to cancel this order." });
    expect(mockCancelled).toContain("pi_o3");

    await page.locator("#ordersShowAll").check();
    await list.locator("text=HT-BBBBBB").waitFor();
    await context.close();
  });
});
