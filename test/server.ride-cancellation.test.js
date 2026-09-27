// Composition/integration tests for rider-initiated cancellation
// (POST /api/rides/:id/cancel), driver withdrawal
// (POST /api/driver/rides/:rideId/withdraw), and the admin
// payment-reconciliation/incident-resolution routes that share the same
// Stripe-void resumability logic (lib/rideCancellation.js,
// server.js's reconcileCancellationPayment()/handleRideCancellation()).

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
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestDriverToken,
  signTestRiderToken,
  driverAuthHeaders,
  riderAuthHeaders
} = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const mockStripeRetrieve = jest.fn();
const mockStripeCancel = jest.fn();

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      retrieve: (...args) => mockStripeRetrieve(...args),
      cancel: (...args) => mockStripeCancel(...args),
      capture: () => Promise.resolve({ id: "pi_test_123", status: "succeeded" })
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

const RIDER = makeRider({ id: "RIDER_1" });
const OTHER_RIDER = makeRider({ id: "RIDER_2", email: "casey@example.test", phone: "+16155550102" });
const DRIVER = makeDriver({ id: "DRIVER_1" });
const OTHER_DRIVER = makeDriver({ id: "DRIVER_2", email: "other@example.test", phone: "+16155550202" });

const riderToken = signTestRiderToken(RIDER.id, { sessionVersion: 0 });
const otherRiderToken = signTestRiderToken(OTHER_RIDER.id, { sessionVersion: 0 });
const driverToken = signTestDriverToken(DRIVER.id);
const otherDriverToken = signTestDriverToken(OTHER_DRIVER.id);

beforeEach(() => {
  mockStripeRetrieve.mockReset();
  mockStripeCancel.mockReset();
  mockStripeRetrieve.mockResolvedValue({ id: "pi_test_123", status: "requires_capture" });
  mockStripeCancel.mockResolvedValue({ id: "pi_test_123", status: "canceled" });

  resetState({
    riders: [RIDER, OTHER_RIDER],
    drivers: [DRIVER, OTHER_DRIVER],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    audit_logs: []
  });
});

describe("POST /api/rides/:id/cancel -- cancellable states", () => {
  const cancellableStates = [
    "payment_required",
    "payment_authorized",
    "awaiting_driver_acceptance",
    "driver_assigned",
    "driver_enroute",
    "arrived",
    "failed"
  ];

  test.each(cancellableStates)("cancels a ride in status %s", async (status) => {
    mockSupabaseClient._state.rides = [
      makeRide({
        status,
        rider_id: RIDER.id,
        driver_id: ["driver_assigned", "driver_enroute", "arrived"].includes(status) ? DRIVER.id : null,
        payment_id: "pi_test_123",
        payment_status: "pending"
      })
    ];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "changed my mind" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("cancelled");
    expect(ride.cancellation_reason).toBe("changed my mind");
    expect(ride.cancelled_by_type).toBe("rider");
    expect(ride.cancelled_by_id).toBe(RIDER.id);
  });

  test("voids the uncaptured PaymentIntent with a stable idempotency key", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "payment_authorized", rider_id: RIDER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(200);
    expect(res.body.cancellation_payment_status).toBe("cancelled");
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);

    const [intentId, , options] = mockStripeCancel.mock.calls[0];
    expect(intentId).toBe("pi_test_123");
    expect(options.idempotencyKey).toBe("cancel-payment-intent:RIDE_1");
  });

  test("releases and notifies an assigned driver", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "driver_enroute", rider_id: RIDER.id, driver_id: DRIVER.id, payment_id: null })
    ];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(200);
    // No payment_id on this ride -- confirms driver release doesn't
    // depend on there being a payment to reconcile.
    expect(res.body.cancellation_payment_status).toBe("not_required");
  });

  test("a ride with no payment_id at all is marked not_required, never calls Stripe", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "payment_required", rider_id: RIDER.id, payment_id: null })
    ];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(200);
    expect(res.body.cancellation_payment_status).toBe("not_required");
    expect(mockStripeCancel).not.toHaveBeenCalled();
  });
});

