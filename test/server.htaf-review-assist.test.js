// HTAF review assistant routes, with synthetic applications only:
// off by default; HTAF staff only; advisory (never changes an application,
// schedules a ride or contacts anyone); nothing sent outside the server;
// audit entries carry no applicant details; staff can mark a suggestion
// wrong; the public website assistant keeps working.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
delete process.env.OPENAI_API_KEY;
delete process.env.HTAF_AI_TRIAGE_ENABLED;

const crypto = require("crypto");
const http = require("http");
const https = require("https");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));
const mockOpenAiCreate = jest.fn();
jest.mock("openai", () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockOpenAiCreate } } })));

const CASEWORKER = "caseworker@htaf.example";
const DISPATCHER = "dispatch@harvey.example";
const VOLUNTEER = "volunteer@htaf.example";

const SYNTHETIC = [
  {
    id: "syn-complete",
    application_code: "HTAF-20261010-SYN001",
    first_name: "Synthia",
    last_name: "Testperson",
    email: "synthia.test@example.test",
    phone: "6155550199",
    county: "Davidson",
    city: "Nashville",
    pickup_city: "Antioch",
    destination: "Synthetic Dialysis Center",
    ride_date: "2099-01-15",
    transportation_need: "Dialysis appointments three times a week.",
    program_type: "medical",
    applicant_type: "self",
    status: "submitted",
    household_size: 3,
    monthly_income: 987.65,
    notes: "Staff note about Synthia",
    submitted_at: "2026-10-10T15:00:00Z"
  },
  {
    id: "syn-incomplete",
    application_code: "HTAF-20261011-SYN002",
    first_name: "Ivy",
    last_name: "",
    email: "",
    phone: "",
    county: "Davidsn",
    pickup_city: "",
    destination: "",
    ride_date: null,
    transportation_need: "ride",
    program_type: "",
    status: "submitted",
    submitted_at: "2026-10-11T15:00:00Z"
  },
  {
    id: "syn-duplicate",
    application_code: "HTAF-20261012-SYN003",
    first_name: "Synthia",
    last_name: "Testperson",
    email: "other.household@example.test",
    phone: "+16155550199",
    county: "Davidson",
    pickup_city: "Antioch",
    destination: "Synthetic Dialysis Center",
    ride_date: "2099-01-15",
    transportation_need: "Dialysis appointments three times a week.",
    program_type: "medical",
    status: "under_review",
    submitted_at: "2026-10-12T15:00:00Z"
  }
];

function seed({ enabled }) {
  return {
    htaf_applications: SYNTHETIC.map((a) => ({ ...a })),
    admin_roles: [
      { email: CASEWORKER, role: "htaf_caseworker" },
      { email: DISPATCHER, role: "dispatcher" },
      { email: VOLUNTEER, role: "volunteer" }
    ],
    admin_rbac_shadow_log: [],
    audit_logs: [],
    rides: [],
    htaf_assistant_questions: [],
    system_flags: [
      ...(enabled ? [{ key: "htaf_review_assist_enabled", value: "true" }] : []),
      { key: "htaf_assist_enabled", value: "true" }
    ]
  };
}

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return [`htaf_admin_session=${encoded}.${sig}`];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const PII = ["Synthia", "Testperson", "synthia.test", "6155550199", "Antioch", "Dialysis", "987.65", "Staff note", "Ivy"];

