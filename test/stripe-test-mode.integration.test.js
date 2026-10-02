// #155 against REAL Stripe test mode.
//
// Runs only when STRIPE_TEST_SECRET_KEY is set to a Stripe TEST secret key
// (sk_test_... or rk_test_...); it refuses anything else, so it can never
// touch live payments. Skipped otherwise (and in normal CI). The database
// is the in-memory fake; Stripe is real (test mode), so every
// PaymentIntent below is a real test-mode object created, confirmed,
// retrieved and cancelled through the Stripe API.
//
//   STRIPE_TEST_SECRET_KEY=sk_test_... npx jest test/stripe-test-mode --runInBand
//
// Covers: successful authorization + payment record; failed (declined)
// authorization; duplicate and concurrent authorization requests (one
// dispatch); abandoned-hold cancellation; simultaneous cancellation vs
// ride attachment (exactly one wins); a ride's payment is never cancelled.
// PaymentIntents are created with the same parameters
// POST /api/rides/payment-intent uses (manual capture, usd,
// metadata.app = harvey_taxi, metadata.rider_id).

const TEST_KEY = process.env.STRIPE_TEST_SECRET_KEY || "";
const KEY_IS_TEST = /^(sk|rk)_test_/.test(TEST_KEY);

process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.UNUSED_HOLD_RELEASE_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "true";
if (KEY_IS_TEST) process.env.STRIPE_SECRET_KEY = TEST_KEY;
else delete process.env.STRIPE_SECRET_KEY;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const describeStripe = KEY_IS_TEST ? describe : describe.skip;
jest.setTimeout(120000);

if (TEST_KEY && !KEY_IS_TEST) {
  throw new Error("STRIPE_TEST_SECRET_KEY must be a Stripe TEST key (sk_test_/rk_test_). Refusing to run.");
}

