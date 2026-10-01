// POST /api/rides/:id/authorize authorizes a ride exactly once.
//
// Regression: the route never looked at the ride's current status for a
// real (non-review) ride. Calling it again -- a retry, a second tab, a
// replayed request -- for a ride that was already authorized, dispatched
// or in progress re-ran verification, rewrote the ride back to
// payment_authorized and dispatched it a second time. These tests run the
// real route over supertest with Supabase replaced by the in-memory fake
// and Stripe's PaymentIntent API mocked.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const { makeRider, makeDriver, makeRide } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
const mockRetrieve = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      retrieve: (...args) => mockRetrieve(...args),
      update: (...args) => mockUpdate(...args)
    }
  }))
);

mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const PI = "pi_test_once";

function intent(overrides = {}) {
  return {
    id: PI,
    status: "requires_capture",
    currency: "usd",
    amount: 2000,
    metadata: { rider_id: "RIDER_1" },
    ...overrides
  };
}

function useFake(rideOverrides = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [makeRide({ status: "payment_required", dispatch_status: null, payment_id: null, ...rideOverrides })],
      driver_offers: [],
      audit_logs: [],
      system_flags: []
    },
    { columns: LIVE_COLUMNS }
  );
  currentFake.rpc = jest.fn(async (fn) =>
    fn === "dispatch_ride_atomic" ? { data: null, error: { message: "rpc unavailable in fake" } } : { data: null, error: null }
  );
  return currentFake;
}

const offers = () => currentFake._state.driver_offers;
const ride = () => currentFake._state.rides[0];
const authorize = (body = { payment_intent_id: PI }) => request(app).post("/api/rides/RIDE_1/authorize").send(body);

let app;

beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

beforeEach(() => {
  mockRetrieve.mockReset().mockResolvedValue(intent());
  mockUpdate.mockReset().mockResolvedValue({});
});

test("first authorization authorizes and dispatches once", async () => {
  useFake();
  const res = await authorize();
  expect(res.status).toBe(200);
  expect(ride().payment_id).toBe(PI);
  expect(offers()).toHaveLength(1);
});

test("a repeat with the same PaymentIntent changes nothing and never redispatches", async () => {
  useFake();
  await authorize();
  // The ride moves on (driver accepted, en route).
  Object.assign(ride(), { status: "driver_enroute", driver_id: "DRIVER_1" });
  mockRetrieve.mockClear();

  const res = await authorize();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ already_authorized: true, status: "driver_enroute", dispatch: null });
  expect(ride().status).toBe("driver_enroute");
  expect(offers()).toHaveLength(1);
  expect(mockRetrieve).not.toHaveBeenCalled();
});

test.each(["payment_authorized", "awaiting_driver_acceptance", "in_progress", "completed"])(
  "a different PaymentIntent on a %s ride is refused",
  async (status) => {
    useFake({ status, payment_id: PI });
    const res = await authorize({ payment_intent_id: "pi_someone_else" });
    expect(res.status).toBe(409);
    expect(ride().status).toBe(status);
    expect(ride().payment_id).toBe(PI);
    expect(offers()).toHaveLength(0);
  }
);

test.each(["cancelled", "failed"])("a %s ride can never be re-authorized", async (status) => {
  useFake({ status, payment_id: PI });
  const res = await authorize();
  expect(res.status).toBe(409);
  expect(ride().status).toBe(status);
  expect(offers()).toHaveLength(0);
});

test("if the ride stops awaiting payment during verification, the write is refused and nothing is dispatched", async () => {
  useFake();
  mockRetrieve.mockImplementation(async () => {
    // A concurrent request (or a cancellation) wins while Stripe is checked.
    ride().status = "cancelled";
    return intent();
  });
  const res = await authorize();
  expect(res.status).toBe(409);
  expect(ride().status).toBe("cancelled");
  expect(offers()).toHaveLength(0);
});
