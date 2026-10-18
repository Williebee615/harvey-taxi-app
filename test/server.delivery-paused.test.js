// Delivery booking is paused by default (owner decision 2026-10-17) until
// the merchant portal and the full merchant / rider / driver flow are
// tested. The server refuses delivery quotes and requests; the public
// config tells the rider app, which shows a waitlist notice instead of the
// booking flow. All data is test fixtures.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";
delete process.env.ENABLE_DELIVERY;
delete process.env.ENABLE_FOOD_DELIVERY;
delete process.env.ENABLE_GROCERY_DELIVERY;

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, riderAuthHeaders, signTestRiderToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let app;
const RIDER = makeRider({ id: "RIDER_1" });
const TRIP = { pickup: "TEST Store, 1 Main St", destination: "TEST Home, 2 Elm St", pickup_lat: 36.16, pickup_lng: -86.78, destination_lat: 36.17, destination_lng: -86.79, rider_id: RIDER.id };

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ riders: [{ ...RIDER }], drivers: [], rides: [], driver_offers: [], audit_logs: [], system_flags: [] }, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

test.each(["food", "grocery"])("a %s delivery estimate is refused while delivery is paused", async (type) => {
  const res = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: type });
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toMatch(/Delivery is paused/);
  expect(res.body.estimate_token).toBeUndefined();
});

test("a delivery request is refused even with a valid ride quote, and nothing is created", async () => {
  const estimate = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: "standard" });
  expect(estimate.body.estimate_token).toBeTruthy();
  const res = await request(app).post("/api/rides/request").set(riderAuthHeaders(signTestRiderToken(RIDER.id))).send({ ...TRIP, ride_type: "food", merchant_name: "TEST Diner", estimate_token: estimate.body.estimate_token });
  expect(res.status).toBe(400);
  expect(mockSupabaseClient._state.rides).toHaveLength(0);
});

test("passenger rides are unaffected", async () => {
  const res = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: "standard" });
  expect(res.status).toBe(200);
});

test("the public config reports delivery as paused", async () => {
  const res = await request(app).get("/api/config/public");
  expect(res.body.delivery).toEqual({ enabled: false, food: false, grocery: false });
});

test("the rider Delivery Center has the paused notice and checks availability before opening the booking flow", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "rider-dashboard.html"), "utf8");
  expect(html).toContain('id="deliveryPausedNote"');
  expect(html).toContain("subject=Waitlist%3A%20food%20delivery");
  expect(html).toMatch(/function goDelivery\(type\) \{[\s\S]*?deliveryAvailability[\s\S]*?goRide\(kind\);/);
});
