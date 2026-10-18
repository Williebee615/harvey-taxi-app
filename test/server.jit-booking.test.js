// Just-in-Time rider booking (owner decision 2026-10-18, Option A), over
// real HTTP via supertest. Twilio is an in-memory fake (no SMS is sent)
// and Supabase is test/fakeSupabase.
//
// - Off by default: the new sign-up routes answer 404 and the booking
//   checks are unchanged (email still required).
// - On: a phone number and a texted code create or sign in the rider;
//   the owner's rule approves them, with an audit record each time.
// - Staff can suspend (booking refused, never re-approved by the rule)
//   and reinstate, with a reason, audited.

const BASE_ENV = {
  NODE_ENV: "test",
  HARVEY_ISOLATED_TEST: "1",
  API_RATE_LIMIT_PER_MINUTE: "100000",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RIDER_SESSION_SECRET: "test-rider-session-secret",
  DRIVER_SESSION_SECRET: "test-driver-session-secret",
  RIDE_QUOTE_SECRET: "test-ride-quote-secret",
  ADMIN_API_TOKEN: "test-admin-token",
  // Matches production as checked 2026-10-18 (/api/config/public:
  // persona_enabled false). With Persona on, riders would need it too.
  ENABLE_PERSONA: "false",
  ENABLE_REAL_SMS: "true",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_VERIFY_SERVICE_SID: "VAtest00000000000000000000000000",
  TWILIO_FROM_NUMBER: "+15005550006"
};

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

jest.setTimeout(30_000);

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => new Proxy({}, { get: (_target, key) => mockSupabaseClient && mockSupabaseClient[key] })
}));

const mockTwilio = { sends: [], checks: [], checkStatus: "approved" };
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: {
          create: async (params) => {
            mockTwilio.sends.push(params);
            return { sid: "VEtest", status: "pending" };
          }
        },
        verificationChecks: {
          create: async (params) => {
            mockTwilio.checks.push(params);
            return { status: mockTwilio.checkStatus };
          }
        }
      })
    },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
);

let app;
beforeAll(() => {
  const saved = { ...process.env };
  Object.assign(process.env, BASE_ENV);
  jest.isolateModules(() => {
    app = require("../server").app;
  });
  process.env = saved;
});

const RIDER_HEADER = ["X-Requested-With", "harvey-rider-app"];
const admin = (r) => r.set("x-admin-token", "test-admin-token");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function seed({ jit = false, riders = [] } = {}) {
  mockTwilio.sends = [];
  mockTwilio.checks = [];
  mockTwilio.checkStatus = "approved";
  mockSupabaseClient = createFakeSupabase({
    riders,
    audit_logs: [],
    system_flags: jit ? [{ key: "jit_booking_enabled", value: "true" }] : []
  });
  return mockSupabaseClient;
}

const audits = (db, action) => db._state.audit_logs.filter((a) => a.action === action);

function pendingRider(overrides = {}) {
  return {
    id: "RIDER_EXISTING",
    first_name: "Dana",
    last_name: "Lee",
    email: "dana@example.test",
    phone: "6155550123",
    status: "pending_verification",
    approval_status: "pending",
    email_verified: false,
    sms_verified: false,
    access_revoked: false,
    ...overrides
  };
}

describe("off by default", () => {
  test("config reports off; the sign-up routes answer 404 and send nothing", async () => {
    seed();
    expect((await request(app).get("/api/rider/jit-config")).body).toMatchObject({ enabled: false });
    const start = await request(app).post("/api/rider/quick/start").set(...RIDER_HEADER).send({ phone: "6155550199" });
    expect(start.status).toBe(404);
    const verify = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550199", code: "123456", first_name: "Ana" });
    expect(verify.status).toBe(404);
    expect(mockTwilio.sends).toHaveLength(0);
    expect(mockTwilio.checks).toHaveLength(0);
  });

  test("booking checks are unchanged: an unverified email still blocks", async () => {
    seed({ riders: [pendingRider({ status: "active", approval_status: "approved", sms_verified: true })] });
    const res = await request(app).get("/api/riders/RIDER_EXISTING/readiness");
    expect(res.body).toMatchObject({ ready: false });
    expect(res.body.checks).toMatchObject({ email_verified: false, phone_verified: true });
  });

  test("ordinary phone sign-in does not auto-approve", async () => {
    const db = seed({ riders: [pendingRider()] });
    const res = await request(app).post("/api/rider/session/verify").set(...RIDER_HEADER).send({ phone: "6155550123", code: "123456" });
    expect(res.status).toBe(200);
    await flush();
    expect(db._state.riders[0]).toMatchObject({ approval_status: "pending", sms_verified: true });
    expect(audits(db, "rider_auto_approved")).toHaveLength(0);
  });
});

