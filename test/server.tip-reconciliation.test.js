// Tip reconciliation (owner decision 2026-10-23): read-only comparison of
// Stripe tip charges with ride_tips and driver earnings, on the live and
// test Stripe accounts. Finance permission for the on-demand report; the
// daily run is off unless tips_reconciliation_enabled is "true", runs at
// most once per 20 h, and alerts only when it finds something. Nothing is
// refunded, cancelled, charged or edited.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.STRIPE_SECRET_KEY = "sk_live_" + "fake".repeat(4);
process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_fake";
process.env.ORDERS_STRIPE_SECRET_KEY = "sk_test_orders";
process.env.ORDERS_STRIPE_PUBLISHABLE_KEY = "pk_test_orders";

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));
jest.mock("web-push", () => ({ setVapidDetails: () => {}, sendNotification: async () => {} }));

const mockStripeData = { live: [], test: [] };
const mockStripeCalls = [];
jest.mock("stripe", () =>
  function MockStripe(key) {
    const account = String(key).startsWith("sk_live_") ? "live" : "test";
    const forbidden = (op) => async () => {
      mockStripeCalls.push({ account, op });
      throw new Error(`${op} must not be called`);
    };
    return {
      paymentIntents: {
        list: async (params) => {
          mockStripeCalls.push({ account, op: "list", params });
          return { data: mockStripeData[account], has_more: false };
        },
        create: forbidden("create"),
        cancel: forbidden("cancel"),
        capture: forbidden("capture"),
        update: forbidden("update"),
        retrieve: async () => null
      },
      refunds: { create: forbidden("refund"), list: async () => ({ data: [], has_more: false }) },
      webhooks: { constructEvent: () => { throw new Error("no"); } }
    };
  }
);
jest.setTimeout(60_000);

const OWNER = "owner@harvey.example";
const FINANCE = "finance@harvey.example";
const DISPATCHER = "dispatch@harvey.example";
function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return [`htaf_admin_session=${encoded}.${sig}`];
}

const recent = new Date(Date.now() - 2 * 86400000).toISOString();
const liveIntent = (id, extra = {}) => ({ id, status: "succeeded", amount: 500, amount_received: 500, currency: "usd", livemode: true, created: Math.floor(Date.now() / 1000) - 86400, metadata: { kind: "ride_tip", tip_id: `tip_${id}`, ride_id: "RIDE-1" }, latest_charge: { amount_refunded: 0 }, ...extra });

function seed({ flags = {}, tips = [], earnings = [], audit = [] } = {}) {
  mockStripeCalls.length = 0;
  mockClient = createFakeSupabase({
    admin_roles: [{ email: FINANCE, role: "finance" }, { email: DISPATCHER, role: "dispatcher" }],
    admin_rbac_shadow_log: [],
    audit_logs: audit,
    system_flags: Object.entries(flags).map(([key, value]) => ({ key, value })),
    rides: [{ id: "RIDE-1", tip_amount: 0 }, { id: "RIDE-2", tip_amount: 0 }],
    ride_tips: tips,
    driver_earnings: earnings
  });
}

let app;
let server;
beforeAll(() => {
  seed();
  server = require("../server");
  ({ app } = server);
});

const report = (email) => request(app).post("/api/admin/tips/reconcile").set("Cookie", session(email)).send({});
const moneyCalls = () => mockStripeCalls.filter((c) => c.op !== "list");

