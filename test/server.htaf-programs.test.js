// HTAF program categories: the application form offers exactly the six
// owner-confirmed categories, while applications already filed under the
// retired "Community Assistance" category are kept unchanged and still
// listed for staff.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
const request = require("supertest");

const SIX = ["Medical Transportation", "Employment Access", "Education Access", "Senior Assistance", "Disability Assistance", "Veteran Assistance"];
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8");

test("the form, its program list and the foundation page use the same six names", () => {
  const form = read("htaf-application.html");
  const choices = [...form.matchAll(/name="program" value="[a-z]+"[^>]*\/><div class="choice-card"><strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
  expect(choices).toEqual(SIX);
  const foundation = read("foundation.html");
  const programs = foundation.slice(foundation.indexOf("<h3>Programs</h3>"), foundation.indexOf('id="governance"'));
  expect([...programs.matchAll(/<h4>([^<]+)<\/h4>/g)].map((m) => m[1])).toEqual(SIX);
  for (const old of ["Community Assistance", "Senior Mobility", "Disability Transportation", "Veteran Transportation"]) {
    expect(form).not.toContain(old);
    expect(foundation).not.toContain(old);
  }
});

test("the pages keep saying that applying does not guarantee eligibility, funding or transportation", () => {
  expect(read("foundation.html")).toContain("Applying does not guarantee approval, funding, transportation, or scheduling.");
  expect(read("htaf-application.html")).toContain("Submission does not guarantee transportation assistance");
});

test("existing Community Assistance applications are kept unchanged and still listed for staff", async () => {
  mockSupabaseClient = createFakeSupabase({
    htaf_applications: [
      { id: "HTAF_OLD", application_code: "HTAF-OLD", program_type: "community", status: "submitted", first_name: "A", last_name: "B", email: "a@example.test", created_at: "2026-08-01T00:00:00Z" },
      { id: "HTAF_NEW", application_code: "HTAF-NEW", program_type: "veteran", status: "submitted", first_name: "C", last_name: "D", email: "c@example.test", created_at: "2026-10-01T00:00:00Z" }
    ],
    audit_logs: []
  });
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  const res = await request(app).get("/api/admin/foundation/applications").set("x-admin-token", "test-admin-token");
  expect(res.status).toBe(200);
  const listed = JSON.stringify(res.body);
  expect(listed).toContain("HTAF-OLD");
  expect(mockSupabaseClient._state.htaf_applications.find((a) => a.id === "HTAF_OLD").program_type).toBe("community");
  expect(mockSupabaseClient._log.filter((e) => e.table === "htaf_applications" && e.op !== "select")).toEqual([]);
});
