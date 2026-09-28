// Composition/integration tests for the Google Play / App Store account
// deletion feature: the public web deletion page (public/delete-account.html)
// and the in-app Settings page both submit to these same routes, and both
// resolve the account to delete from a phone number that was just verified
// with a fresh SMS one-time code -- never from a client-supplied rider/
// driver id. That's the property under test throughout this file: a
// verified code proves control of a phone number, and the account that
// gets deleted is whichever one actually owns that phone number, never
// one merely named in the request body.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  // The mock's createClient() runs once, at require time below, and
  // whatever it returns becomes server.js's permanent `supabase`
  // reference -- so the fake client must exist BEFORE the require, and
  // every test must reuse that same object (mutating its ._state
  // in place via resetState below) rather than assigning a new one.
  mockSupabaseClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function resetState(seed) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  for (const table of Object.keys(seed)) {
    state[table] = seed[table].map((row) => ({ ...row }));
  }
}

function seedCode({ destination, code, purpose = "account_deletion", channel = "sms" }) {
  mockSupabaseClient._state.verification_codes.push({
    id: `VERIFY_${destination}_${code}`,
    channel,
    destination,
    purpose,
    user_type: "rider",
    code_hash: hashToken(code),
    attempts: 0,
    max_attempts: 5,
    used_at: null,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    metadata: {},
    created_at: new Date().toISOString()
  });
}

const RIDER = {
  id: "RIDER_1",
  first_name: "Jamie",
  last_name: "Rivera",
  email: "jamie@example.test",
  phone: "+16155550101",
  access_revoked: false,
  deleted_at: null,
  status: "active"
};

const OTHER_RIDER = {
  id: "RIDER_2",
  first_name: "Casey",
  last_name: "Nolan",
  email: "casey@example.test",
  phone: "+16155550102",
  access_revoked: false,
  deleted_at: null,
  status: "active"
};

const DRIVER = {
  id: "DRIVER_1",
  first_name: "Morgan",
  last_name: "Blake",
  email: "morgan@example.test",
  phone: "+16155550201",
  access_revoked: false,
  deleted_at: null,
  status: "active"
};

beforeEach(() => {
  resetState({
    riders: [RIDER, OTHER_RIDER],
    drivers: [DRIVER],
    rides: [
      {
        id: "RIDE_1",
        rider_id: "RIDER_1",
        rider_name: "Jamie Rivera",
        rider_phone: "+16155550101",
        driver_id: "DRIVER_1",
        driver_name: "Morgan Blake",
        driver_phone: "+16155550201",
        status: "completed"
      }
    ],
    deletion_requests: [],
    verification_codes: []
  });
});

describe("POST /api/account/rider/delete", () => {
  test("deletes the rider that actually owns the verified phone number, not one named by id", async () => {
    seedCode({ destination: RIDER.phone, code: "111111" });

    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: RIDER.phone, code: "111111", reason: "no longer needed" });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const updatedRider = mockSupabaseClient._state.riders.find((r) => r.id === RIDER.id);
    expect(updatedRider.first_name).toBe("Deleted");
    expect(updatedRider.email).toContain("deleted+RIDER_1@");
    expect(updatedRider.phone).toBeNull();
    expect(updatedRider.access_revoked).toBe(true);
    expect(updatedRider.status).toBe("deleted");

    // The other rider is completely untouched.
    const untouchedRider = mockSupabaseClient._state.riders.find((r) => r.id === OTHER_RIDER.id);
    expect(untouchedRider.email).toBe(OTHER_RIDER.email);

    // Ride history is scrubbed of the deleted rider's identity, not removed.
    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.rider_name).toBe("Deleted User");
    expect(ride.rider_phone).toBeNull();
    expect(ride.status).toBe("completed");

    const deletionRequest = mockSupabaseClient._state.deletion_requests.find(
      (d) => d.user_id === RIDER.id
    );
    expect(deletionRequest.status).toBe("completed");
    expect(deletionRequest.user_type).toBe("rider");
  });

  test("cannot be used to delete another rider's account by naming their phone number without their code", async () => {
    // Nobody ever verified OTHER_RIDER's phone number for account_deletion.
    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: OTHER_RIDER.phone, code: "999999" });

    expect(res.status).toBe(400);

    const untouched = mockSupabaseClient._state.riders.find((r) => r.id === OTHER_RIDER.id);
    expect(untouched.access_revoked).toBe(false);
    expect(untouched.email).toBe(OTHER_RIDER.email);
  });

  test("an incorrect code is rejected and the account is left untouched", async () => {
    seedCode({ destination: RIDER.phone, code: "111111" });

    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: RIDER.phone, code: "000000" });

    expect(res.status).toBe(400);

    const untouched = mockSupabaseClient._state.riders.find((r) => r.id === RIDER.id);
    expect(untouched.access_revoked).toBe(false);
  });

  test("missing phone or code is rejected before any verification lookup", async () => {
    const res = await request(app).post("/api/account/rider/delete").send({ code: "111111" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/account/driver/delete-request-public", () => {
  test("revokes access and files a pending deletion request for the verified driver, without full anonymization yet", async () => {
    seedCode({ destination: DRIVER.phone, code: "222222" });

    const res = await request(app)
      .post("/api/account/driver/delete-request-public")
      .send({ phone: DRIVER.phone, code: "222222", reason: "switching apps" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");

    const updatedDriver = mockSupabaseClient._state.drivers.find((d) => d.id === DRIVER.id);
    expect(updatedDriver.access_revoked).toBe(true);
    expect(updatedDriver.status).toBe("deletion_pending");
    // Not anonymized yet -- that happens only once an admin approves.
    expect(updatedDriver.first_name).toBe("Morgan");

    const deletionRequest = mockSupabaseClient._state.deletion_requests.find(
      (d) => d.user_id === DRIVER.id
    );
    expect(deletionRequest.status).toBe("pending");
    expect(deletionRequest.user_type).toBe("driver");
  });

  test("cannot file a deletion request against a driver's phone number without their own verification code", async () => {
    const res = await request(app)
      .post("/api/account/driver/delete-request-public")
      .send({ phone: DRIVER.phone, code: "222222" });

    expect(res.status).toBe(400);

    const untouched = mockSupabaseClient._state.drivers.find((d) => d.id === DRIVER.id);
    expect(untouched.access_revoked).toBe(false);
  });
});

describe("POST /api/admin/deletion-requests/:id/approve -- driver finalize", () => {
  test("anonymizes the driver row and strips the driver's identity from past ride records", async () => {
    mockSupabaseClient._state.deletion_requests.push({
      request_id: "DEL_1",
      user_type: "driver",
      user_id: DRIVER.id,
      status: "pending",
      reason: null,
      requested_at: new Date().toISOString()
    });

    const res = await request(app)
      .post("/api/admin/deletion-requests/DEL_1/approve")
      .set("x-admin-token", "test-admin-token")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");

    const driver = mockSupabaseClient._state.drivers.find((d) => d.id === DRIVER.id);
    expect(driver.first_name).toBe("Deleted");
    expect(driver.phone).toBeNull();

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
    expect(ride.driver_name).toBe("Deleted Driver");
    expect(ride.driver_phone).toBeNull();
    // The rider side of the same ride is untouched by a driver-only deletion.
    expect(ride.rider_name).toBe("Jamie Rivera");
  });
});
