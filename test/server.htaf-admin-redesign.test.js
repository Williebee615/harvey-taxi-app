// HTAF admin redesign (owner decisions 2026-10-23): trip date and
// duplicate hints on the queue (codes only), a grant export date range,
// the assistant triage inbox, and partner onboarding (contact email,
// activate immediately with an agreement, invite text, access history).

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const OWNER = "owner@harvey.example";
const CASEWORKER = "caseworker@htaf.example";
function adminCookie(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}
const asOwner = (r) => r.set("Cookie", [adminCookie(OWNER)]);
const asCaseworker = (r) => r.set("Cookie", [adminCookie(CASEWORKER)]);

const application = (id, extra) => ({
  id, application_code: `CODE-${id}`, first_name: "Syn", last_name: "Thetic", email: `${id}@example.test`, phone: `61555501${id.length}${id.slice(-1).charCodeAt(0) % 10}`,
  county: "Davidson", program_type: "medical", status: "submitted", ride_date: "2026-10-28", created_at: "2026-10-20T15:00:00Z", ...extra
});

function seed() {
  return {
    htaf_applications: [
      application("a1", { phone: "6155550101", email: "same@example.test" }),
      application("a2", { first_name: "Other", phone: "(615) 555-0101", email: "x@example.test", created_at: "2026-10-22T15:00:00Z" }),
      application("a3", { first_name: "Solo", last_name: "Person", phone: "6155550199", email: "solo@example.test", created_at: "2026-07-15T15:00:00Z", status: "approved" })
    ],
    htaf_assistant_questions: [
      { id: 1, question_excerpt: "Unanswered question about: other", intent: "other", created_at: "2026-10-23T13:21:51Z", status: "open" },
      { id: 2, question_excerpt: "Unanswered question about: partnership", intent: "partnership", created_at: "2026-10-14T00:02:00Z", status: "dismissed", resolved_by: OWNER, resolved_at: "2026-10-15T00:00:00Z" }
    ],
    htaf_partners: [],
    htaf_partner_users: [],
    system_flags: [],
    admin_roles: [{ email: OWNER, role: "super_admin" }, { email: CASEWORKER, role: "htaf_caseworker" }],
    admin_rbac_shadow_log: [],
    audit_logs: [],
    rides: []
  };
}

let app;
beforeAll(() => {
  mockClient = createFakeSupabase(seed());
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  mockClient = createFakeSupabase(seed(), { identity: { htaf_partners: "id" } });
});
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("queue list", () => {
  test("carries the trip date and duplicate hints as codes only", async () => {
    const res = await asOwner(request(app).get("/api/admin/foundation/applications"));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.applications.map((a) => [a.id, a]));
    expect(byId.a1.ride_date).toBe("2026-10-28");
    expect(byId.a1.possible_duplicate_of).toEqual(["CODE-a2"]);
    expect(byId.a2.possible_duplicate_of).toEqual(["CODE-a1"]);
    expect(byId.a3.possible_duplicate_of).toBeUndefined();
    // The list query itself asks for no contact details (the fake returns
    // whole rows, so check the columns requested).
    const listRead = mockClient._log.find((e) => e.table === "htaf_applications" && e.op === "select" && e.columns && e.columns.includes("ride_date"));
    expect(listRead.columns).not.toEqual(expect.arrayContaining(["email"]));
    expect(listRead.columns).not.toEqual(expect.arrayContaining(["phone"]));
    expect(mockClient._state.htaf_applications[0].possible_duplicate_of).toBeUndefined();
  });
});

