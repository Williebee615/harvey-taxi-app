// Harvey Assistant phase 1 (docs/ai-knowledge.md): policy questions are
// answered only by quoting approved published pages, with source and date;
// uncovered questions are reported as gaps (logged, redacted, for staff);
// a driver's hours come from that driver's own sessions only; and nothing
// is answered or logged when the assistant is switched off.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.OPENAI_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, makeRider, makeDriver } = require("./rideTestHelpers");

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

const H = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function useFake({ assist = true } = {}) {
  currentFake = createFakeSupabase({
    riders: [makeRider()],
    drivers: [makeDriver({ online: true }), makeDriver({ id: "DRIVER_2", phone: "+16155550202" })],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    driver_online_sessions: [
      { driver_id: "DRIVER_1", started_at: ago(3 * H), ended_at: null },
      { driver_id: "DRIVER_2", started_at: ago(11 * H), ended_at: null }
    ],
    audit_logs: [],
    system_flags: [
      { key: "agent_assist_enabled", value: assist ? "true" : "false" },
      { key: "agent_kill_switch", value: "false" }
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

const riderAsk = (message) => request(app).post("/api/agent/rider/assist").send({ message });
const driverAsk = (message, id = "DRIVER_1") =>
  request(app).post("/api/agent/driver/assist").set(driverAuthHeaders(signTestDriverToken(id))).send({ message, client: "driver_app" });
const decisions = () => currentFake._state.audit_logs.filter((a) => a.action === "agent.decision");

test("policy question: quoted from the published page, with source and date", async () => {
  useFake();
  const res = await riderAsk("How long do you keep my data?");
  expect(res.status).toBe(200);
  expect(res.body.intent).toBe("policy_question");
  expect(res.body.source).toBe("knowledge");
  expect(res.body.knowledge_gap).toBe(false);
  expect(res.body.reply).toMatch(/^From our Privacy Policy \("6\. Data Retention", October 2026\): /);
  expect(res.body.sources[0]).toEqual({ title: "Privacy Policy", section: "6. Data Retention", url: "/privacy-policy.html", updated: "October 2026" });
  expect(res.body.actions).toEqual([{ type: "open_support", label: "Contact support", href: "/support.html" }]);
  const [d] = decisions();
  expect(d.metadata).toMatchObject({ outcome: "answered_from_knowledge", knowledge_gap: false, question_excerpt: null });
  expect(d.metadata.knowledge_sources[0]).toBe("/privacy-policy.html#6. Data Retention");
});

test("uncovered question: says so, no sources, and logs a redacted gap for staff", async () => {
  useFake();
  const res = await riderAsk("What is the cancellation fee? Call me at 615-555-0101");
  expect(res.body.knowledge_gap).toBe(true);
  expect(res.body.sources).toEqual([]);
  expect(res.body.reply).toMatch(/don't have approved Harvey Taxi information.*won't guess/);
  expect(res.body.reply).not.toMatch(/\$\d/);
  const [d] = decisions();
  expect(d.metadata).toMatchObject({ outcome: "knowledge_gap", knowledge_gap: true });
  expect(d.metadata.question_excerpt).toContain("cancellation fee");
  expect(d.metadata.question_excerpt).toContain("[phone]");
  expect(d.metadata.question_excerpt).not.toContain("555");
});

test("driver hours: the signed-in driver's own shift only", async () => {
  useFake();
  const mine = await driverAsk("How many hours have I been online?");
  expect(mine.body.intent).toBe("driver_hours");
  // Remaining time is rounded down, so a few ms past 3 h shows 8 h 59 min.
  expect(mine.body.reply).toMatch(/online 3 h this shift, with (9 h|8 h 59 min) left of the 12 h limit/);
  const theirs = await driverAsk("How many hours have I been online?", "DRIVER_2");
  expect(theirs.body.reply).toMatch(/online 11 h this shift, with (1 h|59 min) left/);
});

test("driver policy question from the app links support in-app", async () => {
  useFake();
  const res = await driverAsk("How do I delete my driver account?");
  expect(res.body.sources[0]).toMatchObject({ title: "Privacy Policy", section: "7. Your Choices" });
  expect(res.body.actions).toEqual([{ type: "open_support", label: "Contact support" }]);
});

test("switched off: no answer and nothing logged", async () => {
  useFake({ assist: false });
  const res = await riderAsk("How long do you keep my data?");
  expect(res.status).toBe(503);
  expect(res.body.agent_available).toBe(false);
  expect(decisions()).toEqual([]);
});
