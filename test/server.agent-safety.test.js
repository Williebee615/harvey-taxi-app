// AI Agent Manager safety properties that must hold beyond one process:
//   - every admin route requires an authenticated admin (enumerated);
//   - forged or missing credentials can never change agent flags,
//     including turning things off or engaging the kill switch;
//   - the kill switch stops queued automated actions immediately, and an
//     action stopped between claim and dispatch is handed back untouched;
//   - redispatch protection holds across two server instances sharing one
//     database and across a restart (fresh process memory);
//   - model status is "disabled"/"not_checked" until a health check succeeds.

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
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.AGENT_LLM_BASE_URL = "http://127.0.0.1:9/v1";
process.env.AGENT_LLM_MODEL = "test-open-weight-model";
process.env.AGENT_LLM_TIMEOUT_MS = "800";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const { makeRider, makeDriver, makeRide } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy({}, {
  get(_t, prop) {
    const v = currentFake[prop];
    return typeof v === "function" ? v.bind(currentFake) : v;
  }
});

const AUTOMATION_ON = ["agent_automation_enabled", "agent_auto_redispatch_enabled"];
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();

function useFake({ on = [], rides } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: [
        makeDriver(),
        makeDriver({ id: "DRIVER_2", email: "d2@example.test", phone: "+16155550202", current_lat: 36.17, current_lng: -86.77 })
      ],
      rides: rides || [makeRide({ id: "RIDE_A", updated_at: ago(10) })],
      driver_offers: [],
      audit_logs: [],
      system_flags: [
        "agent_assist_enabled",
        "agent_shadow_mode_enabled",
        "agent_automation_enabled",
        "agent_auto_redispatch_enabled",
        "agent_kill_switch"
      ].map((key) => ({ key, value: on.includes(key) ? "true" : "false" }))
    },
    { columns: LIVE_COLUMNS }
  );
  currentFake.rpc = jest.fn(async (fn) =>
    fn === "dispatch_ride_atomic" ? { data: null, error: { message: "rpc unavailable in fake" } } : { data: null, error: null }
  );
  return currentFake;
}
const flag = (key) => currentFake._state.system_flags.find((f) => f.key === key);
const setFlag = (key, value) => {
  const row = flag(key);
  if (row) row.value = value;
  else currentFake._state.system_flags.push({ key, value });
};

// A separate server "instance": its own module registry, so its own
// in-process memory, sharing the same database (the fake).
function loadInstance() {
  let mod;
  jest.isolateModules(() => {
    mod = require("../server");
  });
  return mod;
}

let app;
let sweep;
beforeAll(() => {
  useFake();
  ({ app, runAgentCoordinationSweep: sweep } = loadInstance());
});

describe("admin access", () => {
  test("every /api/admin route has admin middleware (except sign-in itself)", () => {
    const PUBLIC_BY_DESIGN = new Set(["/api/admin/login", "/api/admin/logout", "/api/admin/session"]);
    const stack = (app._router || app.router).stack;
    const unprotected = [];
    let count = 0;
    for (const layer of stack) {
      if (!layer.route || typeof layer.route.path !== "string" || !layer.route.path.startsWith("/api/admin")) continue;
      count += 1;
      const names = layer.route.stack.map((s) => s.name);
      if (!names.some((n) => n === "requireAdmin" || n === "requireElevatedAdmin") && !PUBLIC_BY_DESIGN.has(layer.route.path)) {
        unprotected.push(`${Object.keys(layer.route.methods)} ${layer.route.path}`);
      }
    }
    expect(count).toBeGreaterThanOrEqual(40);
    expect(unprotected).toEqual([]);
  });

  const AGENT_ROUTES = [
    ["get", "/api/admin/agent/overview"],
    ["get", "/api/admin/agent/rides/RIDE_A/recommendations"],
    ["post", "/api/admin/agent/flags"],
    ["post", "/api/admin/agent/rules"],
    ["post", "/api/admin/agent/cases/CASE-X/resolve"],
    ["post", "/api/admin/agent/overrides"],
    ["post", "/api/admin/agent/evaluate"],
    ["post", "/api/admin/agent/model/check"]
  ];
  const FORGED = [
    ["no credentials", {}],
    ["wrong admin token", { "x-admin-token": "test-admin-tokenX" }],
    ["empty admin token", { "x-admin-token": "" }],
    ["wrong password", { "x-admin-email": "ops@example.test", "x-admin-password": "nope" }],
    ["right password, wrong email", { "x-admin-email": "attacker@example.test", "x-admin-password": "test-admin-password" }],
    ["forged session cookie", { Cookie: "htaf_admin_session=eyJlbWFpbCI6Im9wc0BleGFtcGxlLnRlc3QifQ.forged" }]
  ];

  test.each(AGENT_ROUTES)("%s %s rejects every forged or missing credential", async (method, path) => {
    for (const [, headers] of FORGED) {
      const res = await request(app)[method](path).set(headers).send({ key: "agent_kill_switch", enabled: true });
      expect(res.status).toBe(401);
    }
  });

  test("nobody unauthenticated can disable assistance or engage the kill switch", async () => {
    useFake({ on: ["agent_assist_enabled"] });
    for (const [, headers] of FORGED) {
      await request(app).post("/api/admin/agent/flags").set(headers).send({ key: "agent_kill_switch", enabled: true });
      await request(app).post("/api/admin/agent/flags").set(headers).send({ key: "agent_assist_enabled", enabled: false });
    }
    expect(flag("agent_kill_switch").value).toBe("false");
    expect(flag("agent_assist_enabled").value).toBe("true");
    expect(currentFake._state.audit_logs.filter((a) => a.action === "agent.flag_changed")).toHaveLength(0);
  });
});

