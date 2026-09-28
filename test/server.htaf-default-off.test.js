process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
delete process.env.HTAF_RIDE_CREATION_ENABLED;
delete process.env.HTAF_AI_TRIAGE_ENABLED;

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");
let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockClient }));

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({ htaf_applications: [{ id: "application-1", first_name: "Private" }] });
  ({ app } = require("../server"));
});

test.each([
  ["create-ride", "HTAF ride creation is paused"],
  ["triage", "HTAF AI triage is disabled"]
])("%s fails closed before reading an application", async (action, message) => {
  const res = await request(app)
    .post(`/api/admin/foundation/applications/application-1/${action}`)
    .set("x-admin-token", process.env.ADMIN_API_TOKEN)
    .send({ pickup: "Private address" });
  expect(res.status).toBe(403);
  expect(JSON.stringify(res.body)).toContain(message);
});
