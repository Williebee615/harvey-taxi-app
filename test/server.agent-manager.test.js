// HTTP-level tests for the AI Agent Manager (docs/ai-agent-manager.md):
// permissions, transaction safety, escalation and failure recovery. Real
// Express routes over supertest; only Supabase is replaced by the
// in-memory fake. The self-hosted model URL points at a closed local port,
// so every test also proves the rule-based fallback works with the model
// unreachable -- and no OpenAI/Anthropic credential is set anywhere.

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "ops@example.test";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.NODE_ENV = "test";
process.env.AGENT_LLM_BASE_URL = "http://127.0.0.1:9/v1";
process.env.AGENT_LLM_MODEL = "test-open-weight-model";
process.env.AGENT_LLM_TIMEOUT_MS = "1000";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const {
  signTestDriverToken,
  signTestRiderToken,
  riderAuthHeaders,
  driverAuthHeaders,
  makeRider,
  makeDriver,
  makeRide
} = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const TOKEN_ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const PASSWORD_ADMIN = { "x-admin-email": process.env.ADMIN_EMAIL, "x-admin-password": process.env.ADMIN_PASSWORD };
const tenMinutesAgo = () => new Date(Date.now() - 10 * 60_000).toISOString();

function flags(on = []) {
  return [
    "agent_assist_enabled",
    "agent_shadow_mode_enabled",
    "agent_automation_enabled",
    "agent_auto_redispatch_enabled",
    "agent_kill_switch"
  ].map((key) => ({ key, value: on.includes(key) ? "true" : "false" }));
}

function useFake({ on = [], rides = null, drivers = null, extraFlags = [], options = {} } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: drivers || [makeDriver(), makeDriver({ id: "DRIVER_2", first_name: "Ola", current_lat: 36.2, current_lng: -86.7 })],
      rides: rides || [makeRide({ updated_at: tenMinutesAgo() })],
      driver_offers: [],
      driver_earnings: [{ id: "E1", driver_id: "DRIVER_1", total_earning: 21.5, created_at: new Date().toISOString() }],
      audit_logs: [],
      system_flags: [...flags(on), ...extraFlags]
    },
    { columns: LIVE_COLUMNS, ...options }
  );
  return currentFake;
}

const agentLogs = (fake, action) => fake._state.audit_logs.filter((r) => !action || r.action === action);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

let app;
let runAgentCoordinationSweep;

beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app, runAgentCoordinationSweep } = require("../server"));
});

describe("status and availability", () => {
  test("everything is off by default and the endpoint says so", async () => {
    useFake();
    const res = await request(app).get("/api/agent/status");
    expect(res.status).toBe(200);
    expect(res.body.assist_available).toBe(false);
  });

  test("assist off: 503 with booking-still-works guidance, nothing logged", async () => {
    const fake = useFake();
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "where is my ride" });
    expect(res.status).toBe(503);
    expect(res.body.reply).toMatch(/still book/);
    expect(agentLogs(fake)).toHaveLength(0);
  });

  test("kill switch overrides assist", async () => {
    useFake({ on: ["agent_assist_enabled", "agent_kill_switch"] });
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "hi" });
    expect(res.status).toBe(503);
  });

  test("flag read failure fails closed", async () => {
    useFake({ on: ["agent_assist_enabled"], options: { failSelect: (t) => (t === "system_flags" ? { message: "down" } : null) } });
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "hi" });
    expect(res.status).toBe(503);
  });
});