describe("on: phone-first sign-up at Confirm Ride", () => {
  test("start texts a code to any valid US number, needs the rider-app header, and refuses a bad number", async () => {
    seed({ jit: true });
    expect((await request(app).get("/api/rider/jit-config")).body).toMatchObject({ enabled: true });

    const noHeader = await request(app).post("/api/rider/quick/start").send({ phone: "6155550199" });
    expect(noHeader.status).toBe(403);

    const bad = await request(app).post("/api/rider/quick/start").set(...RIDER_HEADER).send({ phone: "12345" });
    expect(bad.status).toBe(400);

    const ok = await request(app).post("/api/rider/quick/start").set(...RIDER_HEADER).send({ phone: "(615) 555-0199" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sent: true });
    expect(mockTwilio.sends).toEqual([{ to: "+16155550199", channel: "sms" }]);
  });

  test("a new number with the right code creates an approved rider, signs them in and audits the rule", async () => {
    const db = seed({ jit: true });
    const res = await request(app)
      .post("/api/rider/quick/verify")
      .set(...RIDER_HEADER)
      .send({ phone: "615-555-0199", code: "123456", first_name: "  Ana " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, suspended: false });
    expect(res.headers["set-cookie"].join(";")).toMatch(/HttpOnly/i);
    expect(mockTwilio.checks).toEqual([{ to: "+16155550199", code: "123456" }]);

    expect(db._state.riders).toHaveLength(1);
    const rider = db._state.riders[0];
    expect(rider).toMatchObject({
      id: res.body.rider_id,
      first_name: "Ana",
      email: null,
      phone: "6155550199",
      status: "active",
      approval_status: "approved",
      sms_verified: true,
      email_verified: false
    });

    await flush();
    const [approval] = audits(db, "rider_auto_approved");
    expect(approval).toMatchObject({ actor_type: "system", entity_id: rider.id });
    expect(approval.metadata).toMatchObject({ rule: "phone_verified", set_by: "owner", decision_date: "2026-10-18" });
    expect(audits(db, "rider_signup_created")[0].metadata).toMatchObject({ flow: "jit_booking" });

    // Option A: phone verified is enough to book; email is not required.
    const readiness = await request(app).get(`/api/riders/${rider.id}/readiness`);
    expect(readiness.body).toMatchObject({ ready: true });

    // The session cookie works for the signed-in bootstrap.
    const session = await request(app).get("/api/rider/session").set("Cookie", res.headers["set-cookie"]);
    expect(session.status).toBe(200);
    expect(session.body.rider_id).toBe(rider.id);
  });

  test("a wrong code creates nothing and signs nobody in", async () => {
    const db = seed({ jit: true });
    mockTwilio.checkStatus = "pending";
    const res = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550199", code: "000000", first_name: "Ana" });
    expect(res.status).toBe(400);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db._state.riders).toHaveLength(0);
  });

  test("a new number without a usable first name is refused before any account is made", async () => {
    const db = seed({ jit: true });
    const res = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550199", code: "123456", first_name: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/first name/i);
    expect(db._state.riders).toHaveLength(0);
  });

  test("an existing pending rider is signed in and approved by the rule (name kept)", async () => {
    const db = seed({ jit: true, riders: [pendingRider()] });
    const res = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550123", code: "123456", first_name: "Someone Else" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rider_id: "RIDER_EXISTING", created: false });
    expect(db._state.riders).toHaveLength(1);
    expect(db._state.riders[0]).toMatchObject({ first_name: "Dana", status: "active", approval_status: "approved", sms_verified: true });
    await flush();
    expect(audits(db, "rider_auto_approved")[0].metadata).toMatchObject({ previous_approval_status: "pending" });
  });

  test("ordinary phone sign-in also applies the rule while the switch is on", async () => {
    const db = seed({ jit: true, riders: [pendingRider()] });
    const res = await request(app).post("/api/rider/session/verify").set(...RIDER_HEADER).send({ phone: "6155550123", code: "123456" });
    expect(res.status).toBe(200);
    expect(db._state.riders[0]).toMatchObject({ approval_status: "approved", status: "active" });
  });

  test("two active riders sharing the number: nobody is signed in or created", async () => {
    const db = seed({ jit: true, riders: [pendingRider({ id: "R_A" }), pendingRider({ id: "R_B" })] });
    const res = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550123", code: "123456", first_name: "Ana" });
    expect(res.status).toBe(409);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db._state.riders).toHaveLength(2);
  });

  test("a suspended rider can sign in but is never re-approved and cannot book", async () => {
    const db = seed({
      jit: true,
      riders: [pendingRider({ status: "suspended", approval_status: "suspended", is_blocked: true, sms_verified: true })]
    });
    const res = await request(app).post("/api/rider/quick/verify").set(...RIDER_HEADER).send({ phone: "6155550123", code: "123456" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suspended: true });
    expect(db._state.riders[0].approval_status).toBe("suspended");
    await flush();
    expect(audits(db, "rider_auto_approved")).toHaveLength(0);

    const readiness = await request(app).get("/api/riders/RIDER_EXISTING/readiness");
    expect(readiness.body).toMatchObject({ ready: false, reason: expect.stringMatching(/suspended/) });
  });
});