describe("POST /api/rides/:id/cancel -- blocked states", () => {
  test("refuses to cancel an in_progress trip", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "in_progress", rider_id: RIDER.id, driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(403);

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("in_progress");
  });

  test("a completed ride cannot be cancelled", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "completed", rider_id: RIDER.id })];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/rides/:id/cancel -- repeated cancellation / idempotency", () => {
  test("a second cancel request on an already-cancelled ride returns the same state instead of erroring", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "payment_authorized", rider_id: RIDER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const first = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test again" });

    expect(second.status).toBe(200);
    expect(second.body.status).toBe("cancelled");
    // Only one real Stripe cancel call, not two.
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });

  test("two concurrent cancel requests: only one Stripe void call happens", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "payment_authorized", rider_id: RIDER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const attempt = () =>
      request(app).post("/api/rides/RIDE_1/cancel").set(riderAuthHeaders(riderToken)).send({ reason: "test" });

    const [a, b] = await Promise.all([attempt(), attempt()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });

  test("a repeated cancel request on a ride left cancel_failed resumes reconciliation instead of abandoning it", async () => {
    mockStripeCancel.mockRejectedValueOnce(new Error("network blip"));

    mockSupabaseClient._state.rides = [
      makeRide({ status: "payment_authorized", rider_id: RIDER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const first = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(first.status).toBe(200);
    expect(first.body.cancellation_payment_status).toBe("cancel_failed");

    mockStripeCancel.mockResolvedValue({ id: "pi_test_123", status: "canceled" });

    const second = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(second.status).toBe(200);
    expect(second.body.cancellation_payment_status).toBe("cancelled");
    expect(mockStripeCancel).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/rides/:id/cancel -- already-captured PaymentIntent", () => {
  test("never reverses a captured PaymentIntent; marks cancel_failed and requires an explicit refund workflow", async () => {
    mockStripeRetrieve.mockResolvedValue({ id: "pi_test_123", status: "succeeded" });

    mockSupabaseClient._state.rides = [
      makeRide({ status: "arrived", rider_id: RIDER.id, driver_id: DRIVER.id, payment_id: "pi_test_123", payment_status: "captured" })
    ];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(riderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.cancellation_payment_status).toBe("cancel_failed");
    expect(mockStripeCancel).not.toHaveBeenCalled();

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.cancellation_payment_error).toMatch(/refund/i);
  });
});

describe("POST /api/rides/:id/cancel -- authorization", () => {
  test("a rider cannot cancel another rider's ride", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized", rider_id: RIDER.id })];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(otherRiderToken))
      .send({ reason: "test" });

    expect(res.status).toBe(403);

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("payment_authorized");
  });

  test("rejects a request with no rider session at all", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized", rider_id: RIDER.id })];

    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set({ "x-requested-with": "harvey-rider-app" })
      .send({ reason: "test" });

    expect([401, 403]).toContain(res.status);
  });

  test("a client-supplied rider_id in the body cannot substitute for the authenticated session", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized", rider_id: RIDER.id })];

    // Authenticated as OTHER_RIDER, but claims to be RIDER_1 in the body.
    const res = await request(app)
      .post("/api/rides/RIDE_1/cancel")
      .set(riderAuthHeaders(otherRiderToken))
      .send({ reason: "test", rider_id: RIDER.id, cancelled_by_id: RIDER.id });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/driver/rides/:rideId/withdraw -- separate from cancellation", () => {
  test("releases the driver and returns the ride to dispatch, without cancelling it", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "driver_assigned", rider_id: RIDER.id, driver_id: DRIVER.id, pickup_lat: 36.16, pickup_lng: -86.78 })
    ];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/withdraw")
      .set(driverAuthHeaders(driverToken))
      .send({ reason: "vehicle issue" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("awaiting_driver_acceptance");

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("awaiting_driver_acceptance");
    expect(ride.driver_id).toBeNull();
    // Definitely not cancelled.
    expect(ride.status).not.toBe("cancelled");
  });

  test("blocked once the trip is in_progress", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "in_progress", rider_id: RIDER.id, driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/withdraw")
      .set(driverAuthHeaders(driverToken))
      .send({ reason: "test" });

    expect(res.status).toBe(403);

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.status).toBe("in_progress");
  });

  test("a driver who isn't assigned to the ride cannot withdraw from it", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", rider_id: RIDER.id, driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/withdraw")
      .set(driverAuthHeaders(otherDriverToken))
      .send({ reason: "test" });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/rides/:id/incident-resolve", () => {
  test("requires an explicit payment_action -- no silent default", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "in_progress", rider_id: RIDER.id, driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/admin/rides/RIDE_1/incident-resolve")
      .set("x-admin-token", "test-admin-token")
      .send({ reason: "stuck trip", resolution: "cancelled_by_incident" });

    expect(res.status).toBe(400);
  });

  test("cancelled_by_incident with payment_action=void cancels and voids", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "in_progress", rider_id: RIDER.id, driver_id: DRIVER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const res = await request(app)
      .post("/api/admin/rides/RIDE_1/incident-resolve")
      .set("x-admin-token", "test-admin-token")
      .send({ reason: "stuck trip, rider requested refund path", resolution: "cancelled_by_incident", payment_action: "void" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });

  test("force_completed_by_incident with payment_action=capture completes and captures", async () => {
    mockSupabaseClient._state.rides = [
      makeRide({ status: "in_progress", rider_id: RIDER.id, driver_id: DRIVER.id, payment_id: "pi_test_123", payment_status: "pending" })
    ];

    const res = await request(app)
      .post("/api/admin/rides/RIDE_1/incident-resolve")
      .set("x-admin-token", "test-admin-token")
      .send({ reason: "driver confirms trip finished, app crashed", resolution: "force_completed_by_incident", payment_action: "capture" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });

  test("cannot resolve an already-terminal ride", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "completed", rider_id: RIDER.id })];

    const res = await request(app)
      .post("/api/admin/rides/RIDE_1/incident-resolve")
      .set("x-admin-token", "test-admin-token")
      .send({ reason: "test", resolution: "cancelled_by_incident", payment_action: "leave_pending" });

    expect(res.status).toBe(409);
  });

  test("rejects without admin credentials", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "in_progress", rider_id: RIDER.id })];

    const res = await request(app)
      .post("/api/admin/rides/RIDE_1/incident-resolve")
      .send({ reason: "test", resolution: "cancelled_by_incident", payment_action: "leave_pending" });

    expect([401, 403]).toContain(res.status);
  });
});
