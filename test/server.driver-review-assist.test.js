// Harvey Taxi driver review assistant routes, synthetic drivers only:
// off by default; Harvey Taxi onboarding staff (dispatcher) and the owner
// only -- HTAF and other roles refused; never changes a driver; nothing
// sent outside; Persona/Checkr "not configured" when the integrations are
// unavailable; expired documents; duplicate matches; audit entries without
// personal data; staff can mark a suggestion wrong.

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
delete process.env.PERSONA_API_KEY;
delete process.env.CHECKR_API_KEY;

const crypto = require("crypto");
const http = require("http");
const https = require("https");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const DISPATCHER = "dispatch@harvey.example";
const ROLES = {
  dispatcher: DISPATCHER,
  htaf_caseworker: "caseworker@htaf.example",
  support: "support@harvey.example",
  finance: "finance@harvey.example",
  compliance: "compliance@harvey.example",
  volunteer: "volunteer@htaf.example"
};

const past = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const DRIVERS = [
  {
    id: "DRV-SYN-1",
    first_name: "Dana",
    last_name: "Synthetic",
    email: "dana.synthetic@example.test",
    phone: "6155550123",
    home_address: "1 Example St",
    created_at: "2026-10-01T00:00:00Z",
    approval_status: "pending",
    status: "pending",
    email_verified: true,
    phone_verified: false,
    persona_status: "approved",
    persona_verified: true,
    persona_inquiry_id: "inq_SYN",
    checkr_status: "clear",
    checkr_candidate_id: "cand_SYN",
    drivers_license_number: "TN-SYN-1",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    vehicle_year: "2021",
    vehicle_plate: "SYN-123",
    insurance_confirmed: true,
    license_expires_on: past(5),
    insurance_expires_on: future(200),
    registration_expires_on: future(10),
    accepted_terms: true,
    accepted_background_check_consent: true,
    accepted_driver_policy: true,
    password_hash: "SECRET-HASH"
  },
  {
    id: "DRV-SYN-2",
    first_name: "Dana",
    last_name: "Again",
    email: "other.synthetic@example.test",
    phone: "+16155550123",
    created_at: "2026-09-01T00:00:00Z",
    approval_status: "rejected",
    vehicle_plate: "SYN-123"
  }
];

function seed({ enabled = true } = {}) {
  return {
    drivers: DRIVERS.map((d) => ({ ...d })),
    htaf_applications: [{ id: "HTAF-1", first_name: "Private", status: "submitted" }],
    admin_roles: Object.entries(ROLES).map(([role, email]) => ({ email, role })),
    admin_rbac_shadow_log: [],
    audit_logs: [],
    system_flags: enabled ? [{ key: "driver_review_assist_enabled", value: "true" }] : []
  };
}

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return [`htaf_admin_session=${encoded}.${sig}`];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const PII = ["Dana", "Synthetic", "dana.synthetic", "6155550123", "Example St", "TN-SYN-1", "SYN-123", "SECRET-HASH", "inq_SYN", "cand_SYN", "other.synthetic"];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(h || ""));

