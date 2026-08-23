// Composition/integration tests for the Google Play reviewer-account
// feature. Unlike every other *.test.js in this repo (which test pure
// lib/ functions in isolation), these tests exercise the ACTUAL Express
// routes and middleware in server.js -- requireRider/requireDriver, the
// two review-login routes, the admin kill-switch routes,
// resolveAuthenticatedReviewRider(), the payment-intent simulation
// branch, and ride-creation/dispatch -- over real HTTP via supertest,
// with only Supabase replaced by an in-memory fake (test/fakeSupabase.js)
// and Stripe left entirely unconfigured.
//
// Central property under test, per the approved correction: simulated
// payment, is_review_ride, and reviewer-only dispatch may activate ONLY
// for a request that carries a real, currently-valid session for the
// review rider account itself -- never merely because a request names,
// guesses, or claims the review rider's id or review status.

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
// Left deliberately unset: STRIPE_SECRET_KEY -- the non-review payment
// path must 503 with no Stripe configured, and the review path must
// succeed anyway, precisely because it never touches Stripe.
//
// Both gates below are turned off purely to keep the ride-creation
// fixture small (skip real Stripe payment-authorization and the full
// email/phone/persona readiness matrix, both already covered by their
// own existing unit tests elsewhere in this repo) -- neither setting
// has anything to do with the reviewer-account logic under test here.
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const { createFakeSupabase } = require("./fakeSupabase");
const { hashReviewPassword } = require("../lib/reviewAccounts");
const { signRiderSession } = require("../lib/riderAuth");
const { signRideQuote } = require("../lib/rideQuote");

const REVIEW_RIDER_PASSWORD = "ReviewerRiderPass123!";
const REVIEW_DRIVER_PASSWORD = "ReviewerDriverPass456!";

const reviewRiderCreds = hashReviewPassword(REVIEW_RIDER_PASSWORD);
const reviewDriverCreds = hashReviewPassword(REVIEW_DRIVER_PASSWORD);

const REVIEW_RIDER = {
  id: "RIDER_REVIEW_1",
  email: "google-play-reviewer-rider@example.test",
  first_name: "Google",
  last_name: "Reviewer",
  is_review_account: true,
  review_password_salt: reviewRiderCreds.salt,
  review_password_hash: reviewRiderCreds.hash,
  access_revoked: false,
  deleted_at: null,
  session_version: 0,
  status: "active",
  approval_status: "approved",
  email_verified: true,
  sms_verified: true,
  persona_status: "verified"
};

const ORDINARY_RIDER = {
  id: "RIDER_REAL_1",
  email: "real.rider@example.test",
  is_review_account: false,
  access_revoked: false,
  deleted_at: null,
  session_version: 0,
  status: "active",
  approval_status: "approved",
  email_verified: true,
  sms_verified: true,
  persona_status: "verified"
};

const REVIEW_DRIVER = {
  id: "DRIVER_REVIEW_1",
  email: "google-play-reviewer-driver@example.test",
  is_review_account: true,
  review_password_salt: reviewDriverCreds.salt,
  review_password_hash: reviewDriverCreds.hash,
  access_revoked: false,
  online: true,
  status: "active",
  approval_status: "approved"
};

// A real, ordinary, online driver -- present in every fixture so that
// an ordinary ride's dispatch has somewhere real to go, and so every
// dispatch-isolation assertion is a genuine choice between two
// candidates rather than "there was only one driver anyway."
const ORDINARY_DRIVER = {
  id: "DRIVER_REAL_1",
  email: "real.driver@example.test",
  is_review_account: false,
  access_revoked: false,
  online: true,
  status: "active",
  approval_status: "approved"
};

function freshFixture() {
  return {
    riders: [REVIEW_RIDER, ORDINARY_RIDER],
    drivers: [REVIEW_DRIVER, ORDINARY_DRIVER],
    system_flags: [{ key: "review_account_login_enabled", value: "false" }]
  };
}

// Jest statically forbids a jest.mock() factory from closing over an
// out-of-scope variable unless its name is prefixed "mock" -- see
// https://jestjs.io/docs/es6-class-mocks#calling-jestmock-with-the-module-factory-parameter.
let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase(freshFixture());
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function setFlag(value) {
  const flags = mockSupabaseClient._state.system_flags;
  const row = flags.find((f) => f.key === "review_account_login_enabled");
  if (row) {
    row.value = value;
  } else {
    flags.push({ key: "review_account_login_enabled", value });
  }
}

function enableReviewLogin() {
  setFlag("true");
}

