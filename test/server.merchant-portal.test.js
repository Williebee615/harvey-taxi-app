// Merchant portal phase 1b: store sign-in (texted code via a fake Twilio
// Verify; nothing is sent) and store hours. Fixture data only.
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
const mockTwilio = { sends: [], checks: [], checkStatus: "approved" };
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: { services: () => ({
      verifications: { create: async (p) => { mockTwilio.sends.push(p); return { status: "pending" }; } },
      verificationChecks: { create: async (p) => { mockTwilio.checks.push(p); return { status: mockTwilio.checkStatus }; } }
    }) },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
);

const HDR = { "X-Requested-With": "harvey-merchant-portal" };
const admin = (r) => r.set("x-admin-token", "test-admin-token");
let app;
// Each test gets its own caller address so the per-address limits don't carry over.
let ip = 0;
const from = () => `198.51.100.${++ip}`;

function seed(status = "approved") {
  mockClient = createFakeSupabase(
    {
      merchants: [{ id: "M1", business_name: "TEST Fixture Grocer", category: "grocery", address_line: "100 Test Ave", city: "Nashville", postal_code: "37203", contact_name: "Test Owner", contact_phone: "+16155550100", contact_email: "o@example.test", status, created_at: "2026-10-17T00:00:00Z" }],
      merchant_users: [],
      merchant_hours: [],
      audit_logs: []
    },
    {
      uniqueColumns: { merchant_users: ["phone"] },
      rpc: {
        bump_merchant_user_session_version: (args, state) => {
          const u = state.merchant_users.find((x) => x.id === args.p_user_id);
          if (u) u.session_version += 1;
          return { data: u ? u.session_version : null, error: null };
        }
      }
    }
  );
}

beforeAll(() => {
  seed();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  PHONE = `61555501${String(++phoneN).slice(-2)}`;
  seed();
  mockTwilio.sends = [];
  mockTwilio.checks = [];
  mockTwilio.checkStatus = "approved";
});

// Each test uses its own phone: the real per-phone code limit (3 per 10
// minutes) applies across tests.
let phoneN = 100;
let PHONE = "6155550100";
const giveAccess = (phone = PHONE) => admin(request(app).post("/api/admin/merchants/M1/users")).send({ phone, name: "Test Owner" });
async function signIn(phone = PHONE) {
  const a = from();
  await request(app).post("/api/merchant/session/start").set(HDR).set("x-forwarded-for", a).send({ phone });
  const res = await request(app).post("/api/merchant/session/verify").set(HDR).set("x-forwarded-for", a).send({ phone, code: "123456" });
  return { res, cookie: (res.headers["set-cookie"] || []).find((c) => c.startsWith("harvey_merchant_session=")) };
}
const week = () => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, closed: d === 0, opens_at: d === 0 ? null : "09:00", closes_at: d === 0 ? null : "21:00" }));

describe("admin gives sign-in access", () => {
  test("only to an approved store, and one phone per person", async () => {
    expect((await giveAccess()).status).toBe(201);
    expect(mockClient._state.merchant_users[0]).toMatchObject({ merchant_id: "M1", phone: `+1${PHONE}`, status: "active", session_version: 0, created_by: expect.any(String) });
    expect((await giveAccess()).status).toBe(409);
    seed("pending");
    expect((await giveAccess()).status).toBe(409);
    expect((await request(app).post("/api/admin/merchants/M1/users").send({ phone: PHONE, name: "X" })).status).toBe(401);
  });
});

describe("store sign-in", () => {
  test("a set-up phone gets a code; an unknown phone gets the same reply and no text", async () => {
    await giveAccess();
    const unknown = await request(app).post("/api/merchant/session/start").set(HDR).set("x-forwarded-for", from()).send({ phone: "6155550299" });
    expect(unknown.body).toMatchObject({ sent: true });
    expect(mockTwilio.sends).toEqual([]);
    const known = await request(app).post("/api/merchant/session/start").set(HDR).set("x-forwarded-for", from()).send({ phone: PHONE });
    expect(known.body).toMatchObject({ sent: true });
    expect(mockTwilio.sends).toEqual([{ to: `+1${PHONE}`, channel: "sms" }]);
  });

  test("the right code signs in with an HttpOnly cookie; a wrong code doesn't", async () => {
    await giveAccess();
    mockTwilio.checkStatus = "pending";
    expect((await signIn()).res.status).toBe(400);
    mockTwilio.checkStatus = "approved";
    const { res, cookie } = await signIn();
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  test("requests without the portal header are refused", async () => {
    expect((await request(app).post("/api/merchant/session/start").set("x-forwarded-for", from()).send({ phone: PHONE })).status).toBe(403);
  });
});

describe("signed-in store", () => {
  test("sees its store and saves its hours; bad hours are refused", async () => {
    await giveAccess();
    const { cookie } = await signIn();
    const me = await request(app).get("/api/merchant/me").set(HDR).set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.store).toMatchObject({ id: "M1", business_name: "TEST Fixture Grocer" });
    expect(me.body.store.contact_email).toBeUndefined();

    const save = await request(app).put("/api/merchant/hours").set(HDR).set("Cookie", cookie).send({ days: week() });
    expect(save.status).toBe(200);
    expect(mockClient._state.merchant_hours).toHaveLength(7);
    // Saving again updates the same seven rows.
    await request(app).put("/api/merchant/hours").set(HDR).set("Cookie", cookie).send({ days: week() });
    expect(mockClient._state.merchant_hours).toHaveLength(7);
    expect(mockClient._state.audit_logs.some((a) => a.action === "merchant_hours_updated")).toBe(true);

    const bad = week();
    bad[2] = { day_of_week: 2, closed: false, opens_at: "22:00", closes_at: "02:00" };
    expect((await request(app).put("/api/merchant/hours").set(HDR).set("Cookie", cookie).send({ days: bad })).status).toBe(400);
  });

  test("signing out ends the session; the old cookie stops working", async () => {
    await giveAccess();
    const { cookie } = await signIn();
    expect((await request(app).post("/api/merchant/session/logout").set(HDR).set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/merchant/me").set(HDR).set("Cookie", cookie)).status).toBe(401);
  });

  test("removing access ends the session", async () => {
    await giveAccess();
    const { cookie } = await signIn();
    const userId = mockClient._state.merchant_users[0].id;
    expect((await admin(request(app).post(`/api/admin/merchant-users/${userId}/disable`)).send({})).status).toBe(200);
    expect((await request(app).get("/api/merchant/me").set(HDR).set("Cookie", cookie)).status).toBe(401);
  });

  test("a suspended store can't use the portal, even with a valid session", async () => {
    await giveAccess();
    const { cookie } = await signIn();
    mockClient._state.merchants[0].status = "suspended";
    expect((await request(app).get("/api/merchant/me").set(HDR).set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).put("/api/merchant/hours").set(HDR).set("Cookie", cookie).send({ days: week() })).status).toBe(403);
  });

  test("no cookie, or a forged one, is refused", async () => {
    expect((await request(app).get("/api/merchant/me").set(HDR)).status).toBe(401);
    expect((await request(app).get("/api/merchant/me").set(HDR).set("Cookie", "harvey_merchant_session=abc.def")).status).toBe(401);
  });
});

test("the admin list shows each store's sign-in people", async () => {
  await giveAccess();
  const res = await admin(request(app).get("/api/admin/merchants"));
  expect(res.body.merchants[0].sign_in_users).toEqual([expect.objectContaining({ name: "Test Owner", phone: `+1${PHONE}`, status: "active" })]);
});
