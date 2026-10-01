// App Review end-to-end paths with the payment gate ON (as in
// production). A reviewer ride must never reach Stripe at any step --
// creation, authorization, cancellation or completion -- and ordinary
// riders/drivers must see no change. Stripe is mocked so that ANY call
// fails the test.

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
const { hashReviewPassword } = require("../lib/reviewAccounts");
const { signRideQuote } = require("../lib/rideQuote");
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestRiderToken,
  signTestDriverToken,
  riderAuthHeaders,
  driverAuthHeaders
} = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

// Every Stripe method records the call and throws: a review ride must
// never get this far.
const mockStripeCalls = [];
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => {
    const trap = (name) => (...args) => {
      mockStripeCalls.push({ name, args });
      throw new Error(`Stripe ${name} must not be called in this test`);
    };
    return {
      paymentIntents: {
        create: trap("paymentIntents.create"),
        retrieve: trap("paymentIntents.retrieve"),
        update: trap("paymentIntents.update"),
        capture: trap("paymentIntents.capture"),
        cancel: trap("paymentIntents.cancel")
      },
      customers: { create: trap("customers.create"), retrieve: trap("customers.retrieve") },
      paymentMethods: { list: trap("paymentMethods.list") },
      refunds: { create: trap("refunds.create") },
      transfers: { create: trap("transfers.create") }
    };
  })
);

const request = require("supertest");

// Test-only fixtures, hashed into the fake database below. Not real
// credentials; the real review passwords live only in the store consoles.
const RIDER_PASSWORD = "AppReviewRiderPass123!";
const DRIVER_PASSWORD = "AppReviewDriverPass456!";
const riderCreds = hashReviewPassword(RIDER_PASSWORD);
const driverCreds = hashReviewPassword(DRIVER_PASSWORD);

const REVIEW_RIDER = makeRider({
  id: "RIDER_APP_REVIEW",
  email: "app-review-rider@example.test",
  phone: "+15555550100",
  is_review_account: true,
  review_password_salt: riderCreds.salt,
  review_password_hash: riderCreds.hash
});
const REVIEW_DRIVER = makeDriver({
  id: "DRIVER_APP_REVIEW",
  email: "app-review-driver@example.test",
  phone: "+15555550200",
  is_review_account: true,
  review_password_salt: driverCreds.salt,
  review_password_hash: driverCreds.hash,
  current_lat: 36.163,
  current_lng: -86.781
});
const ORDINARY_RIDER = makeRider({ id: "RIDER_REAL" });
const ORDINARY_DRIVER = makeDriver({ id: "DRIVER_REAL", email: "real.driver@example.test", phone: "+16155550299" });

const RIDER_CLIENT_HEADER = { "x-requested-with": "harvey-rider-app" };

let app;

function resetState() {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [{ ...REVIEW_RIDER }, { ...ORDINARY_RIDER }],
    drivers: [{ ...REVIEW_DRIVER }, { ...ORDINARY_DRIVER }],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    payments: [],
    audit_logs: [],
    // Same values production has today.
    system_flags: [
      { key: "review_account_login_enabled", value: "true" },
      { key: "rider_history_enabled", value: "true" }
    ]
  });
}

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { driver_earnings: ["ride_id"] } });
  resetState();
  ({ app } = require("../server"));
});

beforeEach(() => {
  resetState();
  mockStripeCalls.length = 0;
});

afterEach(() => {
  expect(mockStripeCalls).toEqual([]);
});

function quoteBody({ riderId, scheduledFor } = {}) {
  const pickup = { lat: 36.1627, lng: -86.7816 };
  const destination = { lat: 36.1745, lng: -86.7679 };
  const estimate = { total: 18.5, driver_payout: 14, platform_fee: 4.5, miles: 3.2, minutes: 12 };
  return {
    estimate_token: signRideQuote({
      rideType: "standard",
      miles: 3.2,
      minutes: 12,
      pickup,
      destination,
      riderId,
      estimate,
      secret: process.env.RIDE_QUOTE_SECRET,
      ttlMinutes: 15
    }),
    ride_type: "standard",
    rider_id: riderId,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    pickup: "501 Broadway, Nashville, TN",
    destination: "600 Charlotte Ave, Nashville, TN",
    rider_name: "App Reviewer",
    rider_phone: "+15555550100",
    ...(scheduledFor ? { scheduled_for: scheduledFor } : {})
  };
}

