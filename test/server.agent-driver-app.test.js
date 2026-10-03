// Harvey Assistant in the Harvey Taxi Driver app (driver-app/src/assistant.js):
// the driver route answers with in-app actions when client = "driver_app",
// built only from the signed-in driver's own rows, and never changes a ride,
// an offer or availability itself. The web dashboard (no client) keeps its
// existing answers and links.
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
  return ["agent_assist_enabled", "agent_kill_switch"].map((key) => ({ key, value: on.includes(key) ? "true" : "false" }));
}

const future = () => new Date(Date.now() + 60_000).toISOString();

function useFake({ rides = [makeRide()], offers = [], on = ["agent_assist_enabled"] } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: [makeDriver({ online: false }), makeDriver({ id: "DRIVER_2", first_name: "Ola" })],
      rides,
      driver_offers: offers,
      driver_earnings: [{ id: "E1", driver_id: "DRIVER_1", total_earning: 21.5, created_at: new Date().toISOString() }],
      audit_logs: [],
      system_flags: flags(on)
    },
    { columns: LIVE_COLUMNS }
  );
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const DRIVER_1 = () => driverAuthHeaders(signTestDriverToken("DRIVER_1"));
const ask = (message, { client = "driver_app", headers = DRIVER_1() } = {}) =>
  request(app).post("/api/agent/driver/assist").set(headers).send(client ? { message, client } : { message });

describe("driver app answers", () => {
  test("offers: one confirmable response per offer of this driver only", async () => {
    const fake = useFake({
      offers: [
        { id: "OFFER_MINE", ride_id: "RIDE_1", driver_id: "DRIVER_1", status: "pending", expires_at: future() },
        { id: "OFFER_OTHER", ride_id: "RIDE_1", driver_id: "DRIVER_2", status: "pending", expires_at: future() }
      ]
    });
    const res = await ask("do I have any offers");
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("driver_offers");
    expect(res.body.reply).toMatch(/1 ride offer waiting.*on the Drive screen/);
    expect(res.body.actions).toEqual([{ type: "respond_offer", offer_id: "OFFER_MINE", requires_confirmation: true }]);
    expect(fake._state.driver_offers.map((o) => o.status)).toEqual(["pending", "pending"]);
  });

  test("active trip: next step in the app's words, navigate and a confirmable step; ride unchanged", async () => {
    const fake = useFake({ rides: [makeRide({ driver_id: "DRIVER_1", status: "driver_enroute" })] });
    const res = await ask("what's next on my current trip");
    expect(res.body.intent).toBe("driver_active_ride");
    expect(res.body.reply).toMatch(/I've arrived at pickup/);
    expect(res.body.actions).toEqual([
      { type: "navigate", ride_id: "RIDE_1", target: "pickup", address: "100 Main St" },
      { type: "trip_step", ride_id: "RIDE_1", status: "driver_enroute", requires_confirmation: true }
    ]);
    expect(fake._state.rides[0].status).toBe("driver_enroute");
  });

  test("navigation during the trip points at the drop-off", async () => {
    useFake({ rides: [makeRide({ driver_id: "DRIVER_1", status: "in_progress" })] });
    const res = await ask("navigate please");
    expect(res.body.intent).toBe("driver_navigation");
    expect(res.body.reply).toMatch(/drop-off: 200 Elm St/);
    expect(res.body.actions).toEqual([{ type: "navigate", ride_id: "RIDE_1", target: "dropoff", address: "200 Elm St" }]);
  });

  test("another driver's ride is never used", async () => {
    useFake({ rides: [makeRide({ driver_id: "DRIVER_2", status: "in_progress" })] });
    const res = await ask("directions");
    expect(res.body.reply).toMatch(/don't have an active trip/);
    expect(res.body.actions).toEqual([]);
  });

  test("availability is proposed for confirmation, never changed", async () => {
    const fake = useFake();
    const res = await ask("how do I go online");
    expect(res.body.intent).toBe("driver_availability");
    expect(res.body.actions).toEqual([{ type: "toggle_availability", requires_confirmation: true }]);
    expect(fake._state.drivers.find((d) => d.id === "DRIVER_1").online).toBe(false);
  });

  test("earnings and support open in-app screens", async () => {
    useFake();
    const earnings = await ask("how much did I earn");
    expect(earnings.body.reply).toMatch(/\$21\.50/);
    expect(earnings.body.actions).toEqual([{ type: "open_screen", screen: "earnings", label: "Open Earnings" }]);
    const support = await ask("I need to contact support");
    expect(support.body.intent).toBe("driver_support");
    expect(support.body.actions).toEqual([{ type: "open_support", label: "Contact support" }]);
  });

  test("emergencies still go to 911 and a human case first", async () => {
    const fake = useFake();
    const res = await ask("I was in an accident, someone is injured");
    expect(res.body.escalation).toMatchObject({ category: "emergency" });
    expect(res.body.actions.map((a) => a.type)).toEqual(["call_911", "safety_alert"]);
    expect(fake._state.audit_logs.some((r) => r.action === "agent.case_opened")).toBe(true);
  });
});

describe("compatibility and access", () => {
  test("the web dashboard (no client, or an unknown one) keeps its links", async () => {
    useFake({ rides: [makeRide({ driver_id: "DRIVER_1", status: "driver_enroute" })] });
    for (const client of [null, "something_else"]) {
      const res = await ask("what's next on my current trip", { client });
      expect(res.body.reply).toMatch(/tap "Arrived"/);
      expect(res.body.actions).toEqual([{ type: "open_dashboard", label: "Open driver dashboard", href: "/driver-dashboard.html" }]);
    }
  });

  test("the rider route ignores the driver-app client", async () => {
    useFake();
    const res = await request(app).post("/api/agent/rider/assist").send({ message: "book a ride", client: "driver_app" });
    expect(res.body.actions[0]).toMatchObject({ type: "open_booking" });
  });

  test("still needs the driver's session, and is off when the flag is off", async () => {
    useFake();
    expect((await ask("offers", { headers: {} })).status).toBe(401);
    useFake({ on: [] });
    expect((await ask("offers")).status).toBe(503);
  });
});