describe("grant export", () => {
  test("filters by Nashville submission dates and records the filters", async () => {
    const res = await asOwner(request(app).post("/api/admin/foundation/applications/export"))
      .send({ reason: "Q3 grant report", status: "approved", from_date: "2026-07-01", to_date: "2026-09-30" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("CODE-a3");
    expect(res.text).not.toContain("CODE-a1");
    const audit = mockClient._state.audit_logs.find((a) => a.action === "htaf_applications_exported");
    expect(audit.metadata).toMatchObject({ row_count: 1, filters: { status: "approved", from_date: "2026-07-01", to_date: "2026-09-30" } });
  });
  test("rejects a bad date", async () => {
    const res = await asOwner(request(app).post("/api/admin/foundation/applications/export")).send({ reason: "x", from_date: "07/01/2026" });
    expect(res.status).toBe(400);
  });
});

describe("assistant triage inbox", () => {
  test("shows open questions by default; other filters on request", async () => {
    let res = await asCaseworker(request(app).get("/api/admin/htaf/assistant-questions"));
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q) => q.id)).toEqual([1]);
    res = await asCaseworker(request(app).get("/api/admin/htaf/assistant-questions?status=all"));
    expect(res.body.questions.map((q) => q.id)).toEqual([1, 2]);
  });
  test("dismiss, mark for FAQ and reopen are recorded", async () => {
    let res = await asCaseworker(request(app).post("/api/admin/htaf/assistant-questions/1/resolve")).send({ action: "faq" });
    expect(res.status).toBe(200);
    expect(mockClient._state.htaf_assistant_questions[0]).toMatchObject({ status: "faq", resolved_by: CASEWORKER });
    res = await asCaseworker(request(app).post("/api/admin/htaf/assistant-questions/1/resolve")).send({ action: "reopen" });
    expect(mockClient._state.htaf_assistant_questions[0]).toMatchObject({ status: "open", resolved_by: null });
    await settle();
    expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(expect.arrayContaining(["htaf_assistant_question_faq", "htaf_assistant_question_open"]));
    expect((await asCaseworker(request(app).post("/api/admin/htaf/assistant-questions/1/resolve")).send({ action: "delete" })).status).toBe(400);
    expect((await asCaseworker(request(app).post("/api/admin/htaf/assistant-questions/99/resolve")).send({ action: "dismiss" })).status).toBe(404);
    expect((await request(app).post("/api/admin/htaf/assistant-questions/1/resolve").send({ action: "dismiss" })).status).toBe(401);
  });
});

describe("partner onboarding", () => {
  test("contact email, activate immediately only with an agreement, invite text", async () => {
    let res = await asOwner(request(app).post("/api/admin/htaf/partners")).send({ name: "Safe Haven", partner_type: "shelter", contact_email: "Intake@Example.org", activate: true });
    expect(res.status).toBe(409);
    res = await asOwner(request(app).post("/api/admin/htaf/partners")).send({ name: "Safe Haven", partner_type: "shelter", contact_email: "Intake@Example.org", agreement_ref: "AGR-9", activate: true });
    expect(res.status).toBe(201);
    expect(mockClient._state.htaf_partners[0]).toMatchObject({ contact_email: "intake@example.org", enabled: true, enabled_by: OWNER });
    res = await asOwner(request(app).post("/api/admin/htaf/partners")).send({ name: "Bad Email Org", contact_email: "nope" });
    expect(res.status).toBe(400);
    res = await asOwner(request(app).get("/api/admin/htaf/partners"));
    expect(res.body.partners[0].invite_text).toContain("https://harveytransportationfoundation.com/htaf-partner.html");
    expect(res.body.partners[0].contact_email).toBe("intake@example.org");
  });
  test("access history is owner-only and shows actions, not partner contacts", async () => {
    await asOwner(request(app).post("/api/admin/htaf/partner-access")).send({ enabled: false });
    await settle();
    const res = await asOwner(request(app).get("/api/admin/htaf/partners/audit"));
    expect(res.status).toBe(200);
    expect(res.body.events[0]).toMatchObject({ action: "htaf_partner_access_disabled", by: OWNER });
    expect((await asCaseworker(request(app).get("/api/admin/htaf/partners/audit"))).status).toBe(403);
  });
});
