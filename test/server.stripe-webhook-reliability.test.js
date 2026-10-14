// Stripe webhook reliability (#238): signature verification, duplicate
// deliveries, concurrent writers and recovery after a processing failure.
//
// The concurrency tests simulate another writer changing the ride between
// the webhook's read and its update (the failUpdate hook runs just before
// the update's WHERE clause is evaluated). The update is a compare-and-swap
// on status AND payment_status, so the stale write must not land; the
// webhook re-reads and decides again from the fresh state.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_reliability";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeRide } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const Stripe = jest.requireActual("stripe");
const stripeHelper = new Stripe("sk_test_fake");
const request = require("supertest");

const PI = "pi_test_reliability";
let failUpdateHook = null;

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { failUpdate: (table, patch) => (failUpdateHook ? failUpdateHook(table, patch) : null) });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function reset(rideOverrides = {}) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [makeRider()],
    rides: [makeRide({ status: "payment_required", payment_id: PI, payment_status: null, ...rideOverrides })],
    audit_logs: []
  });
  mockSupabaseClient._log.length = 0;
  failUpdateHook = null;
}
beforeEach(() => reset());

const ride = () => mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_1");
const audits = (action) => mockSupabaseClient._state.audit_logs.filter((a) => a.action === action);
const rideUpdates = () => mockSupabaseClient._log.filter((e) => e.table === "rides" && e.op === "update");
const settle = () => new Promise((r) => setTimeout(r, 20));

function payloadFor(type, eventId = `evt_${type.replace(/\W/g, "_")}`) {
  return JSON.stringify({ id: eventId, object: "event", type, data: { object: { id: PI, object: "payment_intent" } } });
}
function send(payload, header) {
  const r = request(app).post("/api/stripe/webhook").set("Content-Type", "application/json");
  return (header === undefined ? r : r.set("stripe-signature", header)).send(payload);
}
function sendSigned(type, eventId) {
  const payload = payloadFor(type, eventId);
  return send(payload, stripeHelper.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }));
}

describe("signature verification", () => {
  test("missing signature: 400, nothing read or written", async () => {
    const res = await send(payloadFor("payment_intent.succeeded"));
    expect(res.status).toBe(400);
    expect(mockSupabaseClient._log.filter((e) => e.table === "rides")).toEqual([]);
    expect(ride().payment_status).toBeNull();
  });

  test("signature made with a different secret: 400, nothing written", async () => {
    const payload = payloadFor("payment_intent.succeeded");
    const header = stripeHelper.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    const res = await send(payload, header);
    expect(res.status).toBe(400);
    expect(rideUpdates()).toEqual([]);
  });

  test("payload altered after signing: 400, nothing written", async () => {
    const payload = payloadFor("payment_intent.amount_capturable_updated");
    const header = stripeHelper.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const res = await send(payload.replace("amount_capturable_updated", "succeeded"), header);
    expect(res.status).toBe(400);
    expect(rideUpdates()).toEqual([]);
  });

  test("expired timestamp (replay outside Stripe's tolerance): 400", async () => {
    const payload = payloadFor("payment_intent.succeeded");
    const header = stripeHelper.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600
    });
    const res = await send(payload, header);
    expect(res.status).toBe(400);
    expect(rideUpdates()).toEqual([]);
  });
});

describe("duplicate deliveries", () => {
  test("the same authorization event twice: applied once, second is a no-op", async () => {
    expect((await sendSigned("payment_intent.amount_capturable_updated")).status).toBe(200);
    expect(ride()).toMatchObject({ status: "payment_authorized", payment_status: "authorized" });
    const writesAfterFirst = rideUpdates().length;

    expect((await sendSigned("payment_intent.amount_capturable_updated")).status).toBe(200);
    expect(ride()).toMatchObject({ status: "payment_authorized", payment_status: "authorized" });
    expect(rideUpdates().length).toBe(writesAfterFirst);
  });

  test("the same capture event twice: no second write", async () => {
    reset({ status: "completed", payment_status: "authorized" });
    await sendSigned("payment_intent.succeeded");
    const writes = rideUpdates().length;
    await sendSigned("payment_intent.succeeded");
    expect(ride().payment_status).toBe("succeeded");
    expect(rideUpdates().length).toBe(writes);
  });

  test("a late authorization after capture never moves payment backwards", async () => {
    reset({ status: "completed", payment_status: "succeeded", payment_captured: true });
    expect((await sendSigned("payment_intent.amount_capturable_updated")).status).toBe(200);
    expect(ride()).toMatchObject({ status: "completed", payment_status: "succeeded" });
    expect(rideUpdates()).toEqual([]);
  });
});

