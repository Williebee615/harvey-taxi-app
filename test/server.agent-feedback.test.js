// Answer ratings and "resolved without staff" counts (owner-approved
// 2026-10-19, off by default): with agent_feedback_enabled off nothing
// changes; on, each answer carries a token only its asker can use, a
// rating is one audit row with no message text, and the admin summary
// counts chats that needed staff.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, riderAuthHeaders, signTestRiderToken, driverAuthHeaders, signTestDriverToken } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

jest.setTimeout(30_000);

const ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const CONV = "c_TestConversation0001";

function useFake({ feedback = true } = {}) {
  currentFake = createFakeSupabase({
    riders: [makeRider({ id: "RIDER_1" }), makeRider({ id: "RIDER_2", email: "r2@example.test", phone: "+16155550111" })],
    drivers: [makeDriver({ id: "DRIVER_1" })],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    driver_online_sessions: [],
    audit_logs: [],
    system_flags: [
      { key: "agent_assist_enabled", value: "true" },
      { key: "agent_kill_switch", value: "false" },
      { key: "agent_feedback_enabled", value: feedback ? "true" : "false" }
    ]
  });
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const logs = (action) => currentFake._state.audit_logs.filter((a) => a.action === action);
const askRider = (headers = {}, body = {}) =>
  request(app).post("/api/agent/rider/assist").set(headers).send({ message: "How do I contact support?", conversation_id: CONV, ...body });

test("switched off: no token, no ids on the decision, and rating is refused", async () => {
  useFake({ feedback: false });
  const res = await askRider(riderAuthHeaders(signTestRiderToken("RIDER_1")));
  expect(res.status).toBe(200);
  expect(res.body.feedback_token).toBeUndefined();
  const decision = logs("agent.decision")[0];
  expect(decision.metadata.answer_id).toBeUndefined();
  expect(decision.metadata.conversation_id).toBeUndefined();
  const rate = await request(app).post("/api/agent/rider/feedback").send({ feedback_token: "x.y", rating: "up" });
  expect(rate.status).toBe(409);
  expect(logs("agent.feedback")).toHaveLength(0);
});

test("on: the asker rates the answer; the row has no message text", async () => {
  useFake();
  const auth = riderAuthHeaders(signTestRiderToken("RIDER_1"));
  const res = await askRider(auth);
  expect(typeof res.body.feedback_token).toBe("string");
  const decision = logs("agent.decision")[0];
  expect(decision.metadata.answer_id).toMatch(/^ans_/);
  expect(decision.metadata.conversation_id).toBe(CONV);

  const rate = await request(app).post("/api/agent/rider/feedback").set(auth).send({ feedback_token: res.body.feedback_token, rating: "up" });
  expect(rate.status).toBe(200);
  expect(rate.body).toMatchObject({ saved: true, rating: "up" });
  const row = logs("agent.feedback")[0];
  expect(row).toMatchObject({ actor_type: "rider", actor_id: "RIDER_1", entity_id: decision.metadata.answer_id, metadata: { rating: "up", conversation_id: CONV, authenticated: true } });
  expect(JSON.stringify(row)).not.toMatch(/contact support/i);
});

test("another rider, a signed-out caller or the driver route can't rate a rider's answer", async () => {
  useFake();
  const res = await askRider(riderAuthHeaders(signTestRiderToken("RIDER_1")));
  const token = res.body.feedback_token;
  const other = await request(app).post("/api/agent/rider/feedback").set(riderAuthHeaders(signTestRiderToken("RIDER_2"))).send({ feedback_token: token, rating: "down" });
  expect(other.status).toBe(403);
  const anon = await request(app).post("/api/agent/rider/feedback").send({ feedback_token: token, rating: "down" });
  expect(anon.status).toBe(403);
  const asDriver = await request(app).post("/api/agent/driver/feedback").set(driverAuthHeaders(signTestDriverToken("DRIVER_1"))).send({ feedback_token: token, rating: "down" });
  expect(asDriver.status).toBe(403);
  expect(logs("agent.feedback")).toHaveLength(0);
});

test("bad rating values and tampered tokens are refused", async () => {
  useFake();
  const auth = riderAuthHeaders(signTestRiderToken("RIDER_1"));
  const res = await askRider(auth);
  const bad = await request(app).post("/api/agent/rider/feedback").set(auth).send({ feedback_token: res.body.feedback_token, rating: "meh" });
  expect(bad.status).toBe(400);
  const tampered = await request(app).post("/api/agent/rider/feedback").set(auth).send({ feedback_token: `${res.body.feedback_token}x`, rating: "up" });
  expect(tampered.status).toBe(400);
  expect(logs("agent.feedback")).toHaveLength(0);
});

test("a signed-out visitor can rate their own answer with its token", async () => {
  useFake();
  const res = await askRider({}, { conversation_id: "not-valid" });
  expect(logs("agent.decision")[0].metadata.conversation_id).toBeNull();
  const rate = await request(app).post("/api/agent/rider/feedback").send({ feedback_token: res.body.feedback_token, rating: "down" });
  expect(rate.status).toBe(200);
  expect(logs("agent.feedback")[0]).toMatchObject({ actor_id: null, metadata: { authenticated: false, rating: "down" } });
});

test("a driver rates their own answer", async () => {
  useFake();
  const auth = driverAuthHeaders(signTestDriverToken("DRIVER_1"));
  const res = await request(app).post("/api/agent/driver/assist").set(auth).send({ message: "How do I contact support?", client: "driver_app" });
  const rate = await request(app).post("/api/agent/driver/feedback").set(auth).send({ feedback_token: res.body.feedback_token, rating: "up" });
  expect(rate.status).toBe(200);
  expect(logs("agent.feedback")[0]).toMatchObject({ actor_type: "driver", actor_id: "DRIVER_1" });
});

test("a support request from the chat marks it as needing staff; admin summary counts it", async () => {
  useFake();
  const auth = riderAuthHeaders(signTestRiderToken("RIDER_1"));
  await askRider(auth);
  await askRider(auth, { conversation_id: "c_TestConversation0002" });
  const sent = await request(app)
    .post("/api/agent/rider/handoff")
    .set(auth)
    .send({ summary: "My driver never arrived and I need help please.", approved: true, kind: "general", request_id: "req-1", conversation_id: "c_TestConversation0002" });
  expect(sent.status).toBe(200);
  expect(logs("agent.case_opened").find((c) => c.metadata.source === "handoff").metadata.conversation_id).toBe("c_TestConversation0002");

  const summary = await request(app).get("/api/admin/agent/feedback").set(ADMIN);
  expect(summary.status).toBe(200);
  expect(summary.body).toMatchObject({ enabled: true, signer_configured: true });
  expect(summary.body.totals).toMatchObject({ answers: 2, conversations: 2, needed_staff: 1, resolved_without_staff: 1, resolved_without_staff_rate: 50 });

  expect((await request(app).get("/api/admin/agent/feedback")).status).toBe(401);
});

test("the flag is an ordinary agent switch admins can turn on and off, audited", async () => {
  useFake({ feedback: false });
  const on = await request(app).post("/api/admin/agent/flags").set(ADMIN).send({ key: "agent_feedback_enabled", enabled: true });
  expect(on.status).toBe(200);
  expect(currentFake._state.system_flags.find((f) => f.key === "agent_feedback_enabled").value).toBe("true");
  expect(logs("agent.flag_changed").length).toBeGreaterThan(0);
});
