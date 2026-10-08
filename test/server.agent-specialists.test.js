// Specialist agents over the real routes (lib/agent/specialists.js,
// docs/ai-agent-manager.md "Agent hierarchy"). Only Supabase is replaced by
// the in-memory fake (live column list). No model credential is set.
// All data is test fixtures.
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
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const { signTestDriverToken, signTestRiderToken, riderAuthHeaders, driverAuthHeaders, makeRider, makeDriver, makeRide } = require("./rideTestHelpers");
const { SPECIALIST_FLAG_KEYS, SPECIALIST_FLAGS } = require("../lib/agent/specialists");

let currentFake;
const mockSupabaseClient = new Proxy(
  {},
  {
    get(_t, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const TOKEN_ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const PASSWORD_ADMIN = { "x-admin-email": process.env.ADMIN_EMAIL, "x-admin-password": process.env.ADMIN_PASSWORD };
const RIDER = riderAuthHeaders(signTestRiderToken("RIDER_1"));
const OTHER_RIDER = riderAuthHeaders(signTestRiderToken("RIDER_2"));
const DRIVER = driverAuthHeaders(signTestDriverToken("DRIVER_1"));

function useFake({ flags = {}, rides = [], drivers = null } = {}) {
  const base = { agent_assist_enabled: "true", agent_kill_switch: "false", ...flags };
  currentFake = createFakeSupabase(
    {
      riders: [makeRider(), makeRider({ id: "RIDER_2", email: "r2@example.test", phone: "+16155550111" })],
      drivers: drivers || [makeDriver({ online: false })],
      rides,
      driver_offers: [],
      driver_earnings: [],
      driver_online_sessions: [],
      audit_logs: [],
      htaf_assistant_questions: [],
      system_flags: Object.entries(base).map(([key, value]) => ({ key, value }))
    },
    { columns: LIVE_COLUMNS }
  );
  return currentFake;
}
const allOn = () => Object.fromEntries(SPECIALIST_FLAG_KEYS.map((k) => [k, "true"]));
const ask = (role, message, headers = {}) => request(app).post(`/api/agent/${role}/assist`).set(headers).send({ message });
const decisions = (fake) => fake._state.audit_logs.filter((r) => r.action === "agent.decision");
const cases = (fake) => fake._state.audit_logs.filter((r) => r.action === "agent.case_opened");
const settle = () => new Promise((r) => setTimeout(r, 30));

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const WAITING_RIDE = () => makeRide({ id: "TEST-RIDE-WAIT", rider_id: "RIDER_1", status: "awaiting_driver_acceptance", ride_type: "standard", driver_id: null, pickup_lat: 36.16, pickup_lng: -86.78 });
const FOOD = () => makeRide({ id: "TEST-FOOD", rider_id: "RIDER_1", driver_id: "DRIVER_1", driver_name: "Dana", status: "driver_enroute", ride_type: "food", delivery_stage: "enroute_store", merchant_name: "TEST Kitchen", delivery_pin: "4321" });

describe("all specialists off (the default): chiefs answer exactly as before", () => {
  test.each([
    ["rider", "where is my delivery", RIDER],
    ["rider", "my driver was speeding", RIDER],
    ["rider", "I want to talk to support", RIDER],
    ["rider", "what programs does HTAF offer", RIDER],
    ["rider", "where is my ride", RIDER],
    ["driver", "what documents do I need for onboarding", DRIVER]
  ])("%s: %s", async (role, message, headers) => {
    const fake = useFake({ rides: [WAITING_RIDE(), FOOD()] });
    const res = await ask(role, message, headers);
    expect(res.status).toBe(200);
    expect(res.body.specialist).toBeUndefined();
    expect(String(res.body.intent)).not.toMatch(/^specialist\./);
    await settle();
    expect(decisions(fake)[0].metadata).toMatchObject({ specialist: null, chief: null, engine: null });
  });

  test("the stop switch turns specialists off with everything else", async () => {
    useFake({ flags: { ...allOn(), agent_kill_switch: "true" }, rides: [FOOD()] });
    const res = await ask("rider", "where is my delivery", RIDER);
    expect(res.status).toBe(503);
  });
});

describe("Ride Booking & Dispatch (reports to Harvey Assistant (Rider))", () => {
  test("waiting ride: Dispatch Recommender's advice read-only, aggregates only", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.RIDE_BOOKING]: "true" }, rides: [WAITING_RIDE()] });
    const before = JSON.stringify(fake._state.rides);
    const res = await ask("rider", "why is no driver coming", RIDER);
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(
      "Your ride is being offered to nearby drivers. Right now no available drivers are near your pickup. You can keep waiting, or cancel at no charge."
    );
    expect(res.body.source).toBe("rules");
    expect(res.body.specialist).toEqual({ id: "ride_booking_dispatch", name: "Ride Booking & Dispatch", chief: "Harvey Assistant (Rider)", engine: "rules", engine_label: "Rules-based (no AI model)" });
    expect(res.body.actions.find((a) => a.type === "cancel_ride")).toMatchObject({ requires_confirmation: true });
    // Nothing changed, no driver detail leaked.
    expect(JSON.stringify(fake._state.rides)).toBe(before);
    expect(JSON.stringify(res.body)).not.toMatch(/DRIVER_1|36\.16/);
    await settle();
    expect(decisions(fake)[0].metadata).toMatchObject({ specialist: "ride_booking_dispatch", chief: "harvey_assistant_rider", engine: "rules", executed: false, answer_source: "rules" });
  });

  test("an online eligible driver nearby is reported without identifying them", async () => {
    useFake({
      flags: { [SPECIALIST_FLAGS.RIDE_BOOKING]: "true" },
      rides: [WAITING_RIDE()],
      drivers: [makeDriver({ online: true, current_lat: 36.161, current_lng: -86.781, last_location_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })]
    });
    const res = await ask("rider", "where is my ride", RIDER);
    expect(res.body.reply).toMatch(/Available drivers are near your pickup; offers continue automatically\.$/);
    expect(JSON.stringify(res.body)).not.toMatch(/DRIVER_1|Jamie|Test Driver/i);
  });

  test("another rider's ride is never used", async () => {
    useFake({ flags: { [SPECIALIST_FLAGS.RIDE_BOOKING]: "true" }, rides: [WAITING_RIDE()] });
    const res = await ask("rider", "where is my ride", OTHER_RIDER);
    expect(res.body.reply).toBe("You don't have an open ride right now.");
  });
});

