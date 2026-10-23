// HTAF partner access (owner decision 2026-10-23): referral organizations
// view their own clients' applications and submit new ones. Access needs
// the owner's master switch AND the partner's own switch (both off by
// default, checked on every request). Only the owner manages them, and
// a partner session never reaches admin routes.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.HTAF_PARTNER_SESSION_SECRET = "test-htaf-partner-secret";

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signPartnerSession } = require("../lib/htafPartnerAccess");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const OWNER = "owner@harvey.example";
const CASEWORKER = "caseworker@htaf.example";
const HEADER = { "X-Requested-With": "htaf-partner-portal" };

function adminCookie(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}
function partnerCookie({ userId = "u1", partnerId = "p1", version = 0 } = {}) {
  const token = signPartnerSession({ partnerUserId: userId, partnerId, sessionVersion: version, secret: process.env.HTAF_PARTNER_SESSION_SECRET, ttlHours: 1 });
  return `htaf_partner_session=${encodeURIComponent(token)}`;
}

const app = (row) => ({
  id: row.id, application_code: `${row.id}-CODE`, first_name: "Syn", last_name: "Thetic", email: `${row.id}@example.test`, phone: "6155550100",
  program_type: "medical", status: "submitted", ride_date: "2026-11-01", created_at: "2026-10-20T00:00:00Z", notes: "internal note", ...row
});

function seed({ master = "false", partnerEnabled = true } = {}) {
  return {
    system_flags: [{ key: "htaf_partner_access_enabled", value: master }],
    htaf_partners: [
      { id: "p1", name: "Safe Haven Shelter", partner_type: "shelter", agreement_ref: partnerEnabled ? "AGR-1" : null, enabled: partnerEnabled, created_at: "2026-10-23T00:00:00Z" },
      { id: "p2", name: "Other Clinic", partner_type: "clinic", agreement_ref: "AGR-2", enabled: true, created_at: "2026-10-23T00:00:00Z" }
    ],
    htaf_partner_users: [
      { id: "u1", partner_id: "p1", phone: "+16155550111", name: "Coordinator One", status: "active", session_version: 0 },
      { id: "u2", partner_id: "p2", phone: "+16155550122", name: "Coordinator Two", status: "active", session_version: 0 }
    ],
    htaf_applications: [app({ id: "a1", partner_id: "p1" }), app({ id: "a2", partner_id: "p2" }), app({ id: "a3" })],
    admin_roles: [{ email: OWNER, role: "super_admin" }, { email: CASEWORKER, role: "htaf_caseworker" }],
    admin_rbac_shadow_log: [],
    audit_logs: [],
    rides: []
  };
}

let server;
beforeAll(() => {
  mockClient = createFakeSupabase(seed());
  // eslint-disable-next-line global-require
  ({ app: server } = require("../server"));
});
const settle = () => new Promise((r) => setTimeout(r, 20));
const audits = (action) => mockClient._state.audit_logs.filter((a) => a.action === action);

describe("off by default", () => {
  beforeEach(() => { mockClient = createFakeSupabase(seed()); });

  test("master switch off: every partner route is unavailable, even with a valid session", async () => {
    for (const [method, path] of [["post", "/api/htaf/partner/session/start"], ["post", "/api/htaf/partner/session/verify"], ["get", "/api/htaf/partner/applications"], ["post", "/api/htaf/partner/applications"]]) {
      const res = await request(server)[method](path).set(HEADER).set("Cookie", [partnerCookie()]).send({ phone: "6155550111", code: "123456" });
      expect({ path, status: res.status }).toEqual({ path, status: 503 });
    }
  });

  test("the partner page is served on the foundation domain only and not indexed", async () => {
    const res = await request(server).get("/htaf-partner.html").set("Host", "harveytransportationassistancefoundation.org");
    expect([200, 301, 302, 308]).toContain(res.status);
  });
});

