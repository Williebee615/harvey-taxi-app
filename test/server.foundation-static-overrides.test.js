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

// FOUNDATION_HOSTS redirects: unlike privacy/terms, HTAF has no content
// of its own to serve at /support.html or /index.html -- express.static
// isn't domain-gated, so without this, a visitor on the HTAF domain
// (or a relative link on an HTAF page, like the application page's own
// bottom-nav) could land on Harvey Taxi's own support page or homepage.
// Found live in production and reported back after the first round of
// fixes -- the initial audit only searched for absolute
// harveytaxiservice.com URLs and missed these relative ones.
describe("FOUNDATION_HOSTS redirects -- /support.html and /index.html", () => {
  test("the taxi domain's own support page is completely unaffected", async () => {
    const res = await request(app).get("/support.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi — Support");
  });

  test("the taxi domain's own homepage is completely unaffected", async () => {
    const res = await request(app).get("/index.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi");
  });

  test("the HTAF domain redirects /support.html to /contact.html instead of serving Harvey Taxi's support page", async () => {
    const res = await request(app).get("/support.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/contact.html");
  });

  test("the HTAF domain redirects /index.html to / instead of serving Harvey Taxi's homepage", async () => {
    const res = await request(app).get("/index.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/");
  });

  test("the www HTAF host also gets the /support.html redirect, not just the apex", async () => {
    const res = await request(app).get("/support.html").set("Host", "www.harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/contact.html");
  });

  // A third, separate Harvey Taxi privacy document (public/privacy-policy.html,
  // distinct from public/privacy.html) that predates the /privacy.html
  // override -- not linked from any HTAF page, but still directly
  // reachable at this exact filename. Reported live: still showed
  // "Harvey Taxi -- Privacy Policy" on the HTAF domain after the first
  // two rounds of fixes.
  test("the taxi domain's own separate privacy-policy.html is completely unaffected", async () => {
    const res = await request(app).get("/privacy-policy.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi — Privacy Policy");
  });

  test("the HTAF domain redirects /privacy-policy.html to the already-correct /privacy.html", async () => {
    const res = await request(app).get("/privacy-policy.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/privacy.html");
  });

  test("following that redirect lands on HTAF's own privacy policy, not Harvey Taxi's", async () => {
    const res = await request(app).get("/privacy.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy Policy — Harvey Transportation Assistance Foundation");
    expect(res.text).not.toContain("Harvey Taxi");
  });

  test("the taxi domain's own app-review.html is completely unaffected", async () => {
    const res = await request(app).get("/app-review.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi — App Review Information");
  });

  test("the HTAF domain redirects /app-review.html to /contact.html", async () => {
    const res = await request(app).get("/app-review.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/contact.html");
  });

  // Google Play's account-deletion requirement: the deletion page is a
  // Harvey Taxi rider/driver page, not an HTAF one -- HTAF applicants have
  // no Harvey Taxi account to delete.
  test("the taxi domain's own delete-account.html loads publicly, without authentication", async () => {
    const res = await request(app).get("/delete-account.html").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi");
    expect(res.text).toContain("Delete Your Account");
  });

  test("the extensionless /delete-account URL also loads it, not a login page", async () => {
    const res = await request(app).get("/delete-account").set("Host", "harveytaxiservice.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Delete Your Account");
  });

  test("the HTAF domain redirects /delete-account.html to /contact.html", async () => {
    const res = await request(app).get("/delete-account.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/contact.html");
  });
});

describe("htaf-application.html -- corrected cross-domain metadata and links", () => {
  test("og:url and canonical both point at the HTAF domain, not the taxi domain", async () => {
    const res = await request(app).get("/htaf-application.html").set("Host", "harveytransportationfoundation.com");

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://harveytransportationfoundation.com/htaf-application.html"');
    expect(res.text).toContain('content="https://harveytransportationfoundation.com/htaf-application.html"');
    expect(res.text).not.toContain("https://harveytaxiservice.com");
  });

  test("no remaining link or navigation destination points at support.html or index.html", async () => {
    const res = await request(app).get("/htaf-application.html").set("Host", "harveytransportationfoundation.com");

    expect(res.text).not.toMatch(/href="support\.html"/);
    expect(res.text).not.toMatch(/href="index\.html"/);
    expect(res.text).not.toMatch(/location\.href=['"]support\.html['"]/);
    expect(res.text).not.toMatch(/location\.href=['"]index\.html['"]/);
  });
});
