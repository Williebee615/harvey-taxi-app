// Tips during or after a trip, and rider ratings of drivers (owner
// decisions 2026-10-22). Both are off by default. A tip is its own charge on
// the Stripe test key (never the ride key while live tips are off), counted
// only after the server confirms it, and goes 100% to the driver. App
// Review rides are simulated. A low score is only flagged for staff.
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ORDERS_STRIPE_PUBLISHABLE_KEY = "pk_test_orders";
process.env.STRIPE_SECRET_KEY = "sk_live_rides_must_not_be_used";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_rides";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken, riderAuthHeaders, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
jest.mock("web-push", () => ({ setVapidDetails: () => {}, sendNotification: async () => {} }));
const mockIntents = new Map();
const mockStripeUse = [];
jest.mock("stripe", () =>
  function MockStripe(key) {
    const pi = {
      create: async (params, opts) => {
        mockStripeUse.push({ key, op: "create" });
        const intent = { id: `pi_${mockIntents.size + 1}`, amount: params.amount, currency: params.currency, status: "requires_payment_method", metadata: params.metadata, client_secret: `secret_${mockIntents.size + 1}`, idem: opts && opts.idempotencyKey };
        mockIntents.set(intent.id, intent);
        return intent;
      },
      retrieve: async (id) => {
        mockStripeUse.push({ key, op: "retrieve" });
        return mockIntents.get(id);
      },
      cancel: async (id) => {
        mockStripeUse.push({ key, op: "cancel" });
        const i = mockIntents.get(id);
        if (i) i.status = "canceled";
        return i;
      }
    };
    return { paymentIntents: pi, webhooks: { constructEvent: () => { throw new Error("no"); } } };
  }
);
jest.setTimeout(60_000);

let app;
const RIDER = makeRider({ id: "RIDER_1" });
const OTHER = makeRider({ id: "RIDER_2", phone: "+16155550102", email: "other@example.test" });
const DRIVER = makeDriver({ id: "DRIVER_1", first_name: "Sam", last_name: "Ortiz" });
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function reset({ flags = {}, rides = [], earnings = [], ratings = [] } = {}) {
  mockIntents.clear();
  mockStripeUse.length = 0;
  mockClient = createFakeSupabase(
    {
      riders: [RIDER, OTHER],
      drivers: [DRIVER, makeDriver({ id: "DRIVER_2", first_name: "Lee", last_name: "Park" })],
      rides,
      driver_earnings: earnings,
      ride_tips: [],
      driver_ratings: ratings,
      audit_logs: [],
      push_subscriptions: [],
      system_flags: Object.entries(flags).map(([key, value]) => ({ key, value }))
    },
    { uniqueColumns: { driver_ratings: ["ride_id"] } }
  );
}

beforeAll(() => {
  reset();
  ({ app } = require("../server"));
});

const asRider = (r = RIDER) => {
  const h = riderAuthHeaders(signTestRiderToken(r.id));
  return {
    get: (p) => request(app).get(p).set(h),
    post: (p, b = {}) => request(app).post(p).set(h).send(b)
  };
};
const db = () => mockClient._state;
const ON = { ride_tips_enabled: "true", driver_ratings_enabled: "true" };
const tripRide = (over = {}) => makeRide({ id: "RIDE_9", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "in_progress", tip_amount: null, ...over });

describe("switched off by default", () => {
  test("tips and ratings are refused and the page says so", async () => {
    reset({ rides: [tripRide({ status: "completed", completed_at: ago(1) })] });
    expect((await asRider().post("/api/rides/RIDE_9/tips", { amount: 5 })).status).toBe(403);
    expect((await asRider().post("/api/rides/RIDE_9/rating", { stars: 5 })).status).toBe(403);
    const page = await asRider().get("/api/rides/RIDE_9/tip-rating");
    expect(page.status).toBe(200);
    expect(page.body.tips).toMatchObject({ enabled: false, can_tip: false });
    expect(page.body.rating).toMatchObject({ enabled: false, can_rate: false });
    expect(mockIntents.size).toBe(0);
  });
});

