// The admin drivers list reports each driver's setup state (owner
// decision 2026-10-18: "Unverified" / "Pending Setup" instead of a
// misleading "Approved"), and the extra columns read to work it out are
// not sent to the browser.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PERSONA = "true";
process.env.ENABLE_CHECKR = "true";

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

jest.setTimeout(30_000);

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({
    drivers: [
      { id: "D_APPLICANT", created_at: "2026-08-01T00:00:00Z", first_name: "A", status: "approved", approval_status: "approved", email_verified: false, phone_verified: false, vehicle_make: "Toyota", vehicle_model: "Camry", vehicle_year: "2020", persona_status: "not_started" },
      { id: "D_CONTACT", created_at: "2026-08-02T00:00:00Z", first_name: "B", status: "pending", approval_status: "pending", email_verified: true, phone_verified: true, vehicle_make: "Honda", vehicle_model: "Civic", vehicle_year: "2019" },
      { id: "D_READY", created_at: "2026-08-03T00:00:00Z", first_name: "C", status: "approved", approval_status: "approved", email_verified: true, phone_verified: true, persona_status: "approved", checkr_status: "clear", vehicle_make: "Ford", vehicle_model: "Fusion", vehicle_year: "2021" }
    ]
  });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

test("each driver carries its setup state; setup-only columns are not returned", async () => {
  const res = await request(app).get("/api/admin/drivers").set("x-admin-token", "test-admin-token");
  expect(res.status).toBe(200);
  const byId = Object.fromEntries(res.body.drivers.map((d) => [d.id, d]));

  expect(byId.D_APPLICANT.setup).toEqual({ state: "unverified", label: "Unverified", missing: ["email", "phone", "identity", "background check"] });
  expect(byId.D_APPLICANT.approval_status).toBe("approved");
  expect(byId.D_CONTACT.setup).toMatchObject({ state: "pending_setup", label: "Pending Setup", missing: ["identity", "background check"] });
  expect(byId.D_READY.setup).toMatchObject({ state: "verified", label: "Verified", missing: [] });

  for (const driver of res.body.drivers) {
    for (const hidden of ["persona_status", "vehicle_make", "vehicle_model", "vehicle_year"]) {
      expect(driver).not.toHaveProperty(hidden);
    }
  }
});

test("still admin-only", async () => {
  const res = await request(app).get("/api/admin/drivers");
  expect(res.status).toBe(401);
});