describe("Food & Grocery Delivery (reports to Harvey Assistant (Rider))", () => {
  test("status without ever writing the PIN; cancel only as a confirmed button", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.DELIVERY]: "true" }, rides: [FOOD()] });
    const res = await ask("rider", "can I cancel my delivery?", RIDER);
    expect(res.body.reply).toMatch(/^Your food delivery from TEST Kitchen is driver on the way to the store\. Driver: Dana\./);
    expect(JSON.stringify(res.body)).not.toMatch(/4321/);
    expect(res.body.actions.map((a) => a.type)).toEqual(["open_dashboard", "cancel_ride"]);
    expect(fake._state.rides[0].status).toBe("driver_enroute");
    await settle();
    expect(JSON.stringify(fake._state.audit_logs)).not.toMatch(/4321/);
  });
});

describe("Driver Support & Onboarding (reports to Harvey Assistant (Driver))", () => {
  test("the driver's own checklist; nothing changed", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.DRIVER_ONBOARDING]: "true" }, drivers: [makeDriver({ phone_verified: false })] });
    const res = await ask("driver", "what is missing for onboarding?", DRIVER);
    expect(res.body.reply).toMatch(/^Still needed before you can go online: Phone verified\./);
    expect(res.body.specialist.chief).toBe("Harvey Assistant (Driver)");
    expect(fake._state.drivers[0].phone_verified).toBe(false);
  });

  test("screening questions stay with Escalation", async () => {
    const fake = useFake({ flags: allOn() });
    const res = await ask("driver", "why was my background check rejected", DRIVER);
    expect(res.body.specialist).toBeUndefined();
    expect(res.body.escalation).toMatchObject({ category: "screening" });
    await settle();
    expect(cases(fake)).toHaveLength(1);
  });
});

