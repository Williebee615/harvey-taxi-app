// Composition/integration test for the FOUNDATION_HOSTS static
// overrides added alongside the HTAF site-content corrections: HTAF's
// domain must get its own privacy.html/terms.html content, while the
// taxi domain's own policy pages (which describe a commercial
// ride-hailing platform) must be completely unaffected -- these are
// the same URL path on both domains, so only a real request routed by
// Host header proves the split actually works.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
// Left unset deliberately, matching production: CANONICAL_HOST and
// FOUNDATION_HOST fall back to their real hardcoded defaults
// (harveytaxiservice.com / harveytransportationfoundation.com).
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("FOUNDATION_HOSTS static overrides -- /privacy.html and /terms.html", () => {
  test("the taxi domain still gets Harvey Taxi's own privacy policy, unchanged", async () => {
    const res = await request(app).get("/privacy.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi Service LLC");
  });

  test("the taxi domain still gets Harvey Taxi's own terms of service, unchanged", async () => {
    const res = await request(app).get("/terms.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi Terms of Service");
  });

  test("the HTAF domain gets HTAF's own privacy policy at the same URL", async () => {
    const res = await request(app).get("/privacy.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy Policy — Harvey Transportation Assistance Foundation");
    expect(res.text).not.toContain("Harvey Taxi Service LLC");
  });

  test("the HTAF domain gets HTAF's own terms of use at the same URL", async () => {
    const res = await request(app).get("/terms.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Terms of Use — Harvey Transportation Assistance Foundation");
    expect(res.text).not.toContain("Harvey Taxi Service LLC");
  });

  test("the HTAF domain's terms of use clearly states applying is not a guarantee", async () => {
    const res = await request(app).get("/terms.html").set("Host", "harveytransportationfoundation.com");
    const normalized = res.text.replace(/\s+/g, " ");

    expect(normalized).toContain("does not guarantee approval, funding, transportation, or scheduling");
  });

  test("the www HTAF host also gets the HTAF override, not just the apex", async () => {
    const res = await request(app).get("/privacy.html").set("Host", "www.harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy Policy — Harvey Transportation Assistance Foundation");
  });

  test("a path with no override entry falls through unaffected on the HTAF domain", async () => {
    const res = await request(app).get("/contact.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Contact HTAF");
  });
});
