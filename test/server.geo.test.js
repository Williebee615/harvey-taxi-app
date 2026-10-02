// /api/geo/* (Mapbox, server-side) with the token configured, missing,
// and with provider failures. The token must never appear in a response
// body, a header, or a log line.

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { createFakeMapbox, TEST_TOKEN } = require("./fixtures/fakeMapbox");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const BASE_ENV = {
  NODE_ENV: "test",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RIDER_SESSION_SECRET: "test-rider-session-secret",
  DRIVER_SESSION_SECRET: "test-driver-session-secret",
  RIDE_QUOTE_SECRET: "test-ride-quote-secret",
  ADMIN_API_TOKEN: "test-admin-token"
};
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
const fake = createFakeMapbox();

function loadServer(extraEnv) {
  process.env = { ...ORIGINAL_ENV, ...BASE_ENV, ...extraEnv };
  delete process.env.CANONICAL_HOST;
  delete process.env.FOUNDATION_HOST;
  if (!("MAPBOX_ACCESS_TOKEN" in extraEnv)) delete process.env.MAPBOX_ACCESS_TOKEN;
  globalThis.fetch = fake.fetchImpl;

  const logged = [];
  const spies = ["log", "warn", "error", "info"].map((level) =>
    jest.spyOn(console, level).mockImplementation((...args) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    })
  );
  mockSupabaseClient = createFakeSupabase({ system_flags: [], audit_logs: [] });
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  const responses = [];
  const agent = {
    get: (url) => request(app).get(url).then((r) => (responses.push(r), r)),
    post: (url, body) => request(app).post(url).send(body).then((r) => (responses.push(r), r))
  };
  return { app, agent, logged, responses, restore: () => spies.forEach((s) => s.mockRestore()) };
}

function expectNoLeak(ctx) {
  for (const r of ctx.responses) {
    expect(r.text).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(r.headers)).not.toContain(TEST_TOKEN);
  }
  expect(ctx.logged.join("\n")).not.toContain(TEST_TOKEN);
}

