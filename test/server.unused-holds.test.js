// Payment records and unused card hold release (lib/unusedHolds.js):
// ownership, never cancelling a payment that belongs to a ride, the
// bind-vs-release race, idempotency, failures and the sweep. Real routes
// over supertest; Supabase is the in-memory fake (payments.id unique, like
// the real primary key) and Stripe's PaymentIntent API is mocked.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.UNUSED_HOLD_RELEASE_PER_MINUTE = "100000";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken, riderAuthHeaders } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
const mockRetrieve = jest.fn();
const mockUpdate = jest.fn();
const mockCancel = jest.fn();

jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      retrieve: (...a) => mockRetrieve(...a),
      update: (...a) => mockUpdate(...a),
      cancel: (...a) => mockCancel(...a)
    }
  }))
);
mockSupabaseClient = new Proxy({}, {
  get(_t, prop) {
    const v = currentFake[prop];
    return typeof v === "function" ? v.bind(currentFake) : v;
  }
});

const PI = "pi_hold_1";
const SECRET = "pi_hold_1_secret_xyz";
const hoursAgo = (h) => Math.floor((Date.now() - h * 3600_000) / 1000);

let stripeIntent;
function useFake({ flags = { unused_hold_release_enabled: "true" }, rides = [], payments = [] } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides,
      payments,
      driver_offers: [],
      audit_logs: [],
      system_flags: Object.entries(flags).map(([key, value]) => ({ key, value }))
    },
    { uniqueColumns: { payments: ["id"] } }
  );
  currentFake.rpc = jest.fn(async (fn) =>
    fn === "dispatch_ride_atomic" ? { data: null, error: { message: "rpc unavailable" } } : { data: null, error: null }
  );
  return currentFake;
}

const payment = () => currentFake._state.payments.find((p) => p.id === PI);
const release = (body = { client_secret: SECRET }, headers = {}) =>
  request(app).post(`/api/payments/holds/${PI}/release`).set(headers).send(body);
const authorize = (rideId = "RIDE_1") => request(app).post(`/api/rides/${rideId}/authorize`).send({ payment_intent_id: PI });

let app;
let runUnusedHoldSweep;
beforeAll(() => {
  useFake();
  ({ app, runUnusedHoldSweep } = require("../server"));
});

beforeEach(() => {
  stripeIntent = {
    id: PI,
    status: "requires_capture",
    capture_method: "manual",
    amount: 2000,
    currency: "usd",
    client_secret: SECRET,
    created: hoursAgo(3),
    metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1", rider_verified: "true", ride_type: "standard" }
  };
  mockRetrieve.mockReset().mockImplementation(async () => ({ ...stripeIntent, metadata: { ...stripeIntent.metadata } }));
  mockUpdate.mockReset().mockImplementation(async (_id, { metadata }) => {
    stripeIntent.metadata = { ...metadata };
    return stripeIntent;
  });
  mockCancel.mockReset().mockImplementation(async () => {
    stripeIntent.status = "canceled";
    return stripeIntent;
  });
});

