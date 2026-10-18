// Security fix (owner decision 2026-10-18): POST /api/push/subscribe ties a
// browser's push subscription to the signed-in rider or driver. Before,
// it took owner_type/owner_id from the request body, so anyone could
// subscribe a browser to another rider's ride updates or a driver's
// offers.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.VAPID_PUBLIC_KEY = "test-vapid-public";
process.env.VAPID_PRIVATE_KEY = "test-vapid-private";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, riderAuthHeaders, signTestRiderToken, driverAuthHeaders, signTestDriverToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));
jest.mock("web-push", () => ({ setVapidDetails: () => {}, sendNotification: async () => {} }));

const request = require("supertest");

jest.setTimeout(30_000);

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
    riders: [makeRider({ id: "RIDER_1" }), makeRider({ id: "RIDER_VICTIM", email: "v@example.test", phone: "+16155550177" })],
    drivers: [makeDriver({ id: "DRIVER_1" }), makeDriver({ id: "DRIVER_VICTIM", email: "dv@example.test", phone: "+16155550188" })],
    push_subscriptions: []
  });
});

const subscription = (n = 1) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: "key", auth: "auth" } });
const saved = () => mockSupabaseClient._state.push_subscriptions;

test("no session: a rider subscription is refused (401) and nothing is saved", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .send({ owner_type: "rider", owner_id: "RIDER_VICTIM", subscription: subscription() });
  expect(res.status).toBe(401);
  expect(saved()).toHaveLength(0);
});

test("a signed-in rider is subscribed as themselves, whatever owner_id says", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .set(riderAuthHeaders(signTestRiderToken("RIDER_1")))
    .send({ owner_type: "rider", owner_id: "RIDER_VICTIM", subscription: subscription() });
  expect(res.status).toBe(200);
  expect(saved()).toHaveLength(1);
  expect(saved()[0]).toMatchObject({ owner_type: "rider", owner_id: "RIDER_1", endpoint: "https://push.example.test/1" });
});

test("no driver token: a driver subscription is refused and nothing is saved", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .send({ owner_type: "driver", owner_id: "DRIVER_VICTIM", subscription: subscription() });
  expect([401, 403]).toContain(res.status);
  expect(saved()).toHaveLength(0);
});

test("a signed-in driver is subscribed as themselves, whatever owner_id says", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .set(driverAuthHeaders(signTestDriverToken("DRIVER_1")))
    .send({ owner_type: "driver", owner_id: "DRIVER_VICTIM", subscription: subscription(2) });
  expect(res.status).toBe(200);
  expect(saved()[0]).toMatchObject({ owner_type: "driver", owner_id: "DRIVER_1" });
});

test("a rider session can't register as a driver", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .set(riderAuthHeaders(signTestRiderToken("RIDER_1")))
    .send({ owner_type: "driver", owner_id: "DRIVER_VICTIM", subscription: subscription(3) });
  expect([401, 403]).toContain(res.status);
  expect(saved()).toHaveLength(0);
});

test("an admin token can't subscribe on a driver's behalf", async () => {
  const res = await request(app)
    .post("/api/push/subscribe")
    .set("x-admin-token", "test-admin-token")
    .send({ owner_type: "driver", driver_id: "DRIVER_VICTIM", owner_id: "DRIVER_VICTIM", subscription: subscription(4) });
  expect([401, 403]).toContain(res.status);
  expect(saved()).toHaveLength(0);
});
