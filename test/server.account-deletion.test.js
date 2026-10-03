// In-app account deletion: real deletion for ordinary riders/drivers,
// a recorded-but-simulated deletion for designated App Review accounts
// (no SMS, account preserved), and identity never taken from a
// client-supplied id.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestRiderToken,
  signTestDriverToken,
  riderAuthHeaders,
  driverAuthHeaders
} = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

const RIDER = makeRider({ id: "RIDER_REAL", phone: "+16155550111", first_name: "Ann", last_name: "Lee" });
const OTHER_RIDER = makeRider({ id: "RIDER_OTHER", phone: "+16155550122", email: "other@example.test" });
const REVIEW_RIDER = makeRider({ id: "RIDER_REVIEW", phone: "+15555550100", is_review_account: true });
const DRIVER = makeDriver({ id: "DRIVER_REAL", phone: "+16155550133" });
const REVIEW_DRIVER = makeDriver({ id: "DRIVER_REVIEW", phone: "+15555550200", is_review_account: true });

let app;

function verificationRow(phone, code) {
  return {
    id: `VERIFY_${phone}`,
    channel: "sms",
    destination: phone,
    purpose: "account_deletion",
    user_type: "rider",
    code_hash: sha256(code),
    attempts: 0,
    max_attempts: 5,
    used_at: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString()
  };
}

function resetState(extra = {}) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [{ ...RIDER }, { ...OTHER_RIDER }, { ...REVIEW_RIDER }],
    drivers: [{ ...DRIVER }, { ...REVIEW_DRIVER }],
    rides: [
      makeRide({ id: "RIDE_A", rider_id: "RIDER_REAL", rider_name: "Ann Lee", rider_phone: RIDER.phone, driver_id: "DRIVER_REAL", driver_name: "Dee", driver_phone: DRIVER.phone })
    ],
    deletion_requests: [],
    verification_codes: [],
    audit_logs: [],
    system_flags: [{ key: "review_account_login_enabled", value: "true" }],
    ...extra
  });
}

const row = (table, id) => mockSupabaseClient._state[table].find((r) => r.id === id);
const audits = (action) => mockSupabaseClient._state.audit_logs.filter((a) => a.action === action);

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
});

beforeEach(() => resetState());

describe("rider deletion with a signed-in session", () => {
  test("requires typing DELETE", async () => {
    const res = await request(app)
      .post("/api/account/rider/delete")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_REAL")))
      .send({});
    expect(res.status).toBe(400);
    expect(row("riders", "RIDER_REAL").deleted_at).toBeFalsy();
  });

  test("deletes only the session's own account, ignoring any rider_id in the body", async () => {
    const res = await request(app)
      .post("/api/account/rider/delete")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_REAL")))
      .send({ confirm: "DELETE", rider_id: "RIDER_OTHER", reason: "done" });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const deleted = row("riders", "RIDER_REAL");
    expect(deleted.first_name).toBe("Deleted");
    expect(deleted.phone).toBeNull();
    expect(deleted.access_revoked).toBe(true);
    expect(row("riders", "RIDER_OTHER").deleted_at).toBeFalsy();

    const ride = row("rides", "RIDE_A");
    expect(ride.rider_name).toBe("Deleted User");
    expect(ride.rider_phone).toBeNull();

    expect(mockSupabaseClient._state.deletion_requests).toEqual([
      expect.objectContaining({ user_type: "rider", user_id: "RIDER_REAL", status: "completed" })
    ]);
    expect(audits("account_deleted")).toHaveLength(1);
    expect(String(res.headers["set-cookie"] || "")).toMatch(/harvey_rider_session=;/);
  });

  test("a deleted rider's session no longer works", async () => {
    const token = signTestRiderToken("RIDER_REAL");
    await request(app).post("/api/account/rider/delete").set(riderAuthHeaders(token)).send({ confirm: "DELETE" });
    const res = await request(app).get("/api/rider/session").set(riderAuthHeaders(token));
    expect(res.status).toBe(403);
  });
});

describe("rider deletion with an SMS code (no session)", () => {
  test("resolves the account from the verified phone, never from rider_id", async () => {
    resetState({ verification_codes: [verificationRow(OTHER_RIDER.phone, "123456")] });
    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: OTHER_RIDER.phone, code: "123456", rider_id: "RIDER_REAL" });
    expect(res.status).toBe(200);
    expect(row("riders", "RIDER_OTHER").first_name).toBe("Deleted");
    expect(row("riders", "RIDER_REAL").first_name).toBe("Ann");
  });

  test("a wrong code deletes nothing", async () => {
    resetState({ verification_codes: [verificationRow(RIDER.phone, "123456")] });
    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: RIDER.phone, code: "000000" });
    expect(res.status).toBe(400);
    expect(row("riders", "RIDER_REAL").deleted_at).toBeFalsy();
  });

  test("no session and no code is rejected", async () => {
    const res = await request(app).post("/api/account/rider/delete").send({ rider_id: "RIDER_REAL" });
    expect(res.status).toBe(400);
    expect(row("riders", "RIDER_REAL").deleted_at).toBeFalsy();
  });

  test("a phone shared by two accounts is refused", async () => {
    resetState({
      riders: [{ ...RIDER }, { ...OTHER_RIDER, phone: RIDER.phone }, { ...REVIEW_RIDER }],
      verification_codes: [verificationRow(RIDER.phone, "123456")]
    });
    const res = await request(app)
      .post("/api/account/rider/delete")
      .send({ phone: RIDER.phone, code: "123456" });
    expect(res.status).toBe(409);
    expect(row("riders", "RIDER_REAL").deleted_at).toBeFalsy();
    expect(row("riders", "RIDER_OTHER").deleted_at).toBeFalsy();
  });
});

