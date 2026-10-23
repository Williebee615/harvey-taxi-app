// HTAF test records (owner decision 2026-10-23): the owner's own test
// applications are marked, with who and when, and left out of counts,
// public statistics and exports. Nothing is deleted.

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

const row = (id, extra) => ({ id, application_code: `CODE-${id}`, first_name: "Syn", last_name: "Thetic", email: `${id}@gmail.com`, phone: "", county: "Davidson", program_type: "medical", status: "submitted", created_at: "2026-10-20T15:00:00Z", ...extra });
function seed() {
  return {
    htaf_applications: [
      row("t1", { is_test: true, test_marked_by: OWNER, test_marked_at: "2026-10-23T19:00:00Z" }),
      row("r1", { is_test: false }),
      row("r2", { is_test: false, status: "approved" }),
      row("s1", { is_test: false, email: "synthetic@example.test" })
    ],
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
  mockClient = createFakeSupabase(seed());
});
const settle = () => new Promise((r) => setTimeout(r, 20));

test("public statistics leave out test records and synthetic addresses", async () => {
  const res = await request(app).get("/api/foundation/public-stats");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ applications_submitted: 2, pending_review: 1, approved_requests: 1 });
});

test("the queue and the detail say which records are tests", async () => {
  const list = await asOwner(request(app).get("/api/admin/foundation/applications"));
  const byId = Object.fromEntries(list.body.applications.map((a) => [a.id, a]));
  expect(byId.t1.is_test).toBe(true);
  expect(byId.r1.is_test).toBeFalsy();
  const detail = await asOwner(request(app).get("/api/admin/foundation/applications/t1"));
  expect(detail.body.application.is_test).toBe(true);
});

test("exports leave test records out unless included", async () => {
  let res = await asOwner(request(app).post("/api/admin/foundation/applications/export")).send({ reason: "grant report" });
  expect(res.text).not.toContain("CODE-t1");
  expect(res.text).toContain("CODE-r1");
  res = await asOwner(request(app).post("/api/admin/foundation/applications/export")).send({ reason: "audit", include_test: true });
  expect(res.text).toContain("CODE-t1");
});

test("marking and unmarking is recorded; only HTAF roles; nothing else changes", async () => {
  let res = await asCaseworker(request(app).post("/api/admin/foundation/applications/r1/test-marker")).send({ is_test: true });
  expect(res.status).toBe(200);
  const r1 = mockClient._state.htaf_applications.find((a) => a.id === "r1");
  expect(r1).toMatchObject({ is_test: true, test_marked_by: CASEWORKER, status: "submitted" });
  res = await asCaseworker(request(app).post("/api/admin/foundation/applications/r1/test-marker")).send({ is_test: false });
  expect(mockClient._state.htaf_applications.find((a) => a.id === "r1")).toMatchObject({ is_test: false, test_marked_by: null });
  await settle();
  expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(expect.arrayContaining(["htaf_application_marked_test", "htaf_application_unmarked_test"]));
  expect((await asOwner(request(app).post("/api/admin/foundation/applications/r1/test-marker")).send({ is_test: "yes" })).status).toBe(400);
  expect((await asOwner(request(app).post("/api/admin/foundation/applications/nope/test-marker")).send({ is_test: true })).status).toBe(404);
  expect((await request(app).post("/api/admin/foundation/applications/r1/test-marker").send({ is_test: true })).status).toBe(401);
});