describe("staff suspend and reinstate", () => {
  test("both need an admin and a reason", async () => {
    const db = seed({ riders: [pendingRider({ status: "active", approval_status: "approved", sms_verified: true })] });
    const anon = await request(app).post("/api/admin/riders/RIDER_EXISTING/suspend").send({ reason: "Safety report" });
    expect(anon.status).toBe(401);
    const noReason = await admin(request(app).post("/api/admin/riders/RIDER_EXISTING/suspend")).send({ reason: "x" });
    expect(noReason.status).toBe(400);
    const missing = await admin(request(app).post("/api/admin/riders/NOPE/suspend")).send({ reason: "Safety report" });
    expect(missing.status).toBe(404);
    expect(db._state.riders[0].approval_status).toBe("approved");
  });

  test("suspend blocks booking; reinstate restores it; both are audited with the reason", async () => {
    const db = seed({ jit: true, riders: [pendingRider({ status: "active", approval_status: "approved", sms_verified: true })] });

    const suspend = await admin(request(app).post("/api/admin/riders/RIDER_EXISTING/suspend")).send({ reason: "Safety report under review" });
    expect(suspend.status).toBe(200);
    expect(db._state.riders[0]).toMatchObject({ status: "suspended", approval_status: "suspended", is_blocked: true });
    expect((await request(app).get("/api/riders/RIDER_EXISTING/readiness")).body).toMatchObject({ ready: false });

    const reinstate = await admin(request(app).post("/api/admin/riders/RIDER_EXISTING/reinstate")).send({ reason: "Review closed" });
    expect(reinstate.status).toBe(200);
    expect(db._state.riders[0]).toMatchObject({ status: "active", approval_status: "approved", is_blocked: false });
    expect((await request(app).get("/api/riders/RIDER_EXISTING/readiness")).body).toMatchObject({ ready: true });

    await flush();
    expect(audits(db, "rider_suspended")[0]).toMatchObject({ actor_type: "admin", entity_id: "RIDER_EXISTING" });
    expect(audits(db, "rider_suspended")[0].metadata).toMatchObject({ reason: "Safety report under review", previous_approval_status: "approved" });
    expect(audits(db, "rider_reinstated")[0].metadata).toMatchObject({ reason: "Review closed", previous_approval_status: "suspended" });
  });

  test("the switch itself is admin-only and audited", async () => {
    const db = seed();
    expect((await request(app).post("/api/admin/system/enable-jit-booking")).status).toBe(401);
    const on = await admin(request(app).post("/api/admin/system/enable-jit-booking")).send({ reason: "test" });
    expect(on.body).toMatchObject({ jit_booking_enabled: true });
    expect((await request(app).get("/api/rider/jit-config")).body).toMatchObject({ enabled: true });
    const off = await admin(request(app).post("/api/admin/system/disable-jit-booking"));
    expect(off.body).toMatchObject({ jit_booking_enabled: false });
    expect((await request(app).get("/api/rider/jit-config")).body).toMatchObject({ enabled: false });
    await flush();
    expect(audits(db, "jit_booking_enabled")).toHaveLength(1);
    expect(audits(db, "jit_booking_disabled")).toHaveLength(1);
  });
});