let app;
let outbound;
beforeAll(() => {
  mockClient = createFakeSupabase(seed({ enabled: false }));
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
// Records any request leaving the test machine; local test traffic
// (supertest to 127.0.0.1) passes through untouched.
const isLocal = (target) => /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(target || ""));
beforeEach(() => {
  outbound = [];
  for (const mod of [http, https]) {
    const original = mod.request;
    jest.spyOn(mod, "request").mockImplementation(function (...args) {
      const first = args[0];
      const host = typeof first === "string" || first instanceof URL ? new URL(String(first)).hostname : first && (first.hostname || first.host);
      if (!isLocal(host)) outbound.push(String(host));
      return original.apply(this, args);
    });
  }
  if (global.fetch) {
    const originalFetch = global.fetch;
    jest.spyOn(global, "fetch").mockImplementation((url, ...rest) => {
      if (!isLocal(new URL(String(url)).hostname)) outbound.push(String(url));
      return originalFetch(url, ...rest);
    });
  }
});
afterEach(() => jest.restoreAllMocks());

const run = (id, email = CASEWORKER) => request(app).post(`/api/admin/foundation/applications/${id}/review-assist`).set("Cookie", session(email)).send({});
const feedback = (id, body, email = CASEWORKER) =>
  request(app).post(`/api/admin/foundation/applications/${id}/review-assist/feedback`).set("Cookie", session(email)).send(body);

describe("off until the owner turns it on", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed({ enabled: false }));
  });

  test("returns 403, reads no application and records the attempt", async () => {
    const res = await run("syn-complete");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("The HTAF review assistant is turned off.");
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
    await settle();
    expect(mockClient._state.audit_logs.find((a) => a.action === "htaf_review_assist_blocked")).toMatchObject({ entity_id: "syn-complete" });
  });

  test("feedback is refused too", async () => {
    expect((await feedback("syn-complete", { check_id: "missing_name", verdict: "incorrect" })).status).toBe(403);
  });

  test("the public website assistant keeps running", async () => {
    const res = await request(app).post("/api/htaf/assist").send({ message: "How do I apply?" });
    expect(res.status).toBe(200);
    expect(res.body.assist_available).toBe(true);
  });

  test("live AI application triage (external provider) stays off", async () => {
    const res = await request(app).post("/api/admin/foundation/applications/syn-complete/triage").set("Cookie", session(CASEWORKER)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("HTAF AI triage is disabled.");
    expect(mockOpenAiCreate).not.toHaveBeenCalled();
  });
});

