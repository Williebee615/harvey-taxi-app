// Cancellation and no-show controls and records
// (docs/policy-cancellation-noshow-draft.md). Owner instruction
// (2026-10-04): build and test these first, keeping every cancellation
// free. Every test here checks that nothing is charged: the fee is $0,
// the card hold is released, and Stripe capture is never called.

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

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestDriverToken, signTestRiderToken, driverAuthHeaders, riderAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const mockStripeRetrieve = jest.fn();
const mockStripeCancel = jest.fn();
const mockStripeCapture = jest.fn();
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: {
      retrieve: (...args) => mockStripeRetrieve(...args),
      cancel: (...args) => mockStripeCancel(...args),
      capture: (...args) => mockStripeCapture(...args)
    }
  }))
);

const request = require("supertest");
const { haversineMeters } = require("../lib/cancellationRecords");

let app;
let ipCounter = 0;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { driver_earnings: ["ride_id"] } });
  ({ app } = require("../server"));
});

function resetState(seed) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  for (const table of Object.keys(seed)) state[table] = seed[table].map((row) => ({ ...row }));
}

const RIDER = makeRider({ id: "RIDER_1" });
const OTHER_RIDER = makeRider({ id: "RIDER_2", email: "casey@example.test", phone: "+16155550102" });
const DRIVER = makeDriver({ id: "DRIVER_1" });
const OTHER_DRIVER = makeDriver({ id: "DRIVER_2", email: "other@example.test", phone: "+16155550202" });
const riderAuth = riderAuthHeaders(signTestRiderToken(RIDER.id, { sessionVersion: 0 }));
const otherRiderAuth = riderAuthHeaders(signTestRiderToken(OTHER_RIDER.id, { sessionVersion: 0 }));
const driverAuth = driverAuthHeaders(signTestDriverToken(DRIVER.id));
const otherDriverAuth = driverAuthHeaders(signTestDriverToken(OTHER_DRIVER.id));
const ADMIN = { "x-admin-token": "test-admin-token" };

const PICKUP = { pickup_lat: 36.1627, pickup_lng: -86.7816 };
const near = (meters) => ({ latitude: PICKUP.pickup_lat + meters / 111195, longitude: PICKUP.pickup_lng, accuracy: 10 });
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

function seedRide(over = {}, flags = []) {
  resetState({
    riders: [RIDER, OTHER_RIDER],
    drivers: [DRIVER, OTHER_DRIVER],
    rides: [makeRide({ status: "driver_enroute", rider_id: RIDER.id, driver_id: DRIVER.id, payment_id: "pi_test_123", payment_status: "pending", accepted_at: minutesAgo(5), ...PICKUP, ...over })],
    driver_offers: [],
    driver_earnings: [],
    audit_logs: [],
    ride_contact_attempts: [],
    system_flags: flags,
    push_subscriptions: []
  });
}

const ride = () => mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
const post = (path) => request(app).post(path).set("X-Forwarded-For", `10.77.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`);
const get = (path) => request(app).get(path).set("X-Forwarded-For", `10.78.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`);

beforeEach(() => {
  mockStripeRetrieve.mockReset().mockResolvedValue({ id: "pi_test_123", status: "requires_capture" });
  mockStripeCancel.mockReset().mockResolvedValue({ id: "pi_test_123", status: "canceled" });
  mockStripeCapture.mockReset().mockResolvedValue({ id: "pi_test_123", status: "succeeded" });
});

afterEach(() => {
  // Nothing in this file may ever capture a payment.
  expect(mockStripeCapture).not.toHaveBeenCalled();
});

