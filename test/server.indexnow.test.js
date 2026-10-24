// IndexNow (owner decision 2026-10-23): one ping per deployed version with
// every Harvey Taxi page, the key file served at the root, and an off
// switch (system flag indexnow_enabled = "false").

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { INDEXNOW_KEY } = require("../lib/indexNow");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let server;
beforeAll(() => {
  mockClient = createFakeSupabase({ system_flags: [] });
  // eslint-disable-next-line global-require
  server = require("../server");
});
beforeEach(() => {
  mockClient = createFakeSupabase({ system_flags: [] });
});

function fakeFetch(status) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status };
  };
  fn.calls = calls;
  return fn;
}

test("not sent outside production unless forced", async () => {
  const f = fakeFetch(200);
  expect(await server.runIndexNowPing({ fetchImpl: f })).toEqual({ skipped: true, reason: "not_production" });
  expect(f.calls).toHaveLength(0);
});

test("sends every Harvey Taxi page, including the new destinations, and records the version", async () => {
  const f = fakeFetch(202);
  const result = await server.runIndexNowPing({ fetchImpl: f, force: true });
  expect(result).toMatchObject({ sent: true, accepted: true });
  expect(f.calls[0].url).toBe("https://api.indexnow.org/indexnow");
  const body = f.calls[0].body;
  expect(body.key).toBe(INDEXNOW_KEY);
  expect(body.urlList).toEqual(expect.arrayContaining([
    "https://harveytaxiservice.com/nashville-destinations/",
    "https://harveytaxiservice.com/destinations/geodis-park/",
    "https://harveytaxiservice.com/destinations/nashville-va-medical-center/"
  ]));
  expect(body.urlList.join(" ")).not.toMatch(/harveytransportationfoundation|admin|htaf/);
  expect(mockClient._state.system_flags.find((r) => r.key === "indexnow_last_version")).toBeTruthy();
});

test("a rejected ping is not recorded, and the off switch stops it", async () => {
  await server.runIndexNowPing({ fetchImpl: fakeFetch(403), force: true });
  expect(mockClient._state.system_flags.find((r) => r.key === "indexnow_last_version")).toBeUndefined();
  mockClient = createFakeSupabase({ system_flags: [{ key: "indexnow_enabled", value: "false" }] });
  const f = fakeFetch(200);
  expect(await server.runIndexNowPing({ fetchImpl: f, force: true })).toEqual({ skipped: true, reason: "disabled" });
  expect(f.calls).toHaveLength(0);
});

test("the key file and the new pages are served on the taxi site, and listed in the sitemap", async () => {
  const key = await request(server.app).get(`/${INDEXNOW_KEY}.txt`).set("Host", "harveytaxiservice.com");
  expect(key.status).toBe(200);
  expect(key.text).toBe(INDEXNOW_KEY);
  const page = await request(server.app).get("/destinations/geodis-park/").set("Host", "harveytaxiservice.com");
  expect(page.status).toBe(200);
  expect(page.text).toContain("<h1>Rides to GEODIS Park</h1>");
  const sitemap = await request(server.app).get("/sitemap.xml").set("Host", "harveytaxiservice.com");
  expect(sitemap.text).toContain("https://harveytaxiservice.com/destinations/saint-thomas-midtown/");
});
