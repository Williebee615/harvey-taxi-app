// Markets (lib/markets.js): Nashville unchanged; pilot markets (Harare,
// Lagos, Accra) refused for live estimates and ride requests; admin-only
// simulated rides that write nothing.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

// The server keeps the client it was given at start-up, so each test's
// fake is reached through this proxy.
let currentFake;
const mockSupabaseClient = new Proxy({}, { get: (_t, prop) => (typeof currentFake[prop] === "function" ? currentFake[prop].bind(currentFake) : currentFake[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const TRIP = {
  pickup: "100 Main St, Nashville, TN",
  dropoff: "200 Elm St, Nashville, TN",
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  destination_lat: 36.17,
  destination_lng: -86.79
};

const ADMIN = { "x-admin-token": "test-admin-token" };
let app;
let ip = 0;
const post = (path) => request(app).post(path).set("X-Forwarded-For", `203.0.113.${(ip = (ip % 250) + 1)}`);

function useFake(flags = []) {
  currentFake = createFakeSupabase({ riders: [], drivers: [], rides: [], audit_logs: [], system_flags: flags });
  return currentFake;
}

beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("Nashville is unchanged", () => {
  test("an estimate with no market and with us-nashville is the same as before", async () => {
    useFake();
    const plain = await post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP });
    const named = await post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, market_id: "us-nashville" });
    expect(plain.status).toBe(200);
    expect(named.status).toBe(200);
    expect(named.body.estimate || named.body).toMatchObject({ total: (plain.body.estimate || plain.body).total });
  });
});

describe("pilot markets are not open", () => {
  test.each(["zw-harare", "ng-lagos", "gh-accra"])("%s: estimates and ride requests are refused", async (id) => {
    useFake();
    const est = await post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, market_id: id });
    expect(est.status).toBe(403);
    expect(est.body).toMatchObject({ ok: false, market_not_open: true });
    const ride = await post("/api/rides/request").send({ pickup: "x", dropoff: "y", market_id: id });
    expect([401, 403]).toContain(ride.status); // signed-out gate or the market gate; never a ride
    expect(currentFake._state.rides).toEqual([]);
  });

  test("the live flag alone doesn't open a market (the code must also approve it)", async () => {
    useFake([{ key: "market_live_zw-harare", value: "true" }]);
    const est = await post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, market_id: "zw-harare" });
    expect(est.status).toBe(403);
  });

  test("an unknown market is rejected", async () => {
    useFake();
    expect((await post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, market_id: "xx-nowhere" })).status).toBe(400);
  });
});

describe("admin market preview and simulated rides", () => {
  test("admin only", async () => {
    useFake();
    expect((await request(app).get("/api/admin/markets")).status).toBe(401);
    expect((await post("/api/admin/markets/zw-harare/simulate").send({ from: "airport", to: "cbd" })).status).toBe(401);
  });

  test("lists four markets: Nashville live, three pilots in test mode with their unconfirmed items", async () => {
    useFake([{ key: "market_live_gh-accra", value: "true" }]);
    const res = await request(app).get("/api/admin/markets").set(ADMIN);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.markets.map((m) => [m.id, m]));
    expect(Object.keys(byId)).toEqual(["us-nashville", "zw-harare", "ng-lagos", "gh-accra"]);
    expect(byId["us-nashville"]).toMatchObject({ live_allowed: true, status: "live" });
    expect(byId["gh-accra"]).toMatchObject({ status: "test", live_flag: true, approved_for_live: false, live_allowed: false });
    expect(byId["zw-harare"].unconfirmed).toEqual(["currency", "pricing", "emergency numbers", "driver documents"]);
    expect(byId["zw-harare"].phone.country_code).toBe("+263");
  });

  test("a simulated Lagos ride: km, local time, NGN, no database writes at all", async () => {
    const fake = useFake();
    const before = JSON.stringify(fake._state);
    const res = await post("/api/admin/markets/ng-lagos/simulate").set(ADMIN).send({ from: "airport", to: "vi", ride_type: "airport" });
    expect(res.status).toBe(200);
    expect(res.body.ride).toMatchObject({ simulated: true, market: { id: "ng-lagos", live_allowed: false }, fare: { currency: "NGN", illustrative: true } });
    expect(res.body.ride.distance_text).toMatch(/km$/);
    expect(res.body.ride.emergency.instruction).toContain("112");
    expect(JSON.stringify(fake._state)).toBe(before);
  });

  test("bad places and markets without a simulation are rejected", async () => {
    useFake();
    expect((await post("/api/admin/markets/gh-accra/simulate").set(ADMIN).send({ from: "airport", to: "airport" })).status).toBe(400);
    expect((await post("/api/admin/markets/us-nashville/simulate").set(ADMIN).send({ from: "a", to: "b" })).status).toBe(404);
  });
});
