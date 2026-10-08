// HTAF Assistant routes: off until htaf_assist_enabled; answers from HTAF's
// pages only; never reads applicant records or Harvey Taxi's assistant
// records; unanswered questions logged (redacted) in HTAF's own table;
// the staff list is admin-only.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { signTestRiderToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const request = require("supertest");

function loadApp({ enabled = true } = {}) {
  mockSupabaseClient = createFakeSupabase({
    system_flags: [{ key: "htaf_assist_enabled", value: enabled ? "true" : "false" }],
    htaf_applications: [{ id: "HTAF1", application_code: "HTAF-1A2B3C4D-9F2A", email: "applicant@example.test", status: "approved", first_name: "Pat", phone: "+16155550100" }],
    htaf_assistant_questions: [],
    riders: [{ id: "RIDER_1", email: "applicant@example.test", session_version: 1, status: "active", approval_status: "approved" }],
    audit_logs: []
  });
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  return { app, client: mockSupabaseClient };
}

const ask = (app, message, extra = {}) => request(app).post("/api/htaf/assist").set(extra.headers || {}).send({ message, ...extra.body });

describe("availability", () => {
  test("off by default: status says unavailable and questions get support contacts, nothing else", async () => {
    const { app, client } = loadApp({ enabled: false });
    expect((await request(app).get("/api/htaf/assist/status")).body.assist_available).toBe(false);
    const res = await ask(app, "Who can apply?");
    expect(res.status).toBe(503);
    expect(res.body.reply).toContain("WillieHtaf@harveytransportationfoundation.com");
    expect(client._state.htaf_assistant_questions).toHaveLength(0);
  });

  test("on: answers from HTAF's published pages with a source", async () => {
    const { app } = loadApp();
    expect((await request(app).get("/api/htaf/assist/status")).body.assist_available).toBe(true);
    const res = await ask(app, "What documents do I need?");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ intent: "approved_information:documents", knowledge_gap: false, gap_logged: false });
    expect(res.body.reply).toMatch(/Do not upload documents/);
    expect(res.body.sources[0].title).toBe("HTAF home page");
  });

  test("an empty message is refused", async () => {
    const { app } = loadApp();
    expect((await ask(app, "   ")).status).toBe(400);
  });
});

describe("account access and records", () => {
  test("status questions never read applicant records, even with a Harvey Taxi rider session or a real code", async () => {
    const { app, client } = loadApp();
    const cookie = `harvey_rider_session=${encodeURIComponent(signTestRiderToken("RIDER_1"))}`;
    for (const q of ["What's the status of my application?", "Status for HTAF-1A2B3C4D-9F2A please"]) {
      const res = await ask(app, q, { headers: { Cookie: cookie, "x-requested-with": "harvey-rider-app" } });
      expect(res.body.intent).toBe("application_status");
      expect(JSON.stringify(res.body)).not.toMatch(/approved"|Pat|HTAF1"|\+16155550100/);
    }
    const tablesRead = new Set(client._log.map((e) => e.table));
    expect(tablesRead.has("htaf_applications")).toBe(false);
    expect(tablesRead.has("riders")).toBe(false);
  });

  test("a body that claims an applicant or role changes nothing", async () => {
    const { app, client } = loadApp();
    const res = await ask(app, "What's the status of my application?", { body: { application_code: "HTAF-1A2B3C4D-9F2A", email: "applicant@example.test", role: "admin" } });
    expect(res.body.intent).toBe("application_status");
    expect(client._log.some((e) => e.table === "htaf_applications")).toBe(false);
  });

  test("actions are refused and change nothing", async () => {
    const { app, client } = loadApp();
    for (const q of ["Book me a ride to the clinic tomorrow", "Approve my application", "Text me updates"]) {
      expect((await ask(app, q)).body.intent).toBe("action_request");
    }
    expect(client._log.filter((e) => e.op !== "select").map((e) => e.table)).toEqual([]);
  });

  test("an unanswered question is logged, redacted, in HTAF's own table only (no Harvey Taxi assistant record, no IP)", async () => {
    const { app, client } = loadApp();
    const res = await ask(app, "Do you have wheelchair vans? I'm at jane@example.com 615-555-0100");
    expect(res.body).toMatchObject({ intent: "knowledge_gap", knowledge_gap: true, gap_logged: true });
    expect(res.body.actions.map((x) => x.href)).toContain("mailto:WillieHtaf@harveytransportationfoundation.com");
    const rows = client._state.htaf_assistant_questions;
    expect(rows).toHaveLength(1);
    expect(rows[0].question_excerpt).toMatch(/wheelchair vans/);
    expect(JSON.stringify(rows[0])).not.toMatch(/jane|example\.com|615-555|127\.0\.0\.1|ip/i);
    expect(client._state.audit_logs.filter((r) => String(r.action).startsWith("agent."))).toHaveLength(0);
  });

  test("answered questions are not logged at all", async () => {
    const { app, client } = loadApp();
    await ask(app, "Who can apply?");
    await ask(app, "Am I eligible?");
    expect(client._state.htaf_assistant_questions).toHaveLength(0);
  });
});

describe("staff list of unanswered questions", () => {
  test("requires an admin; ordinary visitors and rider sessions are refused", async () => {
    const { app } = loadApp();
    expect((await request(app).get("/api/admin/htaf/assistant-questions")).status).toBe(401);
    const cookie = `harvey_rider_session=${encodeURIComponent(signTestRiderToken("RIDER_1"))}`;
    expect((await request(app).get("/api/admin/htaf/assistant-questions").set("Cookie", cookie)).status).toBe(401);
  });

  test("an admin sees the redacted questions and the assistant's state", async () => {
    const { app } = loadApp();
    await ask(app, "Do you have wheelchair vans?");
    const res = await request(app).get("/api/admin/htaf/assistant-questions").set("x-admin-token", "test-admin-token");
    expect(res.status).toBe(200);
    expect(res.body.questions[0].question_excerpt).toBe("Do you have wheelchair vans?");
    expect(res.body.assistant).toMatchObject({ enabled: true, dropped_topics: [] });
  });
});
