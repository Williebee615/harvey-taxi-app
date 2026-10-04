// Support handoff (docs/ai-knowledge.md, phase 4): the draft is the user's
// own questions; nothing is sent without approval and sign-in; a request
// is recorded in the human-review queue and only then gets a reference;
// a failed save is reported as not sent.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, signTestRiderToken, riderAuthHeaders, makeRider, makeDriver } = require("./rideTestHelpers");

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

const ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };

// Each test calls from its own address, so the per-IP route limit (shared
// by the whole file otherwise) doesn't leak between tests.
let testIp = 0;
const post = (path) => request(app).post(path).set("X-Forwarded-For", `198.51.100.${testIp}`);

function useFake({ enabled = true, failAudit = false } = {}) {
  testIp += 1;
  currentFake = createFakeSupabase(
    {
      riders: [makeRider()],
      drivers: [makeDriver()],
      rides: [],
      driver_offers: [],
      audit_logs: [],
      system_flags: [
        { key: "agent_assist_enabled", value: enabled ? "true" : "false" },
        { key: "agent_kill_switch", value: "false" }
      ]
    },
    failAudit ? { failInsert: (table) => (table === "audit_logs" ? { message: "database unavailable" } : null) } : {}
  );
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const RIDER = () => riderAuthHeaders(signTestRiderToken("RIDER_1"));
const DRIVER = () => driverAuthHeaders(signTestDriverToken("DRIVER_1"));
const SUMMARY = "I need help from Harvey Taxi support.\n\nWhat I asked the assistant:\n- What is the cancellation fee?\n\nMore details: I was charged after cancelling.";
const cases = () => currentFake._state.audit_logs.filter((a) => a.action === "agent.case_opened");

test("draft: the user's own recent questions only; works signed out; nothing recorded", async () => {
  useFake();
  const res = await request(app)
    .post("/api/agent/rider/handoff/draft")
    .send({ context: [{ role: "user", text: "What is the cancellation fee?" }, { role: "assistant", text: "I don't have approved information." }] });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ signed_in: false, note: expect.stringMatching(/Nothing is sent until you tap Send to support/) });
  expect(res.body.draft).toContain("- What is the cancellation fee?");
  expect(res.body.draft).not.toContain("approved information");
  expect(currentFake._state.audit_logs).toEqual([]);
});

test("send: signed-out riders are asked to sign in; nothing is recorded", async () => {
  useFake();
  const res = await post("/api/agent/rider/handoff").send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(401);
  expect(cases()).toEqual([]);
});

test("send: refused without explicit approval or with an empty summary", async () => {
  useFake();
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY })).status).toBe(400);
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: "yes" })).status).toBe(400);
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: "  ", approved: true })).status).toBe(400);
  expect(cases()).toEqual([]);
});

test("rider send: recorded as a support case with the approved text (masked), then a reference", async () => {
  useFake();
  const res = await request(app)
    .post("/api/agent/rider/handoff")
    .set(RIDER())
    .set("User-Agent", "Mozilla/5.0 (iPhone) HarveyTaxiRider/1.0.2 (ios)")
    .send({ summary: `${SUMMARY} Card 4242 4242 4242 4242.`, approved: true });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ sent: true, reference: expect.stringMatching(/^HT-SUP-\d{8}-[A-Z0-9]{6}$/) });
  expect(res.body.message).toContain(res.body.reference);
  const [row] = cases();
  expect(row).toMatchObject({ entity_id: res.body.reference, entity_type: "agent_case" });
  expect(row.metadata).toMatchObject({ category: "support_request", reporter_role: "rider", reporter_id: "RIDER_1", app_target: "rider_ios_app", approved_by_user: true });
  expect(row.metadata.summary).toContain("I was charged after cancelling.");
  expect(row.metadata.summary).toContain("[card]");
  expect(row.metadata.summary).not.toContain("4242");

  // Visible to staff in the existing human-review queue.
  const overview = await request(app).get("/api/admin/agent/overview").set(ADMIN);
  const listed = overview.body.cases.find((c) => c.case_id === res.body.reference);
  expect(listed).toMatchObject({ category: "support_request", status: "open", reporter_id: "RIDER_1", source: "handoff", app_target: "rider_ios_app" });
  expect(listed.summary).toContain("I was charged after cancelling.");
});

test("driver send from the app: own account only, platform recorded", async () => {
  useFake();
  const res = await post("/api/agent/driver/handoff").set(DRIVER()).send({ summary: SUMMARY, approved: true, client: "driver_app", platform: "android" });
  expect(res.status).toBe(200);
  expect(cases()[0].metadata).toMatchObject({ reporter_role: "driver", reporter_id: "DRIVER_1", app_target: "driver_android_app" });
  // The account comes from the session, never the body.
  await post("/api/agent/driver/handoff").set(DRIVER()).send({ summary: SUMMARY, approved: true, driver_id: "DRIVER_2", reporter_id: "DRIVER_2" });
  expect(cases()[1].metadata.reporter_id).toBe("DRIVER_1");
  expect((await post("/api/agent/driver/handoff").send({ summary: SUMMARY, approved: true })).status).toBe(401);
});

test("a failed save is reported as not sent, with no reference", async () => {
  useFake({ failAudit: true });
  const res = await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(503);
  expect(res.body).toMatchObject({ ok: false, sent: false });
  expect(res.body.reference).toBeUndefined();
  expect(res.body.error).toMatch(/was not sent/);
});

test("assistant switched off: nothing sent", async () => {
  useFake({ enabled: false });
  const res = await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(503);
  expect(res.body.sent).toBe(false);
  expect(cases()).toEqual([]);
  expect((await post("/api/agent/rider/handoff/draft").send({})).status).toBe(503);
});

test("at most 5 requests per account per hour", async () => {
  useFake();
  const send = () => post("/api/agent/driver/handoff").set(driverAuthHeaders(signTestDriverToken("DRIVER_LIMIT"))).send({ summary: SUMMARY, approved: true });
  currentFake._state.drivers.push(makeDriver({ id: "DRIVER_LIMIT", phone: "+16155550999" }));
  for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(200);
  const sixth = await send();
  expect(sixth.status).toBe(429);
  expect(sixth.body.sent).toBe(false);
});
