// GET /api/maps-key with and without GOOGLE_MAPS_BROWSER_KEY, plus the
// startup/runtime diagnostics. The key must never reach a log line.

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

// Fixture only; not a real key.
const FAKE_KEY = "fixture-browser-key-456";

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

function loadServer(extraEnv) {
  process.env = { ...ORIGINAL_ENV, ...BASE_ENV, ...extraEnv };
  delete process.env.CANONICAL_HOST;
  delete process.env.FOUNDATION_HOST;
  if (!("GOOGLE_MAPS_BROWSER_KEY" in extraEnv)) delete process.env.GOOGLE_MAPS_BROWSER_KEY;

  const logged = [];
  const spies = ["log", "warn", "error", "info"].map((level) =>
    jest.spyOn(console, level).mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    })
  );
  mockSupabaseClient = createFakeSupabase({ system_flags: [] });
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  return { app, logged, restore: () => spies.forEach((s) => s.mockRestore()) };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/maps-key with GOOGLE_MAPS_BROWSER_KEY configured", () => {
  let ctx;
  beforeAll(() => {
    ctx = loadServer({ GOOGLE_MAPS_BROWSER_KEY: `  ${FAKE_KEY}  ` });
  });
  afterAll(() => ctx.restore());

  test("returns the trimmed key", async () => {
    const res = await request(ctx.app).get("/api/maps-key");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: FAKE_KEY });
  });

  test("startup confirms the key is configured without printing it", () => {
    const all = ctx.logged.join("\n");
    expect(all).toContain("Google Maps browser key configured");
    expect(all).not.toContain(FAKE_KEY);
  });

  test("admin health reports the key as configured (boolean only)", async () => {
    const res = await request(ctx.app).get("/api/health").set("x-admin-token", "test-admin-token");
    expect(res.status).toBe(200);
    expect(res.body.integrations.google_maps_browser_key).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });
});

describe("GET /api/maps-key with GOOGLE_MAPS_BROWSER_KEY missing", () => {
  let ctx;
  beforeAll(() => {
    // A look-alike name is set (as can happen in a hosting dashboard); it
    // must be reported by name and never served.
    ctx = loadServer({ GOOGLE_MAPS_API_KEY: FAKE_KEY });
  });
  afterAll(() => ctx.restore());

  test("returns a clear 503 configuration error, not ok:true with an empty key", async () => {
    const res = await request(ctx.app).get("/api/maps-key");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("maps_not_configured");
    expect(res.body.error).toMatch(/maps are not configured/i);
    expect(res.body).not.toHaveProperty("key");
  });

  test("startup warns, names the look-alike variable, and never prints a value", () => {
    const all = ctx.logged.join("\n");
    expect(all).toMatch(/Google Maps inactive: GOOGLE_MAPS_BROWSER_KEY is not set/);
    expect(all).toMatch(/Found GOOGLE_MAPS_API_KEY instead/);
    expect(all).not.toContain(FAKE_KEY);
  });

  test("requests log a rate-limited runtime warning", async () => {
    const before = ctx.logged.filter((l) => l.includes("/api/maps-key requested")).length;
    await request(ctx.app).get("/api/maps-key");
    await request(ctx.app).get("/api/maps-key");
    const after = ctx.logged.filter((l) => l.includes("/api/maps-key requested")).length;
    expect(before).toBe(1);
    expect(after).toBe(1);
    expect(ctx.logged.join("\n")).not.toContain(FAKE_KEY);
  });

  test("admin health reports the key as not configured", async () => {
    const res = await request(ctx.app).get("/api/health").set("x-admin-token", "test-admin-token");
    expect(res.body.integrations.google_maps_browser_key).toBe(false);
  });

  test("public health does not expose integration details", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.body.integrations).toBeUndefined();
  });
});