function disableReviewLogin() {
  setFlag("false");
}

const RIDER_CLIENT_HEADER = { "x-requested-with": "harvey-rider-app" };

// Logs in as the review rider via the real login route exactly once
// (memoized) and returns a supertest agent that carries the resulting
// session cookie on every subsequent request -- the only legitimate
// way, in these tests or in production, to obtain a request that
// resolveAuthenticatedReviewRider() will accept. Memoized specifically
// to stay well under POST /api/review/rider/login's own
// per-destination rate limit (5 per 10 minutes) across this whole
// file -- every describe block below that needs an authenticated
// reviewer session reuses this one cookie and simply toggles the flag
// with enableReviewLogin()/disableReviewLogin() around its own
// assertions, since resolveAuthenticatedReviewRider() re-checks the
// flag on every call regardless of how old the session cookie is.
let reviewRiderAgentPromise = null;

function getReviewRiderAgent() {
  if (!reviewRiderAgentPromise) {
    reviewRiderAgentPromise = (async () => {
      enableReviewLogin();
      const agent = request.agent(app);
      const res = await agent
        .post("/api/review/rider/login")
        .set(RIDER_CLIENT_HEADER)
        .send({ email: REVIEW_RIDER.email, password: REVIEW_RIDER_PASSWORD });
      if (res.status !== 200) {
        throw new Error(`review rider login failed in test setup: ${res.status} ${JSON.stringify(res.body)}`);
      }
      return agent;
    })();
  }
  return reviewRiderAgentPromise;
}

// A real (forged with the exact same signer real logins use), but
// non-review, rider session -- for proving an ordinary authenticated
// rider gets no reviewer behavior no matter what they submit.
function ordinaryRiderCookie() {
  const token = signRiderSession({
    riderId: ORDINARY_RIDER.id,
    sessionVersion: 0,
    secret: process.env.RIDER_SESSION_SECRET,
    ttlHours: 72
  });
  return `harvey_rider_session=${token}`;
}

describe("POST /api/review/rider/login", () => {
  afterAll(() => disableReviewLogin());

  test("rejects a new login while review_account_login_enabled is false, even with the correct password", async () => {
    disableReviewLogin();

    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: REVIEW_RIDER_PASSWORD });

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  test("rejects the wrong password once the flag is on", async () => {
    enableReviewLogin();

    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: "totally-wrong-password" });

    expect(res.status).toBe(401);
  });

  test("rejects an ordinary rider's email even with an arbitrary password -- only a row with is_review_account = true can ever authenticate here", async () => {
    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: ORDINARY_RIDER.email, password: "anything-at-all" });

    expect(res.status).toBe(401);
  });

  test("succeeds with the correct password while the flag is on, and sets a real rider session cookie", async () => {
    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: REVIEW_RIDER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.rider_id).toBe(REVIEW_RIDER.id);
    expect(res.headers["set-cookie"].some((c) => c.startsWith("harvey_rider_session="))).toBe(true);
  });
});

