// A ride that ends as failed must not leave the rider's card authorized
// (releaseFailedRidePayment in server.js): out of dispatch attempts (the
// offer-expiry sweep and a decline), no driver available, or marked
// failed by an admin. Review rides and captured payments are never
// voided, and an admin can't revive a failed ride whose hold is gone.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "true";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.MAX_DISPATCH_ATTEMPTS = "5";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => new Proxy({}, { get: (_t, key) => (typeof mockSupabaseClient[key] === "function" ? mockSupabaseClient[key].bind(mockSupabaseClient) : mockSupabaseClient[key]) })
}));
const mockStripeRetrieve = jest.fn();
const mockStripeCancel = jest.fn();
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      retrieve: (...args) => mockStripeRetrieve(...args),
      cancel: (...args) => mockStripeCancel(...args),
      capture: () => Promise.resolve({ id: "pi_test_123", status: "succeeded" })
    }
  }))
);

const request = require("supertest");
const ADMIN = { "x-admin-token": "test-admin-token" };
const DRIVER = makeDriver({ id: "DRIVER_1", online: true });
let app;
let runOfferExpirySweep;

function seed({ ride = {}, offer = null, sweep = false, drivers = [DRIVER] } = {}) {
  mockSupabaseClient = createFakeSupabase({
    riders: [makeRider({ id: "RIDER_1" })],
    drivers,
    rides: [makeRide({ id: "RIDE_1", rider_id: "RIDER_1", status: "awaiting_driver_acceptance", dispatch_status: "offer_sent", payment_id: "pi_test_123", payment_status: "authorized", ...ride })],
    driver_offers: offer ? [{ id: "OFFER_1", ride_id: "RIDE_1", driver_id: DRIVER.id, status: "pending", attempt: 1, expires_at: new Date(Date.now() - 60_000).toISOString(), ...offer }] : [],
    audit_logs: [],
    system_flags: [{ key: "offer_expiry_sweep_enabled", value: sweep ? "true" : "false" }]
  });
  return mockSupabaseClient;
}
const ride = () => mockSupabaseClient._state.rides[0];
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeAll(() => {
  seed();
  // eslint-disable-next-line global-require
  ({ app, runOfferExpirySweep } = require("../server"));
});

beforeEach(() => {
  mockStripeRetrieve.mockReset();
  mockStripeCancel.mockReset();
  mockStripeRetrieve.mockResolvedValue({ id: "pi_test_123", status: "requires_capture" });
  mockStripeCancel.mockResolvedValue({ id: "pi_test_123", status: "canceled" });
});

describe("the hold is released when a ride fails", () => {
  test("out of dispatch attempts (offer-expiry sweep)", async () => {
    seed({ ride: { dispatch_attempts: 5 }, offer: {}, sweep: true });
    const result = await runOfferExpirySweep();
    expect(result.maxedOut).toEqual(["RIDE_1"]);
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    expect(mockStripeCancel.mock.calls[0][0]).toBe("pi_test_123");
    expect(ride()).toMatchObject({ status: "failed", cancellation_payment_status: "cancelled" });
    expect(mockSupabaseClient._state.audit_logs.some((a) => a.action === "failed_ride_payment_released")).toBe(true);
  });

  test("no driver available after the only driver declines", async () => {
    seed({ ride: { dispatch_attempts: 1 }, offer: { expires_at: new Date(Date.now() + 30_000).toISOString() } });
    const res = await request(app).post("/api/driver/offers/OFFER_1/decline").set(driverAuthHeaders(signTestDriverToken(DRIVER.id))).send({ reason: "too far" });
    expect(res.status).toBe(200);
    await settle();
    expect(ride().status).toBe("failed");
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    expect(ride().cancellation_payment_status).toBe("cancelled");
  });

  test("an admin marks the ride failed", async () => {
    seed();
    const res = await request(app).patch("/api/admin/rides/RIDE_1/status").set(ADMIN).send({ status: "failed", reason: "Rider unreachable" });
    expect(res.status).toBe(200);
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    expect(ride()).toMatchObject({ status: "failed", cancellation_payment_status: "cancelled" });
  });

  test("running it twice voids the payment once", async () => {
    seed({ ride: { dispatch_attempts: 5 }, offer: {}, sweep: true });
    await runOfferExpirySweep();
    await request(app).patch("/api/admin/rides/RIDE_1/status").set(ADMIN).send({ status: "failed", reason: "again" });
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });
});

describe("never voided", () => {
  test("a review ride (simulated payment)", async () => {
    seed({ ride: { dispatch_attempts: 5, is_review_ride: true, payment_id: null, payment_status: "not_required" }, offer: {}, sweep: true });
    await runOfferExpirySweep();
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(mockStripeCancel).not.toHaveBeenCalled();
    expect(ride()).toMatchObject({ status: "failed", cancellation_payment_status: "not_required" });
  });

  test("an already captured payment is flagged for a refund, not cancelled", async () => {
    mockStripeRetrieve.mockResolvedValue({ id: "pi_test_123", status: "succeeded" });
    seed({ ride: { dispatch_attempts: 5 }, offer: {}, sweep: true });
    await runOfferExpirySweep();
    expect(mockStripeCancel).not.toHaveBeenCalled();
    expect(ride().cancellation_payment_status).toBe("cancel_failed");
  });

  test("a ride that is re-dispatched to another driver instead of failing", async () => {
    const other = makeDriver({ id: "DRIVER_2", email: "two@example.test", phone: "+16155550299", online: true, current_lat: 36.16, current_lng: -86.78, last_location_at: new Date().toISOString() });
    seed({ ride: { dispatch_attempts: 1 }, offer: {}, sweep: true, drivers: [DRIVER, other] });
    const result = await runOfferExpirySweep();
    await settle();
    expect(result.redispatched).toEqual(["RIDE_1"]);
    expect(mockStripeCancel).not.toHaveBeenCalled();
    expect(ride().status).not.toBe("failed");
  });
});

describe("admin revival of a failed ride", () => {
  test("refused once the hold was released", async () => {
    seed({ ride: { status: "failed", dispatch_status: "max_attempts_reached", cancellation_payment_status: "cancelled" } });
    const res = await request(app).patch("/api/admin/rides/RIDE_1/status").set(ADMIN).send({ status: "awaiting_driver_acceptance", reason: "retry" });
    expect(res.status).toBe(409);
    expect(res.body.error || res.body.message).toMatch(/book a new ride/);
    expect(ride().status).toBe("failed");
  });

  test("still allowed while the hold is intact", async () => {
    seed({ ride: { status: "failed", dispatch_status: "no_drivers_available", cancellation_payment_status: null } });
    const res = await request(app).patch("/api/admin/rides/RIDE_1/status").set(ADMIN).send({ status: "awaiting_driver_acceptance", reason: "retry" });
    expect(res.status).toBe(200);
    expect(ride().status).toBe("awaiting_driver_acceptance");
  });
});
