// Card-payment flow, end to end, in an ISOLATED environment:
//   - a throwaway local Postgres built from production's schema (no
//     production data), served through PostgREST like Supabase, so the
//     real constraints (rides.payment_id -> payments.id), conditional
//     writes and dispatch functions are exercised;
//   - synthetic riders and test drivers only (@example.test, 555-01xx);
//   - SMS, email, push and other provider credentials removed;
//   - Stripe in TEST mode when STRIPE_TEST_SECRET_KEY is a test key,
//     otherwise a stateful simulator (test/isolated/stripeSimulator.js).
//
// Opt-in, never part of the default run:
//   HARVEY_ISOLATED_E2E=1 \
//   HARVEY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
//   POSTGREST_BIN=/path/to/postgrest \
//   [STRIPE_TEST_SECRET_KEY=sk_test_...] \
//   npx jest test/stripe-isolated --runInBand
//
// See docs/unused-card-holds.md section 6.

const RUN = process.env.HARVEY_ISOLATED_E2E === "1";
const TEST_KEY = process.env.STRIPE_TEST_SECRET_KEY || "";
const KEY_IS_TEST = /^(sk|rk)_test_/.test(TEST_KEY);
if (TEST_KEY && !KEY_IS_TEST) {
  throw new Error("STRIPE_TEST_SECRET_KEY must be a Stripe TEST key (sk_test_/rk_test_). Refusing to run.");
}
const STRIPE_MODE = KEY_IS_TEST ? "stripe_test_mode" : "simulated";

const { startIsolatedEnvironment, stripOutboundCredentials } = require("./isolated/isolatedEnv");
const { createStripeSimulator } = require("./isolated/stripeSimulator");
const { makeRider, makeDriver, makeRide, signTestRiderToken, signTestDriverToken, riderAuthHeaders, driverAuthHeaders } = require("./rideTestHelpers");

const describeIsolated = RUN ? describe : describe.skip;
jest.setTimeout(180000);