describe("owner controls", () => {
  beforeEach(() => { mockClient = createFakeSupabase(seed(), { identity: { htaf_partners: "id", htaf_partner_users: "id" } }); });

  test("only the owner can manage partners (a caseworker is refused)", async () => {
    for (const [method, path] of [["get", "/api/admin/htaf/partners"], ["post", "/api/admin/htaf/partner-access"], ["post", "/api/admin/htaf/partners"], ["post", "/api/admin/htaf/partners/p1/access"], ["post", "/api/admin/htaf/partners/p1/users"], ["post", "/api/admin/htaf/partner-users/u1/remove"]]) {
      const res = await request(server)[method](path).set("Cookie", [adminCookie(CASEWORKER)]).send({ enabled: true });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(mockClient._state.system_flags[0].value).toBe("false");
  });

  test("master switch on and off, audited", async () => {
    let res = await request(server).post("/api/admin/htaf/partner-access").set("Cookie", [adminCookie(OWNER)]).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(mockClient._state.system_flags.find((f) => f.key === "htaf_partner_access_enabled").value).toBe("true");
    res = await request(server).post("/api/admin/htaf/partner-access").set("Cookie", [adminCookie(OWNER)]).send({ enabled: false });
    expect(res.body.master_enabled).toBe(false);
    await settle();
    expect(audits("htaf_partner_access_enabled")).toHaveLength(1);
    expect(audits("htaf_partner_access_disabled")).toHaveLength(1);
    res = await request(server).post("/api/admin/htaf/partner-access").set("Cookie", [adminCookie(OWNER)]).send({ enabled: "yes" });
    expect(res.status).toBe(400);
  });

  test("a new partner starts off and can't be switched on without an agreement", async () => {
    let res = await request(server).post("/api/admin/htaf/partners").set("Cookie", [adminCookie(OWNER)]).send({ name: "Workforce Centre", partner_type: "workforce" });
    expect(res.status).toBe(201);
    expect(res.body.partner.enabled).toBe(false);
    // The real table generates a uuid; give the fake row a string id.
    const id = "p3";
    mockClient._state.htaf_partners.find((r) => r.name === "Workforce Centre").id = id;
    res = await request(server).post(`/api/admin/htaf/partners/${id}/access`).set("Cookie", [adminCookie(OWNER)]).send({ enabled: true });
    expect(res.status).toBe(409);
    res = await request(server).post(`/api/admin/htaf/partners/${id}/access`).set("Cookie", [adminCookie(OWNER)]).send({ enabled: true, agreement_ref: "AGR-3" });
    expect(res.status).toBe(200);
    expect(res.body.partner).toMatchObject({ enabled: true, agreement_ref: "AGR-3", enabled_by: OWNER });
  });

  test("the list shows phone endings only", async () => {
    const res = await request(server).get("/api/admin/htaf/partners").set("Cookie", [adminCookie(OWNER)]);
    expect(res.status).toBe(200);
    expect(res.body.master_enabled).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("+16155550111");
    expect(res.body.partners[0].users[0]).toEqual({ id: "u1", name: "Coordinator One", phone_last4: "0111", last_sign_in_at: undefined });
  });
});

describe("partner portal with both switches on", () => {
  beforeEach(() => { mockClient = createFakeSupabase(seed({ master: "true" })); });
  const get = (cookie) => request(server).get("/api/htaf/partner/applications").set(HEADER).set("Cookie", [cookie]);

  test("sees only its own clients, in a reduced view", async () => {
    const res = await get(partnerCookie());
    expect(res.status).toBe(200);
    expect(res.body.applications.map((a) => a.application_code)).toEqual(["a1-CODE"]);
    expect(JSON.stringify(res.body)).not.toMatch(/example\.test|6155550100|internal note/);
  });

  test("submits an application linked to the partner, only with the client's agreement", async () => {
    const body = { first_name: "New", last_name: "Client", email: "new@example.test", phone: "6155550199", county: "Davidson", city: "Nashville", pickup_city: "Nashville", destination: "100 Main St", ride_date: "2026-11-02", transportation_need: "ride to work", program_type: "employment" };
    let res = await request(server).post("/api/htaf/partner/applications").set(HEADER).set("Cookie", [partnerCookie()]).send(body);
    expect(res.status).toBe(400);
    res = await request(server).post("/api/htaf/partner/applications").set(HEADER).set("Cookie", [partnerCookie()]).send({ ...body, client_consent: true });
    expect(res.status).toBe(201);
    const row = mockClient._state.htaf_applications.find((a) => a.email === "new@example.test");
    expect(row).toMatchObject({ partner_id: "p1", partner_user_id: "u1", status: "submitted", applicant_type: "caseworker" });
    await settle();
    expect(audits("htaf_application_created")[0].metadata).toMatchObject({ partner_id: "p1", client_consent_confirmed: true });
  });

  test("switching the partner off, or the master off, ends access at once", async () => {
    mockClient._state.htaf_partners[0].enabled = false;
    expect((await get(partnerCookie())).status).toBe(403);
    mockClient._state.htaf_partners[0].enabled = true;
    mockClient._state.system_flags[0].value = "false";
    expect((await get(partnerCookie())).status).toBe(503);
  });

  test("a removed coordinator or an old session is refused", async () => {
    expect((await get(partnerCookie({ version: 1 }))).status).toBe(401);
    mockClient._state.htaf_partner_users[0].status = "disabled";
    expect((await get(partnerCookie())).status).toBe(401);
  });

  test("the request header is required, and a partner session never opens admin routes", async () => {
    expect((await request(server).get("/api/htaf/partner/applications").set("Cookie", [partnerCookie()])).status).toBe(403);
    const admin = await request(server).get("/api/admin/foundation/applications").set("Cookie", [partnerCookie()]);
    expect(admin.status).toBe(401);
  });
});
