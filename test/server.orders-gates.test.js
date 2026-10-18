// Ordering stays off unless ENABLE_MERCHANT_ORDERS is on AND Stripe uses
// test keys (merchant portal phase 3a, test mode only).
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";

const request = require("supertest");

// Each case loads a fresh copy of server.js (isolateModules); on a cold Jest
// cache that alone can pass the 5-second default.
jest.setTimeout(30_000);
const { createFakeSupabase } = require("./fakeSupabase");
const { signRiderSession } = require("../lib/riderAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));
const mockCreate = jest.fn();
jest.mock("stripe", () => function MockStripe() { return { paymentIntents: { create: mockCreate } }; });

const RIDER = { id: "RIDER_G", first_name: "Ana", session_version: 0, status: "active", approval_status: "approved", access_revoked: false, deleted_at: null };
const cookie = `harvey_rider_session=${signRiderSession({ riderId: RIDER.id, sessionVersion: 0, secret: "test-rider-session-secret", ttlHours: 1 })}`;

function loadApp(env) {
  let app;
  jest.isolateModules(() => {
    Object.assign(process.env, env);
    // eslint-disable-next-line global-require
    ({ app } = require("../server"));
  });
  return app;
}

beforeEach(() => {
  mockClient = createFakeSupabase({ riders: [{ ...RIDER }], orders: [], merchants: [] });
  mockCreate.mockReset();
});

test.each([
  ["the switch is off (the default)", { ENABLE_MERCHANT_ORDERS: "false", ORDERS_STRIPE_SECRET_KEY: "sk_test_x" }, /isn't available yet/],
  ["the orders key is a live key", { ENABLE_MERCHANT_ORDERS: "true", ORDERS_STRIPE_SECRET_KEY: "sk_live_x" }, /own Stripe test key/],
  ["there is no orders key, even with a test ride key", { ENABLE_MERCHANT_ORDERS: "true", ORDERS_STRIPE_SECRET_KEY: "", STRIPE_SECRET_KEY: "sk_test_rides" }, /own Stripe test key/]
])("checkout refuses when %s, before touching Stripe or the database", async (_label, env, message) => {
  const app = loadApp(env);
  const r = await request(app).post("/api/orders/checkout").set("x-requested-with", "harvey-rider-app").set("Cookie", cookie).send({ client_order_key: "gate-key-123", merchant_id: "M1", items: [] });
  expect(r.status).toBe(503);
  expect(r.body.error).toMatch(message);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockClient._state.orders).toEqual([]);
});
