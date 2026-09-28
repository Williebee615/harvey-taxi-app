// Composition/integration tests for the recoverable ride-completion
// workflow (POST /api/driver/rides/:rideId/complete): trip completion,
// payment capture, and driver-earning creation are three independently
// resumable facts, not one linear sequence that's unrecoverable if a
// crash lands between steps. See lib/ridePaymentCapture.js and
// server.js's captureRidePaymentIdempotent()/upsertDriverEarningIdempotent().
//
// Stripe is mocked (not left unconfigured, unlike server.review-accounts.test.js)
// specifically so these tests can exercise real capture success/failure/
// retry behavior, including the idempotency key passed to Stripe.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "true";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

// Controllable fake Stripe client. Each test configures
// mockStripeCapture/mockStripeCapture.mockImplementation(...) as needed.
const mockStripeCapture = jest.fn();

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      capture: (...args) => mockStripeCapture(...args)
    }
  }));
});

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { driver_earnings: ["ride_id"] } });
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

const DRIVER = makeDriver({ id: "DRIVER_1" });
const OTHER_DRIVER = makeDriver({ id: "DRIVER_2", email: "other@example.test", phone: "+16155550202" });
const driverToken = signTestDriverToken(DRIVER.id);
const otherDriverToken = signTestDriverToken(OTHER_DRIVER.id);

beforeEach(() => {
  mockStripeCapture.mockReset();
  mockStripeCapture.mockResolvedValue({ id: "pi_test_123", status: "succeeded" });

  resetState({
    riders: [makeRider()],
    drivers: [DRIVER, OTHER_DRIVER],
    rides: [
      makeRide({
        status: "in_progress",
        driver_id: DRIVER.id,
        payment_id: "pi_test_123",
        payment_status: "pending"
      })
    ],
    driver_offers: [],
    driver_earnings: [],
    audit_logs: []
  });
});

describe("POST /api/driver/rides/:rideId/complete -- happy path", () => {
  test("completes the ride, captures payment with an idempotency key, and creates exactly one earning", async () => {
    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.payment_status).toBe("captured");
    expect(res.body.payment_captured).toBe(true);
    expect(res.body.earning.ride_id).toBe("RIDE_1");

    expect(mockStripeCapture).toHaveBeenCalledTimes(1);
    const [intentId, , options] = mockStripeCapture.mock.calls[0];
    expect(intentId).toBe("pi_test_123");
    expect(options.idempotencyKey).toBe("complete-capture:RIDE_1");

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("completed");
    expect(ride.payment_status).toBe("captured");

    const earnings = mockSupabaseClient._state.driver_earnings.filter((e) => e.ride_id === "RIDE_1");
    expect(earnings).toHaveLength(1);
  });
});

describe("POST /api/driver/rides/:rideId/complete -- duplicate/concurrent requests", () => {
  test("a second call after completion resumes safely instead of erroring, and does not re-capture or duplicate the earning", async () => {
    const first = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(second.status).toBe(200);
    expect(second.body.status).toBe("completed");
    expect(second.body.payment_status).toBe("captured");

    // Capture only ran once (real call), not twice.
    expect(mockStripeCapture).toHaveBeenCalledTimes(1);

    const earnings = mockSupabaseClient._state.driver_earnings.filter((e) => e.ride_id === "RIDE_1");
    expect(earnings).toHaveLength(1);
  });

  test("two concurrent completion requests: only one transitions the ride, both resolve successfully", async () => {
    const attempt = () =>
      request(app).post("/api/driver/rides/RIDE_1/complete").set(driverAuthHeaders(driverToken)).send({});

    const [a, b] = await Promise.all([attempt(), attempt()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.status).toBe("completed");
    expect(b.body.status).toBe("completed");

    // Only one earning ever exists, regardless of which request "won."
    const earnings = mockSupabaseClient._state.driver_earnings.filter((e) => e.ride_id === "RIDE_1");
    expect(earnings).toHaveLength(1);
  });
});

describe("POST /api/driver/rides/:rideId/complete -- capture failure and retry", () => {
  test("a Stripe capture failure is persisted as capture_failed, not silently swallowed, and the earning is still created", async () => {
    mockStripeCapture.mockRejectedValue(new Error("card issuer declined"));

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.payment_status).toBe("capture_failed");
    expect(res.body.payment_captured).toBe(false);

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.payment_status).toBe("capture_failed");
    expect(ride.payment_capture_error).toContain("card issuer declined");

    // The driver still gets their earning even though the platform's own
    // capture failed -- that's a business/ops problem to reconcile
    // separately, not something that withholds the driver's payout record.
    const earnings = mockSupabaseClient._state.driver_earnings.filter((e) => e.ride_id === "RIDE_1");
    expect(earnings).toHaveLength(1);
  });

  test("does not automatically retry a capture that already failed once (a second /complete call skips it)", async () => {
    mockStripeCapture.mockRejectedValue(new Error("card issuer declined"));

    await request(app).post("/api/driver/rides/RIDE_1/complete").set(driverAuthHeaders(driverToken)).send({});

    mockStripeCapture.mockClear();

    const second = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(second.status).toBe(200);
    expect(second.body.payment_status).toBe("capture_failed");
    expect(mockStripeCapture).not.toHaveBeenCalled();
  });

  test("admin reconciliation retry succeeds once the underlying issue is resolved", async () => {
    mockStripeCapture.mockRejectedValue(new Error("card issuer declined"));

    await request(app).post("/api/driver/rides/RIDE_1/complete").set(driverAuthHeaders(driverToken)).send({});

    mockStripeCapture.mockReset();
    mockStripeCapture.mockResolvedValue({ id: "pi_test_123", status: "succeeded" });

    const res = await request(app)
      .post("/api/admin/payments/RIDE_1/reconcile")
      .set("x-admin-token", "test-admin-token")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.results.capture).toBe("captured");
    expect(mockStripeCapture).toHaveBeenCalledTimes(1);

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.payment_status).toBe("captured");
  });
});

describe("POST /api/driver/rides/:rideId/complete -- not_required and disabled-gate paths", () => {
  test("a ride with no payment_id is marked not_required, never attempts Stripe", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "in_progress", driver_id: DRIVER.id, payment_id: null, payment_status: null })
    ];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe("not_required");
    expect(mockStripeCapture).not.toHaveBeenCalled();
  });
});

describe("POST /api/driver/rides/:rideId/complete -- lifecycle guard", () => {
  test("rejects completing a ride that was never started (still driver_assigned)", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(409);
    expect(mockStripeCapture).not.toHaveBeenCalled();
  });

  test("rejects a driver who isn't assigned to the ride", async () => {
    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/complete")
      .set(driverAuthHeaders(otherDriverToken))
      .send({});

    expect(res.status).toBe(403);
    expect(mockStripeCapture).not.toHaveBeenCalled();
  });
});