describe("rider release", () => {
  test("off unless the flag is on; nothing is called", async () => {
    useFake({ flags: {} });
    const res = await release();
    expect(res.status).toBe(503);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test("the browser that created the hold (client secret) can cancel it once", async () => {
    useFake();
    const res = await release();
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(mockCancel).toHaveBeenCalledWith(PI, { cancellation_reason: "abandoned" }, { idempotencyKey: `harvey-hold-release-${PI}` });
    expect(payment().status).toBe("released");
    expect(payment().ride_id ?? null).toBeNull();
    expect(currentFake._state.audit_logs.find((a) => a.action === "unused_card_hold_released")).toBeTruthy();

    const again = await release();
    expect(again.status).toBe(409);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  test("a verified rider session that owns the hold can cancel it without the secret", async () => {
    useFake();
    const res = await release({}, riderAuthHeaders(signTestRiderToken("RIDER_1")));
    expect(res.status).toBe(200);
  });

  test("anyone else gets not-found and nothing is cancelled", async () => {
    useFake();
    currentFake._state.riders.push(makeRider({ id: "RIDER_2", email: "x@example.test", phone: "+16155550999" }));
    for (const [body, headers] of [
      [{ client_secret: "wrong" }, {}],
      [{}, {}],
      [{ rider_id: "RIDER_1" }, {}],
      [{}, riderAuthHeaders(signTestRiderToken("RIDER_2"))]
    ]) {
      const res = await release(body, headers);
      expect(res.status).toBe(404);
      expect(res.body.reason).toBe("not_found");
    }
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test.each(["payment_authorized", "driver_enroute", "in_progress", "completed", "cancelled"])(
    "a hold referenced by a %s ride is never cancelled",
    async (status) => {
      useFake({ rides: [makeRide({ status, payment_id: PI })] });
      const res = await release();
      expect(res.status).toBe(409);
      expect(mockCancel).not.toHaveBeenCalled();
    }
  );

  test("Stripe failure is reported, recorded, and can be retried", async () => {
    useFake();
    mockCancel.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "api_error" }));
    expect((await release()).status).toBe(502);
    expect(payment().status).toBe("release_failed");
    expect((await release()).status).toBe(200);
    expect(payment().status).toBe("released");
  });
});

describe("binding a hold to a ride (rides.payment_id -> payments.id)", () => {
  test("authorization creates the payment record, bound to the ride, before the ride references it", async () => {
    const fake = useFake({ rides: [makeRide({ status: "payment_required", payment_id: null })] });
    const res = await authorize();
    expect(res.status).toBe(200);
    expect(payment()).toMatchObject({ status: "authorized", ride_id: "RIDE_1", rider_id: "RIDER_1", amount: 20 });
    const order = fake._log.filter((e) => (e.table === "payments" && e.op === "insert") || (e.table === "rides" && e.op === "update"));
    expect(order[0].table).toBe("payments");
    expect(fake._state.rides[0].payment_id).toBe(PI);
  });

  test("a hold recorded at creation is bound by authorization", async () => {
    useFake({
      rides: [makeRide({ status: "payment_required", payment_id: null })],
      payments: [{ id: PI, rider_id: "RIDER_1", status: "created", amount: 20 }]
    });
    expect((await authorize()).status).toBe(200);
    expect(payment()).toMatchObject({ status: "authorized", ride_id: "RIDE_1" });
  });

  test("release first: the ride can no longer be authorized with that hold, and nothing is dispatched", async () => {
    const fake = useFake({ rides: [makeRide({ status: "payment_required", payment_id: null })] });
    expect((await release()).status).toBe(200);
    stripeIntent.status = "requires_capture"; // even if Stripe still said so, the record decides
    const res = await authorize();
    expect(res.status).toBe(409);
    expect(fake._state.rides[0]).toMatchObject({ status: "payment_required", payment_id: null });
    expect(fake._state.driver_offers).toHaveLength(0);
  });

  test("authorize first: the release is refused and the ride keeps its payment", async () => {
    const fake = useFake({ rides: [makeRide({ status: "payment_required", payment_id: null })] });
    expect((await authorize()).status).toBe(200);
    const res = await release();
    expect(res.status).toBe(409);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(fake._state.rides[0].payment_id).toBe(PI);
  });

  test("a hold bound to another ride cannot authorize a second ride", async () => {
    useFake({
      rides: [makeRide({ status: "payment_required", payment_id: null }), makeRide({ id: "RIDE_2", status: "payment_required", payment_id: null })],
      payments: [{ id: PI, rider_id: "RIDER_1", status: "authorized", ride_id: "RIDE_2", amount: 20 }]
    });
    const res = await authorize("RIDE_1");
    expect(res.status).toBe(409);
    expect(currentFake._state.rides[0].payment_id).toBeNull();
  });

  test("if the ride stops awaiting payment, the record is handed back so the hold can still be released", async () => {
    useFake({ rides: [makeRide({ status: "payment_required", payment_id: null })] });
    mockRetrieve.mockImplementationOnce(async () => {
      currentFake._state.rides[0].status = "cancelled";
      return { ...stripeIntent };
    });
    expect((await authorize()).status).toBe(409);
    expect(payment()).toMatchObject({ status: "created", ride_id: null });
    expect((await release()).status).toBe(200);
  });
});

describe("sweep", () => {
  test("off by default", async () => {
    useFake({ payments: [{ id: PI, rider_id: "RIDER_1", status: "created", ride_id: null, created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }] });
    expect(await runUnusedHoldSweep()).toEqual({ skipped: true });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  test("releases only old, unbound, created holds", async () => {
    useFake({
      flags: { unused_hold_sweep_enabled: "true" },
      payments: [{ id: PI, rider_id: "RIDER_1", status: "created", ride_id: null, created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }]
    });
    const result = await runUnusedHoldSweep();
    expect(result.released.map((r) => r.id)).toEqual([PI]);
    expect(payment().status).toBe("released");
  });

  test("a recent hold is kept (rider may still be booking)", async () => {
    useFake({
      flags: { unused_hold_sweep_enabled: "true" },
      payments: [{ id: PI, rider_id: "RIDER_1", status: "created", ride_id: null, created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }]
    });
    stripeIntent.created = hoursAgo(0.25);
    const result = await runUnusedHoldSweep();
    expect(result.kept).toEqual([{ id: PI, reason: "too_recent" }]);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