let app;
let outbound;
beforeAll(() => {
  mockClient = createFakeSupabase(seed());
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
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

const run = (id, email = DISPATCHER) => request(app).post(`/api/admin/drivers/${id}/review-assist`).set("Cookie", session(email)).send({});

describe("off until the owner turns it on", () => {
  test("403, no driver read, attempt recorded", async () => {
    mockClient = createFakeSupabase(seed({ enabled: false }));
    const res = await run("DRV-SYN-1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("The driver review assistant is turned off.");
    expect(mockClient._log.filter((e) => e.table === "drivers")).toEqual([]);
    await settle();
    expect(mockClient._state.audit_logs.find((a) => a.action === "driver_review_assist_blocked")).toMatchObject({ entity_id: "DRV-SYN-1" });
  });
});

describe("turned on (synthetic drivers)", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed());
  });

  test("integrations unavailable: Persona and Checkr show 'not configured', not verified", async () => {
    const { review } = (await run("DRV-SYN-1")).body;
    expect(review.processing).toBe("internal");
    expect(review.status.identity_persona).toBe("not configured");
    expect(review.status.background_checkr).toBe("not configured");
    expect(review.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["identity_not_configured", "background_not_configured"]));
  });

  test("expired license and soon-expiring registration flagged; driver-confirmed insurance is not 'verified'", async () => {
    const { review } = (await run("DRV-SYN-1")).body;
    const ids = review.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["license_expired", "expiring_soon", "insurance_self_reported", "license_not_verified", "phone_not_verified"]));
    expect(review.status.insurance).toBe("confirmed by driver only");
  });

  test("duplicate matches: phone (local vs +1 format) and plate, shown as a prompt with account id only", async () => {
    const { review } = (await run("DRV-SYN-1")).body;
    const dup = review.checks.find((c) => c.id === "possible_duplicate");
    expect(dup.message).toMatch(/not evidence of fraud/);
    expect(dup.related).toEqual([{ account: "DRV-SYN-2", created: "2026-09-01", status: "rejected", matched: ["phone", "plate"] }]);
  });

  test("works before the expiration columns exist (falls back, reports 'not recorded')", async () => {
    // A database without the proposed columns: the first read fails with
    // "column does not exist" and the route retries without them.
    const noExpiry = seed();
    noExpiry.drivers = noExpiry.drivers.map(({ license_expires_on, insurance_expires_on, registration_expires_on, ...d }) => d);
    mockClient = createFakeSupabase(noExpiry, {
      failSelect: (table, cols) => (table === "drivers" && cols && cols.includes("license_expires_on") ? { code: "42703", message: "column does not exist" } : null)
    });
    const res = await run("DRV-SYN-1");
    expect(res.status).toBe(200);
    expect(res.body.review.status.expiration_dates).toBe("not recorded");
    const driverReads = mockClient._log.filter((e) => e.table === "drivers" && e.op === "select");
    expect(driverReads.length).toBeGreaterThanOrEqual(2);
  });

  test("advisory only: no driver changed, nothing sent outside, no personal data in response or audit", async () => {
    const before = JSON.stringify(mockClient._state.drivers);
    const res = await run("DRV-SYN-1");
    await request(app).post("/api/admin/drivers/DRV-SYN-1/review-assist/feedback").set("Cookie", session(DISPATCHER)).send({ check_id: "possible_duplicate", verdict: "incorrect" });
    await settle();
    expect(JSON.stringify(mockClient._state.drivers)).toBe(before);
    expect(mockClient._log.filter((e) => e.table === "drivers" && e.op !== "select")).toEqual([]);
    expect(outbound).toEqual([]);
    const body = JSON.stringify(res.body);
    const audit = JSON.stringify(mockClient._state.audit_logs);
    for (const v of PII) {
      expect(body).not.toContain(v);
      expect(audit).not.toContain(v);
    }
    expect(mockClient._state.audit_logs.find((a) => a.action === "driver_review_assist_run").metadata.engine).toBe("driver-review-assist-v1");
  });

  test("staff can mark a suggestion wrong (fixed choices only)", async () => {
    expect((await request(app).post("/api/admin/drivers/DRV-SYN-1/review-assist/feedback").set("Cookie", session(DISPATCHER)).send({ check_id: "possible_duplicate", verdict: "incorrect", note: "Dana is the same person" })).status).toBe(200);
    await settle();
    expect(mockClient._state.audit_logs.find((a) => a.action === "driver_review_assist_feedback").metadata).toEqual({ engine: "driver-review-assist-v1", check: "possible_duplicate", verdict: "incorrect" });
    expect(JSON.stringify(mockClient._state.audit_logs)).not.toContain("Dana");
    expect((await request(app).post("/api/admin/drivers/DRV-SYN-1/review-assist/feedback").set("Cookie", session(DISPATCHER)).send({ check_id: "approve_driver", verdict: "incorrect" })).status).toBe(400);
  });

  test("the owner (admin token) is allowed", async () => {
    const res = await request(app).post("/api/admin/drivers/DRV-SYN-1/review-assist").set("x-admin-token", "test-admin-token").send({});
    expect(res.status).toBe(200);
  });
});

describe("unauthorized access attempts", () => {
  beforeEach(() => {
    mockClient = createFakeSupabase(seed());
  });

  test("no sign-in: 401", async () => {
    expect((await request(app).post("/api/admin/drivers/DRV-SYN-1/review-assist").send({})).status).toBe(401);
  });

  test.each([["HTAF caseworker", "htaf_caseworker"], ["support", "support"], ["finance", "finance"], ["compliance", "compliance"], ["volunteer", "volunteer"]])(
    "%s: refused before any driver or HTAF record is read",
    async (_label, role) => {
      const res = await run("DRV-SYN-1", ROLES[role]);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Driver review requires a Harvey Taxi onboarding role.");
      expect(mockClient._log.filter((e) => e.table === "drivers" || e.table === "htaf_applications")).toEqual([]);
    }
  );

  test("the driver review routes never read HTAF applications", async () => {
    await run("DRV-SYN-1");
    expect(mockClient._log.filter((e) => e.table === "htaf_applications")).toEqual([]);
  });
});
