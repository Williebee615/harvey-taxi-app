// Merchant portal phase 3a: orders. Real rider sessions and real signed
// fare quotes; Stripe and the database are fakes (test mode only).
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
// Orders have their own Stripe test key and switch; the ride key and the
// legacy delivery switches stay as production has them (owner decision
// 2026-10-18: real ride payments unaffected, legacy delivery paused).
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.STRIPE_SECRET_KEY = "sk_live_rides_must_not_be_used";
process.env.ENABLE_MERCHANT_ORDERS = "true";
process.env.ENABLE_DELIVERY = "false";
process.env.ENABLE_FOOD_DELIVERY = "false";
process.env.ENABLE_GROCERY_DELIVERY = "false";
process.env.ORDERS_TEST_TAX_RATE_BPS = "1000";
process.env.MAPBOX_ACCESS_TOKEN = require("./fixtures/fakeMapbox").TEST_TOKEN;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signMerchantSession } = require("../lib/merchantAuth");
const { signRiderSession } = require("../lib/riderAuth");
const { signRideQuote } = require("../lib/rideQuote");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
const mockIntents = new Map();
const mockCalls = { create: [], cancel: [], keys: [] };
jest.mock("stripe", () =>
  function MockStripe(key) {
    mockCalls.keys.push(key);
    const forRides = key !== "sk_test_orders";
    return {
      _key: key,
      paymentIntents: {
        create: async (params, opts) => {
          if (forRides) throw new Error("the ride Stripe key was used for an order");
          mockCalls.create.push({ params, opts });
          const existing = [...mockIntents.values()].find((i) => i.idem === opts.idempotencyKey);
          if (existing) return existing;
          const intent = { id: `pi_test_${mockIntents.size + 1}`, object: "payment_intent", amount: params.amount, status: "requires_payment_method", metadata: params.metadata, livemode: false, client_secret: `secret_${mockIntents.size + 1}`, idem: opts.idempotencyKey };
          mockIntents.set(intent.id, intent);
          return intent;
        },
        retrieve: async (id) => {
          if (forRides) throw new Error("the ride Stripe key was used for an order");
          const i = mockIntents.get(id);
          if (!i) throw new Error("No such payment_intent");
          return i;
        },
        cancel: async (id) => {
          if (forRides) throw new Error("the ride Stripe key was used for an order");
          mockCalls.cancel.push(id);
          const i = mockIntents.get(id);
          i.status = "canceled";
          return i;
        }
      }
    };
  }
);

const PICKUP = { lat: 36.1627, lng: -86.7816 };
const DROPOFF = { lat: 36.1745, lng: -86.7679 };
const BASE_RIDER = { id: "RIDER_1", first_name: "Ana", last_name: "Lopez", email: "ana@example.test", phone: "+16155550111", session_version: 0, status: "active", approval_status: "approved", access_revoked: false, deleted_at: null, email_verified: true, sms_verified: true };
const RIDER2 = { ...BASE_RIDER, id: "RIDER_2", first_name: "Ben", email: "ben@example.test" };
// A new rider per test: the checkout limit (20 per 10 minutes per rider) is real.
let RIDER = BASE_RIDER;
let riderN = 0;
const allDay = (merchantId) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ merchant_id: merchantId, day_of_week: d, closed: false, opens_at: "00:00:00", closes_at: "24:00:00" }));
const store = (id, category, pin = PICKUP) => ({ id, business_name: `TEST Store ${id}`, category, market: "nashville", pickup_lat: pin ? pin.lat : null, pickup_lng: pin ? pin.lng : null, pickup_pin_confirmed_by: pin ? "staff@example.test" : null, pickup_pin_confirmed_at: pin ? "2026-10-18T00:00:00Z" : null, address_line: "1 Test St", city: "Nashville", postal_code: "37203", contact_name: "O", contact_phone: "+16155550100", contact_email: `${id}@example.test`, status: "approved", created_at: "2026-10-17T00:00:00Z" });
const item = (id, merchantId, extra = {}) => ({ id, merchant_id: merchantId, name: id, price_cents: 500, available: true, substitutable: false, review_status: "listed", review_flags: [], archived_at: null, ...extra });

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  riderN += 1;
  RIDER = { ...BASE_RIDER, id: `RIDER_T${riderN}` };
  mockIntents.clear();
  mockCalls.create.length = 0;
  mockCalls.cancel.length = 0;
  mockClient = createFakeSupabase({
    riders: [{ ...RIDER }, { ...RIDER2 }],
    merchants: [store("M1", "grocery"), store("M2", "restaurant"), store("M3", "restaurant"), store("M4", "restaurant", null)],
    merchant_hours: [...allDay("M1"), ...allDay("M2"), ...allDay("M4")],
    merchant_users: [
      { id: "U0000001", merchant_id: "M1", phone: "+16155550001", name: "Owner", role: "owner", status: "active", session_version: 0 },
      { id: "U0000002", merchant_id: "M2", phone: "+16155550002", name: "Owner", role: "owner", status: "active", session_version: 0 }
    ],
    catalog_items: [
      item("milk", "M1", { name: "Whole milk", price_cents: 449, substitutable: true }),
      item("bread", "M1", { name: "Bread", price_cents: 325 }),
      item("beer", "M1", { name: "Craft beer", review_status: "held" }),
      item("burger", "M2", { name: "Burger", price_cents: 1099 }),
      item("taco", "M4", { name: "Taco", price_cents: 399 })
    ],
    orders: [],
    order_items: [],
    order_events: [],
    audit_logs: []
  }, { uniqueColumns: { orders: ["quote_jti", "order_number"] } });
});