describe("turned on (synthetic data)", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed({ enabled: true }));
  });

  test("complete application: summary with no flags, labelled as an automated suggestion", async () => {
    const res = await run("syn-complete");
    expect(res.status).toBe(200);
    const { review } = res.body;
    expect(review.processing).toBe("internal");
    expect(review.label).toMatch(/^Automated suggestions .* Not a decision: a person approves or denies every application/);
    expect(review.summary).toMatch(/^Medical transportation request, applying for themselves\. Ride date 2099-01-15/);
    // The other application with the same contact details is surfaced by code only.
    expect(review.checks.map((c) => c.id)).toEqual(["possible_duplicate"]);
    expect(review.checks[0].related).toEqual([{ application_code: "HTAF-20261012-SYN003", status: "Under review", submitted: "2026-10-12" }]);
  });

  test("incomplete application: missing items and follow-up questions; inaccurate county flag is worded as 'please confirm'", async () => {
    const { review } = (await run("syn-incomplete")).body;
    expect(review.checks.map((c) => c.id)).toEqual([
      "missing_name",
      "missing_contact",
      "county_not_recognized",
      "missing_pickup",
      "missing_destination",
      "missing_ride_date",
      "need_brief",
      "program_unspecified"
    ]);
    expect(review.checks.find((c) => c.id === "county_not_recognized").message).toMatch(/may be misspelled.*Please confirm/);
    expect(review.follow_up_questions.length).toBe(7);
  });

  test("advisory only: no application is changed, no ride created, nobody contacted, nothing sent out", async () => {
    const before = JSON.stringify(mockClient._state.htaf_applications);
    for (const app_ of SYNTHETIC) await run(app_.id);
    await feedback("syn-incomplete", { check_id: "county_not_recognized", verdict: "incorrect" });
    await settle();
    expect(JSON.stringify(mockClient._state.htaf_applications)).toBe(before);
    expect(mockClient._log.filter((e) => e.table === "htaf_applications" && e.op !== "select")).toEqual([]);
    expect(mockClient._state.rides).toEqual([]);
    expect(mockOpenAiCreate).not.toHaveBeenCalled();
    expect(outbound).toEqual([]);
  });

  test("reads only the fields the rules need (never income, household size or notes)", async () => {
    await run("syn-complete");
    const selects = mockClient._log.filter((e) => e.table === "htaf_applications" && e.op === "select");
    expect(selects.length).toBeGreaterThan(0);
    const body = JSON.stringify((await run("syn-complete")).body);
    for (const value of PII) expect(body).not.toContain(value);
  });

  test("audit entries record the rule version and which checks fired, with no applicant details", async () => {
    await run("syn-incomplete");
    await settle();
    const entry = mockClient._state.audit_logs.find((a) => a.action === "htaf_review_assist_run");
    expect(entry).toMatchObject({ actor_id: CASEWORKER, entity_id: "syn-incomplete" });
    expect(entry.metadata.engine).toBe("htaf-review-assist-v2");
    expect(entry.metadata.checks).toContain("county_not_recognized");
    const audit = JSON.stringify(mockClient._state.audit_logs);
    for (const value of PII) expect(audit).not.toContain(value);
  });

  test("staff can mark an inaccurate suggestion wrong; only fixed choices are accepted", async () => {
    const ok = await feedback("syn-incomplete", { check_id: "county_not_recognized", verdict: "incorrect", note: "Applicant is Ivy, typo for Davidson" });
    expect(ok.status).toBe(200);
    await settle();
    const entry = mockClient._state.audit_logs.find((a) => a.action === "htaf_review_assist_feedback");
    expect(entry.metadata).toEqual({ engine: "htaf-review-assist-v2", check: "county_not_recognized", verdict: "incorrect", reason: null });
    expect(JSON.stringify(mockClient._state.audit_logs)).not.toContain("Ivy");
    expect((await feedback("syn-incomplete", { check_id: "approve_now", verdict: "incorrect" })).status).toBe(400);
    expect((await feedback("syn-incomplete", { check_id: "missing_name", verdict: "approve" })).status).toBe(400);
  });

  test("the decision stays with a person: status changes only through the normal staff update", async () => {
    const { review } = (await run("syn-incomplete")).body;
    expect(review).not.toHaveProperty("recommendation");
    expect(mockClient._state.htaf_applications.find((a) => a.id === "syn-incomplete").status).toBe("submitted");
  });

  test("unknown application: 404 without details", async () => {
    const res = await run("does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("unauthorized access attempts", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed({ enabled: true }));
  });

  test("no sign-in: 401", async () => {
    expect((await request(app).post("/api/admin/foundation/applications/syn-complete/review-assist").send({})).status).toBe(401);
    expect((await request(app).post("/api/admin/foundation/applications/syn-complete/review-assist/feedback").send({ check_id: "missing_name", verdict: "incorrect" })).status).toBe(401);
  });

  test("forged admin session: 401", async () => {
    const forged = session(CASEWORKER)[0].replace(/\.[0-9a-f]+$/, ".deadbeef");
    expect((await request(app).post("/api/admin/foundation/applications/syn-complete/review-assist").set("Cookie", [forged]).send({})).status).toBe(401);
  });

  test.each([
    ["Harvey Taxi dispatcher", DISPATCHER],
    ["volunteer (no HTAF role)", VOLUNTEER],
    ["admin with no role", "nobody@harvey.example"]
  ])("%s: denied, and no application is read", async (_label, email) => {
    const res = await run("syn-complete", email);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/Synthia|SYN001/);
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
  });

  test("a rider-style token is not an admin credential", async () => {
    const res = await request(app).post("/api/admin/foundation/applications/syn-complete/review-assist").set("Authorization", "Bearer not-an-admin").send({});
    expect(res.status).toBe(401);
  });
});