async function reviewerRiderAgent() {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/review/rider/login")
    .set(RIDER_CLIENT_HEADER)
    .send({ email: REVIEW_RIDER.email, password: RIDER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

// The reviewer login route is rate-limited (5 per 10 minutes per email);
// tests beyond the sign-in ones use a session signed the same way the
// login route signs it, so they don't trip that limit.
const reviewerHeaders = () => riderAuthHeaders(signTestRiderToken(REVIEW_RIDER.id));

function asReviewer() {
  return {
    post: (path) => request(app).post(path).set(reviewerHeaders()),
    get: (path) => request(app).get(path).set(reviewerHeaders())
  };
}

describe("App Review sign-in", () => {
  test("rider and driver reviewer accounts sign in with email + password, no code", async () => {
    await reviewerRiderAgent();

    const driver = await request(app)
      .post("/api/review/driver/login")
      .send({ email: REVIEW_DRIVER.email, password: DRIVER_PASSWORD });
    expect(driver.status).toBe(200);
    expect(driver.body.driver_token).toEqual(expect.any(String));
  });

  test("an ordinary rider or driver email can never use the reviewer password route", async () => {
    const rider = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: ORDINARY_RIDER.email, password: RIDER_PASSWORD });
    expect(rider.status).toBe(401);

    const driver = await request(app)
      .post("/api/review/driver/login")
      .send({ email: ORDINARY_DRIVER.email, password: DRIVER_PASSWORD });
    expect(driver.status).toBe(401);
  });

  test("the reviewer session reports review_mode; an ordinary rider's does not", async () => {
    const reviewer = await asReviewer().get("/api/rider/session");
    expect(reviewer.status).toBe(200);
    expect(reviewer.body.review_mode).toBe(true);

    const ordinary = await request(app)
      .get("/api/rider/session")
      .set(riderAuthHeaders(signTestRiderToken(ORDINARY_RIDER.id)));
    expect(ordinary.status).toBe(200);
    expect(ordinary.body.review_mode).toBe(false);
  });

  test("user-facing messages name neither Apple nor Google", async () => {
    mockSupabaseClient._state.system_flags.find((f) => f.key === "review_account_login_enabled").value = "false";
    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: RIDER_PASSWORD });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/google|apple/i);
  });
});

