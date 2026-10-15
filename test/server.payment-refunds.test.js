// Payment reconciliation report and refund routes, synthetic data only:
// the report is read-only and needs the finance permission; refunds are
// off by default, owner-only, test mode only (a live key or live intent is
// refused whatever the flag says), and audited with ids and codes only.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.STRIPE_SECRET_KEY = "sk_test_" + "fake".repeat(4);

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const mockStripe = {
  paymentIntents: { retrieve: jest.fn(), list: jest.fn(), create: jest.fn(), cancel: jest.fn(), capture: jest.fn() },
  refunds: { create: jest.fn(), retrieve: jest.fn(), list: jest.fn() }
};
jest.mock("stripe", () => jest.fn().mockImplementation(() => mockStripe));

const OWNER = "owner@harvey.example";
const FINANCE = "finance@harvey.example";
const DISPATCHER = "dispatch@harvey.example";

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return [`htaf_admin_session=${encoded}.${sig}`];
}

const reserveCalls = [];
function seed({ refundsEnabled = false } = {}) {
  reserveCalls.length = 0;
  return createFakeSupabase(
    {
      admin_roles: [
        { email: FINANCE, role: "finance" },
        { email: DISPATCHER, role: "dispatcher" }
      ],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      system_flags: refundsEnabled ? [{ key: "refunds_enabled", value: "true" }] : [],
      payments: [{ id: "pi_tracked", amount: 25, status: "authorized", stripe_latest_status: "requires_capture", ride_id: "RIDE-1", provider: "stripe", created_at: new Date().toISOString(), client_secret: "pi_tracked_secret_x" }],
      rides: [{ id: "RIDE-1", payment_id: "pi_tracked", payment_status: "pending", created_at: new Date().toISOString() }],
      payment_refunds: []
    },
    {
      rpc: {
        reserve_payment_refund: (args) => {
          reserveCalls.push(args);
          return { data: { outcome: "reserved", refund: { id: "ledger-1", payment_intent_id: args.p_payment_intent_id, amount_cents: args.p_amount_cents, status: "pending", stripe_refund_id: null } }, error: null };
        },
        record_payment_refund_result: (args) => ({ data: { id: args.p_id, status: args.p_status, stripe_refund_id: args.p_stripe_refund_id, amount_cents: 500 }, error: null })
      }
    }
  );
}

let app;
beforeAll(() => {
  mockClient = seed();
  ({ app } = require("../server"));
});
beforeEach(() => {
  for (const group of Object.values(mockStripe)) for (const fn of Object.values(group)) fn.mockReset();
  mockStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_cap", status: "succeeded", amount_received: 2500, currency: "usd", livemode: false, metadata: { app: "harvey_taxi" }, latest_charge: { amount_refunded: 0 } });
  mockStripe.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 500 });
});
const settle = () => new Promise((r) => setTimeout(r, 20));

const refund = (email, body = { amount_cents: 500, reason_code: "fare_adjustment", idempotency_key: "req-0001-test" }, pi = "pi_cap") =>
  request(app).post(`/api/admin/payments/${pi}/refunds`).set("Cookie", session(email)).send(body);

describe("refund route", () => {
  test("off by default: refused before Stripe or the ledger", async () => {
    mockClient = seed();
    const res = await refund(OWNER);
    expect(res.status).toBe(403);
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(reserveCalls).toHaveLength(0);
  });

  test("owner only, even when on", async () => {
    mockClient = seed({ refundsEnabled: true });
    for (const email of [FINANCE, DISPATCHER]) expect((await refund(email)).status).toBe(403);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
    expect((await request(app).post("/api/admin/payments/pi_cap/refunds").send({})).status).toBe(401);
  });

  test("on, owner, test mode: refunds through the ledger and audits ids and codes only", async () => {
    mockClient = seed({ refundsEnabled: true });
    const res = await refund(OWNER);
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ status: "succeeded", stripe_refund_id: "re_1" });
    expect(reserveCalls[0]).toMatchObject({ p_payment_intent_id: "pi_cap", p_amount_cents: 500, p_captured_cents: 2500, p_requested_by: OWNER });
    expect(mockStripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "harvey-refund:ledger-1" });
    await settle();
    const audit = mockClient._state.audit_logs.find((a) => a.action === "payment_refund_requested");
    expect(audit.metadata).toEqual({ amount_cents: 500, reason_code: "fare_adjustment", outcome: "succeeded", ledger_id: "ledger-1" });
  });

  test("a live-mode PaymentIntent is refused even when on", async () => {
    mockClient = seed({ refundsEnabled: true });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_cap", status: "succeeded", amount_received: 2500, currency: "usd", livemode: true, metadata: { app: "harvey_taxi" } });
    const res = await refund(OWNER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("live_refunds_not_approved");
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
    expect(reserveCalls).toHaveLength(0);
  });

  test("bad input is refused with the field name", async () => {
    mockClient = seed({ refundsEnabled: true });
    const res = await refund(OWNER, { amount_cents: "500", reason_code: "fare_adjustment", idempotency_key: "req-0001-test" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("amount_cents");
  });

  test("an ambiguous Stripe failure is 503 and retryable", async () => {
    mockClient = seed({ refundsEnabled: true });
    mockStripe.refunds.create.mockRejectedValue(Object.assign(new Error("timeout"), { type: "StripeConnectionError" }));
    const res = await refund(OWNER);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "stripe_outcome_unknown", retryable: true });
  });
});

describe("reconciliation report (read-only)", () => {
  beforeEach(() => {
    mockStripe.paymentIntents.list.mockResolvedValue({
      data: [
        { id: "pi_tracked", status: "requires_capture", amount: 2500, livemode: false, metadata: { app: "harvey_taxi" } },
        { id: "pi_orphan", status: "succeeded", amount: 1800, amount_received: 1800, livemode: false, metadata: { app: "harvey_taxi" }, client_secret: "pi_orphan_secret_x" }
      ],
      has_more: false
    });
    mockStripe.refunds.list.mockResolvedValue({ data: [], has_more: false });
  });

  test("finance or owner only", async () => {
    mockClient = seed();
    expect((await request(app).post("/api/admin/payments/reconcile/report").set("Cookie", session(DISPATCHER))).status).toBe(403);
    expect(mockStripe.paymentIntents.list).not.toHaveBeenCalled();
  });

  test("reports discrepancies with ids and amounts only, and writes nothing", async () => {
    mockClient = seed();
    const res = await request(app).post("/api/admin/payments/reconcile/report").set("Cookie", session(FINANCE));
    expect(res.status).toBe(200);
    expect(res.body.read_only).toBe(true);
    expect(res.body.summary).toMatchObject({ harvey_intents: 2, payments_rows: 1, rides_with_payment: 1 });
    expect(res.body.findings.map((f) => f.code).sort()).toEqual(["captured_without_ride", "intent_untracked"]);
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    const writes = mockClient._log.filter((e) => ["insert", "update", "upsert", "delete"].includes(e.op) && e.table !== "audit_logs" && e.table !== "admin_rbac_shadow_log");
    expect(writes).toEqual([]);
    for (const fn of [mockStripe.paymentIntents.cancel, mockStripe.paymentIntents.capture, mockStripe.refunds.create]) expect(fn).not.toHaveBeenCalled();
  });
});
