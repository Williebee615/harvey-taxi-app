// Business partnership inquiries (owner decision 2026-10-22): stored,
// audited, emailed to support; spam dropped quietly; one open inquiry per
// email; a clear 503 until the table exists; admin list and status
// changes need an admin and are audited.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.setTimeout(30_000);

let app;
let ip = 0;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ partnership_inquiries: [], audit_logs: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  mockSupabaseClient._state.partnership_inquiries = [];
  mockSupabaseClient._state.audit_logs = [];
});

const INQUIRY = {
  organization_name: "Test Hotel Group",
  business_type: "llc",
  industry: "hospitality",
  city: "Nashville",
  state: "TN",
  contact_name: "Test Contact",
  contact_email: "contact@example.test",
  contact_phone: "6155550100",
  interests: ["transportation_partnership"],
  message: "We'd like to discuss transportation options for our guests.",
  consent: true,
  form_started_at: Date.now() - 60_000
};
const submit = (body, from = `198.51.100.${++ip}`) => request(app).post("/api/partnerships/inquiries").set("x-forwarded-for", from).send(body);
const rows = () => mockSupabaseClient._state.partnership_inquiries;
const actions = () => mockSupabaseClient._state.audit_logs.map((a) => a.action);
const ADMIN = { "x-admin-token": "test-admin-token" };

test("a valid inquiry is stored, audited and reported as received", async () => {
  const res = await submit(INQUIRY);
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ received: true, inquiry: { status: "new" } });
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ organization_name: "Test Hotel Group", contact_phone: "+16155550100", interests: ["transportation_partnership"], status: "new" });
  expect(actions()).toContain("partnership_inquiry_submitted");
  await new Promise((r) => setTimeout(r, 50));
  expect(actions()).toContain("partnership_inquiry_email");
});

test("an invalid inquiry is refused with a reason and nothing is stored", async () => {
  const res = await submit({ ...INQUIRY, consent: false });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Confirm/);
  expect(rows()).toHaveLength(0);
});

test("spam (hidden field or too fast) gets the same reply but is not stored", async () => {
  expect((await submit({ ...INQUIRY, company_fax: "555" })).status).toBe(201);
  expect((await submit({ ...INQUIRY, form_started_at: Date.now() })).status).toBe(201);
  expect(rows()).toHaveLength(0);
  expect(actions().filter((a) => a === "partnership_inquiry_dropped")).toHaveLength(2);
});

test("a second inquiry from the same email while the first is new isn't stored twice", async () => {
  await submit(INQUIRY);
  const again = await submit(INQUIRY);
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ received: true, duplicate: true });
  expect(rows()).toHaveLength(1);
});

test("rate limit: at most 5 an hour from one address", async () => {
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push((await submit({ ...INQUIRY, contact_email: `p${i}@example.test` }, "203.0.113.77")).status);
  expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
  expect(codes[5]).toBe(429);
});

test("before the table exists: a clear 503 for applicants, 'not set up' for admins", async () => {
  const saved = mockSupabaseClient._state.partnership_inquiries;
  delete mockSupabaseClient._state.partnership_inquiries;
  const original = mockSupabaseClient.from;
  mockSupabaseClient.from = (table) => {
    if (table !== "partnership_inquiries") return original.call(mockSupabaseClient, table);
    const missing = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    const chain = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (resolve) => resolve(missing) : () => chain) });
    return chain;
  };
  try {
    const res = await submit(INQUIRY);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/aren't open yet/);
    const list = await request(app).get("/api/admin/partnerships").set(ADMIN);
    expect(list.body).toMatchObject({ inquiries: [], not_set_up: true });
  } finally {
    mockSupabaseClient.from = original;
    mockSupabaseClient._state.partnership_inquiries = saved;
  }
});

test("admin list and status changes: admin only, labels included, changes audited", async () => {
  await submit(INQUIRY);
  rows()[0].id = "00000000-0000-4000-8000-000000000001";
  expect((await request(app).get("/api/admin/partnerships")).status).toBe(401);
  const list = await request(app).get("/api/admin/partnerships").set(ADMIN);
  expect(list.status).toBe(200);
  expect(list.body.inquiries[0]).toMatchObject({ industry_label: "Hospitality", business_type_label: "LLC", interest_labels: ["Transportation partnerships"] });
  const id = list.body.inquiries[0].id;
  expect((await request(app).patch(`/api/admin/partnerships/${id}`).set(ADMIN).send({ status: "approved" })).status).toBe(400);
  const changed = await request(app).patch(`/api/admin/partnerships/${id}`).set(ADMIN).send({ status: "contacted", note: "Called them" });
  expect(changed.status).toBe(200);
  expect(rows()[0]).toMatchObject({ status: "contacted", staff_note: "Called them" });
  expect(actions()).toContain("partnership_inquiry_status_changed");
  expect((await request(app).patch("/api/admin/partnerships/NOPE").set(ADMIN).send({ status: "closed" })).status).toBe(404);
});