describe("POST /api/review/driver/login", () => {
  afterAll(() => disableReviewLogin());

  test("rejects a new login while the flag is off", async () => {
    disableReviewLogin();

    const res = await request(app)
      .post("/api/review/driver/login")
      .send({ email: REVIEW_DRIVER.email, password: REVIEW_DRIVER_PASSWORD });

    expect(res.status).toBe(503);
  });

  test("succeeds with the correct password once the flag is on, and returns a bearer driver_token", async () => {
    enableReviewLogin();

    const res = await request(app)
      .post("/api/review/driver/login")
      .send({ email: REVIEW_DRIVER.email, password: REVIEW_DRIVER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.driver_id).toBe(REVIEW_DRIVER.id);
    expect(typeof res.body.driver_token).toBe("string");
    expect(res.body.driver_token.length).toBeGreaterThan(0);
  });
});

describe("requireRider kill switch: already-issued reviewer sessions", () => {
  test("a reviewer session works while the flag is on, is rejected the instant it's disabled, and ordinary riders are never affected either way", async () => {
    const agent = await getReviewRiderAgent();

    const whileEnabled = await agent.get("/api/rider/session");
    expect(whileEnabled.status).toBe(200);
    expect(whileEnabled.body.rider_id).toBe(REVIEW_RIDER.id);

    const ordinaryWhileEnabled = await request(app)
      .get("/api/rider/session")
      .set("Cookie", [ordinaryRiderCookie()]);
    expect(ordinaryWhileEnabled.status).toBe(200);
    expect(ordinaryWhileEnabled.body.rider_id).toBe(ORDINARY_RIDER.id);

    disableReviewLogin();

    const afterDisable = await agent.get("/api/rider/session");
    expect(afterDisable.status).toBe(403);

    const ordinaryAfterDisable = await request(app)
      .get("/api/rider/session")
      .set("Cookie", [ordinaryRiderCookie()]);
    expect(ordinaryAfterDisable.status).toBe(200);
    expect(ordinaryAfterDisable.body.rider_id).toBe(ORDINARY_RIDER.id);
  });
});

describe("requireDriver kill switch: already-issued reviewer sessions", () => {
  // This test legitimately drives the review driver offline via the
  // real POST /api/driver/status route -- restore it afterward so
  // later dispatch-isolation tests (which need the review driver
  // online to prove a review ride reaches it) aren't polluted by this
  // block's own side effect on the shared fixture.
  afterAll(() => {
    const row = mockSupabaseClient._state.drivers.find((d) => d.id === REVIEW_DRIVER.id);
    if (row) row.online = true;
  });

  test("a reviewer driver_token works while the flag is on and is rejected the instant it's disabled", async () => {
    enableReviewLogin();

    const login = await request(app)
      .post("/api/review/driver/login")
      .send({ email: REVIEW_DRIVER.email, password: REVIEW_DRIVER_PASSWORD });

    expect(login.status).toBe(200);
    const token = login.body.driver_token;

    const whileEnabled = await request(app)
      .post("/api/driver/status")
      .set("x-driver-token", token)
      .send({ online: false });
    expect(whileEnabled.status).toBe(200);

    disableReviewLogin();

    const afterDisable = await request(app)
      .post("/api/driver/status")
      .set("x-driver-token", token)
      .send({ online: false });
    expect(afterDisable.status).toBe(403);
  });
});

describe("No admin access for reviewer sessions", () => {
  test("a reviewer rider session cannot reach a requireAdmin-gated route", async () => {
    const agent = await getReviewRiderAgent();

    const res = await agent.get("/api/admin/operations-overview");
    expect(res.status).toBe(401);
  });

  test("a reviewer driver_token cannot reach a requireAdmin-gated route", async () => {
    enableReviewLogin();
    const login = await request(app)
      .post("/api/review/driver/login")
      .send({ email: REVIEW_DRIVER.email, password: REVIEW_DRIVER_PASSWORD });

    const res = await request(app)
      .get("/api/admin/operations-overview")
      .set("x-driver-token", login.body.driver_token);
    expect(res.status).toBe(401);

    disableReviewLogin();
  });
});

// Shared quote-token builder for the payment-intent and ride-request
// tests below. riderId here is only what the *quote token itself* is
// signed for and what the request body's rider_id claims -- it is
// intentionally NOT what determines reviewer behavior; see the
// describe blocks below for the actual identity-source assertions.
function buildQuoteBody({ riderId }) {
  const pickup = { lat: 36.1627, lng: -86.7816 };
  const destination = { lat: 36.1745, lng: -86.7679 };
  const estimate = { total: 18.5, driver_payout: 14, platform_fee: 4.5, miles: 3.2, minutes: 12 };

  const token = signRideQuote({
    rideType: "standard",
    miles: 3.2,
    minutes: 12,
    pickup,
    destination,
    riderId,
    estimate,
    secret: process.env.RIDE_QUOTE_SECRET,
    ttlMinutes: 15
  });

  return {
    estimate_token: token,
    ride_type: "standard",
    rider_id: riderId,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng
  };
}

describe("POST /api/rides/payment-intent -- identity must come from an authenticated reviewer session", () => {
  afterEach(() => disableReviewLogin());

  test("only an authenticated review rider session receives simulated payment", async () => {
    const agent = await getReviewRiderAgent();
    enableReviewLogin();

    const res = await agent
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.simulated_label.toLowerCase()).toContain("google play review mode");
    expect(res.body.payment_intent_id).toMatch(/^review_sim_/);
  });

  test("an unauthenticated caller who merely guesses/names the review rider id in rider_id gets no simulated payment", async () => {
    enableReviewLogin();

    const res = await request(app)
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));

    // No session cookie at all -- falls straight to the ordinary path,
    // which 503s because ENABLE_PAYMENT_GATE is off in this test env.
    // The key assertion either way is the one right below: simulated
    // is never present.
    expect(res.body.simulated).toBeUndefined();
    expect(res.status).not.toBe(200);
  });

  test("an ordinary authenticated rider who submits the review rider id in rider_id gets no review mode", async () => {
    enableReviewLogin();

    const res = await request(app)
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .set("Cookie", [ordinaryRiderCookie()])
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));

    // resolveAuthenticatedReviewRider() looks at the SESSION's own row
    // (the ordinary rider's), never req.body.rider_id -- so this must
    // never simulate, regardless of what rider_id claims.
    expect(res.body.simulated).toBeUndefined();
    expect(res.status).not.toBe(200);
  });

  test("client-supplied is_review_account/is_review_ride/payment_mode fields have no effect for an ordinary session", async () => {
    enableReviewLogin();

    const body = buildQuoteBody({ riderId: ORDINARY_RIDER.id });
    body.is_review_account = true;
    body.is_review_ride = true;
    body.review_mode = true;
    body.payment_mode = "simulated";

    const res = await request(app)
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .set("Cookie", [ordinaryRiderCookie()])
      .send(body);

    expect(res.body.simulated).toBeUndefined();
    expect(res.status).not.toBe(200);
  });

  test("flag-off blocks the reviewer payment path even with a previously-valid reviewer session", async () => {
    const agent = await getReviewRiderAgent();
    enableReviewLogin();

    const whileEnabled = await agent
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));
    expect(whileEnabled.status).toBe(200);
    expect(whileEnabled.body.simulated).toBe(true);

    disableReviewLogin();

    const afterDisable = await agent
      .post("/api/rides/payment-intent")
      .set(RIDER_CLIENT_HEADER)
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));

    // Same still-valid session cookie, same claimed rider_id -- but
    // resolveAuthenticatedReviewRider() re-checks the flag on every
    // call, so this must fall through to the ordinary (non-simulated)
    // path immediately.
    expect(afterDisable.body.simulated).toBeUndefined();
    expect(afterDisable.status).not.toBe(200);
  });
});