const RH = { "x-requested-with": "harvey-rider-app" };
const riderCookie = (r) => `harvey_rider_session=${signRiderSession({ riderId: r.id, sessionVersion: 0, secret: process.env.RIDER_SESSION_SECRET, ttlHours: 1 })}`;
const asRider = (r) => {
  const who = r || RIDER;
  return {
    get: (p) => request(app).get(p).set(RH).set("Cookie", riderCookie(who)),
    post: (p, b = {}) => request(app).post(p).set(RH).set("Cookie", riderCookie(who)).send(b)
  };
};
const MH = { "X-Requested-With": "harvey-merchant-portal" };
const storeCookie = (userId, merchantId) => `harvey_merchant_session=${signMerchantSession({ merchantUserId: userId, merchantId, sessionVersion: 0, secret: process.env.MERCHANT_SESSION_SECRET, ttlHours: 1 })}`;
const asStore = (userId = "U0000001", merchantId = "M1") => ({
  get: (p) => request(app).get(p).set(MH).set("Cookie", storeCookie(userId, merchantId)),
  post: (p, b = {}) => request(app).post(p).set(MH).set("Cookie", storeCookie(userId, merchantId)).send(b)
});
const admin = (r) => r.set("x-admin-token", "test-admin-token");

let keyN = 0;
function checkoutBody({ rider = RIDER, merchant = "M1", rideType = "grocery", items = [{ catalog_item_id: "milk", quantity: 2, substitution_choice: "best_match", unit_price_cents: 1 }, { catalog_item_id: "bread", quantity: 1 }], tip = 200, key, quoteTotal = 11.5, jti, pickup = PICKUP } = {}) {
  keyN += 1;
  const estimate_token = signRideQuote({ rideType, miles: 3.2, minutes: 12, pickup, destination: DROPOFF, riderId: rider.id, estimate: { total: quoteTotal, miles: 3.2, minutes: 12 }, secret: process.env.RIDE_QUOTE_SECRET, ttlMinutes: 15, ...(jti ? { jti } : {}) });
  return { merchant_id: merchant, items, tip_cents: tip, client_order_key: key || `order-key-${keyN}`, estimate_token, ride_type: rideType, pickup_lat: pickup.lat, pickup_lng: pickup.lng, destination_lat: DROPOFF.lat, destination_lng: DROPOFF.lng, rider_notes: "Ring the bell" };
}
const orders = () => mockClient._state.orders;
const events = (orderId) => mockClient._state.order_events.filter((e) => e.order_id === orderId).map((e) => e.to_status);
async function placedOrder(opts = {}) {
  const r = await asRider(opts.rider).post("/api/orders/checkout", checkoutBody(opts));
  expect(r.status).toBe(201);
  const order = orders().find((o) => o.id === r.body.order.id);
  mockIntents.get(order.payment_intent_id).status = "requires_capture";
  const c = await asRider(opts.rider).post(`/api/orders/${order.id}/confirm-payment`);
  expect(c.body.order.status).toBe("placed");
  return order.id;
}

