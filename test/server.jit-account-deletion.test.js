// Account deletion for a phone-only rider: the account Just-in-Time
// booking creates (first name + phone, no email). Owner requirement
// 2026-10-18: confirm in-app deletion works for these accounts before the
// jit_booking_enabled switch is ever turned on. Twilio is a fake.

const crypto = require("crypto");

process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PERSONA = "false";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

jest.setTimeout(30_000);

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => new Proxy({}, { get: (_target, key) => mockSupabaseClient && mockSupabaseClient[key] })
}));
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: { create: async () => ({ sid: "VEtest", status: "pending" }) },
        verificationChecks: { create: async () => ({ status: "approved" }) }
      })
    },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
);

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

beforeEach(() => {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [],
    rides: [],
    audit_logs: [],
    deletion_requests: [],
    verification_codes: [],
    system_flags: [{ key: "jit_booking_enabled", value: "true" }]
  });
});

const RIDER_HEADER = { "x-requested-with": "harvey-rider-app" };
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const riders = () => mockSupabaseClient._state.riders;

async function signUpByPhone(phone = "6155550199", firstName = "Ana") {
  const res = await request(app)
    .post("/api/rider/quick/verify")
    .set(RIDER_HEADER)
    .send({ phone, code: "123456", first_name: firstName });
  expect(res.status).toBe(200);
  expect(res.body.created).toBe(true);
  return { riderId: res.body.rider_id, cookie: res.headers["set-cookie"] };
}

function deletionCode(destination, code = "246810") {
  mockSupabaseClient._state.verification_codes.push({
    id: `VERIFY_${destination}`,
    channel: "sms",
    destination,
    purpose: "account_deletion",
    user_type: "rider",
    code_hash: sha256(code),
    attempts: 0,
    max_attempts: 5,
    used_at: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString()
  });
  return code;
}

test("signed in (the Just-in-Time path): a phone-only rider deletes their account from Settings", async () => {
  const { riderId, cookie } = await signUpByPhone();
  expect(riders()[0]).toMatchObject({ id: riderId, email: null, phone: "6155550199" });

  const res = await request(app)
    .post("/api/account/rider/delete")
    .set(RIDER_HEADER)
    .set("Cookie", cookie)
    .send({ confirm: "DELETE", reason: "test" });
  expect(res.status).toBe(200);
  expect(res.body.deleted).toBe(true);
  expect(res.headers["set-cookie"].join(";")).toMatch(/harvey_rider_session=;/);

  // Personal data removed and access revoked.
  expect(riders()[0]).toMatchObject({ first_name: "Deleted", last_name: "User", phone: null, access_revoked: true, status: "deleted" });
  expect(riders()[0].deleted_at).toBeTruthy();
  expect(mockSupabaseClient._state.deletion_requests[0]).toMatchObject({ user_type: "rider", user_id: riderId, status: "completed" });

  // The old session no longer works, and it can't book.
  const session = await request(app).get("/api/rider/session").set(RIDER_HEADER).set("Cookie", cookie);
  expect([401, 403]).toContain(session.status);
  const ride = await request(app).post("/api/rides/request").set(RIDER_HEADER).set("Cookie", cookie).send({ pickup: "a", destination: "b" });
  expect([401, 403]).toContain(ride.status);
});

test("signing up again with the same number afterwards creates a new, separate account", async () => {
  const first = await signUpByPhone();
  await request(app).post("/api/account/rider/delete").set(RIDER_HEADER).set("Cookie", first.cookie).send({ confirm: "DELETE" });
  const second = await signUpByPhone("6155550199", "Ana");
  expect(second.riderId).not.toBe(first.riderId);
  expect(riders()).toHaveLength(2);
  expect(riders().find((r) => r.id === first.riderId).first_name).toBe("Deleted");
});

test.each([
  ["10 digits", "6155550199"],
  ["formatted", "(615) 555-0199"],
  ["with +1", "+1 615 555 0199"]
])("signed out: deletion by texted code finds the phone-only account (%s)", async (_label, typed) => {
  const { riderId } = await signUpByPhone();
  // The code is stored for the number as the Settings page sends it.
  const code = deletionCode(String(typed).replace(/[^\d+]/g, ""));
  const res = await request(app).post("/api/account/rider/delete").send({ phone: typed, code });
  expect(res.status).toBe(200);
  expect(res.body.deleted).toBe(true);
  expect(riders().find((r) => r.id === riderId)).toMatchObject({ first_name: "Deleted", phone: null, access_revoked: true });
});