describe("rider: the exact fee is shown before confirming (always $0.00 now)", () => {
  test("preview: free, $0.00, for the ride's own rider only", async () => {
    seedRide();
    const res = await get("/api/rides/RIDE_1/cancel-preview").set(riderAuth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancellable: true, fee_cents: 0, fee_display: "$0.00", free: true });
    expect(res.body.message).toMatch(/free/);
    expect(res.body).not.toHaveProperty("assessment");
    expect((await get("/api/rides/RIDE_1/cancel-preview").set(otherRiderAuth)).status).toBe(404);
    expect((await get("/api/rides/RIDE_1/cancel-preview")).status).toBe(401);
  });

  test("preview for a trip in progress says it can't be cancelled", async () => {
    seedRide({ status: "in_progress" });
    const res = await get("/api/rides/RIDE_1/cancel-preview").set(riderAuth);
    expect(res.body).toMatchObject({ cancellable: false });
    expect(res.body.message).toMatch(/already underway/);
  });

  test("cancel with the fee shown: free, hold released, records kept", async () => {
    seedRide({ pickup_progress_at: minutesAgo(1), pickup_due_at: new Date(Date.now() + 5 * 60000).toISOString() });
    const res = await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ reason: "plans changed", expected_fee_cents: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", cancellation_fee_cents: 0, cancellation_fee_display: "$0.00", cancellation_category: "rider_cancelled" });
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    const r = ride();
    expect(r).toMatchObject({ cancellation_category: "rider_cancelled", cancellation_fee_cents: 0, cancellation_fee_shown_cents: 0 });
    // The draft policy would have allowed a fee here (5 min after
    // acceptance, driver progressing, on time) -- recorded, not charged.
    expect(r.cancellation_assessment).toMatchObject({ phase: "after_free_window", policy_fee_eligible: true, fee_cents: 0, charges_active: false });
  });

  test("a fee that doesn't match what was shown is refused, and nothing changes", async () => {
    seedRide();
    const res = await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ expected_fee_cents: 500 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "cancellation_fee_changed", fee_cents: 0, fee_display: "$0.00" });
    expect(ride().status).toBe("driver_enroute");
    expect(mockStripeCancel).not.toHaveBeenCalled();
    expect((await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ expected_fee_cents: "abc" })).status).toBe(409);
  });

  test("older clients that send no fee still cancel for free", async () => {
    seedRide({ status: "awaiting_driver_acceptance", driver_id: null, accepted_at: null });
    const res = await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({});
    expect(res.status).toBe(200);
    expect(ride()).toMatchObject({ cancellation_fee_cents: 0, cancellation_fee_shown_cents: null });
    expect(ride().cancellation_assessment).toMatchObject({ phase: "before_acceptance", waivers: ["before_acceptance"] });
  });

  test("cancelling twice never charges and releases the hold once", async () => {
    seedRide();
    await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ expected_fee_cents: 0 });
    const again = await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ expected_fee_cents: 0 });
    expect(again.status).toBe(200);
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });
});

