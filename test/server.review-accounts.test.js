// Composition/integration tests for the Google Play reviewer-account
// feature. Unlike every other *.test.js in this repo (which test pure
// lib/ functions in isolation), these tests exercise the ACTUAL Express
// routes and middleware in server.js -- requireRider/requireDriver, the
// two new review-login routes, the admin kill-switch routes, and the
// payment-intent simulation branch -- over real HTTP via supertest,
// with only Supabase replaced by an in-memory fake (test/fakeSupabase.js)
// and Stripe left entirely unconfigured. This is what proves the rules
// below hold at the route/middleware level, not just in a pure helper.
//
// Deliberately out of scope here (covered instead by
// lib/reviewAccounts.test.js's unit tests plus direct code reading, per
// the implementation report): the full ride-creation -> dispatchRide()
// pipeline, which depends on the ride-quote/pricing/geocoding chain and
// would require a much larger fixture to exercise over real HTTP for
// no added confidence beyond what planReviewAwareDispatch()'s own unit
// tests already prove.

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
  online: true
};

function freshFixture() {
  return {
    riders: [REVIEW_RIDER, ORDINARY_RIDER],
    drivers: [REVIEW_DRIVER],
    system_flags: [{ key: "review_account_login_enabled", value: "false" }]
  };
}

// Jest statically forbids a jest.mock() factory from closing over an
// out-of-scope variable unless its name is prefixed "mock" -- see
// https://jestjs.io/docs/es6-class-mocks#calling-jestmock-with-the-module-factory-parameter.
// eslint-disable-next-line no-var
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
    enableReviewLogin();

    const agent = request.agent(app);

    const login = await agent
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: REVIEW_RIDER_PASSWORD });

    expect(login.status).toBe(200);

    const whileEnabled = await agent.get("/api/rider/session");
    expect(whileEnabled.status).toBe(200);
    expect(whileEnabled.body.rider_id).toBe(REVIEW_RIDER.id);

    // An ordinary rider's session, forged with the exact same
    // lib/riderAuth.js signer real logins use, must keep working
    // regardless of the review flag's value -- resolveReviewSessionOutcome
    // only ever removes access from a row where is_review_account is
    // true.
    const ordinaryToken = signRiderSession({
      riderId: ORDINARY_RIDER.id,
      sessionVersion: 0,
      secret: process.env.RIDER_SESSION_SECRET,
      ttlHours: 72
    });

    const ordinaryWhileEnabled = await request(app)
      .get("/api/rider/session")
      .set("Cookie", [`harvey_rider_session=${ordinaryToken}`]);
    expect(ordinaryWhileEnabled.status).toBe(200);
    expect(ordinaryWhileEnabled.body.rider_id).toBe(ORDINARY_RIDER.id);

    disableReviewLogin();

    const afterDisable = await agent.get("/api/rider/session");
    expect(afterDisable.status).toBe(403);

    const ordinaryAfterDisable = await request(app)
      .get("/api/rider/session")
      .set("Cookie", [`harvey_rider_session=${ordinaryToken}`]);
    expect(ordinaryAfterDisable.status).toBe(200);
    expect(ordinaryAfterDisable.body.rider_id).toBe(ORDINARY_RIDER.id);
  });
});

describe("requireDriver kill switch: already-issued reviewer sessions", () => {
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
    enableReviewLogin();

    const agent = request.agent(app);
    await agent
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email: REVIEW_RIDER.email, password: REVIEW_RIDER_PASSWORD });

    const res = await agent.get("/api/admin/operations-overview");
    expect(res.status).toBe(401);
  });

  test("a reviewer driver_token cannot reach a requireAdmin-gated route", async () => {
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

describe("POST /api/rides/payment-intent -- Option A simulated payment", () => {
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

  test("a review rider gets a simulated, clearly-labeled payment intent with no Stripe configured", async () => {
    const res = await request(app)
      .post("/api/rides/payment-intent")
      .send(buildQuoteBody({ riderId: REVIEW_RIDER.id }));

    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.simulated_label.toLowerCase()).toContain("google play review mode");
    expect(res.body.payment_intent_id).toMatch(/^review_sim_/);
  });

  test("an ordinary rider on the very same route still requires real Stripe, and 503s when it isn't configured -- proving the simulated branch is genuinely review-only", async () => {
    const res = await request(app)
      .post("/api/rides/payment-intent")
      .send(buildQuoteBody({ riderId: ORDINARY_RIDER.id }));

    expect(res.status).toBe(503);
    expect(res.body.simulated).toBeUndefined();
  });

  test("a client cannot spoof review-mode payment behavior for an ordinary rider by claiming is_review_account in the request body", async () => {
    const body = buildQuoteBody({ riderId: ORDINARY_RIDER.id });
    body.is_review_account = true;
    body.review_mode = true;
    body.payment_mode = "simulated";

    const res = await request(app).post("/api/rides/payment-intent").send(body);

    // Still 503 (real Stripe path, unconfigured) -- the spoofed fields
    // are never read; only the freshly loaded riders row decides this.
    expect(res.status).toBe(503);
  });
});