describe("concurrent writers (compare-and-swap)", () => {
  test("ride cancelled between read and write: the stale 'authorize' does not land, and the late authorization is flagged", async () => {
    let raced = false;
    failUpdateHook = (table) => {
      if (table === "rides" && !raced) {
        raced = true;
        Object.assign(ride(), { status: "cancelled" }); // rider cancels concurrently
      }
      return null;
    };
    const res = await sendSigned("payment_intent.amount_capturable_updated");
    await settle();

    expect(res.status).toBe(200);
    expect(ride().status).toBe("cancelled"); // the cancellation was not overwritten
    expect(ride().payment_status).toBeNull();
    expect(audits("stripe_webhook_needs_review").map((a) => a.metadata.reason)).toContain("authorized_after_ride_closed");
  });

  test("payment_status changed concurrently (status unchanged): the write is retried against the fresh state", async () => {
    reset({ status: "completed", payment_status: "authorized" });
    let raced = false;
    failUpdateHook = (table) => {
      if (table === "rides" && !raced) {
        raced = true;
        ride().payment_status = "capture_pending"; // capture path started concurrently
      }
      return null;
    };
    const res = await sendSigned("payment_intent.succeeded");

    expect(res.status).toBe(200);
    expect(rideUpdates().length).toBe(2); // first attempt matched nothing, second applied
    expect(ride()).toMatchObject({ status: "completed", payment_status: "succeeded", payment_captured: true });
  });

  test("a ride that keeps changing: after 3 attempts the webhook returns 500 so Stripe redelivers, nothing is overwritten", async () => {
    const statuses = ["payment_authorized", "awaiting_driver_acceptance", "offer_sent"];
    let n = 0;
    failUpdateHook = (table) => {
      if (table === "rides") ride().status = statuses[n++ % statuses.length];
      return null;
    };
    const res = await sendSigned("payment_intent.canceled");
    await settle();

    expect(res.status).toBe(500);
    expect(rideUpdates().length).toBe(3);
    expect(ride().status).not.toBe("failed");
    expect(audits("stripe_webhook_retry_requested")).toHaveLength(1);
    expect(audits("stripe_webhook_received")).toHaveLength(0);
  });
});

describe("recovery after a processing failure", () => {
  test("database write fails: 500 (Stripe retries); the redelivery applies the change exactly once", async () => {
    failUpdateHook = (table) => (table === "rides" ? { code: "XX000", message: "connection reset" } : null);
    const first = await sendSigned("payment_intent.amount_capturable_updated");
    expect(first.status).toBe(500);
    expect(ride()).toMatchObject({ status: "payment_required", payment_status: null });

    failUpdateHook = null;
    const retry = await sendSigned("payment_intent.amount_capturable_updated");
    expect(retry.status).toBe(200);
    expect(ride()).toMatchObject({ status: "payment_authorized", payment_status: "authorized" });
  });

  test("ride read fails: 500, nothing written", async () => {
    mockSupabaseClient._state.rides = null;
    const original = mockSupabaseClient.from;
    mockSupabaseClient.from = (table) => {
      if (table !== "rides") return original.call(mockSupabaseClient, table);
      return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "XX000", message: "db down" } }) }) }) };
    };
    try {
      const res = await sendSigned("payment_intent.succeeded");
      expect(res.status).toBe(500);
    } finally {
      mockSupabaseClient.from = original;
    }
  });
});

describe("ride status and payment status stay separate", () => {
  test.each([
    ["payment_intent.payment_failed", "in_progress"],
    ["payment_intent.canceled", "in_progress"],
    ["payment_intent.payment_failed", "completed"],
    ["payment_intent.succeeded", "in_progress"]
  ])("%s on a %s ride never changes the trip status", async (type, status) => {
    reset({ status, payment_status: "authorized" });
    await sendSigned(type);
    expect(ride().status).toBe(status);
  });
});