describe("driver: pickup records", () => {
  test("Arrived records whether the driver was at the pickup, without blocking", async () => {
    seedRide();
    const res = await post("/api/driver/rides/RIDE_1/arrived").set(driverAuth).send(near(60));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "arrived", arrival_verified: true, arrival_check: "verified" });
    expect(ride()).toMatchObject({ arrival_verified: true, arrival_check: "verified" });
    expect(ride().arrival_distance_m).toBeLessThanOrEqual(70);
  });

  test("Arrived far from the pickup: still arrives, recorded as not at pickup", async () => {
    seedRide();
    const res = await post("/api/driver/rides/RIDE_1/arrived").set(driverAuth).send(near(800));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "arrived", arrival_verified: false, arrival_check: "not_at_pickup" });
  });

  test("Arrived with no location and no earlier fix: recorded as no location", async () => {
    seedRide();
    const res = await post("/api/driver/rides/RIDE_1/arrived").set(driverAuth).send({});
    expect(res.body).toMatchObject({ arrival_verified: false, arrival_check: "no_driver_location" });
  });

  test("location updates before pickup record progress toward the pickup", async () => {
    seedRide();
    const at = near(2000);
    const res = await post("/api/driver/location").set(driverAuth).send({ latitude: at.latitude, longitude: at.longitude, accuracy: 12 });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const r = ride();
    expect(Math.abs(r.pickup_start_distance_m - 2000)).toBeLessThan(5);
    expect(r).toMatchObject({ pickup_fix_accuracy_m: 12 });
    expect(Math.round(haversineMeters(r.pickup_fix_lat, r.pickup_fix_lng, PICKUP.pickup_lat, PICKUP.pickup_lng))).toBe(r.pickup_last_distance_m);
  });

  test("contact attempts are recorded for the assigned driver only, before pickup", async () => {
    seedRide({ status: "arrived", arrived_at: minutesAgo(3) });
    const res = await post("/api/driver/rides/RIDE_1/contact-attempt").set(driverAuth).send({ method: "call" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recorded: true, method: "call" });
    expect(ride().contact_attempt_count).toBe(1);
    expect(mockSupabaseClient._state.ride_contact_attempts).toEqual([expect.objectContaining({ ride_id: "RIDE_1", driver_id: DRIVER.id, method: "call", ride_status: "arrived" })]);
    expect((await post("/api/driver/rides/RIDE_1/contact-attempt").set(driverAuth).send({ method: "message" })).body.recorded).toBe(true);
    expect(ride().contact_attempt_count).toBe(2);

    expect((await post("/api/driver/rides/RIDE_1/contact-attempt").set(driverAuth).send({ method: "fax" })).status).toBe(400);
    expect((await post("/api/driver/rides/RIDE_1/contact-attempt").set(otherDriverAuth).send({ method: "call" })).status).toBe(403);
    seedRide({ status: "in_progress" });
    expect((await post("/api/driver/rides/RIDE_1/contact-attempt").set(driverAuth).send({ method: "call" })).status).toBe(409);
  });
});

describe("driver: no-show (off until the owner turns it on)", () => {
  const eligibleRide = () => ({ status: "arrived", arrived_at: minutesAgo(8), arrival_verified: true, last_contact_attempt_at: minutesAgo(4) });

  test("off by default: refused, nothing changes", async () => {
    seedRide(eligibleRide());
    const res = await post("/api/driver/rides/RIDE_1/no-show").set(driverAuth).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_show_disabled");
    expect(ride().status).toBe("arrived");
    const status = await get("/api/driver/rides/RIDE_1/no-show").set(driverAuth);
    expect(status.body).toMatchObject({ enabled: false, eligible: true });
  });

  test("when on: refused until verified arrival, 7 minutes and a contact attempt, naming what's missing", async () => {
    seedRide({ status: "arrived", arrived_at: minutesAgo(3), arrival_verified: false }, [{ key: "driver_no_show_enabled", value: "true" }]);
    const res = await post("/api/driver/rides/RIDE_1/no-show").set(driverAuth).send({});
    expect(res.status).toBe(409);
    expect(res.body.missing).toEqual(["arrival_not_verified", "wait_under_7_minutes", "no_contact_attempt_after_arrival"]);
    expect(ride().status).toBe("arrived");
  });

  test("when on and eligible: cancelled for free, hold released, recorded as a no-show", async () => {
    seedRide(eligibleRide(), [{ key: "driver_no_show_enabled", value: "true" }]);
    const res = await post("/api/driver/rides/RIDE_1/no-show").set(driverAuth).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", cancellation_category: "driver_no_show", cancellation_fee_cents: 0 });
    expect(ride()).toMatchObject({ status: "cancelled", cancelled_by_type: "driver", cancellation_reason: "rider_no_show", cancellation_category: "driver_no_show", cancellation_fee_cents: 0 });
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
    expect((await post("/api/driver/rides/RIDE_1/no-show").set(otherDriverAuth).send({})).status).toBe(403);
  });
});