describe("checkout", () => {
  test("needs a signed-in rider", async () => {
    expect((await request(app).post("/api/orders/checkout").set(RH).send(checkoutBody())).status).toBe(401);
  });

  test("prices come from the catalog, totals are computed on the server, one test-mode authorization with its own app tag", async () => {
    const r = await asRider().post("/api/orders/checkout", checkoutBody());
    expect(r.status).toBe(201);
    // 2 x 449 + 325 = 1223 items; 10% placeholder tax per line = 90 + 33; fee 1150; tip 200.
    expect(r.body.order).toMatchObject({ status: "pending_payment", items_subtotal_cents: 1223, tax_cents: 123, delivery_fee_cents: 1150, tip_cents: 200, total_cents: 2696, test_mode: true, store_name: "TEST Store M1" });
    // Grocery holds items + 15% (1406) and tax on that (141), plus fee and tip.
    expect(r.body.order.authorized_cents).toBe(1406 + 141 + 1150 + 200);
    expect(r.body.client_secret).toBe("secret_1");
    expect(mockCalls.create).toHaveLength(1);
    expect(mockCalls.create[0].params).toMatchObject({ amount: r.body.order.authorized_cents, capture_method: "manual", currency: "usd" });
    expect(mockCalls.create[0].params.metadata).toMatchObject({ app: "harvey_taxi_orders", order_id: r.body.order.id, rider_id: RIDER.id });
    expect(mockClient._state.order_items.map((i) => [i.name, i.unit_price_cents, i.quantity, i.substitution_choice])).toEqual([["Whole milk", 449, 2, "best_match"], ["Bread", 325, 1, "refund"]]);
    expect(orders()[0]).toMatchObject({ rider_id: RIDER.id, livemode: false, rider_notes: "Ring the bell", tax_rate_bps: 1000 });
    expect(events(r.body.order.id)).toEqual(["pending_payment"]);
  });

  test("retrying with the same key returns the same order and authorization", async () => {
    const body = checkoutBody({ key: "same-key-abc" });
    const a = await asRider().post("/api/orders/checkout", body);
    const b = await asRider().post("/api/orders/checkout", { ...body });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ repeated: true, client_secret: "secret_1" });
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(orders()).toHaveLength(1);
    expect(mockCalls.create).toHaveLength(1);
  });

  test.each([
    ["a held item", { items: [{ catalog_item_id: "beer", quantity: 1 }] }, 409, /no longer available/],
    ["another store's item", { items: [{ catalog_item_id: "burger", quantity: 1 }] }, 409, /no longer available/],
    ["a closed store", { merchant: "M3", rideType: "food", items: [{ catalog_item_id: "burger", quantity: 1 }] }, 409, /closed right now/],
    ["the wrong delivery type for the store", { rideType: "food" }, 400, /fresh delivery estimate/],
    ["a tip over $500", { tip: 50001 }, 400, /tip/],
    ["a store without a confirmed pickup pin", { merchant: "M4", rideType: "food", items: [{ catalog_item_id: "taco", quantity: 1 }] }, 409, /isn't taking orders yet/],
    ["a delivery quote that doesn't start at the store (about 1.3 km away)", { pickup: { lat: 36.1745, lng: -86.7816 } }, 400, /fresh delivery estimate from this store/]
  ])("refuses %s", async (_label, opts, status, error) => {
    const r = await asRider().post("/api/orders/checkout", checkoutBody(opts));
    expect(r.status).toBe(status);
    expect(r.body.error).toMatch(error);
    expect(orders()).toEqual([]);
    expect(mockCalls.create).toEqual([]);
  });

  test("a fare quote is bound to the rider and can't be reused", async () => {
    const stolen = checkoutBody({ rider: RIDER2 });
    expect((await asRider(RIDER).post("/api/orders/checkout", stolen)).status).toBe(400);
    await asRider().post("/api/orders/checkout", checkoutBody({ jti: "shared-jti" }));
    const again = await asRider().post("/api/orders/checkout", checkoutBody({ jti: "shared-jti" }));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already used/);
  });

  test("the order reaches the store only after Stripe shows the card authorized", async () => {
    const r = await asRider().post("/api/orders/checkout", checkoutBody());
    const id = r.body.order.id;
    expect((await asRider().post(`/api/orders/${id}/confirm-payment`)).status).toBe(409);
    expect((await asStore().get("/api/merchant/orders")).body.orders).toEqual([]);
    mockIntents.get(orders()[0].payment_intent_id).status = "requires_capture";
    expect((await asRider(RIDER2).post(`/api/orders/${id}/confirm-payment`)).status).toBe(404);
    const ok = await asRider().post(`/api/orders/${id}/confirm-payment`);
    expect(ok.body.order.status).toBe("placed");
    expect(orders()[0].placed_at).toBeTruthy();
    expect(events(id)).toEqual(["pending_payment", "placed"]);
  });
});