describe("Reviewer rider: request, schedule, authorize, cancel -- never Stripe", () => {
  test("a reviewer ride is created already authorized with payment not_required, simulated, and dispatched only to the review driver", async () => {
    const agent = asReviewer();
    const res = await agent.post("/api/rides/request").send(quoteBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride).toMatchObject({
      is_review_ride: true,
      payment_status: "not_required",
      payment_id: null
    });
    // Created payment_authorized, then immediately offered to the review
    // driver by dispatchRide().
    expect(["payment_authorized", "awaiting_driver_acceptance"]).toContain(res.body.ride.status);
    expect(res.body.review_mode).toBe(true);
    expect(res.body.simulated_label).toMatch(/simulated payment/i);
    expect(res.body.dispatch?.driver?.id).toBe(REVIEW_DRIVER.id);
  });

  test("a scheduled reviewer ride is authorized without Stripe and held for its scheduled time", async () => {
    const agent = asReviewer();
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const res = await agent
      .post("/api/rides/request")
      .send(quoteBody({ riderId: REVIEW_RIDER.id, scheduledFor: later }));

    expect(res.status).toBe(201);
    expect(res.body.ride).toMatchObject({ is_review_ride: true, status: "payment_authorized", payment_status: "not_required" });
    expect(res.body.ride.scheduled_time).toBe(later);
    expect(res.body.dispatch).toBeNull();
  });

  test("authorize on a reviewer ride is a simulated no-op (old clients) and never calls Stripe", async () => {
    const agent = asReviewer();
    const created = await agent.post("/api/rides/request").send(quoteBody({ riderId: REVIEW_RIDER.id }));
    const res = await agent
      .post(`/api/rides/${created.body.ride.id}/authorize`)
      .send({ payment_intent_id: "review_sim_REVIEWPAY-1" });

    expect(res.status).toBe(200);
    expect(res.body.simulated_payment).toBe(true);
  });

  test("a reviewer ride still awaiting payment can be authorized only by its own reviewer session", async () => {
    mockSupabaseClient._state.rides.push(
      makeRide({ id: "RIDE_REVIEW_OLD", rider_id: REVIEW_RIDER.id, is_review_ride: true, status: "payment_required", payment_id: null })
    );

    const stranger = await request(app).post("/api/rides/RIDE_REVIEW_OLD/authorize").send({ payment_intent_id: "pi_x" });
    expect(stranger.status).toBe(403);

    const ordinary = await request(app)
      .post("/api/rides/RIDE_REVIEW_OLD/authorize")
      .set(riderAuthHeaders(signTestRiderToken(ORDINARY_RIDER.id)))
      .send({});
    expect(ordinary.status).toBe(403);

    const res = await asReviewer().post("/api/rides/RIDE_REVIEW_OLD/authorize").send({});
    expect(res.status).toBe(200);
    expect(res.body.ride.payment_status).toBe("not_required");
    expect(["payment_authorized", "awaiting_driver_acceptance"]).toContain(res.body.ride.status);
  });

  test("cancelling a reviewer ride records not_required and never contacts Stripe", async () => {
    const agent = asReviewer();
    const created = await agent.post("/api/rides/request").send(quoteBody({ riderId: REVIEW_RIDER.id }));
    const res = await agent.post(`/api/rides/${created.body.ride.id}/cancel`).send({ reason: "App Review test" });

    expect(res.status).toBe(200);
    const ride = mockSupabaseClient._state.rides.find((r) => r.id === created.body.ride.id);
    expect(ride.status).toBe("cancelled");
    expect(ride.cancellation_payment_status).toBe("not_required");
  });

  test("ride history lists the reviewer's own rides", async () => {
    const agent = asReviewer();
    const created = await agent.post("/api/rides/request").send(quoteBody({ riderId: REVIEW_RIDER.id }));
    const res = await agent.get(`/api/rider/rides?riderId=${REVIEW_RIDER.id}&limit=25`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(created.body.ride.id);
  });
});

describe("Ordinary riders are unchanged", () => {
  test("an ordinary rider's ride still starts payment_required with no review fields", async () => {
    const res = await request(app)
      .post("/api/rides/request")
      .set(riderAuthHeaders(signTestRiderToken(ORDINARY_RIDER.id)))
      .send(quoteBody({ riderId: ORDINARY_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.ride.status).toBe("payment_required");
    expect(res.body.ride.payment_status ?? null).not.toBe("not_required");
    expect(res.body.review_mode).toBeUndefined();
    expect(res.body.dispatch).toBeNull();
  });

  test("client-supplied review flags on an ordinary ride have no effect", async () => {
    const body = { ...quoteBody({ riderId: ORDINARY_RIDER.id }), is_review_ride: true, review_mode: true, payment_status: "not_required" };
    const res = await request(app)
      .post("/api/rides/request")
      .set(riderAuthHeaders(signTestRiderToken(ORDINARY_RIDER.id)))
      .send(body);

    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.ride.status).toBe("payment_required");
  });
});

describe("Reviewer driver: en route, arrived, start, complete, earnings -- never Stripe", () => {
  const driverToken = signTestDriverToken(REVIEW_DRIVER.id);

  function seedAssignedReviewRide(status) {
    mockSupabaseClient._state.rides.push(
      makeRide({
        id: "RIDE_REVIEW_TRIP",
        rider_id: REVIEW_RIDER.id,
        is_review_ride: true,
        driver_id: REVIEW_DRIVER.id,
        status,
        payment_id: null,
        payment_status: "not_required"
      })
    );
  }

  test("the full trip lifecycle completes without capture and records a simulated earning", async () => {
    seedAssignedReviewRide("driver_assigned");

    for (const step of ["enroute", "arrived", "start", "complete"]) {
      const res = await request(app)
        .post(`/api/driver/rides/RIDE_REVIEW_TRIP/${step}`)
        .set(driverAuthHeaders(driverToken))
        .send({});
      expect({ step, status: res.status, error: res.body.error }).toEqual({ step, status: 200, error: undefined });
    }

    const ride = mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_REVIEW_TRIP");
    expect(ride.status).toBe("completed");
    expect(ride.payment_status).toBe("not_required");

    const earnings = await request(app)
      .get(`/api/driver/${REVIEW_DRIVER.id}/earnings`)
      .set(driverAuthHeaders(driverToken));
    expect(earnings.status).toBe(200);
    expect(earnings.body.review_mode).toBe(true);
    expect(earnings.body.review_label).toMatch(/simulated/i);
    expect(earnings.body.records).toHaveLength(1);
  });

  test("an ordinary driver's earnings response has no review fields", async () => {
    const res = await request(app)
      .get(`/api/driver/${ORDINARY_DRIVER.id}/earnings`)
      .set(driverAuthHeaders(signTestDriverToken(ORDINARY_DRIVER.id)));
    expect(res.status).toBe(200);
    expect(res.body.review_mode).toBeUndefined();
  });
});
