// Autonomous rides are not offered (owner decision 2026-10-17): the rider
// app shows a waitlist, and the server refuses the ride type rather than
// quietly turning it into a human-driver ride. All data is test fixtures.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, riderAuthHeaders, signTestRiderToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let app;
const RIDER = makeRider({ id: "RIDER_1" });
const TRIP = { pickup: "TEST 100 Main St", destination: "TEST 200 Elm St", pickup_lat: 36.16, pickup_lng: -86.78, destination_lat: 36.17, destination_lng: -86.79, rider_id: RIDER.id };

function reset() {
  const s = mockSupabaseClient._state;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, {
    riders: [{ ...RIDER }],
    drivers: [makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78, last_seen_at: new Date().toISOString() })],
    rides: [],
    driver_offers: [],
    audit_logs: [],
    system_flags: []
  });
  mockSupabaseClient.rpc = () => Promise.resolve({ data: null, error: null });
}

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(reset);

test("a fare estimate for an autonomous ride is refused", async () => {
  const res = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: "autonomous" });
  expect(res.status).toBe(400);
  expect(res.body.estimate_token).toBeUndefined();
  expect(JSON.stringify(res.body)).toMatch(/not available/i);
});

test("a ride request naming autonomous is refused even with a valid quote, and nothing is created", async () => {
  const estimate = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: "standard" });
  expect(estimate.body.estimate_token).toBeTruthy();
  const res = await request(app).post("/api/rides/request").set(riderAuthHeaders(signTestRiderToken(RIDER.id))).send({ ...TRIP, ride_type: "AUTONOMOUS", estimate_token: estimate.body.estimate_token });
  expect(res.status).toBe(400);
  expect(mockSupabaseClient._state.rides).toHaveLength(0);
});

test("standard rides still work", async () => {
  const estimate = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, ride_type: "standard" });
  const res = await request(app).post("/api/rides/request").set(riderAuthHeaders(signTestRiderToken(RIDER.id))).send({ ...TRIP, ride_type: "standard", estimate_token: estimate.body.estimate_token });
  expect(res.status).toBe(201);
});

describe("screens offer a waitlist, not a booking", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8");

  test("rider dashboard has no autonomous booking mode", () => {
    const html = read("rider-dashboard.html");
    expect(html).not.toContain('id="modeAutonomousBtn"');
    expect(html).not.toMatch(/rideType:\s*"autonomous"/);
    expect(html).not.toMatch(/goRide\("autonomous"\)/);
    expect(html).not.toMatch(/\["driver", "airport", "autonomous"/);
    expect(html).toContain("subject=Waitlist%3A%20autonomous%20rides");
    expect(html).toContain("Harvey Taxi does not operate autonomous vehicles today");
  });

  test("driver sign-up offers an owner-program interest link, not an autonomous driver mode", () => {
    const html = read("driver-signup.html");
    expect(html).not.toContain('name="driverType" value="autonomous"');
    expect(html).toContain("subject=Waitlist%3A%20autonomous%20vehicle%20owner%20program");
    expect(html).toContain("every Harvey Taxi trip has a licensed human driver");
  });
});