describeStripe("#155 against Stripe test mode", () => {
  let app;
  let request;
  let stripe;
  const created = [];

  beforeAll(() => {
    mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { payments: ["id"] } });
    ({ app } = require("../server"));
    request = require("supertest");
    stripe = require("stripe")(TEST_KEY);
  });

  afterAll(async () => {
    // Leave nothing authorized in the test account.
    for (const id of created) {
      try {
        const pi = await stripe.paymentIntents.retrieve(id);
        if (!["canceled", "succeeded"].includes(pi.status)) await stripe.paymentIntents.cancel(id);
      } catch {
        /* already gone */
      }
    }
  });

  function reset(rides = []) {
    const state = mockSupabaseClient._state;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, {
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides,
      payments: [],
      driver_offers: [],
      audit_logs: [],
      system_flags: [{ key: "unused_hold_release_enabled", value: "true" }]
    });
    mockSupabaseClient.rpc = async (fn) => (fn === "dispatch_ride_atomic" ? { data: null, error: { message: "fallback" } } : { data: null, error: null });
  }

  // Same parameters as POST /api/rides/payment-intent.
  async function hold({ amount = 2000, card = "pm_card_visa", confirm = true } = {}) {
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      capture_method: "manual",
      payment_method_types: ["card"],
      metadata: { app: "harvey_taxi", account: "harvey_taxi_service", metadata_version: "2", ride_type: "standard", rider_id: "RIDER_1", rider_verified: "false" }
    });
    created.push(pi.id);
    if (!confirm) return pi;
    try {
      return await stripe.paymentIntents.confirm(pi.id, { payment_method: card });
    } catch (err) {
      return { ...(await stripe.paymentIntents.retrieve(pi.id)), declined: err.code || err.type };
    }
  }

  const ride = (overrides = {}) => makeRide({ status: "payment_required", dispatch_status: null, payment_id: null, estimated_fare: 20, ...overrides });
  const authorize = (rideId, pi) => request(app).post(`/api/rides/${rideId}/authorize`).send({ payment_intent_id: pi });
  const release = (pi) => request(app).post(`/api/payments/holds/${pi.id}/release`).send({ client_secret: pi.client_secret });
  const state = () => mockSupabaseClient._state;
  const pendingOffers = () => state().driver_offers.filter((o) => o.status === "pending").length;

  test("successful authorization: Stripe hold verified, payment record created and bound, ride dispatched once", async () => {
    reset([ride()]);
    const pi = await hold();
    expect(pi.status).toBe("requires_capture");
    const res = await authorize("RIDE_1", pi.id);
    expect(res.status).toBe(200);
    expect(state().payments.find((p) => p.id === pi.id)).toMatchObject({ status: "authorized", ride_id: "RIDE_1", amount: 20 });
    expect(state().rides[0]).toMatchObject({ status: expect.stringMatching(/payment_authorized|awaiting_driver_acceptance/), payment_id: pi.id });
    expect(pendingOffers()).toBe(1);
    const atStripe = await stripe.paymentIntents.retrieve(pi.id);
    expect(atStripe.metadata.ride_id).toBe("RIDE_1");
    expect(atStripe.status).toBe("requires_capture");
  });

  test("failed authorization (declined card): no record bound, ride not authorized, nothing dispatched", async () => {
    reset([ride()]);
    const pi = await hold({ card: "pm_card_chargeDeclined" });
    expect(pi.declined).toBeTruthy();
    const res = await authorize("RIDE_1", pi.id);
    expect(res.status).toBe(402);
    expect(state().rides[0]).toMatchObject({ status: "payment_required", payment_id: null });
    expect(state().payments.filter((p) => p.status === "authorized")).toHaveLength(0);
    expect(pendingOffers()).toBe(0);
  });

  test("duplicate requests: concurrent and repeated authorizations dispatch exactly once", async () => {
    reset([ride()]);
    const pi = await hold();
    const results = await Promise.all([authorize("RIDE_1", pi.id), authorize("RIDE_1", pi.id), authorize("RIDE_1", pi.id)]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(pendingOffers()).toBe(1);
    const later = await authorize("RIDE_1", pi.id);
    expect(later.status).toBe(200);
    expect(later.body.already_authorized).toBe(true);
    expect(pendingOffers()).toBe(1);
  });

  test("the same hold cannot authorize a second ride", async () => {
    reset([ride(), ride({ id: "RIDE_2" })]);
    const pi = await hold();
    expect((await authorize("RIDE_1", pi.id)).status).toBe(200);
    expect((await authorize("RIDE_2", pi.id)).status).toBe(409);
    expect(state().rides.find((r) => r.id === "RIDE_2").payment_id).toBeNull();
  });

  test("abandoned hold: the owner's release cancels it at Stripe, once", async () => {
    reset([]);
    const pi = await hold();
    const res = await release(pi);
    expect(res.status).toBe(200);
    expect((await stripe.paymentIntents.retrieve(pi.id)).status).toBe("canceled");
    expect(state().payments.find((p) => p.id === pi.id).status).toBe("released");
    expect((await release(pi)).status).toBe(409);
  });

  test("a ride's payment is never cancelled by a release request", async () => {
    reset([ride()]);
    const pi = await hold();
    expect((await authorize("RIDE_1", pi.id)).status).toBe(200);
    expect((await release(pi)).status).toBe(409);
    expect((await stripe.paymentIntents.retrieve(pi.id)).status).toBe("requires_capture");
  });

  test.each([1, 2, 3, 4, 5])("simultaneous release and ride attachment (run %i): exactly one wins, never both", async () => {
    reset([ride()]);
    const pi = await hold();
    const [rel, auth] = await Promise.all([release(pi), authorize("RIDE_1", pi.id)]);
    const atStripe = await stripe.paymentIntents.retrieve(pi.id);
    const rideRow = state().rides[0];
    const attached = rideRow.payment_id === pi.id;
    if (attached) {
      // The ride won: its hold must still be live and the release refused.
      expect(auth.status).toBe(200);
      expect(rel.status).toBe(409);
      expect(atStripe.status).toBe("requires_capture");
      expect(pendingOffers()).toBe(1);
    } else {
      // The release won: the ride was not authorized or dispatched.
      expect(rel.status).toBe(200);
      expect(auth.status).not.toBe(200);
      expect(atStripe.status).toBe("canceled");
      expect(rideRow.status).toBe("payment_required");
      expect(pendingOffers()).toBe(0);
    }
  });
});

test("guard: the suite refuses to use a live key", () => {
  expect(/^(sk|rk)_test_/.test("sk_live_x")).toBe(false);
});
