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
process.env.STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ENABLE_MERCHANT_ORDERS = "true";
process.env.ENABLE_DELIVERY = "true";
process.env.ENABLE_FOOD_DELIVERY = "true";
process.env.ENABLE_GROCERY_DELIVERY = "true";
process.env.ORDERS_TEST_TAX_RATE_BPS = "1000";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signMerchantSession } = require("../lib/merchantAuth");
const { signRiderSession } = require("../lib/riderAuth");
const { signRideQuote } = require("../lib/rideQuote");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
const mockIntents = new Map();
const mockCalls = { create: [], cancel: [] };
jest.mock("stripe", () =>
  function MockStripe() {
    return {
      paymentIntents: {
        create: async (params, opts) => {
          mockCalls.create.push({ params, opts });
          const existing = [...mockIntents.values()].find((i) => i.idem === opts.idempotencyKey);
          if (existing) return existing;
          const intent = { id: `pi_test_${mockIntents.size + 1}`, object: "payment_intent", amount: params.amount, status: "requires_payment_method", metadata: params.metadata, livemode: false, client_secret: `secret_${mockIntents.size + 1}`, idem: opts.idempotencyKey };
          mockIntents.set(intent.id, intent);
          return intent;
        },
        retrieve: async (id) => {
          const i = mockIntents.get(id);
          if (!i) throw new Error("No such payment_intent");
          return i;
        },
        cancel: async (id) => {
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
const store = (id, category) => ({ id, business_name: `TEST Store ${id}`, category, address_line: "1 Test St", city: "Nashville", postal_code: "37203", contact_name: "O", contact_phone: "+16155550100", contact_email: `${id}@example.test`, status: "approved", created_at: "2026-10-17T00:00:00Z" });
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
    merchants: [store("M1", "grocery"), store("M2", "restaurant"), store("M3", "restaurant")],
    merchant_hours: [...allDay("M1"), ...allDay("M2")],
    merchant_users: [
      { id: "U0000001", merchant_id: "M1", phone: "+16155550001", name: "Owner", role: "owner", status: "active", session_version: 0 },
      { id: "U0000002", merchant_id: "M2", phone: "+16155550002", name: "Owner", role: "owner", status: "active", session_version: 0 }
    ],
    catalog_items: [
      item("milk", "M1", { name: "Whole milk", price_cents: 449, substitutable: true }),
      item("bread", "M1", { name: "Bread", price_cents: 325 }),
      item("beer", "M1", { name: "Craft beer", review_status: "held" }),
      item("burger", "M2", { name: "Burger", price_cents: 1099 })
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
function checkoutBody({ rider = RIDER, merchant = "M1", rideType = "grocery", items = [{ catalog_item_id: "milk", quantity: 2, substitution_choice: "best_match", unit_price_cents: 1 }, { catalog_item_id: "bread", quantity: 1 }], tip = 200, key, quoteTotal = 11.5, jti } = {}) {
  keyN += 1;
  const estimate_token = signRideQuote({ rideType, miles: 3.2, minutes: 12, pickup: PICKUP, destination: DROPOFF, riderId: rider.id, estimate: { total: quoteTotal, miles: 3.2, minutes: 12 }, secret: process.env.RIDE_QUOTE_SECRET, ttlMinutes: 15, ...(jti ? { jti } : {}) });
  return { merchant_id: merchant, items, tip_cents: tip, client_order_key: key || `order-key-${keyN}`, estimate_token, ride_type: rideType, pickup_lat: PICKUP.lat, pickup_lng: PICKUP.lng, destination_lat: DROPOFF.lat, destination_lng: DROPOFF.lng, rider_notes: "Ring the bell" };
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
    ["a tip over $500", { tip: 50001 }, 400, /tip/]
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
