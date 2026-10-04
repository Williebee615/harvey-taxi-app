// Driver hours limit (docs/driver-hours.md): up to 12 hours online per
// shift, then 6 hours of rest before going online again. Going online is
// refused during rest; dispatch skips drivers at the limit; the sweep
// takes them offline (after any trip in progress); the app sees its hours.
// Review accounts are exempt.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.DRIVER_MAX_ONLINE_HOURS;
delete process.env.DRIVER_MIN_REST_HOURS;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const { signTestDriverToken, driverAuthHeaders, makeDriver, makeRide } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const H = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function useFake({ driver = {}, sessions = [], rides = [], flags = [] } = {}) {
  currentFake = createFakeSupabase(
    {
      drivers: [makeDriver({ online: false, ...driver }), makeDriver({ id: "DRIVER_2", phone: "+16155550202", online: true })],
      driver_online_sessions: sessions,
      rides,
      driver_offers: [],
      audit_logs: [],
      system_flags: flags,
      push_subscriptions: [],
      driver_push_tokens: []
    },
    { columns: LIVE_COLUMNS }
  );
  return currentFake;
}

let app;
let runDriverHoursSweep;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app, runDriverHoursSweep } = require("../server"));
});

const D1 = () => driverAuthHeaders(signTestDriverToken("DRIVER_1"));
const goOnline = () => request(app).post("/api/driver/status").set(D1()).send({ online: true });
const driverRow = (id = "DRIVER_1") => currentFake._state.drivers.find((d) => d.id === id);

describe("going online", () => {
  test("allowed under the limit", async () => {
    useFake({ sessions: [{ driver_id: "DRIVER_1", started_at: ago(10 * H), ended_at: ago(2 * H) }] });
    const res = await goOnline();
    expect(res.status).toBe(200);
    expect(driverRow().online).toBe(true);
  });

  test("refused after 12 hours until 6 hours of rest have passed", async () => {
    useFake({ sessions: [{ driver_id: "DRIVER_1", started_at: ago(14 * H), ended_at: ago(2 * H) }] });
    const res = await goOnline();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("rest_required");
    expect(res.body.error).toMatch(/12 hours online.*rest for 6 hours/);
    const restUntil = Date.parse(res.body.rest_until);
    expect(Math.abs(restUntil - (Date.now() + 4 * H))).toBeLessThan(60_000);
    expect(driverRow().online).toBe(false);
  });

  test("short breaks don't reset the count", async () => {
    useFake({
      sessions: [
        { driver_id: "DRIVER_1", started_at: ago(17 * H), ended_at: ago(11 * H) },
        { driver_id: "DRIVER_1", started_at: ago(9 * H), ended_at: ago(3 * H) }
      ]
    });
    expect((await goOnline()).status).toBe(409);
  });

  test("allowed again after 6 hours of rest", async () => {
    useFake({ sessions: [{ driver_id: "DRIVER_1", started_at: ago(19 * H), ended_at: ago(6 * H + 60_000) }] });
    expect((await goOnline()).status).toBe(200);
  });

  test("review accounts are exempt", async () => {
    useFake({
      driver: { is_review_account: true },
      sessions: [{ driver_id: "DRIVER_1", started_at: ago(14 * H), ended_at: ago(1 * H) }],
      flags: [{ key: "review_account_login_enabled", value: "true" }]
    });
    expect((await goOnline()).status).toBe(200);
  });

  test("going offline is always allowed", async () => {
    useFake({ driver: { online: true }, sessions: [{ driver_id: "DRIVER_1", started_at: ago(13 * H), ended_at: null }] });
    const res = await request(app).post("/api/driver/status").set(D1()).send({ online: false });
    expect(res.status).toBe(200);
    expect(driverRow().online).toBe(false);
  });
});

describe("sweep", () => {
  test("takes a driver offline at 12 hours and records why", async () => {
    useFake({ driver: { online: true }, sessions: [{ driver_id: "DRIVER_1", started_at: ago(12 * H + 60_000), ended_at: null }] });
    expect(await runDriverHoursSweep()).toEqual(["DRIVER_1"]);
    expect(driverRow().online).toBe(false);
    expect(currentFake._state.audit_logs.some((a) => a.action === "driver_hours_limit_offline" && a.entity_id === "DRIVER_1")).toBe(true);
    expect(driverRow("DRIVER_2").online).toBe(true);
  });

  test("leaves a driver under the limit alone", async () => {
    useFake({ driver: { online: true }, sessions: [{ driver_id: "DRIVER_1", started_at: ago(11 * H), ended_at: null }] });
    expect(await runDriverHoursSweep()).toEqual([]);
    expect(driverRow().online).toBe(true);
  });

  test("waits for a trip in progress to end", async () => {
    useFake({
      driver: { online: true },
      sessions: [{ driver_id: "DRIVER_1", started_at: ago(13 * H), ended_at: null }],
      rides: [makeRide({ id: "RIDE_T", driver_id: "DRIVER_1", status: "in_progress" })]
    });
    expect(await runDriverHoursSweep()).toEqual([]);
    expect(driverRow().online).toBe(true);
  });

  test("never takes a review account offline", async () => {
    useFake({ driver: { online: true, is_review_account: true }, sessions: [{ driver_id: "DRIVER_1", started_at: ago(30 * H), ended_at: null }] });
    expect(await runDriverHoursSweep()).toEqual([]);
    expect(driverRow().online).toBe(true);
  });
});

describe("driver app state", () => {
  test("includes hours used and whether rest is required", async () => {
    useFake({ sessions: [{ driver_id: "DRIVER_1", started_at: ago(13 * H), ended_at: ago(1 * H) }] });
    const res = await request(app).get("/api/driver/state").set(D1());
    expect(res.status).toBe(200);
    expect(res.body.hours).toMatchObject({ limit_minutes: 720, rest_hours: 6, limit_reached: true, can_go_online: false, remaining_minutes: 0 });
    expect(res.body.hours.worked_minutes).toBeGreaterThanOrEqual(719);
    expect(res.body.hours.rest_until).toBeTruthy();
  });

  test("a fresh driver has a full shift", async () => {
    useFake();
    const res = await request(app).get("/api/driver/state").set(D1());
    expect(res.body.hours).toMatchObject({ worked_minutes: 0, remaining_minutes: 720, can_go_online: true, rest_until: null });
  });
});
