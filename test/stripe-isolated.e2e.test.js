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
  // ---- Untracked-hold fix: persist before returning the client secret,
  // cancel or alert on failure, Stripe-side reconciliation. ----

  const SIM_ONLY = KEY_IS_TEST ? test.skip : test;
  const TRIP = { pickup: "100 Main St", destination: "200 Elm St", pickup_lat: 36.16, pickup_lng: -86.78, destination_lat: 36.17, destination_lng: -86.79, ride_type: "standard" };

  async function createIntent({ headers = {}, riderId, key, server = app } = {}) {
    const est = await request(server).post("/api/rides/estimate").set(headers).send({ ...TRIP, miles: 5, minutes: 12, ...(riderId ? { rider_id: riderId } : {}) });
    expect(est.status).toBe(200);
    const res = await request(server)
      .post("/api/rides/payment-intent")
      .set(headers)
      .send({ ...TRIP, miles: 5, minutes: 12, estimate_token: est.body.estimate_token, idempotency_key: key || `k-${Math.random()}`, ...(riderId ? { rider_id: riderId } : {}) });
    if (res.body.payment_intent_id) created.push(res.body.payment_intent_id);
    return res;
  }

  async function rejectCreatedRecordWrites(on) {
    if (on) {
      await env.db.query(`create or replace function public.test_reject_created() returns trigger language plpgsql as $$ begin raise exception 'simulated payments write failure'; end $$;
        drop trigger if exists test_reject_created on public.payments;
        create trigger test_reject_created before insert on public.payments for each row when (new.status = 'created') execute function public.test_reject_created();`);
    } else {
      await env.db.query("drop trigger if exists test_reject_created on public.payments");
    }
  }

  const setFlag = (key, value) => env.db.query("insert into public.system_flags(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, value]);
  const ownOnly = (ids) => (pi) => ids.includes(pi.id);
  const reconcile = (opts) => require("../server").reconcileStripeHolds({ minAgeMs: 0, ...opts });

  // Regression for the reproduced gap: a failed background write used to
  // leave a confirmed hold that nothing tracked.
  test("REGRESSION: a payments-write failure never leaves a usable, untracked intent", async () => {
    await reset([]);
    await rejectCreatedRecordWrites(true);
    try {
      const res = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
      expect(res.status).toBe(503);
      expect(res.body.retry_with_new_key).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/_secret_/);
      expect(res.body.client_secret).toBeUndefined();
    } finally {
      await rejectCreatedRecordWrites(false);
    }
    // The intent the server created was cancelled at Stripe.
    const own = (await stripe.paymentIntents.list({ limit: 5 })).data.filter((pi) => pi.metadata?.account === "harvey_taxi_service");
    expect(own.length).toBeGreaterThan(0);
    expect(own[0].status).toBe("canceled");
    created.push(own[0].id);
    expect(await q("select 1 from public.payments")).toHaveLength(0);
  });

  SIM_ONLY("write failure AND cancel failure: no secret, redacted alert, recovered by reconciliation", async () => {
    await reset([]);
    const alerts = [];
    const spy = jest.spyOn(console, "error").mockImplementation((tag, payload) => {
      if (tag === "🚨 PAYMENT_OPS_ALERT") alerts.push(payload);
    });
    await rejectCreatedRecordWrites(true);
    stripe._failCancel("*", true);
    let res;
    try {
      res = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
    } finally {
      stripe._failCancel("*", false);
      await rejectCreatedRecordWrites(false);
      spy.mockRestore();
    }
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/_secret_/);
    expect(alerts).toHaveLength(1);
    const alert = JSON.parse(alerts[0]);
    expect(alert).toMatchObject({ event: "payment_intent_untracked", reason: "record_write_failed_and_cancel_failed" });
    expect(alerts[0]).not.toMatch(/_secret_|example\.test/);
    const piId = alert.payment_intent_id;
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("requires_payment_method");
    expect(await paymentRow(piId)).toBeUndefined();

    // Reconciliation (cleanup off) records it; with cleanup on, cancels it.
    const dry = await reconcile({ intentFilter: ownOnly([piId]) });
    expect(dry).toMatchObject({ newly_tracked: 1, would_release: 1, released: 0, cleanup_enabled: false });
    expect(await paymentRow(piId)).toMatchObject({ status: "created", rider_id: "RIDER_1" });
    await setFlag("unused_hold_sweep_enabled", "true");
    const live = await reconcile({ intentFilter: ownOnly([piId]) });
    expect(live).toMatchObject({ released: 1, cleanup_enabled: true });
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("canceled");
  });

  test("app termination after the card hold: the record already exists; reconciliation cancels only when cleanup is on", async () => {
    await reset([]);
    const res = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
    expect(res.status).toBe(200);
    const piId = res.body.payment_intent_id;
    // Persisted before the response -- no waiting.
    expect(await paymentRow(piId)).toMatchObject({ status: "created", rider_id: "RIDER_1", client_secret: null });
    await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
    // ...and the app is killed: no release call, no booking.

    const dry = await reconcile({ intentFilter: ownOnly([piId]) });
    expect(dry).toMatchObject({ would_release: 1, released: 0, cleanup_enabled: false });
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("requires_capture");

    await setFlag("unused_hold_sweep_enabled", "true");
    const live = await reconcile({ intentFilter: ownOnly([piId]) });
    expect(live.released).toBe(1);
    expect((await stripe.paymentIntents.retrieve(piId)).status).toBe("canceled");
    expect((await paymentRow(piId)).status).toBe("released");
  });

  test("missing rider identity: tracked as unidentified; a client-claimed rider_id never proves ownership", async () => {
    await reset([]);
    const anon = await createIntent({});
    expect(anon.status).toBe(200);
    expect(await paymentRow(anon.body.payment_intent_id)).toMatchObject({ status: "created", rider_id: "unidentified" });
    const anonPi = await stripe.paymentIntents.retrieve(anon.body.payment_intent_id);
    expect(anonPi.metadata).toMatchObject({ app: "harvey_taxi", account: "harvey_taxi_service", rider_verified: "false" });

    // Sessionless request naming RIDER_1: recorded, but not verified.
    const claimed = await createIntent({ riderId: "RIDER_1" });
    const claimedPi = await stripe.paymentIntents.retrieve(claimed.body.payment_intent_id);
    expect(claimedPi.metadata).toMatchObject({ rider_id: "RIDER_1", rider_verified: "false" });
    const asRider = riderAuthHeaders(signTestRiderToken("RIDER_1"));
    expect((await request(app).post(`/api/payments/holds/${claimedPi.id}/release`).set(asRider).send({})).status).toBe(404);
    // The browser that created it (holds the client secret) can release it.
    expect((await request(app).post(`/api/payments/holds/${claimedPi.id}/release`).send({ client_secret: claimed.body.client_secret })).status).toBe(200);

    // A verified session's own hold can be released by that session.
    const verified = await createIntent({ headers: asRider, riderId: "RIDER_1" });
    expect((await stripe.paymentIntents.retrieve(verified.body.payment_intent_id)).metadata.rider_verified).toBe("true");
    expect((await request(app).post(`/api/payments/holds/${verified.body.payment_intent_id}/release`).set(asRider).send({})).status).toBe(200);
  });

  test("duplicate requests with one idempotency key: one intent, one record, same secret", async () => {
    await reset([]);
    const headers = riderAuthHeaders(signTestRiderToken("RIDER_1"));
    const est = await request(app).post("/api/rides/estimate").set(headers).send({ ...TRIP, miles: 5, minutes: 12, rider_id: "RIDER_1" });
    const body = { ...TRIP, miles: 5, minutes: 12, rider_id: "RIDER_1", estimate_token: est.body.estimate_token, idempotency_key: `dup-${Date.now()}` };
    const results = await Promise.all([1, 2, 3].map(() => request(app).post("/api/rides/payment-intent").set(headers).send(body)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = new Set(results.map((r) => r.body.payment_intent_id));
    expect(ids.size).toBe(1);
    const [piId] = [...ids];
    created.push(piId);
    expect(Number((await q("select count(*) from public.payments where id = $1", [piId]))[0].count)).toBe(1);
    // A retry after the intent was released is refused, and the client is
    // told to start a new attempt (no cancelled intent is handed out).
    await request(app).post(`/api/payments/holds/${piId}/release`).send({ client_secret: results[0].body.client_secret });
    const retry = await request(app).post("/api/rides/payment-intent").set(headers).send(body);
    expect(retry.status).toBe(409);
    expect(retry.body.retry_with_new_key).toBe(true);
    expect(retry.body.client_secret).toBeUndefined();
  });

  test("uncertain attachment or ownership is flagged for review, never cancelled", async () => {
    await reset([]);
    await setFlag("unused_hold_sweep_enabled", "true");
    const alerts = [];
    const spy = jest.spyOn(console, "error").mockImplementation((tag, payload) => {
      if (tag === "🚨 PAYMENT_OPS_ALERT") alerts.push(payload);
    });
    try {
      // Stripe names a ride the database never bound.
      const named = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
      await stripe.paymentIntents.confirm(named.body.payment_intent_id, { payment_method: "pm_card_visa" });
      await stripe.paymentIntents.update(named.body.payment_intent_id, { metadata: { ride_id: "RIDE_UNKNOWN" } });
      // A Harvey Taxi hold without the account tag (pre-fix metadata).
      const legacy = await hold();
      const ids = [named.body.payment_intent_id, legacy.id];
      const summary = await reconcile({ intentFilter: ownOnly(ids) });
      expect(summary).toMatchObject({ review: 2, released: 0 });
      for (const id of ids) {
        expect((await paymentRow(id)).status).toBe("review_required");
        expect((await stripe.paymentIntents.retrieve(id)).status).toBe("requires_capture");
      }
      expect(alerts.filter((a) => JSON.parse(a).event === "payment_hold_review_required")).toHaveLength(2);
      // Flagged once: a second pass does not alert again.
      await reconcile({ intentFilter: ownOnly(ids) });
      expect(alerts).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  test("reconciliation pages through Stripe's list", async () => {
    await reset([]);
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const pi = await stripe.paymentIntents.create(
        { amount: 2000, currency: "usd", capture_method: "manual", metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "RIDER_1", rider_verified: "false" } },
        {}
      );
      created.push(pi.id);
      ids.push(pi.id);
    }
    const summary = await reconcile({ pageSize: 2, intentFilter: ownOnly(ids) });
    expect(summary.pages).toBeGreaterThanOrEqual(3);
    expect(summary.newly_tracked).toBe(5);
    expect(summary.would_release).toBe(5);
    expect(Number((await q("select count(*) from public.payments where id = any($1)", [ids]))[0].count)).toBe(5);
  });

  test("admin dry run: authenticated, reports findings, and changes nothing even with both flags on", async () => {
    await reset([]);
    await setFlag("unused_hold_sweep_enabled", "true");
    await setFlag("stripe_reconciliation_enabled", "true");
    // An unused tracked hold, an untracked hold, and a legacy (no account tag) hold.
    const tracked = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
    await stripe.paymentIntents.confirm(tracked.body.payment_intent_id, { payment_method: "pm_card_visa" });
    const untracked = await stripe.paymentIntents.create({ amount: 2000, currency: "usd", capture_method: "manual", metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "", rider_verified: "false" } }, {});
    created.push(untracked.id);
    await stripe.paymentIntents.confirm(untracked.id, { payment_method: "pm_card_visa" });
    const legacy = await hold();
    const ids = [tracked.body.payment_intent_id, untracked.id, legacy.id];
    for (const id of ids) if (stripe._age) stripe._age(id, 3 * 3600);

    const snapshot = async () => ({
      payments: await q("select id, status, ride_id, rider_id, updated_at from public.payments order by id"),
      audit: Number((await q("select count(*) from public.audit_logs"))[0].count),
      stripe: await Promise.all(ids.map(async (id) => (await stripe.paymentIntents.retrieve(id)).status))
    });
    // The setup's own audit rows (estimate, payment intent) are written in
    // the background; let them land before the "before" snapshot.
    for (let i = 0; i < 50 && Number((await q("select count(*) from public.audit_logs"))[0].count) < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    const before = await snapshot();
    const alerts = [];
    const spy = jest.spyOn(console, "error").mockImplementation((tag) => {
      if (tag === "🚨 PAYMENT_OPS_ALERT") alerts.push(tag);
    });
    let res;
    try {
      expect((await request(app).post("/api/admin/payments/reconcile/dry-run").send({})).status).toBe(401);
      res = await request(app).post("/api/admin/payments/reconcile/dry-run").set("x-admin-token", "isolated-admin-token").send({ dry_run: false });
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.reconciliation.mode).toBe("dry_run");
    expect(await snapshot()).toEqual(before);
    expect(alerts).toHaveLength(0);
    if (!KEY_IS_TEST) {
      // With the simulator the account holds only this test's intents.
      const byId = Object.fromEntries(res.body.reconciliation.findings.map((f) => [f.payment_intent_id, f]));
      expect(byId[tracked.body.payment_intent_id]).toMatchObject({ tracked: true, action: "release_candidate" });
      expect(byId[untracked.id]).toMatchObject({ tracked: false, action: "release_candidate" });
      expect(byId[legacy.id]).toMatchObject({ action: "review", reason: "missing_account_tag" });
      expect(res.body.reconciliation).toMatchObject({ would_track: 2, would_release: 2, review: 1, released: 0, newly_tracked: 0 });
      expect(JSON.stringify(res.body)).not.toMatch(/_secret_|RIDER_1/);
    }
  });

  test("scheduled reconciliation is off unless stripe_reconciliation_enabled is true", async () => {
    await reset([]);
    const untracked = await stripe.paymentIntents.create({ amount: 2000, currency: "usd", capture_method: "manual", metadata: { app: "harvey_taxi", account: "harvey_taxi_service", rider_id: "", rider_verified: "false" } }, {});
    created.push(untracked.id);
    const { runScheduledReconciliation } = require("../server");
    expect(await runScheduledReconciliation()).toEqual({ skipped: true, reason: "disabled" });
    expect(await paymentRow(untracked.id)).toBeUndefined();
  });

  test('"unidentified" records never link sessionless riders or grant ownership', async () => {
    await reset([]);
    const a = await createIntent({});
    const b = await createIntent({ riderId: "unidentified" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await paymentRow(a.body.payment_intent_id)).rider_id).toBe("unidentified");
    expect((await paymentRow(b.body.payment_intent_id)).rider_id).toBe("unidentified");
    // A client-sent "unidentified" is not recorded as an identity at Stripe.
    expect((await stripe.paymentIntents.retrieve(b.body.payment_intent_id)).metadata).toMatchObject({ rider_id: "", rider_verified: "false" });
    // A's secret cannot release B's hold, and vice versa.
    expect((await request(app).post(`/api/payments/holds/${b.body.payment_intent_id}/release`).send({ client_secret: a.body.client_secret })).status).toBe(404);
    expect((await request(app).post(`/api/payments/holds/${a.body.payment_intent_id}/release`).send({ client_secret: b.body.client_secret })).status).toBe(404);
    // Each owner can release its own.
    expect((await request(app).post(`/api/payments/holds/${a.body.payment_intent_id}/release`).send({ client_secret: a.body.client_secret })).status).toBe(200);
    expect((await stripe.paymentIntents.retrieve(b.body.payment_intent_id)).status).not.toBe("canceled");
  });

  // Head starts (ms) for authorization; across them both interleavings occur
  // (measured locally: reconciliation wins at 0 ms most often, authorization
  // at 20 ms), and every run must have exactly one winner.
  test.each([0, 3, 6, 10, 20])("reconciliation (instance B) vs authorization (instance A) race, authorization head start %i ms: exactly one wins", async (delay) => {
    let serverB;
    jest.isolateModules(() => {
      serverB = require("../server");
    });
    await reset([ride()]);
    await setFlag("unused_hold_sweep_enabled", "true");
    const res = await createIntent({ headers: riderAuthHeaders(signTestRiderToken("RIDER_1")), riderId: "RIDER_1" });
    const piId = res.body.payment_intent_id;
    const confirmed = await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
    // The ride's fare must match the route-priced hold, or authorization
    // would fail for that reason instead of racing.
    await env.db.query("update public.rides set estimated_fare = $1 where id = 'RIDE_1'", [confirmed.amount / 100]);
    const [summary, auth] = await Promise.all([
      new Promise((r) => setTimeout(r, delay)).then(() => serverB.reconcileStripeHolds({ minAgeMs: 0, intentFilter: ownOnly([piId]) })),
      authorize("RIDE_1", piId)
    ]);
    const atStripe = await stripe.paymentIntents.retrieve(piId);
    const r = await rideRow();
    if (r.payment_id === piId) {
      expect(auth.status).toBe(200);
      expect(summary.released).toBe(0);
      expect(atStripe.status).toBe("requires_capture");
      expect(await pendingOffers()).toBe(1);
    } else {
      expect(summary.released).toBe(1);
      expect(auth.status).not.toBe(200);
      expect(atStripe.status).toBe("canceled");
      expect(r.status).toBe("payment_required");
      expect(await pendingOffers()).toBe(0);
    }
  });
});

test("guard: a live Stripe key is never accepted", () => {
  expect(/^(sk|rk)_test_/.test("sk_live_x")).toBe(false);
  expect(/^(sk|rk)_test_/.test("rk_live_x")).toBe(false);
});