describe("kill switch", () => {
  test("engaged after the first action: the remaining queued rides are not dispatched", async () => {
    const fake = useFake({
      on: AUTOMATION_ON,
      rides: [makeRide({ id: "RIDE_A", updated_at: ago(10) }), makeRide({ id: "RIDE_B", updated_at: ago(10) })]
    });
    // Engage the kill switch the moment the first offer is written.
    const from = fake.from.bind(fake);
    fake.from = (table) => {
      const b = from(table);
      if (table === "driver_offers") {
        const insert = b.insert.bind(b);
        b.insert = (row) => {
          setFlag("agent_kill_switch", "true");
          return insert(row);
        };
      }
      return b;
    };
    const result = await sweep();
    expect(fake._state.driver_offers).toHaveLength(1);
    expect(result.outcomes.map((o) => o.decision)).toEqual(["redispatched", "skipped"]);
    expect(result.outcomes[1].reason).toBe("automation_stopped");
    const untouched = fake._state.rides.find((r) => r.id === result.outcomes[1].ride_id);
    expect(untouched.dispatch_status).toBe("ready_to_dispatch");
  });

  test("engaged between claim and dispatch: the ride is handed back exactly as it was", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_K", updated_at: ago(10), dispatch_status: "ready_to_dispatch" })] });
    const from = fake.from.bind(fake);
    fake.from = (table) => {
      const b = from(table);
      if (table === "rides") {
        const update = b.update.bind(b);
        b.update = (patch) => {
          if (patch.dispatch_status === "redispatching") setFlag("agent_kill_switch", "true");
          return update(patch);
        };
      }
      return b;
    };
    const result = await sweep();
    expect(result.outcomes[0]).toMatchObject({ decision: "skipped", reason: "automation_stopped" });
    const ride = fake._state.rides[0];
    expect(ride.dispatch_status).toBe("ready_to_dispatch");
    expect(ride.dispatch_claimed_at).toBeNull();
    expect(fake._state.driver_offers).toHaveLength(0);
  });

  test("turning automation off (not only the kill switch) also stops queued actions", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_OFF", updated_at: ago(10) })] });
    const from = fake.from.bind(fake);
    let reads = 0;
    fake.from = (table) => {
      if (table === "system_flags" && ++reads === 2) setFlag("agent_auto_redispatch_enabled", "false");
      return from(table);
    };
    const result = await sweep();
    expect(result.outcomes[0].reason).toBe("automation_stopped");
    expect(fake._state.driver_offers).toHaveLength(0);
  });

  test("a failed flag read stops automation (fail closed)", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_FAIL", updated_at: ago(10) })] });
    const from = fake.from.bind(fake);
    let reads = 0;
    fake.from = (table) => {
      if (table === "system_flags" && ++reads >= 2) {
        return createFakeSupabase({}, { failSelect: () => ({ message: "down" }) }).from(table);
      }
      return from(table);
    };
    const result = await sweep();
    expect(result.outcomes[0].reason).toBe("automation_stopped");
    expect(fake._state.driver_offers).toHaveLength(0);
  });
});

describe("redispatch protection beyond one process", () => {
  test("two instances sweeping at the same time dispatch a ride once", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_M", updated_at: ago(10) })] });
    const other = loadInstance();
    const [a, b] = await Promise.all([sweep(), other.runAgentCoordinationSweep()]);
    expect(fake._state.driver_offers).toHaveLength(1);
    const decisions = [...a.outcomes, ...b.outcomes].map((o) => o.decision).sort();
    expect(decisions).toEqual(["redispatched", "skipped"]);
  });

  test("after a restart (fresh memory) the database cooldown still holds", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_R", updated_at: ago(10) })] });
    await sweep();
    expect(fake._state.driver_offers).toHaveLength(1);
    // The offer expires and the ride is back to waiting, as if nothing happened.
    fake._state.driver_offers[0].status = "expired";
    Object.assign(fake._state.rides[0], { status: "payment_authorized", dispatch_status: "ready_to_dispatch", updated_at: ago(10) });
    const restarted = loadInstance();
    const result = await restarted.runAgentCoordinationSweep();
    expect(result.outcomes[0]).toMatchObject({ decision: "wait", reason: "cooldown" });
    expect(fake._state.driver_offers).toHaveLength(1);
  });

  test("exhausted rides open one case, even from two instances and after a restart", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_X", updated_at: ago(10), dispatch_attempts: 3 })] });
    await sweep();
    await loadInstance().runAgentCoordinationSweep();
    const opened = fake._state.audit_logs.filter((a) => a.action === "agent.case_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0].entity_id).toBe("CASE-DISPATCH-RIDE_X");
  });

  test("a crash after the claim leaves the ride for the existing stuck-redispatch recovery", async () => {
    const fake = useFake({ on: AUTOMATION_ON, rides: [makeRide({ id: "RIDE_C", updated_at: ago(10) })] });
    fake.rpc = jest.fn(async () => {
      throw new Error("process died");
    });
    await sweep();
    const ride = fake._state.rides[0];
    expect(ride.dispatch_status === "redispatching" || fake._state.driver_offers.length === 1).toBe(true);
    expect(ride.dispatch_claimed_at).toBeTruthy();
  });
});

describe("model status", () => {
  test("configured but never checked reads not_checked; an unreachable check reads unreachable", async () => {
    useFake();
    const admin = { "x-admin-token": "test-admin-token" };
    const before = await request(app).get("/api/admin/agent/overview").set(admin);
    expect(before.body.model.health).toBe("not_checked");
    const checked = await request(app).post("/api/admin/agent/model/check").set(admin).send({});
    expect(checked.body.model.health).toBe("unreachable");
    expect(checked.body.model.last_checked_at).toBeTruthy();
  });
});