describe("on-demand report", () => {
  test("clean data: no findings on either account, and only list calls with the charge expanded", async () => {
    mockStripeData.live = [liveIntent("pi_1")];
    mockStripeData.test = [];
    seed({
      tips: [{ id: "tip_pi_1", ride_id: "RIDE-1", driver_id: "D1", amount_cents: 500, status: "succeeded", mode: "live", payment_intent_id: "pi_1", created_at: recent }],
      earnings: [{ ride_id: "RIDE-1", tip_amount: 5, driver_base_earning: 20, total_earning: 25 }]
    });
    const res = await report(FINANCE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ read_only: true, scheduled_daily: false, discrepancies: 0, failed_modes: [] });
    expect(res.body.reports.map((r) => r.mode)).toEqual(["live", "test"]);
    expect(res.body.reports[0].summary).toMatchObject({ stripe_tip_cents: 500, recorded_tip_cents: 500, earnings_checked: 1 });
    expect(mockStripeCalls.filter((c) => c.op === "list").map((c) => c.account).sort()).toEqual(["live", "test"]);
    expect(mockStripeCalls[0].params.expand).toEqual(["data.latest_charge"]);
    expect(moneyCalls()).toEqual([]);
  });

  test("mismatches are reported and nothing is changed", async () => {
    mockStripeData.live = [liveIntent("pi_1"), liveIntent("pi_2", { metadata: { kind: "ride_tip", tip_id: "tip_pi_2", ride_id: "RIDE-2" } })];
    const tips = [{ id: "tip_pi_1", ride_id: "RIDE-1", driver_id: "D1", amount_cents: 500, status: "pending", mode: "live", payment_intent_id: "pi_1", created_at: recent }];
    const earnings = [{ ride_id: "RIDE-1", tip_amount: 0, driver_base_earning: 20, total_earning: 20 }];
    seed({ tips: JSON.parse(JSON.stringify(tips)), earnings: JSON.parse(JSON.stringify(earnings)) });
    const res = await report(FINANCE);
    expect(res.body.discrepancies).toBe(2);
    expect(res.body.reports[0].findings.map((f) => f.code).sort()).toEqual(["tip_paid_not_recorded", "tip_paid_untracked"]);
    expect(mockClient._state.ride_tips).toEqual(tips);
    expect(mockClient._state.driver_earnings).toEqual(earnings);
    expect(moneyCalls()).toEqual([]);
    const audit = mockClient._state.audit_logs.find((a) => a.action === "tip_reconciliation_admin_run");
    expect(audit.metadata.discrepancies).toBe(2);
    expect(JSON.stringify(audit)).not.toMatch(/client_secret|card/);
  });

  test("needs the finance permission", async () => {
    seed();
    expect((await report(DISPATCHER)).status).toBe(403);
    expect((await request(app).post("/api/admin/tips/reconcile").send({})).status).toBe(401);
  });
});

describe("daily run", () => {
  test("off by default", async () => {
    seed();
    expect(await server.runScheduledTipReconciliation()).toEqual({ skipped: true, reason: "disabled" });
    expect(mockStripeCalls).toEqual([]);
  });

  test("when on, runs, records the run and alerts only on findings", async () => {
    mockStripeData.live = [liveIntent("pi_9")];
    mockStripeData.test = [];
    seed({ flags: { tips_reconciliation_enabled: "true" } });
    const result = await server.runScheduledTipReconciliation();
    expect(result.discrepancies).toBe(1);
    const actions = mockClient._state.audit_logs.map((a) => a.action);
    expect(actions).toContain("tip_reconciliation_scheduled_run");
    expect(actions).toContain("payment_ops_alert_tip_reconciliation_discrepancies");
    expect(moneyCalls()).toEqual([]);

    mockStripeData.live = [];
    seed({ flags: { tips_reconciliation_enabled: "true" } });
    await server.runScheduledTipReconciliation();
    expect(mockClient._state.audit_logs.map((a) => a.action)).not.toContain("payment_ops_alert_tip_reconciliation_discrepancies");
  });

  test("doesn't run twice within 20 hours, even after a restart", async () => {
    seed({ flags: { tips_reconciliation_enabled: "true" }, audit: [{ id: 1, action: "tip_reconciliation_scheduled_run", created_at: new Date(Date.now() - 3600000).toISOString(), metadata: {} }] });
    expect(await server.runScheduledTipReconciliation()).toEqual({ skipped: true, reason: "ran_recently" });
    expect(mockStripeCalls).toEqual([]);
  });
});