describeIsolated(`card flow in an isolated environment (Stripe: ${STRIPE_MODE})`, () => {
  let env;
  let app;
  let request;
  let stripe;
  const created = [];

  beforeAll(async () => {
    env = await startIsolatedEnvironment();

    stripOutboundCredentials(process.env);
    Object.assign(process.env, {
      NODE_ENV: "test",
      HARVEY_ISOLATED_TEST: "1",
      API_RATE_LIMIT_PER_MINUTE: "100000",
      UNUSED_HOLD_RELEASE_PER_MINUTE: "100000",
      SUPABASE_URL: env.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
      RIDER_SESSION_SECRET: "isolated-rider-session-secret",
      DRIVER_SESSION_SECRET: "isolated-driver-session-secret",
      RIDE_QUOTE_SECRET: "isolated-ride-quote-secret",
      ADMIN_API_TOKEN: "isolated-admin-token",
      ENABLE_PAYMENT_GATE: "true",
      STRIPE_SECRET_KEY: KEY_IS_TEST ? TEST_KEY : "sk_test_simulated_not_a_real_key"
    });

    if (KEY_IS_TEST) {
      stripe = require("stripe")(TEST_KEY);
    } else {
      stripe = createStripeSimulator();
      jest.doMock("stripe", () => function StripeSimulator() {
        return stripe;
      });
    }
    ({ app } = require("../server"));
    request = require("supertest");
  });

  afterAll(async () => {
    if (KEY_IS_TEST) {
      for (const id of created) {
        try {
          const pi = await stripe.paymentIntents.retrieve(id);
          if (!["canceled", "succeeded"].includes(pi.status)) await stripe.paymentIntents.cancel(id);
        } catch {
          /* already gone */
        }
      }
    }
    if (env) await env.teardown();
  });

  const testDrivers = () => [
    makeDriver(),
    makeDriver({ id: "DRIVER_2", first_name: "Avery", last_name: "Stone", email: "avery@example.test", phone: "+16155550202", current_lat: 36.161, current_lng: -86.781 })
  ];
  const ride = (overrides = {}) => makeRide({ status: "payment_required", dispatch_status: null, payment_id: null, estimated_fare: 20, ...overrides });

  async function reset(rides = []) {
    await env.reset({ riders: [makeRider()], drivers: testDrivers(), rides, flags: { unused_hold_release_enabled: "true" } });
  }

  async function hold({ amount = 2000, card = "pm_card_visa" } = {}) {
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      capture_method: "manual",
      payment_method_types: ["card"],
      metadata: { app: "harvey_taxi", ride_type: "standard", rider_id: "RIDER_1" }
    });
    created.push(pi.id);
    try {
      return await stripe.paymentIntents.confirm(pi.id, { payment_method: card });
    } catch (err) {
      return { ...(await stripe.paymentIntents.retrieve(pi.id)), declined: err.code || err.type };
    }
  }

  const authorize = (rideId, piId) => request(app).post(`/api/rides/${rideId}/authorize`).send({ payment_intent_id: piId });
  const release = (pi) => request(app).post(`/api/payments/holds/${pi.id}/release`).send({ client_secret: pi.client_secret });
  const q = async (sql, params = []) => (await env.db.query(sql, params)).rows;
  const rideRow = async (id = "RIDE_1") => (await q("select * from public.rides where id = $1", [id]))[0];
  const paymentRow = async (id) => (await q("select * from public.payments where id = $1", [id]))[0];
  const pendingOffers = async () => Number((await q("select count(*) from public.driver_offers where status = 'pending'"))[0].count);

  test("isolation: local database, synthetic people only, no outbound providers configured", async () => {
    await reset([ride()]);
    expect(env.dbName).toMatch(/^harvey_isolated_[0-9a-f]+$/);
    const people = await q("select email, phone from public.riders union all select email, phone from public.drivers");
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) {
      expect(p.email).toMatch(/@example\.test$/);
      expect(p.phone).toMatch(/^\+1615555\d{4}$/);
    }
    // Integration details are admin-only.
    const health = await request(app).get("/api/health").set("x-admin-token", "isolated-admin-token");
    expect(health.body.integrations).toMatchObject({ sendgrid: false, twilio: false, web_push: false, stripe: true });
  });

  test("the real database enforces rides.payment_id -> payments.id", async () => {
    await reset([ride()]);
    await expect(env.db.query("update public.rides set payment_id = 'pi_does_not_exist' where id = 'RIDE_1'")).rejects.toThrow(/rides_payment_id_fkey/);
  });

  test("successful authorization: payment record created and bound, ride dispatched to a test driver once", async () => {
    await reset([ride()]);
    const pi = await hold();
    expect(pi.status).toBe("requires_capture");
    const res = await authorize("RIDE_1", pi.id);
    expect(res.status).toBe(200);
    const payment = await paymentRow(pi.id);
    expect(payment).toMatchObject({ status: "authorized", ride_id: "RIDE_1", rider_id: "RIDER_1" });
    expect(Number(payment.amount)).toBe(20);
    expect(payment.client_secret).toBeNull();
    const r = await rideRow();
    expect(r.payment_id).toBe(pi.id);
    expect(r.status).toMatch(/payment_authorized|awaiting_driver_acceptance/);
    expect(await pendingOffers()).toBe(1);
    const offer = (await q("select driver_id from public.driver_offers where status = 'pending'"))[0];
    expect(["DRIVER_1", "DRIVER_2"]).toContain(offer.driver_id);
    const atStripe = await stripe.paymentIntents.retrieve(pi.id);
    expect(atStripe.metadata.ride_id).toBe("RIDE_1");
    expect(atStripe.status).toBe("requires_capture");
  });

  test("failed authorization (declined card): nothing bound, ride not authorized, nothing dispatched", async () => {
    await reset([ride()]);
    const pi = await hold({ card: "pm_card_chargeDeclined" });
    expect(pi.declined).toBeTruthy();
    const res = await authorize("RIDE_1", pi.id);
    expect(res.status).toBe(402);
    const r = await rideRow();
    expect(r).toMatchObject({ status: "payment_required", payment_id: null });
    expect(await q("select 1 from public.payments where status = 'authorized'")).toHaveLength(0);
    expect(await pendingOffers()).toBe(0);
  });

  test("duplicate requests: concurrent and repeated authorizations dispatch exactly once", async () => {
    await reset([ride()]);
    const pi = await hold();
    const results = await Promise.all([authorize("RIDE_1", pi.id), authorize("RIDE_1", pi.id), authorize("RIDE_1", pi.id)]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(await pendingOffers()).toBe(1);
    const later = await authorize("RIDE_1", pi.id);
    expect(later.status).toBe(200);
    expect(later.body.already_authorized).toBe(true);
    expect(await pendingOffers()).toBe(1);
    expect(Number((await q("select count(*) from public.payments where id = $1", [pi.id]))[0].count)).toBe(1);
  });

  test("the same hold cannot authorize a second ride", async () => {
    await reset([ride(), ride({ id: "RIDE_2" })]);
    const pi = await hold();
    expect((await authorize("RIDE_1", pi.id)).status).toBe(200);
    expect((await authorize("RIDE_2", pi.id)).status).toBe(409);
    expect((await rideRow("RIDE_2")).payment_id).toBeNull();
  });

  test("abandoned hold: the owner's release cancels it once", async () => {
    await reset([]);
    const pi = await hold();
    const res = await release(pi);
    expect(res.status).toBe(200);
    expect((await stripe.paymentIntents.retrieve(pi.id)).status).toBe("canceled");
    expect((await paymentRow(pi.id)).status).toBe("released");
    expect((await release(pi)).status).toBe(409);
  });

  test("a ride's payment is never cancelled by a release request", async () => {
    await reset([ride()]);
    const pi = await hold();
    expect((await authorize("RIDE_1", pi.id)).status).toBe(200);
    expect((await release(pi)).status).toBe(409);
    expect((await stripe.paymentIntents.retrieve(pi.id)).status).toBe("requires_capture");
    expect((await paymentRow(pi.id)).status).toBe("authorized");
  });

  test.each([1, 2, 3, 4, 5])("simultaneous release and ride attachment (run %i): exactly one wins, never both", async () => {
    await reset([ride()]);
    const pi = await hold();
    const [rel, auth] = await Promise.all([release(pi), authorize("RIDE_1", pi.id)]);
    const atStripe = await stripe.paymentIntents.retrieve(pi.id);
    const r = await rideRow();
    if (r.payment_id === pi.id) {
      expect(auth.status).toBe(200);
      expect(rel.status).toBe(409);
      expect(atStripe.status).toBe("requires_capture");
      expect(await pendingOffers()).toBe(1);
    } else {
      expect(rel.status).toBe(200);
      expect(auth.status).not.toBe(200);
      expect(atStripe.status).toBe("canceled");
      expect(r.status).toBe("payment_required");
      expect(await pendingOffers()).toBe(0);
    }
  });
  // The booking flow exactly as the rider dashboard drives it, through the
  // server's own routes: estimate -> payment-intent -> (card confirmed, as
  // Stripe.js would) -> ride request -> authorize -> test driver accepts ->
  // rider cancels (the existing void workflow cancels the hold).
  test("full booking flow through the server's routes, then rider cancellation voids the hold", async () => {
    await reset([]);
    const rider = riderAuthHeaders(signTestRiderToken("RIDER_1"));
    const trip = {
      pickup: "100 Main St", destination: "200 Elm St",
      pickup_lat: 36.16, pickup_lng: -86.78, destination_lat: 36.17, destination_lng: -86.79,
      ride_type: "standard", rider_id: "RIDER_1"
    };

    const estimate = await request(app).post("/api/rides/estimate").set(rider).send({ ...trip, miles: 5, minutes: 12 });
    expect(estimate.status).toBe(200);
    const body = { ...trip, miles: 5, minutes: 12, estimate_token: estimate.body.estimate_token };

    const intentRes = await request(app).post("/api/rides/payment-intent").set(rider).send({ ...body, idempotency_key: "isolated-flow-1" });
    expect(intentRes.status).toBe(200);
    const piId = intentRes.body.payment_intent_id || intentRes.body.paymentIntentId || intentRes.body.id || String(intentRes.body.client_secret).split("_secret_")[0];
    created.push(piId);
    // The "created" record is written best effort after the response.
    let createdRecord;
    for (let i = 0; i < 50 && !createdRecord; i++) {
      createdRecord = await paymentRow(piId);
      if (!createdRecord) await new Promise((r) => setTimeout(r, 100));
    }
    expect(createdRecord).toMatchObject({ status: "created", rider_id: "RIDER_1", ride_id: null, client_secret: null });
    await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });

    const rideRes = await request(app).post("/api/rides/request").set(rider).send(body);
    expect([200, 201]).toContain(rideRes.status);
    const rideId = rideRes.body.ride?.id || rideRes.body.ride_id || rideRes.body.id;
    expect((await rideRow(rideId)).status).toBe("payment_required");

    const auth = await request(app).post(`/api/rides/${rideId}/authorize`).set(rider).send({ payment_intent_id: piId });
    expect(auth.status).toBe(200);
    expect(await paymentRow(piId)).toMatchObject({ status: "authorized", ride_id: rideId });
    const offers = await q("select id, driver_id from public.driver_offers where ride_id = $1 and status = 'pending'", [rideId]);
    expect(offers).toHaveLength(1);

    const accepted = await request(app)
      .post(`/api/driver/offers/${offers[0].id}/accept`)
      .set(driverAuthHeaders(signTestDriverToken(offers[0].driver_id)))
      .send({});
    expect(accepted.status).toBe(200);
    expect(await rideRow(rideId)).toMatchObject({ status: "driver_assigned", driver_id: offers[0].driver_id, payment_id: piId });

    // A release request can never cancel the hold of a booked ride.
    expect((await request(app).post(`/api/payments/holds/${piId}/release`).send({ client_secret: intentRes.body.client_secret })).status).toBe(409);
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("requires_capture");

    const cancel = await request(app).post(`/api/rides/${rideId}/cancel`).set(rider).send({ reason: "isolated test" });
    expect(cancel.status).toBe(200);
    const after = await rideRow(rideId);
    expect(after.status).toBe("cancelled");
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("canceled");
    expect(after.cancellation_payment_status).toBe("cancelled");
  });

  // Two server instances (as with more than one production instance)
  // sharing the same database: concurrent authorizations of one ride
  // through different instances still dispatch exactly once.
  test("two server instances racing the same authorization dispatch exactly once", async () => {
    let app2;
    jest.isolateModules(() => {
      ({ app: app2 } = require("../server"));
    });
    for (let run = 0; run < 3; run++) {
      await reset([ride()]);
      const pi = await hold();
      const results = await Promise.all([
        request(app).post("/api/rides/RIDE_1/authorize").send({ payment_intent_id: pi.id }),
        request(app2).post("/api/rides/RIDE_1/authorize").send({ payment_intent_id: pi.id }),
        request(app).post("/api/rides/RIDE_1/authorize").send({ payment_intent_id: pi.id }),
        request(app2).post("/api/rides/RIDE_1/authorize").send({ payment_intent_id: pi.id })
      ]);
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
      expect(await pendingOffers()).toBe(1);
      expect(Number((await q("select count(*) from public.payments where id = $1", [pi.id]))[0].count)).toBe(1);
    }
  });
});

test("guard: a live Stripe key is never accepted", () => {
  expect(/^(sk|rk)_test_/.test("sk_live_x")).toBe(false);
  expect(/^(sk|rk)_test_/.test("rk_live_x")).toBe(false);
});
