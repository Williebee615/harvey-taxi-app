// Merchant portal phase 1a: public applications and admin review
// (owner decision 2026-10-17). All data is test fixtures.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let app;
const APPLICATION = {
  business_name: "TEST Corner Market",
  category: "grocery",
  address_line: "100 Test Ave",
  city: "Nashville",
  state: "TN",
  postal_code: "37203",
  contact_name: "Test Owner",
  contact_email: "Owner@Example.test",
  contact_phone: "(615) 555-0100",
  website: "https://example.test",
  prices_differ_from_store: true,
  confirmed_exclusions: true
};
const merchant = (over) => ({ id: "M1", business_name: "TEST Diner", category: "restaurant", status: "pending", contact_email: "diner@example.test", created_at: "2026-10-17T00:00:00Z", ...over });
const admin = (req) => req.set("x-admin-token", "test-admin-token");
// Applications are limited to 5 an hour per address; each test uses its own.
let ip = 0;
const apply = (body, from = `198.51.100.${++ip}`) => request(app).post("/api/merchants/apply").set("x-forwarded-for", from).send(body);

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ merchants: [], audit_logs: [] }, { uniqueColumns: { merchants: ["contact_email"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

beforeEach(() => {
  mockSupabaseClient._state.merchants = [];
  mockSupabaseClient._state.audit_logs = [];
});

describe("POST /api/merchants/apply", () => {
  test("stores a valid application as pending, normalized", async () => {
    const res = await apply(APPLICATION);
    expect(res.status).toBe(201);
    const [row] = mockSupabaseClient._state.merchants;
    expect(row).toMatchObject({ contact_email: "owner@example.test", contact_phone: "+16155550100", state: "TN", confirmed_exclusions: true });
    expect(row.status === undefined || row.status === "pending").toBe(true);
  });

  test("requires the excluded-items confirmation", async () => {
    const res = await apply({ ...APPLICATION, confirmed_exclusions: false });
    expect(res.status).toBe(400);
    expect(mockSupabaseClient._state.merchants).toHaveLength(0);
  });

  test("refuses stores outside Tennessee", async () => {
    const res = await apply({ ...APPLICATION, state: "GA" });
    expect(res.status).toBe(400);
  });

  test("a second open application for the same email is a 409", async () => {
    await apply(APPLICATION);
    const res = await apply(APPLICATION);
    expect(res.status).toBe(409);
    expect(mockSupabaseClient._state.merchants).toHaveLength(1);
  });

  test("more than 5 applications an hour from one address are refused", async () => {
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await apply({ ...APPLICATION, contact_email: `s${i}@example.test` }, "203.0.113.9")).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  test("ignores a client-supplied status", async () => {
    await apply({ ...APPLICATION, status: "approved" });
    expect(mockSupabaseClient._state.merchants[0].status).not.toBe("approved");
  });
});

describe("admin merchant review", () => {
  test("listing requires an admin", async () => {
    expect((await request(app).get("/api/admin/merchants")).status).toBe(401);
  });

  test("an admin lists merchants", async () => {
    mockSupabaseClient._state.merchants = [merchant()];
    const res = await admin(request(app).get("/api/admin/merchants"));
    expect(res.status).toBe(200);
    expect(res.body.merchants).toHaveLength(1);
  });

  test("review requires an admin", async () => {
    mockSupabaseClient._state.merchants = [merchant()];
    const res = await request(app).patch("/api/admin/merchants/M1/review").send({ decision: "approve" });
    expect(res.status).toBe(401);
    expect(mockSupabaseClient._state.merchants[0].status).toBe("pending");
  });

  test("approving a pending merchant records the reviewer and an audit entry", async () => {
    mockSupabaseClient._state.merchants = [merchant()];
    const res = await admin(request(app).patch("/api/admin/merchants/M1/review")).send({ decision: "approve" });
    expect(res.status).toBe(200);
    expect(mockSupabaseClient._state.merchants[0]).toMatchObject({ status: "approved" });
    expect(mockSupabaseClient._state.merchants[0].reviewed_at).toBeTruthy();
    expect(mockSupabaseClient._state.audit_logs.some((a) => a.action === "merchant_approved" && a.entity_id === "M1")).toBe(true);
  });

  test("rejecting needs a reason of at least 10 characters", async () => {
    mockSupabaseClient._state.merchants = [merchant()];
    const short = await admin(request(app).patch("/api/admin/merchants/M1/review")).send({ decision: "reject", reason: "no" });
    expect(short.status).toBe(400);
    expect(mockSupabaseClient._state.merchants[0].status).toBe("pending");
    const res = await admin(request(app).patch("/api/admin/merchants/M1/review")).send({ decision: "reject", reason: "Outside the pilot delivery area." });
    expect(res.status).toBe(200);
    expect(mockSupabaseClient._state.merchants[0]).toMatchObject({ status: "rejected", review_reason: "Outside the pilot delivery area." });
  });

  test("an invalid transition is a 409 and changes nothing", async () => {
    mockSupabaseClient._state.merchants = [merchant({ status: "rejected" })];
    const res = await admin(request(app).patch("/api/admin/merchants/M1/review")).send({ decision: "approve" });
    expect(res.status).toBe(409);
    expect(mockSupabaseClient._state.merchants[0].status).toBe("rejected");
  });

  test("an unknown merchant is a 404", async () => {
    const res = await admin(request(app).patch("/api/admin/merchants/NOPE/review")).send({ decision: "approve" });
    expect(res.status).toBe(404);
  });
});

test("the application page is HTS-branded, says delivery isn't live, and lists the exclusions", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "merchant-apply.html"), "utf8");
  const { EXCLUDED_ITEMS } = require("../lib/merchants");
  expect(html).toContain('src="/hts-logo-192.png"');
  expect(html).toMatch(/Delivery isn't live yet/);
  for (const item of EXCLUDED_ITEMS) expect(html).toContain(item);
});

describe("review flags", () => {
  test("the admin list carries review flags, and a flagged application stays pending and can still be approved", async () => {
    mockSupabaseClient._state.merchants = [merchant({ contact_email: "x@mailinator.com", address_line: "Main Street", postal_code: "38103" })];
    const res = await admin(request(app).get("/api/admin/merchants"));
    expect(res.body.merchants[0].review_flags.map((f) => f.code)).toEqual(expect.arrayContaining(["disposable_email", "address_no_number", "zip_outside_pilot"]));
    expect(mockSupabaseClient._state.merchants[0].status).toBe("pending");
    expect(mockSupabaseClient._state.merchants[0].review_flags).toBeUndefined();
    const approve = await admin(request(app).patch("/api/admin/merchants/M1/review")).send({ decision: "approve" });
    expect(approve.status).toBe(200);
  });
});
