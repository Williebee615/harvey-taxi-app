// Guards the contract between every writer of rides.payment_status and the
// rides_payment_status_check constraint added by migration
// 20260927220100_rides_payment_capture_and_cancellation_columns.sql.
//
// The allowed list is read from the migration file itself, so this test
// fails if the constraint and the application drift apart in either
// direction: a writer that starts producing a value the constraint
// rejects, or a constraint that loses (or gains) a value. The database
// test (test/db/pr130Migrations.db.test.js) proves the same list is what
// Postgres actually enforces.
//
// Exercises the real routes: the Stripe webhook (signed with Stripe's own
// test-signature helper, verified by the real stripe.webhooks.constructEvent)
// and the completion / admin reconciliation capture paths (Stripe capture
// mocked).

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
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_payment_status";

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");
const { CAPTURE_STATUS } = require("../lib/ridePaymentCapture");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

// Real Stripe webhook verification; only the network-bound capture call is
// mocked.
const mockStripeCapture = jest.fn();
jest.mock("stripe", () => {
  const ActualStripe = jest.requireActual("stripe");
  return jest.fn().mockImplementation((key) => {
    const real = new ActualStripe(key);
    return {
      webhooks: real.webhooks,
      paymentIntents: { capture: (...args) => mockStripeCapture(...args) }
    };
  });
});

const Stripe = jest.requireActual("stripe");
const stripeHelper = new Stripe("sk_test_fake");

const request = require("supertest");

const MIGRATION = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260927220100_rides_payment_capture_and_cancellation_columns.sql"
);

// The value list inside `add constraint rides_payment_status_check check (...)`.
function allowedPaymentStatuses() {
  const sql = fs.readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "");
  const match = sql.match(/add constraint rides_payment_status_check\s+check\s*\(\s*payment_status is null or payment_status in \(([^)]*)\)/i);
  if (!match) throw new Error("rides_payment_status_check not found in migration");
  return match[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

const ALLOWED = allowedPaymentStatuses();

const EXPECTED_ALLOWED = [
  "pending",
  "authorized",
  "capture_pending",
  "captured",
  "succeeded",
  "capture_failed",
  "not_required",
  "failed"
];

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { driver_earnings: ["ride_id"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const DRIVER = makeDriver({ id: "DRIVER_1" });
const driverToken = signTestDriverToken(DRIVER.id);
const PI = "pi_test_payment_status";

function resetState(rideOverrides = {}) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [makeRider()],
    drivers: [{ ...DRIVER }],
    rides: [makeRide({ status: "in_progress", driver_id: DRIVER.id, payment_id: PI, payment_status: null, ...rideOverrides })],
    driver_earnings: [],
    audit_logs: []
  });
}

const ride = () => mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");

beforeEach(() => {
  mockStripeCapture.mockReset();
  mockStripeCapture.mockResolvedValue({ id: PI, status: "succeeded" });
  resetState();
});

function sendWebhook(type, { id = PI } = {}) {
  const payload = JSON.stringify({
    id: `evt_${type.replace(/\W/g, "_")}`,
    object: "event",
    type,
    data: { object: { id, object: "payment_intent" } }
  });
  const header = stripeHelper.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET
  });
  return request(app)
    .post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", header)
    .send(payload);
}

function complete() {
  return request(app).post("/api/driver/rides/RIDE_1/complete").set(driverAuthHeaders(driverToken)).send({});
}

function expectAllowed(value) {
  expect(ALLOWED).toContain(value);
}

describe("rides_payment_status_check allowed list", () => {
  test("is exactly the approved set -- nothing missing, nothing extra", () => {
    expect([...ALLOWED].sort()).toEqual([...EXPECTED_ALLOWED].sort());
  });

  test("covers every CAPTURE_STATUS value the capture state machine can write", () => {
    for (const value of Object.values(CAPTURE_STATUS)) expectAllowed(value);
  });

  test("covers every string literal server.js assigns to payment_status", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const literals = [...source.matchAll(/\bpayment_status\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(["succeeded", "authorized", "failed"]));
    for (const value of literals) expectAllowed(value);
  });
});