describe("POST /api/rides/request -> dispatchRide() -- reviewer dispatch isolation over real HTTP", () => {
  afterEach(() => disableReviewLogin());

  function buildRideRequestBody({ riderId }) {
    return {
      ...buildQuoteBody({ riderId }),
      pickup: "123 Main St, Nashville, TN",
      destination: "456 Oak Ave, Nashville, TN"
    };
  }

  test("an authenticated review rider's ride is flagged is_review_ride and reaches only the paired review driver", async () => {
    const agent = await getReviewRiderAgent();
    enableReviewLogin();

    const res = await agent
      .post("/api/rides/request")
      .set(RIDER_CLIENT_HEADER)
      .send(buildRideRequestBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(true);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.driver.id).toBe(REVIEW_DRIVER.id);
  });

  test("an ordinary rider's ride is never flagged is_review_ride and never reaches the review driver, even after the review rider has an active session", async () => {
    // Regression guard: a previous (or even concurrently active)
    // reviewer session must not leak review behavior into an unrelated
    // ordinary request.
    await getReviewRiderAgent();
    enableReviewLogin();

    const res = await request(app)
      .post("/api/rides/request")
      .send(buildRideRequestBody({ riderId: ORDINARY_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.driver.id).toBe(ORDINARY_DRIVER.id);
    expect(res.body.dispatch.driver.id).not.toBe(REVIEW_DRIVER.id);
  });

  test("an unauthenticated caller who merely names the review rider id creates an ordinary (non-review) ride that never reaches the review driver", async () => {
    enableReviewLogin();

    const res = await request(app)
      .post("/api/rides/request")
      .send(buildRideRequestBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.dispatch.driver.id).not.toBe(REVIEW_DRIVER.id);
  });

  test("client-supplied is_review_ride:true has no effect without an authenticated reviewer session", async () => {
    enableReviewLogin();

    const body = buildRideRequestBody({ riderId: ORDINARY_RIDER.id });
    body.is_review_ride = true;
    body.is_review_account = true;

    const res = await request(app).post("/api/rides/request").send(body);

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.dispatch.driver.id).toBe(ORDINARY_DRIVER.id);
  });

  test("flag-off blocks review-ride creation even with a previously-valid reviewer session", async () => {
    const agent = await getReviewRiderAgent();
    disableReviewLogin();

    const res = await agent
      .post("/api/rides/request")
      .set(RIDER_CLIENT_HEADER)
      .send(buildRideRequestBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(201);
    expect(res.body.ride.is_review_ride).toBe(false);
    expect(res.body.dispatch.driver.id).not.toBe(REVIEW_DRIVER.id);
  });
});