describe("v2 hardening: authorization, data boundary, flag, corrections", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed({ enabled: true }));
  });

  test("the database read selects only the rule fields (never income, household size, notes)", async () => {
    await run("syn-complete");
    const reads = mockClient._log.filter((e) => e.table === "htaf_applications" && e.op === "select");
    const main = reads.find((e) => e.columns && e.columns.includes("transportation_need"));
    expect(main.columns.sort()).toEqual(
      ["id", "first_name", "last_name", "email", "phone", "county", "pickup_city", "destination", "ride_date", "transportation_need", "program_type", "applicant_type", "status", "submitted_at", "created_at"].sort()
    );
    for (const r of reads) {
      expect(r.columns).toBeTruthy();
      for (const banned of ["monthly_income", "household_size", "notes", "review_notes", "*"]) expect(r.columns).not.toContain(banned);
    }
  });

  test("duplicate check: phone matched across stored formats, current application excluded, bounded", async () => {
    const { review } = (await run("syn-complete")).body;
    const dup = review.checks.find((c) => c.id === "possible_duplicate");
    expect(dup.related.map((x) => x.application_code)).toEqual(["HTAF-20261012-SYN003"]);
    expect(dup.message).toMatch(/not a reason to deny/);
  });

  test("changing the application ID: authorised staff get only that application's review; unknown IDs 404", async () => {
    const a = (await run("syn-complete")).body.review;
    const b = (await run("syn-incomplete")).body.review;
    expect(a.summary).not.toEqual(b.summary);
    expect((await run("syn-nonexistent")).status).toBe(404);
    expect((await run("syn-complete", DISPATCHER)).status).toBe(403);
    expect((await run("syn-incomplete", DISPATCHER)).status).toBe(403);
  });

  test("the HTAF_RBAC_ENFORCED emergency rollback does not open these routes", async () => {
    process.env.HTAF_RBAC_ENFORCED = "false";
    let looseApp;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      ({ app: looseApp } = require("../server"));
    });
    delete process.env.HTAF_RBAC_ENFORCED;
    for (const path of ["/review-assist", "/review-assist/feedback"]) {
      const res = await request(looseApp).post(`/api/admin/foundation/applications/syn-complete${path}`).set("Cookie", session(DISPATCHER)).send({ check_id: "missing_name", verdict: "incorrect" });
      expect(res.status).toBe(403);
    }
  });

  test.each([["missing", null], ["empty", ""], ["TRUE (wrong case)", "TRUE"], ["yes", "yes"], ["1", "1"], ["false", "false"]])("flag %s: off", async (_l, value) => {
    const state = seed({ enabled: false });
    if (value !== null) state.system_flags.push({ key: "htaf_review_assist_enabled", value });
    mockClient = createFakeSupabase(state);
    expect((await run("syn-complete")).status).toBe(403);
  });

  test("flag: a database error reading it keeps the assistant off", async () => {
    mockClient = createFakeSupabase(seed({ enabled: true }), { failSelect: (table) => (table === "system_flags" ? { code: "XX000", message: "db down" } : null) });
    expect((await run("syn-complete")).status).toBe(403);
  });

  test("corrections: fixed reason codes only, application must exist, no applicant facts or suggestion text stored", async () => {
    const ok = await feedback("syn-incomplete", { check_id: "county_not_recognized", verdict: "incorrect", reason: "county_is_valid", note: "Ivy lives in Davidson" });
    expect(ok.status).toBe(200);
    await settle();
    const entry = mockClient._state.audit_logs.find((a) => a.action === "htaf_review_assist_feedback");
    expect(entry.metadata).toEqual({ engine: "htaf-review-assist-v2", check: "county_not_recognized", verdict: "incorrect", reason: "county_is_valid" });
    const audit = JSON.stringify(mockClient._state.audit_logs);
    expect(audit).not.toMatch(/Ivy|Davidsn|misspelled/);
    expect((await feedback("syn-incomplete", { check_id: "county_not_recognized", verdict: "incorrect", reason: "Ivy lives here" })).status).toBe(400);
    expect((await feedback("does-not-exist", { check_id: "missing_name", verdict: "incorrect" })).status).toBe(404);
  });

  test("corrections by unauthorised roles are refused", async () => {
    expect((await feedback("syn-complete", { check_id: "missing_name", verdict: "incorrect" }, DISPATCHER)).status).toBe(403);
    expect((await feedback("syn-complete", { check_id: "missing_name", verdict: "incorrect" }, VOLUNTEER)).status).toBe(403);
    expect((await request(app).post("/api/admin/foundation/applications/syn-complete/review-assist/feedback").send({ check_id: "missing_name", verdict: "incorrect" })).status).toBe(401);
  });
});
