// Composition/integration tests for the centralized ride-status
// transition table (lib/rideLifecycle.js) as wired into the driver-side
// transition routes and the narrowed admin status route. Exercises real
// HTTP via supertest against the actual Express app, with Supabase
// replaced by the in-memory fake.
//
// Central property under test: every status-changing route now goes
// through claimRideTransition() instead of an unconditional write, so a
// duplicate, backward, skipped, or wrong-actor transition is rejected
// with a real HTTP status and an audit record, not silently applied.

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
const { makeRider, makeDriver, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
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
  resetState({
    riders: [makeRider()],
    drivers: [DRIVER, OTHER_DRIVER],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    audit_logs: []
  });
});

describe("driver transition routes -- valid forward transitions", () => {
  test("enroute: driver_assigned -> driver_enroute", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("driver_enroute");
    expect(mockSupabaseClient._state.rides[0].status).toBe("driver_enroute");
    expect(mockSupabaseClient._state.rides[0].enroute_at).toBeTruthy();
  });

  test("arrived: driver_enroute -> arrived", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_enroute", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/arrived")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("arrived");
  });

  test("start: arrived -> in_progress", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "arrived", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/start")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
    expect(mockSupabaseClient._state.rides[0].trip_started_at).toBeTruthy();
  });
});

describe("driver transition routes -- rejected transitions", () => {
  test("rejects skipping a stage (driver_assigned -> arrived)", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/arrived")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.current_status).toBe("driver_assigned");
    // Nothing was written.
    expect(mockSupabaseClient._state.rides[0].status).toBe("driver_assigned");
  });

  test("rejects going backward (arrived -> driver_enroute)", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "arrived", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(409);
  });

  test("rejects re-applying the same transition on an already-completed ride (no reopening)", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "completed", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(409);
    expect(mockSupabaseClient._state.rides[0].status).toBe("completed");
  });

  test("rejects a duplicate call after the transition already happened", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const first = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(second.status).toBe(409);
    expect(second.body.current_status).toBe("driver_enroute");
  });

  test("returns 404 for a nonexistent ride", async () => {
    const res = await request(app)
      .post("/api/driver/rides/does-not-exist/enroute")
      .set(driverAuthHeaders(driverToken))
      .send({});

    expect(res.status).toBe(404);
  });
});

describe("driver transition routes -- unauthorized access", () => {
  test("a driver who is not assigned to the ride gets 403, not 500", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const res = await request(app)
      .post("/api/driver/rides/RIDE_1/enroute")
      .set(driverAuthHeaders(otherDriverToken))
      .send({});

    expect(res.status).toBe(403);
    expect(mockSupabaseClient._state.rides[0].status).toBe("driver_assigned");
  });

  test("no driver token at all is rejected", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned", driver_id: DRIVER.id })];

    const res = await request(app).post("/api/driver/rides/RIDE_1/enroute").send({});

    expect([401, 403]).toContain(res.status);
  });
});

describe("driver-missions.html retirement", () => {
  test("redirects to driver-dashboard.html instead of serving the old page", async () => {
    const res = await request(app).get("/driver-missions.html");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/driver-dashboard.html");
  });
});

describe("PATCH /api/admin/rides/:id/status -- narrowed scope", () => {
  test("allows the explicit unstick transition (payment_authorized -> failed) with a reason", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "failed", reason: "stuck, manually unsticking" });

    expect(res.status).toBe(200);
    expect(res.body.ride.status).toBe("failed");
  });

  test("requires a reason", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "failed" });

    expect(res.status).toBe(400);
  });

  test("refuses to set a ride to completed", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "in_progress" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "completed", reason: "trying to force-complete" });

    expect(res.status).toBe(409);
    expect(mockSupabaseClient._state.rides[0].status).toBe("in_progress");
  });

  test("refuses to set a ride to cancelled", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "driver_assigned" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "cancelled", reason: "trying to cancel via generic route" });

    expect(res.status).toBe(409);
  });

  test("refuses to mutate an already-completed ride at all", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "completed" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "failed", reason: "trying to touch a completed ride" });

    expect(res.status).toBe(409);
    expect(mockSupabaseClient._state.rides[0].status).toBe("completed");
  });

  test("refuses to mutate an already-cancelled ride at all", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "cancelled" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "failed", reason: "trying to touch a cancelled ride" });

    expect(res.status).toBe(409);
  });

  test("response is field-minimized, not the full ride row", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .set("x-admin-token", "test-admin-token")
      .send({ status: "failed", reason: "unstick" });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.ride).sort()).toEqual(
      ["dispatch_status", "driver_id", "id", "status", "updated_at"].sort()
    );
  });

  test("rejects without admin credentials", async () => {
    mockSupabaseClient._state.rides = [makeRide({ status: "payment_authorized" })];

    const res = await request(app)
      .patch("/api/admin/rides/RIDE_1/status")
      .send({ status: "failed", reason: "unstick" });

    expect([401, 403]).toContain(res.status);
  });
});
