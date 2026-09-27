// Composition/integration tests for ride-creation idempotency:
// lib/rideQuote.js's quote.jti, and rides.quote_jti's unique index, as
// wired into POST /api/rides/request. A replayed quote token (network
// retry, a double-tapped "Request Ride" button, or a deliberate replay)
// must return the original ride instead of creating a duplicate -- and
// must never return a DIFFERENT rider's ride merely because a token/jti
// collided.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function resetState(seed) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  for (const table of Object.keys(seed)) {
    state[table] = seed[table].map((row) => ({ ...row }));
  }
}

const RIDER = makeRider({ id: "RIDER_1" });
const OTHER_RIDER = makeRider({ id: "RIDER_2", email: "casey@example.test", phone: "+16155550102" });

beforeEach(() => {
  resetState({
    riders: [RIDER, OTHER_RIDER],
    drivers: [makeDriver()],
    rides: [],
    driver_offers: [],
    audit_logs: []
  });
});

const TRIP_BODY_BASE = {
  pickup: "100 Main St",
  destination: "200 Elm St",
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  destination_lat: 36.17,
  destination_lng: -86.79,
  ride_type: "standard"
};

async function getQuoteToken(riderId) {
  const res = await request(app)
    .post("/api/rides/estimate")
    .send({
      miles: 5,
      minutes: 12,
      ...TRIP_BODY_BASE,
      rider_id: riderId
    });

  expect(res.status).toBe(200);
  return res.body.estimate_token;
}

describe("POST /api/rides/request -- quote-token replay protection", () => {
  test("a replayed token by the same rider returns the original ride, not a duplicate", async () => {
    const token = await getQuoteToken(RIDER.id);

    const first = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: token });

    expect(first.status).toBe(201);
    const firstRideId = first.body.ride.id;

    const second = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: token });

    expect(second.status).toBe(200);
    expect(second.body.replay).toBe(true);
    expect(second.body.ride.id).toBe(firstRideId);

    // Only one ride was ever actually created.
    expect(mockSupabaseClient._state.rides).toHaveLength(1);
  });

  test("three rapid duplicate requests with the same token still produce exactly one ride", async () => {
    const token = await getQuoteToken(RIDER.id);
    const body = { ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: token };

    const results = await Promise.all([
      request(app).post("/api/rides/request").send(body),
      request(app).post("/api/rides/request").send(body),
      request(app).post("/api/rides/request").send(body)
    ]);

    // Exactly one request wins the real insert (201); any others racing
    // against it land on the replay path (200) -- either way, all three
    // succeed and agree on the same ride.
    results.forEach((res) => expect([200, 201]).toContain(res.status));
    expect(mockSupabaseClient._state.rides).toHaveLength(1);

    const rideIds = new Set(results.map((res) => res.body.ride.id));
    expect(rideIds.size).toBe(1);
  });

  test("a fresh (unused) token from a new estimate always creates a new ride", async () => {
    const tokenA = await getQuoteToken(RIDER.id);
    const tokenB = await getQuoteToken(RIDER.id);

    expect(tokenA).not.toBe(tokenB);

    const first = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: tokenA });

    const second = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: tokenB });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.ride.id).not.toBe(second.body.ride.id);
    expect(mockSupabaseClient._state.rides).toHaveLength(2);
  });

  test("a token issued for one rider cannot be replayed by a different rider (quoteMatchesSubmission rejects it first)", async () => {
    const token = await getQuoteToken(RIDER.id);

    const first = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: token });

    expect(first.status).toBe(201);

    const attacker = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: OTHER_RIDER.id, estimate_token: token });

    expect(attacker.status).toBe(400);
    // Never leaked RIDER_1's ride to OTHER_RIDER.
    expect(attacker.body.ride).toBeUndefined();
    expect(mockSupabaseClient._state.rides).toHaveLength(1);
  });

  test("does not reuse an expired/tampered token", async () => {
    const token = await getQuoteToken(RIDER.id);
    const tampered = `${token}x`;

    const res = await request(app)
      .post("/api/rides/request")
      .send({ ...TRIP_BODY_BASE, rider_id: RIDER.id, estimate_token: tampered });

    expect(res.status).toBe(400);
    expect(mockSupabaseClient._state.rides).toHaveLength(0);
  });
});