describe("App Review rider account", () => {
  test("deletion is confirmed and recorded, the account is preserved, and no SMS is needed", async () => {
    const res = await request(app)
      .post("/api/account/rider/delete")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_REVIEW")))
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.deleted).toBe(false);
    expect(res.body.message).toMatch(/App Review mode/);
    expect(res.body.message).not.toMatch(/apple|google/i);

    const preserved = row("riders", "RIDER_REVIEW");
    expect(preserved.deleted_at).toBeFalsy();
    expect(preserved.access_revoked).toBe(false);
    expect(preserved.phone).toBe(REVIEW_RIDER.phone);

    expect(mockSupabaseClient._state.deletion_requests).toEqual([
      expect.objectContaining({ user_id: "RIDER_REVIEW", status: "review_simulated", reviewed_by: "app_review_simulation" })
    ]);
    expect(audits("account_deletion_review_simulated")).toHaveLength(1);
    expect(mockSupabaseClient._state.verification_codes).toHaveLength(0);

    const session = await request(app)
      .get("/api/rider/session")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_REVIEW")));
    expect(session.status).toBe(200);
  });
});

describe("driver deletion request", () => {
  test("records a pending request and revokes access", async () => {
    const res = await request(app)
      .post("/api/account/driver/delete-request")
      .set(driverAuthHeaders(signTestDriverToken("DRIVER_REAL")))
      .send({ reason: "retiring" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(row("drivers", "DRIVER_REAL").access_revoked).toBe(true);
    expect(row("drivers", "DRIVER_REAL").status).toBe("deletion_pending");
    expect(mockSupabaseClient._state.deletion_requests).toEqual([
      expect.objectContaining({ user_type: "driver", user_id: "DRIVER_REAL", status: "pending" })
    ]);
  });

  test("if the request cannot be recorded, the driver keeps access", async () => {
    const original = mockSupabaseClient.from.bind(mockSupabaseClient);
    const spy = jest.spyOn(mockSupabaseClient, "from").mockImplementation((table) => {
      if (table === "deletion_requests") {
        return { insert: async () => ({ data: null, error: { message: "relation does not exist" } }) };
      }
      return original(table);
    });
    try {
      const res = await request(app)
        .post("/api/account/driver/delete-request")
        .set(driverAuthHeaders(signTestDriverToken("DRIVER_REAL")))
        .send({});
      expect(res.status).toBe(500);
      expect(row("drivers", "DRIVER_REAL").access_revoked).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("admin credentials cannot request deletion on a driver's behalf", async () => {
    const res = await request(app)
      .post("/api/account/driver/delete-request")
      .set("x-admin-token", "test-admin-token")
      .send({ driver_id: "DRIVER_REAL" });
    expect([401, 403]).toContain(res.status);
    expect(row("drivers", "DRIVER_REAL").access_revoked).toBe(false);
  });

  test("App Review driver: simulated, recorded, access kept", async () => {
    const res = await request(app)
      .post("/api/account/driver/delete-request")
      .set(driverAuthHeaders(signTestDriverToken("DRIVER_REVIEW")))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.status).toBe("review_simulated");
    expect(row("drivers", "DRIVER_REVIEW").access_revoked).toBe(false);
    expect(row("drivers", "DRIVER_REVIEW").status).toBe("active");
    expect(audits("account_deletion_review_simulated")).toHaveLength(1);
  });

  test("admin approval anonymizes the driver and their ride snapshots", async () => {
    await request(app)
      .post("/api/account/driver/delete-request")
      .set(driverAuthHeaders(signTestDriverToken("DRIVER_REAL")))
      .send({});
    const requestId = mockSupabaseClient._state.deletion_requests[0].request_id;
    const res = await request(app)
      .post(`/api/admin/deletion-requests/${requestId}/approve`)
      .set("x-admin-token", "test-admin-token")
      .send({ admin_notes: "verified" });
    expect(res.status).toBe(200);
    expect(row("drivers", "DRIVER_REAL").first_name).toBe("Deleted");
    expect(row("rides", "RIDE_A").driver_name).toBe("Deleted Driver");
    expect(row("rides", "RIDE_A").driver_phone).toBeNull();
  });

  test("driver deletion also removes location, photo, addresses, license/plate numbers and push tokens", async () => {
    Object.assign(row("drivers", "DRIVER_REAL"), {
      online: true,
      current_lat: 36.16,
      current_lng: -86.78,
      last_location_at: new Date().toISOString(),
      photo_url: "https://example.test/p.jpg",
      home_address: "1 Home St",
      license_plate: "ABC123",
      drivers_license_number: "D1234567"
    });
    mockSupabaseClient._state.driver_push_tokens = [
      { token: "ExponentPushToken[deletemetoken1]", driver_id: "DRIVER_REAL", platform: "ios" },
      { token: "ExponentPushToken[keepthistoken2]", driver_id: "DRIVER_REVIEW", platform: "ios" }
    ];
    await request(app).post("/api/account/driver/delete-request").set(driverAuthHeaders(signTestDriverToken("DRIVER_REAL"))).send({});
    const requestId = mockSupabaseClient._state.deletion_requests[0].request_id;
    await request(app).post(`/api/admin/deletion-requests/${requestId}/approve`).set("x-admin-token", "test-admin-token").send({});
    expect(row("drivers", "DRIVER_REAL")).toMatchObject({
      online: false,
      current_lat: null,
      current_lng: null,
      last_location_at: null,
      photo_url: null,
      home_address: null,
      license_plate: null,
      drivers_license_number: null
    });
    expect(mockSupabaseClient._state.driver_push_tokens.map((t) => t.driver_id)).toEqual(["DRIVER_REVIEW"]);
  });
});