describe("Customer Support (reports to Support Handoff) and Safety Escalation (reports to Escalation)", () => {
  test("support: a request the user approves; nothing sent or opened", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.CUSTOMER_SUPPORT]: "true" } });
    const res = await ask("rider", "I want to talk to a person", RIDER);
    expect(res.body.specialist.chief).toBe("Support Handoff");
    expect(res.body.actions[0]).toMatchObject({ type: "support_handoff", requires_confirmation: true });
    await settle();
    expect(cases(fake)).toHaveLength(0);
  });

  test("safety concern: 911 first, a report the user confirms; no automatic case", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.SAFETY]: "true" } });
    const res = await ask("rider", "my driver was texting while driving", RIDER);
    expect(res.body.specialist.chief).toBe("Escalation");
    expect(res.body.actions.map((a) => a.type)).toEqual(["call_911", "support_handoff"]);
    await settle();
    expect(cases(fake)).toHaveLength(0);
  });

  test("an emergency stays with Escalation even with every specialist on", async () => {
    const fake = useFake({ flags: allOn() });
    const res = await ask("rider", "someone has a gun", RIDER);
    expect(res.body.specialist).toBeUndefined();
    expect(res.body.escalation).toMatchObject({ category: "emergency" });
    expect(res.body.actions.map((a) => a.type)).toEqual(["call_911", "safety_alert"]);
    await settle();
    expect(cases(fake)).toHaveLength(1);
  });
});

describe("HTAF Information (reports to HTAF Information Assistant)", () => {
  test("needs the HTAF assistant's own switch too", async () => {
    useFake({ flags: { [SPECIALIST_FLAGS.HTAF]: "true" } });
    const res = await ask("rider", "what programs does HTAF offer?", RIDER);
    expect(res.body.specialist).toBeUndefined();
  });

  test("with both on: approved published content only", async () => {
    useFake({ flags: { [SPECIALIST_FLAGS.HTAF]: "true", htaf_assist_enabled: "true" } });
    const res = await ask("rider", "how do I apply to HTAF?", RIDER);
    expect(res.body.source).toBe("approved_content");
    expect(res.body.specialist).toMatchObject({ id: "htaf_information", chief: "HTAF Information Assistant", engine_label: "Approved published content only (no AI model)" });
    expect(res.body.actions.every((a) => a.href.startsWith("/"))).toBe(true);
  });

  test("an unanswered HTAF question is logged for HTAF staff, redacted", async () => {
    const fake = useFake({ flags: { [SPECIALIST_FLAGS.HTAF]: "true", htaf_assist_enabled: "true" } });
    const res = await ask("rider", "HTAF income limit for a family of 4, call me at 615-555-0100", RIDER);
    expect(res.body.knowledge_gap).toBe(true);
    expect(fake._state.htaf_assistant_questions).toHaveLength(1);
    expect(fake._state.htaf_assistant_questions[0].question_excerpt).not.toMatch(/555-0100/);
  });
});

describe("admin: hierarchy and switches", () => {
  test("hierarchy needs admin; shows every specialist off", async () => {
    useFake();
    expect((await request(app).get("/api/admin/agent/specialists")).status).toBe(401);
    const res = await request(app).get("/api/admin/agent/specialists").set(PASSWORD_ADMIN);
    expect(res.status).toBe(200);
    const specialists = res.body.chiefs.flatMap((c) => c.specialists);
    expect(specialists).toHaveLength(6);
    expect(specialists.every((s) => !s.switched_on && !s.answering)).toBe(true);
    expect(res.body.chiefs.find((c) => c.name === "Harvey Assistant (Rider)").specialists.map((s) => s.name)).toEqual(["Food & Grocery Delivery", "Ride Booking & Dispatch"]);
  });

  test("switching on needs the elevated token; switching off doesn't; both are audited", async () => {
    const fake = useFake();
    const key = SPECIALIST_FLAGS.DELIVERY;
    const denied = await request(app).post("/api/admin/agent/flags").set(PASSWORD_ADMIN).send({ key, enabled: true });
    expect(denied.status).toBe(403);
    expect(fake._state.system_flags.find((r) => r.key === key)).toBeUndefined();
    const on = await request(app).post("/api/admin/agent/flags").set(TOKEN_ADMIN).send({ key, enabled: true, reason: "test" });
    expect(on.status).toBe(200);
    const off = await request(app).post("/api/admin/agent/flags").set(PASSWORD_ADMIN).send({ key, enabled: false });
    expect(off.status).toBe(200);
    expect(fake._state.system_flags.find((r) => r.key === key).value).toBe("false");
    const changes = fake._state.audit_logs.filter((r) => r.action === "agent.flag_changed" && r.entity_id === key);
    expect(changes.map((r) => r.metadata.value)).toEqual(["true", "false"]);
  });

  test("unauthenticated callers can't switch anything", async () => {
    const fake = useFake();
    const res = await request(app).post("/api/admin/agent/flags").send({ key: SPECIALIST_FLAGS.SAFETY, enabled: true });
    expect(res.status).toBe(401);
    expect(fake._state.system_flags.find((r) => r.key === SPECIALIST_FLAGS.SAFETY)).toBeUndefined();
  });
});
