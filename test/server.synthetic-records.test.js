// Synthetic test records (email on the reserved example.test domain) never
// count toward public HTAF totals, and the response stays aggregate-only.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

test("public HTAF stats exclude example.test applications", async () => {
  mockClient = createFakeSupabase({
    htaf_applications: [
      { id: "a1", status: "submitted", email: "real.person@gmail.com" },
      { id: "a2", status: "approved", email: "another@yahoo.com" },
      { id: "s1", status: "submitted", email: "htaf-smoke-1@example.test" },
      { id: "s2", status: "approved", email: "QA@Example.Test " },
      { id: "n1", status: "submitted", email: null }
    ]
  });
  const res = await request(app).get("/api/foundation/public-stats");
  expect(res.status).toBe(200);
  expect(res.body.applications_submitted).toBe(3);
  expect(res.body.approved_requests).toBe(1);
  const body = JSON.stringify(res.body);
  for (const v of ["real.person", "example.test", "gmail"]) expect(body).not.toContain(v);
});

test("lookalike domains are still counted", async () => {
  mockClient = createFakeSupabase({
    htaf_applications: [
      { id: "a1", status: "submitted", email: "me@example.test.com" },
      { id: "a2", status: "submitted", email: "me@notexample.test.org" }
    ]
  });
  const res = await request(app).get("/api/foundation/public-stats");
  expect(res.body.applications_submitted).toBe(2);
});