describe("real Stripe webhook paths", () => {
  test("payment_intent.amount_capturable_updated writes 'authorized' (manual-capture authorization)", async () => {
    const res = await sendWebhook("payment_intent.amount_capturable_updated");

    expect(res.status).toBe(200);
    expect(ride().payment_status).toBe("authorized");
    expectAllowed(ride().payment_status);
  });

  test("payment_intent.succeeded writes 'succeeded'", async () => {
    const res = await sendWebhook("payment_intent.succeeded");

    expect(res.status).toBe(200);
    expect(ride().payment_status).toBe("succeeded");
    expect(ride().payment_captured).toBe(true);
    expectAllowed(ride().payment_status);
  });

  test.each(["payment_intent.payment_failed", "payment_intent.canceled"])("%s writes 'failed'", async (type) => {
    const res = await sendWebhook(type);

    expect(res.status).toBe(200);
    expect(ride().payment_status).toBe("failed");
    expectAllowed(ride().payment_status);
  });

  test("an unsigned webhook is rejected and writes nothing", async () => {
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=bogus")
      .send(JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: PI } } }));

    expect(res.status).toBe(400);
    expect(ride().payment_status).toBeNull();
  });
});

describe("completion and reconciliation capture paths", () => {
  test("manual-capture lifecycle: authorized -> captured -> succeeded, every value allowed", async () => {
    const seen = [];

    await sendWebhook("payment_intent.amount_capturable_updated");
    seen.push(ride().payment_status);
    // The authorization webhook moves the ride to payment_authorized;
    // put it back in progress for the completion step.
    Object.assign(ride(), { status: "in_progress", driver_id: DRIVER.id });

    const res = await complete();
    expect(res.status).toBe(200);
    expect(mockStripeCapture).toHaveBeenCalledTimes(1);
    seen.push(ride().payment_status);

    await sendWebhook("payment_intent.succeeded");
    seen.push(ride().payment_status);

    expect(seen).toEqual(["authorized", "captured", "succeeded"]);
    for (const value of seen) expectAllowed(value);
  });

  test("automatic-capture flow: succeeded arrives with no prior authorization", async () => {
    await sendWebhook("payment_intent.succeeded");

    expect(ride().payment_status).toBe("succeeded");
    expectAllowed(ride().payment_status);
  });

  test("a failed capture writes 'capture_failed' and admin reconciliation then writes 'captured'", async () => {
    mockStripeCapture.mockRejectedValue(new Error("card issuer declined"));
    await complete();
    expect(ride().payment_status).toBe("capture_failed");
    expectAllowed(ride().payment_status);

    mockStripeCapture.mockReset();
    mockStripeCapture.mockResolvedValue({ id: PI, status: "succeeded" });
    const res = await request(app).post("/api/admin/payments/RIDE_1/reconcile").set("x-admin-token", "test-admin-token").send({});

    expect(res.status).toBe(200);
    expect(ride().payment_status).toBe("captured");
    expectAllowed(ride().payment_status);
  });

  test("a ride with no payment to capture writes 'not_required'", async () => {
    resetState({ payment_id: null });

    const res = await complete();

    expect(res.status).toBe(200);
    expect(ride().payment_status).toBe("not_required");
    expectAllowed(ride().payment_status);
  });

  test("an interrupted capture leaves 'capture_pending', which is allowed", async () => {
    let statusDuringStripeCall;
    mockStripeCapture.mockImplementation(async () => {
      statusDuringStripeCall = ride().payment_status;
      return { id: PI, status: "succeeded" };
    });

    await complete();

    expect(statusDuringStripeCall).toBe("capture_pending");
    expectAllowed(statusDuringStripeCall);
  });
});