const BROADWAY = { lat: 36.1612, lng: -86.7775 };
const AIRPORT = { lat: 36.1263, lng: -86.6774 };

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("with MAPBOX_ACCESS_TOKEN configured", () => {
  let ctx;
  beforeAll(() => {
    ctx = loadServer({ MAPBOX_ACCESS_TOKEN: `  ${TEST_TOKEN}  ` });
  });
  beforeEach(() => fake.reset());
  afterAll(() => {
    expectNoLeak(ctx);
    ctx.restore();
  });

  test("status reports configured (boolean only)", async () => {
    const res = await ctx.agent.get("/api/geo/status");
    expect(res.body).toEqual({ ok: true, configured: true });
  });

  test("startup confirms configuration without printing the token", () => {
    expect(ctx.logged.join("\n")).toContain("Mapbox address search and routing configured");
  });

  test("suggest returns labels and coordinates; the trimmed token is what reaches Mapbox", async () => {
    const res = await ctx.agent.get("/api/geo/suggest?q=501%20Broadway");
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toEqual({ label: "501 Broadway, Nashville, Tennessee 37203, United States", ...BROADWAY });
    expect(fake.calls[0].tokenOk).toBe(true);
  });

  test("resolve, reverse and route", async () => {
    const resolved = await ctx.agent.post("/api/geo/resolve", { query: "1 Terminal Dr" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.place).toMatchObject(AIRPORT);
    expect(fake.calls[0].params.permanent).toBe("true");

    const reversed = await ctx.agent.post("/api/geo/reverse", BROADWAY);
    expect(reversed.status).toBe(200);
    expect(reversed.body.place.label).toMatch(/Broadway/);

    const route = await ctx.agent.post("/api/geo/route", { from: BROADWAY, to: AIRPORT });
    expect(route.body).toEqual({ ok: true, distance_miles: 5.2, duration_minutes: 14 });
  });

  test("unknown address is 404 address_not_found; no driving route is 422 no_route", async () => {
    const missing = await ctx.agent.post("/api/geo/resolve", { query: "zzzz nowhere" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("address_not_found");

    fake.setMode("no_route");
    const noRoute = await ctx.agent.post("/api/geo/route", { from: BROADWAY, to: AIRPORT });
    expect(noRoute.status).toBe(422);
    expect(noRoute.body.code).toBe("no_route");
  });

  test("bad input is rejected before calling Mapbox", async () => {
    expect((await ctx.agent.get("/api/geo/suggest?q=ab")).status).toBe(400);
    expect((await ctx.agent.post("/api/geo/resolve", { query: "" })).status).toBe(400);
    expect((await ctx.agent.post("/api/geo/reverse", { lat: 200, lng: 0 })).status).toBe(400);
    expect((await ctx.agent.post("/api/geo/route", { from: BROADWAY })).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test.each([
    ["http_401", 401],
    ["http_500", 500],
    ["timeout", 0],
    ["network", 0]
  ])("provider failure (%s) is a plain 503 geo_unavailable with no provider details", async (mode) => {
    fake.setMode(mode);
    const res = await ctx.agent.post("/api/geo/resolve", { query: "501 Broadway" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("geo_unavailable");
    expect(res.body.error).toMatch(/temporarily unavailable/);
    expect(res.text).not.toMatch(/Invalid Token|upstream|api\.mapbox\.com/);
  }, 15000); // the timeout case waits out the client's 6 s limit

  test("a rejected token is logged as an HTTP status with a hint, never with the URL", () => {
    const all = ctx.logged.join("\n");
    expect(all).toMatch(/Mapbox rejected a request \(HTTP 401\)/);
    expect(all).toMatch(/permanent geocoding also requires a credit card/);
    expect(all).not.toMatch(/api\.mapbox\.com|access_token/);
  });

  test("admin health reports mapbox: true; public health shows no integrations", async () => {
    const admin = await request(ctx.app).get("/api/health").set("x-admin-token", "test-admin-token");
    ctx.responses.push(admin);
    expect(admin.body.integrations.mapbox).toBe(true);
    const pub = await ctx.agent.get("/api/health");
    expect(pub.body.integrations).toBeUndefined();
  });

  test("the old Google key endpoint is gone", async () => {
    expect((await ctx.agent.get("/api/maps-key")).status).toBe(404);
  });
});

describe("with MAPBOX_ACCESS_TOKEN missing", () => {
  let ctx;
  beforeAll(() => {
    fake.reset();
    ctx = loadServer({ MAPBOX_TOKEN: TEST_TOKEN });
  });
  afterAll(() => {
    expectNoLeak(ctx);
    ctx.restore();
  });

  test("status reports not configured", async () => {
    expect((await ctx.agent.get("/api/geo/status")).body).toEqual({ ok: true, configured: false });
  });

  test("every lookup is a 503 geo_not_configured and Mapbox is never called", async () => {
    const results = await Promise.all([
      ctx.agent.get("/api/geo/suggest?q=501%20Broadway"),
      ctx.agent.post("/api/geo/resolve", { query: "501 Broadway" }),
      ctx.agent.post("/api/geo/reverse", BROADWAY),
      ctx.agent.post("/api/geo/route", { from: BROADWAY, to: AIRPORT })
    ]);
    for (const res of results) {
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("geo_not_configured");
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("startup warns and names the look-alike variable; runtime warning is rate-limited", () => {
    const all = ctx.logged.join("\n");
    expect(all).toMatch(/Mapbox inactive: MAPBOX_ACCESS_TOKEN is not set/);
    expect(all).toMatch(/Found MAPBOX_TOKEN instead/);
    expect(ctx.logged.filter((l) => l.includes("Address search requested but MAPBOX_ACCESS_TOKEN is not set"))).toHaveLength(1);
  });

  test("admin health reports mapbox: false", async () => {
    const admin = await request(ctx.app).get("/api/health").set("x-admin-token", "test-admin-token");
    expect(admin.body.integrations.mapbox).toBe(false);
  });
});