describe("tips", () => {
  test("during the trip: a test-key charge, recorded only after Stripe confirms, then 100% to the driver at completion", async () => {
    reset({ flags: ON, rides: [tripRide()] });
    const start = await asRider().post("/api/rides/RIDE_9/tips", { amount: "5" });
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ mode: "test", publishable_key: "pk_test_orders" });
    expect(mockStripeUse.every((u) => u.key === "sk_test_orders")).toBe(true);
    const tipId = start.body.tip.id;
    expect(db().ride_tips[0]).toMatchObject({ status: "pending", amount_cents: 500, driver_id: "DRIVER_1" });

    // Not paid yet: confirming changes nothing.
    expect((await asRider().post(`/api/rides/RIDE_9/tips/${tipId}/confirm`)).status).toBe(409);
    expect(db().ride_tips[0].status).toBe("pending");

    const intent = mockIntents.get(db().ride_tips[0].payment_intent_id);
    Object.assign(intent, { status: "succeeded", amount_received: 500 });
    const done = await asRider().post(`/api/rides/RIDE_9/tips/${tipId}/confirm`);
    expect(done.status).toBe(200);
    expect(db().ride_tips[0].status).toBe("succeeded");
    expect(db().audit_logs.map((a) => a.action)).toContain("ride_tip_paid");

    // A second tip on the same trip is refused.
    expect((await asRider().post("/api/rides/RIDE_9/tips", { amount: 2 })).status).toBe(409);
  });

  test("after the trip: the driver's earning row picks up the tip", async () => {
    reset({
      flags: ON,
      rides: [tripRide({ status: "completed", completed_at: ago(2), tip_amount: 3 })],
      earnings: [{ id: "EARN_1", ride_id: "RIDE_9", driver_id: "DRIVER_1", driver_base_earning: 20, tip_amount: 3, total_earning: 23, payout_amount: 23 }]
    });
    const start = await asRider().post("/api/rides/RIDE_9/tips", { amount: 10 });
    const intent = mockIntents.get(db().ride_tips[0].payment_intent_id);
    Object.assign(intent, { status: "succeeded", amount_received: 1000 });
    await asRider().post(`/api/rides/RIDE_9/tips/${start.body.tip.id}/confirm`);
    expect(db().driver_earnings[0]).toMatchObject({ driver_base_earning: 20, tip_amount: 13, total_earning: 33, payout_amount: 33 });
  });

  test("a mismatched intent never counts", async () => {
    reset({ flags: ON, rides: [tripRide()] });
    const start = await asRider().post("/api/rides/RIDE_9/tips", { amount: 5 });
    const intent = mockIntents.get(db().ride_tips[0].payment_intent_id);
    Object.assign(intent, { status: "succeeded", amount_received: 100 });
    expect((await asRider().post(`/api/rides/RIDE_9/tips/${start.body.tip.id}/confirm`)).status).toBe(409);
    expect(db().ride_tips[0].status).toBe("pending");
  });

  test("only the rider, only with a driver, only once the trip has started, only within 24 hours", async () => {
    reset({ flags: ON, rides: [tripRide({ status: "driver_enroute" })] });
    expect((await asRider().post("/api/rides/RIDE_9/tips", { amount: 5 })).status).toBe(409);
    expect((await asRider(OTHER).post("/api/rides/RIDE_9/tips", { amount: 5 })).status).toBe(404);
    reset({ flags: ON, rides: [tripRide({ status: "completed", completed_at: ago(30) })] });
    expect((await asRider().post("/api/rides/RIDE_9/tips", { amount: 5 })).status).toBe(409);
    expect((await asRider().post("/api/rides/RIDE_9/tips", { amount: 500 })).status).toBe(400);
    expect(mockIntents.size).toBe(0);
  });

  test("App Review rides: simulated, nothing charged", async () => {
    reset({ flags: ON, rides: [tripRide({ is_review_ride: true })] });
    const r = await asRider().post("/api/rides/RIDE_9/tips", { amount: 5 });
    expect(r.status).toBe(201);
    expect(r.body.simulated).toBe(true);
    expect(db().ride_tips[0]).toMatchObject({ status: "simulated", mode: "simulated" });
    expect(db().ride_tips[0].payment_intent_id ?? null).toBeNull();
    expect(mockIntents.size).toBe(0);
  });
});

describe("ratings and the driver score", () => {
  test("one rating per completed trip; review rides are kept but never counted", async () => {
    reset({ flags: ON, rides: [tripRide({ status: "completed", completed_at: ago(1) }), tripRide({ id: "RIDE_R", status: "completed", completed_at: ago(1), is_review_ride: true })] });
    expect((await asRider().post("/api/rides/RIDE_9/rating", { stars: 6 })).status).toBe(400);
    const r = await asRider().post("/api/rides/RIDE_9/rating", { stars: 4, tags: ["late"], comment: "A bit late but kind." });
    expect(r.status).toBe(201);
    expect((await asRider().post("/api/rides/RIDE_9/rating", { stars: 5 })).status).toBe(409);
    await asRider().post("/api/rides/RIDE_R/rating", { stars: 1 });
    expect(db().driver_ratings.map((x) => x.counted).sort()).toEqual([false, true]);
    const audit = db().audit_logs.find((a) => a.action === "driver_rated");
    expect(JSON.stringify(audit.metadata)).not.toMatch(/kind/);
  });

  test("staff see flagged drivers first; the driver sees their score without comments", async () => {
    const rows = [5, 4, 4, 4, 5].map((stars, i) => ({ id: `RT${i}`, ride_id: `R${i}`, rider_id: "RIDER_1", driver_id: "DRIVER_1", stars, tags: stars === 4 ? ["late"] : [], comment: stars === 4 ? "late again" : null, counted: true, created_at: ago(i + 1) }));
    const good = [5, 5, 5, 5, 5].map((stars, i) => ({ id: `RG${i}`, ride_id: `G${i}`, rider_id: "RIDER_1", driver_id: "DRIVER_2", stars, tags: [], comment: null, counted: true, created_at: ago(i + 1) }));
    reset({ flags: ON, ratings: [...rows, ...good] });
    const staff = await request(app).get("/api/admin/driver-ratings").set("x-admin-token", "test-admin-token");
    expect(staff.status).toBe(200);
    expect(staff.body.drivers[0]).toMatchObject({ driver_id: "DRIVER_1", name: "Sam O.", score: 4.4, needs_review: true });
    expect(staff.body.drivers[1]).toMatchObject({ driver_id: "DRIVER_2", score: 5, needs_review: false });
    expect(staff.body.drivers[0].recent_low).toEqual([]); // 4 stars isn't "low" (3 or fewer)
    expect((await request(app).get("/api/admin/driver-ratings")).status).toBe(401);

    const mine = await request(app).get("/api/driver/rating").set(driverAuthHeaders(signTestDriverToken("DRIVER_1")));
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ enabled: true, score: 4.4, count: 5, shown: true });
    expect(JSON.stringify(mine.body)).not.toMatch(/late again|RIDER_1/);
    // Nothing happens to the driver automatically.
    expect(db().drivers.find((d) => d.id === "DRIVER_1")).toMatchObject({ id: "DRIVER_1" });
    expect(db().audit_logs.filter((a) => /suspend/.test(a.action))).toEqual([]);
  });
});