describe("admin and duplicate-charge protection", () => {
  test("a cancelled incident resolution can't also charge the fare", async () => {
    seedRide();
    const res = await post("/api/admin/rides/RIDE_1/incident-resolve").set(ADMIN).send({ resolution: "cancelled_by_incident", payment_action: "capture", reason: "test" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("cancellation_charge_not_allowed");
    expect(ride().status).toBe("driver_enroute");
  });

  test("a Harvey service failure is recorded as such, with the hold released", async () => {
    seedRide();
    const res = await post("/api/admin/rides/RIDE_1/incident-resolve").set(ADMIN).send({ resolution: "cancelled_by_incident", payment_action: "void", reason: "no driver available", service_failure: true });
    expect(res.status).toBe(200);
    expect(ride()).toMatchObject({ status: "cancelled", cancellation_category: "harvey_service_failure", cancellation_fee_cents: 0 });
    expect(ride().cancellation_assessment.waivers).toEqual(["harvey_service_failure"]);
    expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  });

  test("a cancelled ride can't later be completed and charged", async () => {
    seedRide();
    await post("/api/rides/RIDE_1/cancel").set(riderAuth).send({ expected_fee_cents: 0 });
    const res = await post("/api/driver/rides/RIDE_1/complete").set(driverAuth).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ride().status).toBe("cancelled");
  });
});

describe("original pickup estimate through driver reassignment", () => {
  test("A accepts (6 min), releases the ride, B accepts (12 min): the original 6-minute estimate and due time stay", async () => {
    seedRide({ id: "RIDE_1", status: "awaiting_driver_acceptance", driver_id: null, accepted_at: null, driver_eta_to_pickup_minutes: 6, payment_id: null });
    const state = mockSupabaseClient._state;
    state.driver_offers = [{ id: "OFFER_A", ride_id: "RIDE_1", driver_id: DRIVER.id, status: "pending", created_at: new Date().toISOString() }];
    const realRpc = mockSupabaseClient.rpc;
    // In-memory stand-in for accept_driver_offer_atomic (the real function
    // is tested against Postgres in test/db/acceptDriverOfferAtomic.db.test.js).
    mockSupabaseClient.rpc = async (fn, args) => {
      if (fn !== "accept_driver_offer_atomic") return { data: null, error: null };
      const offer = state.driver_offers.find((o) => o.id === args.p_offer_id);
      const r = state.rides.find((x) => x.id === offer.ride_id);
      if (offer.driver_id !== args.p_driver_id || offer.status !== "pending" || r.driver_id) return { data: [{ outcome: "offer_not_pending" }], error: null };
      offer.status = "accepted";
      Object.assign(r, { driver_id: offer.driver_id, status: "driver_assigned", accepted_at: new Date().toISOString() });
      return { data: [{ outcome: "accepted", ride_id: r.id, offer_id: offer.id, driver_id: offer.driver_id, rider_id: r.rider_id }], error: null };
    };
    try {
      expect((await post("/api/driver/offers/OFFER_A/accept").set(driverAuth).send({})).status).toBe(200);
      await new Promise((r) => setTimeout(r, 30));
      const original = { eta: ride().eta_at_accept_minutes, due: ride().pickup_due_at };
      expect(original.eta).toBe(6);
      expect(original.due).toBeTruthy();
      await post("/api/driver/rides/RIDE_1/contact-attempt").set(driverAuth).send({ method: "call" });

      const w = await post("/api/driver/rides/RIDE_1/withdraw").set(driverAuth).send({ reason: "test" });
      expect(w.body).toMatchObject({ status: "awaiting_driver_acceptance" });
      // Redispatch (no online drivers in this fixture) is not under test
      // here: put the ride where dispatch would have, with an offer to B.
      Object.assign(ride(), { status: "awaiting_driver_acceptance", driver_id: null });
      ride().driver_eta_to_pickup_minutes = 12; // the new driver is further away
      state.driver_offers.push({ id: "OFFER_B", ride_id: "RIDE_1", driver_id: OTHER_DRIVER.id, status: "pending", created_at: new Date().toISOString() });

      expect((await post("/api/driver/offers/OFFER_B/accept").set(otherDriverAuth).send({})).status).toBe(200);
      await new Promise((r) => setTimeout(r, 30));
      expect(ride()).toMatchObject({ status: "driver_assigned", driver_id: OTHER_DRIVER.id, eta_at_accept_minutes: 6, pickup_due_at: original.due, contact_attempt_count: 0 });
    } finally {
      mockSupabaseClient.rpc = realRpc;
    }
  });
});