describe("rider assistance", () => {
  test("model unreachable: rule-based answer, decision logged without raw text", async () => {
    const fake = useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "I need a ride to 12 Oak St, my phone is 615-555-0100" });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("rules");
    expect(res.body.actions[0]).toMatchObject({ type: "open_booking", requires_confirmation: true });
    await settle();
    const [log] = agentLogs(fake, "agent.decision");
    expect(log.metadata).toMatchObject({ record_type: "assistance_answer", executed: false, authenticated: false });
    expect(JSON.stringify(log)).not.toMatch(/Oak|555-0100/);
  });

  test("sessionless rider cannot read ride data, even naming a ride id", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "status of ride RIDE_1", rider_id: "RIDER_1" });
    expect(res.body.reply).toMatch(/sign in/);
    expect(JSON.stringify(res.body)).not.toMatch(/RIDE_1|100 Main/);
  });

  test("verified rider gets their own ride; cancellation is only proposed", async () => {
    const fake = useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app)
      .post("/api/agent/rider/assist")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_1")))
      .send({ message: "cancel my ride" });
    expect(res.status).toBe(200);
    const cancel = res.body.actions.find((a) => a.type === "cancel_ride");
    expect(cancel).toMatchObject({ ride_id: "RIDE_1", requires_confirmation: true, endpoint: "/api/rides/RIDE_1/cancel" });
    expect(fake._state.rides[0].status).toBe("payment_authorized");
    expect(fake._log.filter((e) => e.table === "rides" && e.op === "update")).toHaveLength(0);
  });

  test("another rider's session never sees this ride", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    currentFake._state.riders.push(makeRider({ id: "RIDER_2", email: "b@example.test", phone: "+16155550199" }));
    const res = await request(app)
      .post("/api/agent/rider/assist")
      .set(riderAuthHeaders(signTestRiderToken("RIDER_2")))
      .send({ message: "cancel my ride" });
    expect(res.body.reply).toMatch(/don't have an open ride/);
  });

  test("emergency: 911 first, case opened, never sent to the model", async () => {
    const fake = useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "the driver has a gun and I'm in danger" });
    expect(res.body.reply).toMatch(/call 911/);
    expect(res.body.actions.map((a) => a.type)).toEqual(["call_911", "safety_alert"]);
    expect(res.body.case_id).toMatch(/^CASE-/);
    const opened = agentLogs(fake, "agent.case_opened");
    expect(opened[0].metadata).toMatchObject({ category: "emergency", severity: "critical" });
  });

  test.each([
    ["I was charged twice", "disputed_charge"],
    ["I want a refund for my trip", "refund"],
    ["this looks like fraud", "fraud"]
  ])("%s opens a %s case for a human", async (message, category) => {
    const fake = useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app).post("/api/agent/rider/assist").send({ message });
    expect(res.body.escalation.category).toBe(category);
    expect(agentLogs(fake, "agent.case_opened")[0].metadata.category).toBe(category);
  });

  test("empty or non-string message is rejected", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    expect((await request(app).post("/api/agent/rider/assist").send({ message: { $ne: 1 } })).status).toBe(400);
  });
});

describe("driver assistance", () => {
  test("requires the driver's own session", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    expect((await request(app).post("/api/agent/driver/assist").send({ message: "offers?" })).status).toBe(401);
    // admin credentials cannot act as a driver here
    expect((await request(app).post("/api/agent/driver/assist").set(TOKEN_ADMIN).send({ message: "offers?", driver_id: "DRIVER_1" })).status).toBe(401);
  });

  test("earnings come from the driver's own rows only", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    const res = await request(app)
      .post("/api/agent/driver/assist")
      .set(driverAuthHeaders(signTestDriverToken("DRIVER_1")))
      .send({ message: "how much did I earn" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/\$21\.50/);
  });
});

describe("admin command center: permissions", () => {
  test.each([
    ["get", "/api/admin/agent/overview"],
    ["get", "/api/admin/agent/rides/RIDE_1/recommendations"],
    ["post", "/api/admin/agent/flags"],
    ["post", "/api/admin/agent/rules"],
    ["post", "/api/admin/agent/cases/CASE-1/resolve"],
    ["post", "/api/admin/agent/overrides"],
    ["post", "/api/admin/agent/evaluate"]
  ])("%s %s requires admin", async (method, path) => {
    useFake();
    const res = await request(app)[method](path).set(riderAuthHeaders(signTestRiderToken("RIDER_1"))).send({});
    expect(res.status).toBe(401);
  });

  test("ordinary admin cannot enable automation; elevated admin can; anyone can stop it", async () => {
    const fake = useFake();
    const denied = await request(app).post("/api/admin/agent/flags").set(PASSWORD_ADMIN).send({ key: "agent_automation_enabled", enabled: true });
    expect(denied.status).toBe(403);
    const allowed = await request(app).post("/api/admin/agent/flags").set(TOKEN_ADMIN).send({ key: "agent_automation_enabled", enabled: true });
    expect(allowed.status).toBe(200);
    const kill = await request(app).post("/api/admin/agent/flags").set(PASSWORD_ADMIN).send({ key: "agent_kill_switch", enabled: true, reason: "test" });
    expect(kill.status).toBe(200);
    expect(kill.body.mode.mode).toBe("killed");
    const changes = agentLogs(fake, "agent.flag_changed");
    expect(changes.map((c) => c.entity_id)).toEqual(["agent_automation_enabled", "agent_kill_switch"]);
    expect(changes[1].metadata).toMatchObject({ human_override: true, mode_after: "killed" });
  });

  test("unrelated system flags cannot be changed through this route", async () => {
    const fake = useFake();
    const res = await request(app).post("/api/admin/agent/flags").set(TOKEN_ADMIN).send({ key: "dispatch_paused", enabled: true });
    expect(res.status).toBe(400);
    expect(fake._state.system_flags.find((f) => f.key === "dispatch_paused")).toBeUndefined();
  });

  test("rules are validated and audited", async () => {
    const fake = useFake();
    expect((await request(app).post("/api/admin/agent/rules").set(PASSWORD_ADMIN).send({ rules: { max_candidates: 500 } })).status).toBe(400);
    const res = await request(app).post("/api/admin/agent/rules").set(PASSWORD_ADMIN).send({ rules: { max_candidates: 3 } });
    expect(res.status).toBe(200);
    expect(JSON.parse(fake._state.system_flags.find((f) => f.key === "agent_rules").value).max_candidates).toBe(3);
    expect(agentLogs(fake, "agent.rules_changed")).toHaveLength(1);
  });
});

