// Web separation (owner decision 2026-10-23): HTAF's pages are served
// only on harveytransportationfoundation.com and Harvey Taxi's pages only
// on harveytaxiservice.com. Both domains share this app, so only a real
// request routed by Host header proves the split.


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

const TAXI = "harveytaxiservice.com";
const HTAF = "harveytransportationfoundation.com";
const get = (path, host) => request(app).get(path).set("Host", host);

describe("foundation domain serves only HTAF pages", () => {
  test.each([
    ["/rider-dashboard.html", `https://${TAXI}/rider-dashboard.html`],
    ["/driver-dashboard.html", `https://${TAXI}/driver-dashboard.html`],
    ["/request-ride.html?x=1", `https://${TAXI}/request-ride.html?x=1`]
  ])("%s redirects to the taxi domain", async (path, location) => {
    const res = await get(path, HTAF);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(location);
  });

  test("/foundation.html redirects to the foundation homepage, keeping the query", async () => {
    const res = await get("/foundation.html?lang=es", HTAF);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/?lang=es");
  });

  test.each(["/", "/htaf-application.html", "/leadership.html", "/contact.html", "/privacy.html", "/terms.html"])(
    "%s is served",
    async (path) => {
      const res = await get(path, HTAF);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/Request a Ride/i);
    }
  );

  test("HTAF staff tools stay reachable", async () => {
    const res = await get("/admin-htaf.html", HTAF);
    expect(res.status).toBe(200);
  });

  test("shared assets are not redirected", async () => {
    const res = await get("/htaf-manifest.json", HTAF);
    expect(res.status).toBe(200);
    expect(res.body.short_name || JSON.parse(res.text).short_name).toBe("HTAF");
  });

  test("the HTAF homepage uses its own manifest and links out to the separate taxi company", async () => {
    const res = await get("/", HTAF);
    expect(res.text).toContain('href="/htaf-manifest.json"');
    expect(res.text).toContain("Harvey Taxi Service LLC");
    expect(res.text).toContain('href="https://harveytaxiservice.com/"');
  });
});

describe("taxi domain sends HTAF pages to the foundation domain", () => {
  test.each([
    ["/foundation.html", `https://${HTAF}/`],
    ["/htaf-application.html?lang=fr", `https://${HTAF}/htaf-application.html?lang=fr`],
    ["/leadership.html", `https://${HTAF}/leadership.html`],
    ["/contact.html", `https://${HTAF}/contact.html`]
  ])("%s redirects", async (path, location) => {
    const res = await get(path, TAXI);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(location);
  });

  test("the taxi homepage has no HTAF booking entry points, only an external link", async () => {
    const res = await get("/", TAXI);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/href="\/?foundation\.html/);
    expect(res.text).not.toMatch(/href="\/?htaf-application\.html/);
    expect(res.text).toContain('href="https://harveytransportationfoundation.com/"');
  });

  test("the taxi sitemap lists no HTAF pages", async () => {
    const res = await get("/sitemap.xml", TAXI);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/htaf-application|foundation\.html|leadership\.html/);
  });

  test("other hosts (previews, tests) are unaffected", async () => {
    const res = await request(app).get("/htaf-application.html");
    expect(res.status).toBe(200);
  });
});

describe("admin split (owner decision 2026-10-23)", () => {
  test.each(["/admin-dashboard.html", "/admin-home.html", "/admin-login.html"])(
    "Harvey Taxi staff page %s on the foundation domain goes to the taxi domain",
    async (path) => {
      const res = await get(path, HTAF);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://${TAXI}${path}`);
    }
  );

  test("the HTAF admin on the taxi domain goes to the foundation domain", async () => {
    const res = await get("/admin-htaf.html", TAXI);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`https://${HTAF}/admin-htaf.html`);
  });

  test("the HTAF admin links only to HTAF pages", async () => {
    const res = await get("/admin-htaf.html", HTAF);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/admin-home\.html|drivers\.html|rides\.html|analytics\.html|support\.html/);
  });

  test("the Harvey Taxi admin dashboard loads and shows no HTAF applications", async () => {
    const res = await get("/admin-dashboard.html", TAXI);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/foundation\/applications|admin-htaf|HTAF Applications/);
  });
});

describe("each domain's icon (owner report 2026-10-23: HTS icon beside HTAF's Google result)", () => {
  const fs = require("fs");
  const path = require("path");
  const file = (name) => fs.readFileSync(path.join(__dirname, "..", "public", name));
  const bytes = (res) => Buffer.from(res.body);
  const getBinary = (p, host) => request(app).get(p).set("Host", host).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

  test("the foundation domain's /favicon.ico is HTAF's icon", async () => {
    const res = await getBinary("/favicon.ico", HTAF);
    expect(res.status).toBe(200);
    expect(bytes(res).equals(file("htaf-favicon.ico"))).toBe(true);
  });

  test("the taxi domain's /favicon.ico is Harvey Taxi's icon", async () => {
    const res = await getBinary("/favicon.ico", TAXI);
    expect(bytes(res).equals(file("favicon.ico"))).toBe(true);
  });

  test("each domain's /apple-touch-icon.png is its own", async () => {
    expect(bytes(await getBinary("/apple-touch-icon.png", HTAF)).equals(file("htaf-apple-touch-icon.png"))).toBe(true);
    expect(bytes(await getBinary("/apple-touch-icon.png", TAXI)).equals(file("icon-192.png"))).toBe(true);
  });

  test("the taxi homepage declares a 192 px PNG icon", async () => {
    expect((await get("/", TAXI)).text).toContain('<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />');
  });
});