describe("store inbox", () => {
  test("the store sees its own orders with the rider's first name only", async () => {
    await placedOrder();
    const inbox = await asStore().get("/api/merchant/orders");
    expect(inbox.body.orders).toHaveLength(1);
    expect(inbox.body.orders[0]).toMatchObject({ status: "placed", rider_first_name: "Ana", rider_notes: "Ring the bell", items_subtotal_cents: 1223 });
    expect(JSON.stringify(inbox.body)).not.toMatch(/ana@example|5550111|Lopez|36\.17/);
    expect((await asStore("U0000002", "M2").get("/api/merchant/orders")).body.orders).toEqual([]);
  });

  test("accept needs a prep time; ready; a second accept loses the race; the rider can't cancel once ready (D2)", async () => {
    const id = await placedOrder();
    expect((await asStore().post(`/api/merchant/orders/${id}/accept`, {})).status).toBe(400);
    expect((await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 95 })).status).toBe(400);
    expect((await asStore("U0000002", "M2").post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 15 })).status).toBe(404);
    const a = await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 15 });
    expect(a.body.order).toMatchObject({ status: "accepted", prep_minutes: 15 });
    expect((await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 15 })).status).toBe(409);
    expect((await asStore().post(`/api/merchant/orders/${id}/ready`)).body.order.status).toBe("ready");
    const late = await asRider().post(`/api/orders/${id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/contact support/);
    expect(mockCalls.cancel).toEqual([]);
    expect(events(id)).toEqual(["pending_payment", "placed", "accepted", "ready"]);
    expect(mockClient._state.order_events.filter((e) => e.order_id === id).map((e) => e.from_status)).toEqual([null, "pending_payment", "placed", "accepted"]);
  });

  test("rejecting needs a reason and releases the card hold", async () => {
    const id = await placedOrder();
    expect((await asStore().post(`/api/merchant/orders/${id}/reject`, {})).status).toBe(400);
    const r = await asStore().post(`/api/merchant/orders/${id}/reject`, { reason: "Out of bread today" });
    expect(r.body.order.status).toBe("rejected");
    expect(mockCalls.cancel).toEqual([orders()[0].payment_intent_id]);
    expect(orders()[0]).toMatchObject({ cancel_reason: "Out of bread today" });
    expect(mockClient._state.audit_logs.map((x) => x.action)).toContain("order_rejected");
  });

  test("D1: an order not accepted within 8 minutes expires and its hold is released; a late accept is refused", async () => {
    const id = await placedOrder();
    orders()[0].placed_at = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    const late = await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 10 });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/expired/);
    expect(orders()[0].status).toBe("expired");
    expect(mockCalls.cancel).toHaveLength(1);
  });

  test("the inbox sweep expires unanswered orders and abandons unpaid checkouts", async () => {
    const id = await placedOrder();
    const unpaid = (await asRider().post("/api/orders/checkout", checkoutBody())).body.order.id;
    orders().find((o) => o.id === id).placed_at = new Date(Date.now() - 8 * 60 * 1000 - 1000).toISOString();
    orders().find((o) => o.id === unpaid).created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    await asStore().get("/api/merchant/orders");
    expect(orders().find((o) => o.id === id).status).toBe("expired");
    expect(orders().find((o) => o.id === unpaid).status).toBe("payment_abandoned");
    expect(mockCalls.cancel).toHaveLength(2);
  });
});

describe("rider cancel", () => {
  test("free while placed or accepted (D2): the hold is released; another rider can't", async () => {
    const id = await placedOrder();
    await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 20 });
    expect((await asRider(RIDER2).post(`/api/orders/${id}/cancel`)).status).toBe(404);
    const r = await asRider().post(`/api/orders/${id}/cancel`);
    expect(r.body.order).toMatchObject({ status: "cancelled_by_rider", can_cancel: false });
    expect(mockCalls.cancel).toHaveLength(1);
    expect((await asRider().get("/api/orders")).body.orders.map((o) => o.status)).toEqual(["cancelled_by_rider"]);
  });
});

describe("staff", () => {
  test("admin only; list open orders with store names; detail with history; cancel with a reason releases the hold", async () => {
    const id = await placedOrder();
    expect((await request(app).get("/api/admin/orders")).status).toBe(401);
    const list = await admin(request(app).get("/api/admin/orders"));
    expect(list.body).toMatchObject({ enabled: true, test_mode_keys: true });
    expect(list.body.orders.map((o) => [o.order_number, o.store_name, o.status, o.can_staff_cancel])).toEqual([[orders()[0].order_number, "TEST Store M1", "placed", true]]);
    const detail = await admin(request(app).get(`/api/admin/orders/${id}`));
    expect(detail.body.order).toMatchObject({ rider_first_name: "Ana", items: expect.any(Array) });
    expect(detail.body.events.map((e) => e.to_status)).toEqual(["pending_payment", "placed"]);
    expect((await admin(request(app).post(`/api/admin/orders/${id}/cancel`)).send({ reason: "short" })).status).toBe(400);
    const c = await admin(request(app).post(`/api/admin/orders/${id}/cancel`)).send({ reason: "Store called to say it is closing." });
    expect(c.body.order.status).toBe("cancelled_by_staff");
    expect(mockCalls.cancel).toHaveLength(1);
    expect((await admin(request(app).get("/api/admin/orders"))).body.orders).toEqual([]);
    expect((await admin(request(app).get("/api/admin/orders?view=all"))).body.orders).toHaveLength(1);
  });

  test("an accepted order past its prep time + 20 minutes is flagged", async () => {
    const id = await placedOrder();
    await asStore().post(`/api/merchant/orders/${id}/accept`, { prep_minutes: 10 });
    orders()[0].accepted_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect((await admin(request(app).get("/api/admin/orders"))).body.orders[0].attention).toMatch(/preparation time/);
  });
});

describe("store pickup pin (staff)", () => {
  const pin = (id, body) => admin(request(app).post(`/api/admin/merchants/${id}/pickup-pin`)).send(body);
  test("admin only; paste coordinates or a Google Maps link; must be in Tennessee; audited", async () => {
    expect((await request(app).post("/api/admin/merchants/M4/pickup-pin").send({ pin: "36.1627, -86.7816" })).status).toBe(401);
    expect((await pin("M4", { pin: "somewhere downtown" })).status).toBe(400);
    expect((await pin("M4", { pin: "40.7128, -74.0060" })).body.error).toMatch(/isn't in Tennessee/);
    const r = await pin("M4", { pin: "https://www.google.com/maps/place/Store/@36.158812,-86.778344,17z" });
    expect(r.body.pickup_pin).toEqual({ lat: 36.158812, lng: -86.778344 });
    expect(mockClient._state.merchants.find((m) => m.id === "M4")).toMatchObject({ pickup_lat: 36.158812, pickup_lng: -86.778344, pickup_pin_confirmed_by: expect.any(String), pickup_pin_confirmed_at: expect.any(String) });
    expect(mockClient._state.audit_logs.map((a) => a.action)).toContain("merchant_pickup_pin_set");
    const list = await admin(request(app).get("/api/admin/merchants"));
    expect(list.body.merchants.find((m) => m.id === "M4").pickup_pin).toMatchObject({ lat: 36.158812, lng: -86.778344 });
  });
  test("pins are for approved or paused stores only", async () => {
    mockClient._state.merchants.find((m) => m.id === "M4").status = "pending";
    expect((await pin("M4", { pin: "36.1627, -86.7816" })).status).toBe(409);
  });
});

describe("isolation from rides and the legacy delivery booking (owner decision 2026-10-18)", () => {
  test("orders build their own Stripe client from the orders test key; the ride key client is never used for orders", async () => {
    expect(mockCalls.keys).toEqual(expect.arrayContaining(["sk_test_orders", "sk_live_rides_must_not_be_used"]));
    // A full order cycle runs with the delivery switches off; any use of the
    // ride client would throw.
    const id = await placedOrder();
    expect((await asStore().post(`/api/merchant/orders/${id}/reject`, { reason: "Closing early" })).status).toBe(200);
    expect(mockCalls.cancel).toHaveLength(1);
  });
  test("the legacy free-text delivery booking stays paused while orders are on", async () => {
    const r = await request(app).post("/api/rides/payment-intent").set(RH).send({ ride_type: "food" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Delivery is paused/);
  });
  test("the rider screens get the publishable key only when it is a test key", async () => {
    const r = await request(app).get("/api/orders/config");
    expect(r.body).toMatchObject({ enabled: true, test_mode: true, publishable_key: null });
  });
});

describe("rider store list and menu (step 3b)", () => {
  test("signed-in riders only; approved, pinned stores with items for sale; held or hidden items never sent", async () => {
    expect((await request(app).get("/api/stores")).status).toBe(401);
    mockClient._state.catalog_items.push(item("vodka", "M1", { name: "Vodka", review_status: "blocked" }), item("gone", "M1", { name: "Gone", archived_at: "2026-10-01T00:00:00Z" }), item("eggs", "M1", { name: "Eggs", available: false }));
    const list = await asRider().get("/api/stores");
    expect(list.body).toMatchObject({ enabled: true, market: { id: "nashville" } });
    // M1 grocery and M2 restaurant are pinned and have items; M3 has none; M4 has no pin.
    expect(list.body.stores.map((s) => [s.business_name, s.order_type, s.open_now, s.item_count])).toEqual([
      ["TEST Store M1", "grocery", true, 2],
      ["TEST Store M2", "food", true, 1]
    ]);
    expect(list.body.stores[0]).toMatchObject({ market: "nashville", address: "1 Test St, Nashville" });
    expect(JSON.stringify(list.body)).not.toMatch(/pickup_lat|contact_phone|contact_email|@example/);

    const menu = await asRider().get("/api/stores/M1/menu");
    expect(menu.body.store).toMatchObject({ business_name: "TEST Store M1", item_count: 2 });
    expect(menu.body.items.map((i) => [i.name, i.available]).sort()).toEqual([["Bread", true], ["Eggs", false], ["Whole milk", true]]);
    expect(JSON.stringify(menu.body)).not.toMatch(/Vodka|Gone|Craft beer|review_status|merchant_id/);
    expect((await asRider().get("/api/stores/M4/menu")).status).toBe(404);
    expect((await asRider().get("/api/stores/NOPE/menu")).status).toBe(404);
  });
  test("only the rider's market is listed; an unknown market falls back to Nashville", async () => {
    mockClient._state.merchants.find((m) => m.id === "M2").market = "memphis";
    for (const m of mockClient._state.merchants) if (!m.market) m.market = "nashville";
    const names = (await asRider().get("/api/stores?market=memphis")).body.stores.map((s) => s.business_name);
    expect(names).toEqual(["TEST Store M1"]);
  });
  test("an order carries its store's market", async () => {
    mockClient._state.merchants.find((m) => m.id === "M1").market = "nashville";
    const r = await asRider().post("/api/orders/checkout", checkoutBody());
    expect(orders().find((o) => o.id === r.body.order.id).market).toBe("nashville");
  });
});

describe("delivery estimate for an order (step 3b part 2)", () => {
  const { createFakeMapbox } = require("./fixtures/fakeMapbox");
  const fake = createFakeMapbox();
  const realFetch = globalThis.fetch;
  beforeAll(() => { globalThis.fetch = fake.fetchImpl; });
  afterAll(() => { globalThis.fetch = realFetch; });
  beforeEach(() => fake.reset());
  const estimate = (body, rider) => asRider(rider).post("/api/orders/estimate", { merchant_id: "M1", destination_lat: DROPOFF.lat, destination_lng: DROPOFF.lng, ...body });

  test("routes from the store's pin by road, signs the fee, and never sends the pin", async () => {
    expect((await request(app).post("/api/orders/estimate").set(RH).send({ merchant_id: "M1" })).status).toBe(401);
    const r = await estimate({ pickup_lat: 36.0, pickup_lng: -86.0, miles: 0.1 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ride_type: "grocery", miles: 5.2, minutes: 14, destination: DROPOFF });
    expect(r.body.delivery_fee_cents).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/pickup|36\.1627|-86\.7816/);
    // The route starts at the pin, not at anything the device sent.
    expect(fake.calls[0].path).toBe(`/directions/v5/mapbox/driving/${PICKUP.lng},${PICKUP.lat};${DROPOFF.lng},${DROPOFF.lat}`);
    expect(mockClient._state.audit_logs.map((a) => a.action)).toContain("order_estimate_created");

    // Checkout with that quote, without sending the pin, charges the quoted fee.
    const body = { merchant_id: "M1", items: [{ catalog_item_id: "bread", quantity: 1 }], tip_cents: 0, client_order_key: "estimate-key-1", estimate_token: r.body.estimate_token, ride_type: r.body.ride_type, destination_lat: DROPOFF.lat, destination_lng: DROPOFF.lng };
    const c = await asRider().post("/api/orders/checkout", body);
    expect(c.status).toBe(201);
    expect(c.body.order.delivery_fee_cents).toBe(r.body.delivery_fee_cents);
    // Single use.
    const again = await asRider().post("/api/orders/checkout", { ...body, client_order_key: "estimate-key-2" });
    expect(again.status).toBe(409);
  });

  test.each([
    ["an address outside Tennessee", { destination_lat: 40.7128, destination_lng: -74.006 }, 400, /in Tennessee/],
    ["no address", { destination_lat: null, destination_lng: null }, 400, /in Tennessee/],
    ["a store without a pin", { merchant_id: "M4" }, 404, /isn't taking orders/],
    ["a store with no hours (closed)", { merchant_id: "M3" }, 409, /closed right now/]
  ])("refuses %s", async (_label, body, status, message) => {
    const r = await estimate(body);
    expect(r.status).toBe(status);
    expect(r.body.error || r.body.message).toMatch(message);
    expect(fake.calls).toHaveLength(0);
  });

  test("no route, a routing outage, or a trip past the delivery limit gives no quote", async () => {
    fake.setMode("no_route");
    expect((await estimate({})).status).toBe(422);
    fake.setMode("http_500");
    const down = await estimate({});
    expect(down.status).toBe(503);
    expect(down.body.estimate_token).toBeUndefined();
    fake.reset();
    const realImpl = fake.fetchImpl;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 40000, duration: 2400 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    const far = await estimate({});
    globalThis.fetch = realImpl;
    expect(far.status).toBe(422);
    expect(far.body.error || far.body.message).toMatch(/more than 15 miles/);
  });

  test("a quote for one rider can't be used by another", async () => {
    const r = await estimate({});
    const body = { merchant_id: "M1", items: [{ catalog_item_id: "bread", quantity: 1 }], tip_cents: 0, client_order_key: "estimate-key-3", estimate_token: r.body.estimate_token, ride_type: "grocery", destination_lat: DROPOFF.lat, destination_lng: DROPOFF.lng };
    expect((await asRider(RIDER2).post("/api/orders/checkout", body)).status).toBe(400);
  });
});