describe("admin command center: data", () => {
  test("overview shows rides, drivers, alerts and pending recommendations without contact data", async () => {
    useFake();
    const res = await request(app).get("/api/admin/agent/overview").set(PASSWORD_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.mode.mode).toBe("off");
    expect(res.body.active_rides.map((r) => r.id)).toEqual(["RIDE_1"]);
    expect(res.body.recommendations).toEqual([expect.objectContaining({ ride_id: "RIDE_1", decision: "redispatch" })]);
    expect(res.body.alerts.map((a) => a.code)).toContain("stalled_rides");
    expect(res.body.model).toMatchObject({ configured: true, api_key_set: false });
    expect(JSON.stringify(res.body)).not.toMatch(/\+1615|@example\.test"|current_lat/);
  });

  test("overview survives a data outage", async () => {
    useFake({ options: { failSelect: (t) => (t === "rides" ? { message: "down" } : null) } });
    const res = await request(app).get("/api/admin/agent/overview").set(PASSWORD_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.snapshot_error).toMatch(/could not be loaded/);
  });

  test("recommendations are advice only: logged, nothing written to rides or offers", async () => {
    const fake = useFake();
    const res = await request(app).get("/api/admin/agent/rides/RIDE_1/recommendations").set(PASSWORD_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.recommendation.eligible.map((c) => c.driver_id)).toEqual(["DRIVER_1", "DRIVER_2"]);
    expect(fake._log.filter((e) => ["rides", "driver_offers"].includes(e.table) && e.op !== "select")).toHaveLength(0);
    expect(agentLogs(fake, "agent.recommendation")[0].metadata).toMatchObject({ executed: false, record_type: "recommendation" });
  });

  test("cases resolve once; unknown cases 404", async () => {
    const fake = useFake({ on: ["agent_assist_enabled"] });
    const opened = await request(app).post("/api/agent/rider/assist").send({ message: "I want a refund" });
    const id = opened.body.case_id;
    expect((await request(app).post("/api/admin/agent/cases/CASE-NOPE/resolve").set(PASSWORD_ADMIN).send({ resolution: "resolved" })).status).toBe(404);
    expect((await request(app).post(`/api/admin/agent/cases/${id}/resolve`).set(PASSWORD_ADMIN).send({ resolution: "bogus" })).status).toBe(400);
    expect((await request(app).post(`/api/admin/agent/cases/${id}/resolve`).set(PASSWORD_ADMIN).send({ resolution: "referred_to_support" })).status).toBe(200);
    expect((await request(app).post(`/api/admin/agent/cases/${id}/resolve`).set(PASSWORD_ADMIN).send({ resolution: "resolved" })).status).toBe(409);
    const ov = await request(app).get("/api/admin/agent/overview").set(PASSWORD_ADMIN);
    expect(ov.body.cases[0]).toMatchObject({ case_id: id, status: "resolved", resolution: "referred_to_support" });
    expect(agentLogs(fake, "agent.case_resolved")[0].metadata.human_override).toBe(true);
  });
});

describe("coordination: shadow mode and gated automation", () => {
  const rideWrites = (fake) => fake._log.filter((e) => ["rides", "driver_offers"].includes(e.table) && e.op !== "select");

  test("mode off: the sweep does nothing", async () => {
    const fake = useFake();
    expect(await runAgentCoordinationSweep()).toEqual({ skipped: "mode_off" });
    expect(rideWrites(fake)).toHaveLength(0);
  });

  test("shadow mode logs would-redispatch and touches no ride, offer or driver", async () => {
    const fake = useFake({ on: ["agent_shadow_mode_enabled"] });
    const result = await runAgentCoordinationSweep();
    expect(result.outcomes).toEqual([expect.objectContaining({ ride_id: "RIDE_1", decision: "would_redispatch", executed: false })]);
    expect(rideWrites(fake)).toHaveLength(0);
    expect(agentLogs(fake, "agent.shadow_decision")[0].metadata).toMatchObject({ record_type: "shadow_only_not_executed", executed: false });
  });

  test("shadow wins over automation flags", async () => {
    const fake = useFake({ on: ["agent_shadow_mode_enabled", "agent_automation_enabled", "agent_auto_redispatch_enabled"] });
    await runAgentCoordinationSweep();
    expect(rideWrites(fake)).toHaveLength(0);
  });

  test("admin manual evaluation is always shadow-only", async () => {
    const fake = useFake({ on: ["agent_automation_enabled", "agent_auto_redispatch_enabled"] });
    const res = await request(app).post("/api/admin/agent/evaluate").set(PASSWORD_ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcomes[0].decision).toBe("would_redispatch");
    expect(rideWrites(fake)).toHaveLength(0);
  });

  test("automation (when explicitly enabled) redispatches once through dispatchRide; concurrent runs never double-dispatch", async () => {
    const fake = useFake({ on: ["agent_automation_enabled", "agent_auto_redispatch_enabled"] });
    fake.rpc = jest.fn(async (fn) => (fn === "dispatch_ride_atomic" ? { data: null, error: { message: "rpc unavailable in fake" } } : { data: null, error: null }));
    const [a, b] = await Promise.all([runAgentCoordinationSweep(), runAgentCoordinationSweep()]);
    expect([a.skipped, b.skipped].filter(Boolean)).toEqual(["already_running"]);
    const offers = fake._state.driver_offers;
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ ride_id: "RIDE_1", driver_id: "DRIVER_1", status: "pending" });
    expect(agentLogs(fake, "agent.action_executed")[0].metadata).toMatchObject({ executed: true, action: "redispatch_via_dispatchRide" });
    // A second pass sees the live offer and does nothing more.
    await runAgentCoordinationSweep();
    expect(fake._state.driver_offers).toHaveLength(1);
    // Even with the offer gone, the per-ride cooldown holds the next attempt.
    fake._state.driver_offers[0].status = "expired";
    fake._state.rides[0].status = "payment_authorized";
    fake._state.rides[0].updated_at = tenMinutesAgo();
    const third = await runAgentCoordinationSweep();
    expect(third.outcomes[0]).toMatchObject({ decision: "wait", reason: "cooldown" });
  });

  test("automation never claims a ride that changed since the snapshot", async () => {
    const fake = useFake({ on: ["agent_automation_enabled", "agent_auto_redispatch_enabled"], rides: [makeRide({ id: "RIDE_CHANGED", updated_at: tenMinutesAgo() })] });
    const originalFrom = fake.from;
    let ridesReads = 0;
    fake.from = (table) => {
      const builder = originalFrom(table);
      if (table === "rides") {
        ridesReads += 1;
        // After the snapshot read, someone else updates the ride.
        if (ridesReads === 3) fake._state.rides[0].updated_at = new Date().toISOString();
      }
      return builder;
    };
    const result = await runAgentCoordinationSweep();
    expect(result.outcomes[0]).toMatchObject({ decision: "skipped", executed: false });
    expect(fake._state.driver_offers).toHaveLength(0);
  });

  test("kill switch and dispatch pause both block automation", async () => {
    for (const extra of [["agent_kill_switch"], []]) {
      const fake = useFake({
        on: ["agent_automation_enabled", "agent_auto_redispatch_enabled", ...extra],
        extraFlags: extra.length ? [] : [{ key: "dispatch_paused", value: "true" }]
      });
      const res = await runAgentCoordinationSweep();
      expect(res.skipped).toBeDefined();
      expect(rideWrites(fake)).toHaveLength(0);
    }
  });

  test("rides out of automatic attempts go to a human", async () => {
    const fake = useFake({ on: ["agent_automation_enabled", "agent_auto_redispatch_enabled"], rides: [makeRide({ id: "RIDE_X", updated_at: tenMinutesAgo(), dispatch_attempts: 3 })] });
    await runAgentCoordinationSweep();
    expect(fake._state.driver_offers).toHaveLength(0);
    expect(agentLogs(fake, "agent.case_opened")[0].metadata).toMatchObject({ category: "dispatch_exhausted", ride_id: "RIDE_X" });
  });
});
