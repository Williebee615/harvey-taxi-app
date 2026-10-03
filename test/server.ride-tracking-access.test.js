// Ride status and live stream (GET /api/rides/:id/status, /stream) are
// visible only to the ride's rider (session that owns it, or the ride's
// tracking token), its assigned driver, or an admin. Unrelated riders,
// drivers and anonymous callers get "not found". The assigned driver never
// receives the delivery PIN.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const http = require("http");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestRiderToken,
  signTestDriverToken,
  riderAuthHeaders,
  driverAuthHeaders
} = require("./rideTestHelpers");
const { signRideTrackingToken, deriveTrackingSecret } = require("../lib/rideAccess");
const { signRideQuote } = require("../lib/rideQuote");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const RIDER = makeRider({ id: "RIDER_1" });
const OTHER_RIDER = makeRider({ id: "RIDER_2", email: "o@example.test", phone: "+16155550199" });
const DRIVER = makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78, last_seen_at: new Date().toISOString() });
const OTHER_DRIVER = makeDriver({ id: "DRIVER_2", email: "d2@example.test", phone: "+16155550299" });
const SECRET = deriveTrackingSecret({ quoteSecret: process.env.RIDE_QUOTE_SECRET });
const tokenFor = (rideId) => signRideTrackingToken(rideId, SECRET);

let app;
let server;
let base;

function reset() {
  const s = mockSupabaseClient._state;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, {
    riders: [{ ...RIDER }, { ...OTHER_RIDER }],
    drivers: [{ ...DRIVER }, { ...OTHER_DRIVER }],
    rides: [
      makeRide({
        id: "RIDE_1",
        status: "driver_enroute",
        rider_id: "RIDER_1",
        driver_id: "DRIVER_1",
        driver_phone: DRIVER.phone,
        ride_type: "food",
        delivery_pin: "4321"
      })
    ],
    driver_offers: [],
    audit_logs: [],
    system_flags: []
  });
}

beforeAll(async () => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(reset);

const status = (headers = {}, query = "") => request(app).get(`/api/rides/RIDE_1/status${query}`).set(headers);

describe("GET /api/rides/:id/status", () => {
  test("anonymous, unrelated rider, unrelated driver, and wrong token: not found, nothing leaked", async () => {
    for (const [label, headers, query] of [
      ["anonymous", {}, ""],
      ["other rider", riderAuthHeaders(signTestRiderToken("RIDER_2")), ""],
      ["other driver", driverAuthHeaders(signTestDriverToken("DRIVER_2")), ""],
      ["wrong token", { "x-ride-tracking-token": tokenFor("RIDE_OTHER") }, ""],
      ["forged admin", { "x-admin-token": "nope" }, ""],
      ["rider's own token for another ride", { "x-ride-tracking-token": tokenFor("RIDE_2") }, ""]
    ]) {
      const res = await status(headers, query);
      expect([label, res.status]).toEqual([label, 404]);
      expect(JSON.stringify(res.body)).not.toMatch(/36\.16|4321|5550201/);
    }
  });

  test("a missing ride and a forbidden ride look the same", async () => {
    const missing = await request(app).get("/api/rides/RIDE_NOPE/status");
    const forbidden = await status();
    expect(missing.status).toBe(forbidden.status);
    expect(missing.body.error).toBe(forbidden.body.error);
  });

  test("the rider: by owning session or by the ride's tracking token, with the delivery PIN", async () => {
    const bySession = await status(riderAuthHeaders(signTestRiderToken("RIDER_1")));
    expect(bySession.status).toBe(200);
    expect(bySession.body.driver.location).toMatchObject({ lat: 36.16, lng: -86.78 });
    expect(bySession.body.delivery.pin).toBe("4321");
    const byToken = await status({ "x-ride-tracking-token": tokenFor("RIDE_1") });
    expect(byToken.status).toBe(200);
    expect(byToken.body.delivery.pin).toBe("4321");
  });

  test("the assigned driver sees the ride but never the PIN; a revoked driver sees nothing", async () => {
    const res = await status(driverAuthHeaders(signTestDriverToken("DRIVER_1")));
    expect(res.status).toBe(200);
    expect(res.body.delivery).not.toHaveProperty("pin");
    mockSupabaseClient._state.drivers.find((d) => d.id === "DRIVER_1").access_revoked = true;
    expect((await status(driverAuthHeaders(signTestDriverToken("DRIVER_1")))).status).toBe(404);
  });

  test("admin", async () => {
    const res = await status({ "x-admin-token": "test-admin-token" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/rides/:id/stream", () => {
  function open(path, headers = {}) {
    return new Promise((resolve) => {
      const events = [];
      const req = http.get(`${base}${path}`, { headers }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          for (const m of chunk.matchAll(/event: (\S+)/g)) events.push(m[1]);
        });
        res.on("end", () => {});
        setTimeout(() => {
          req.destroy();
          resolve({ status: res.statusCode, events });
        }, 80);
      });
      req.on("error", () => {});
    });
  }

  test("refused without an authorized viewer", async () => {
    expect((await open("/api/rides/RIDE_1/stream")).status).toBe(404);
    expect((await open("/api/rides/RIDE_1/stream", riderAuthHeaders(signTestRiderToken("RIDER_2")))).status).toBe(404);
    expect((await open("/api/rides/RIDE_1/stream", driverAuthHeaders(signTestDriverToken("DRIVER_2")))).status).toBe(404);
    expect((await open(`/api/rides/RIDE_1/stream?t=${tokenFor("RIDE_9")}`)).status).toBe(404);
  });

  test("opens for the rider's token, the rider's session, the assigned driver and an admin", async () => {
    for (const [path, headers] of [
      [`/api/rides/RIDE_1/stream?t=${encodeURIComponent(tokenFor("RIDE_1"))}`, {}],
      ["/api/rides/RIDE_1/stream", riderAuthHeaders(signTestRiderToken("RIDER_1"))],
      ["/api/rides/RIDE_1/stream", driverAuthHeaders(signTestDriverToken("DRIVER_1"))],
      ["/api/rides/RIDE_1/stream", { "x-admin-token": "test-admin-token" }]
    ]) {
      const res = await open(path, headers);
      expect(res.status).toBe(200);
      expect(res.events).toContain("connected");
    }
  });

  test("an unrelated rider never receives a location event", async () => {
    const outsider = await open("/api/rides/RIDE_1/stream", riderAuthHeaders(signTestRiderToken("RIDER_2")));
    await request(app).post("/api/driver/location").set(driverAuthHeaders(signTestDriverToken("DRIVER_1"))).send({ latitude: 36.2, longitude: -86.7 });
    expect(outsider.events).not.toContain("location");
  });
});

test("POST /api/rides/request returns the ride's tracking token, which opens that ride only", async () => {
  const pickup = { lat: 36.1627, lng: -86.7816 };
  const destination = { lat: 36.1745, lng: -86.7679 };
  const estimate = { total: 18.5, driver_payout: 14, platform_fee: 4.5, miles: 3.2, minutes: 12 };
  const res = await request(app)
    .post("/api/rides/request")
    .set({ "x-requested-with": "harvey-rider-app" })
    .send({
      estimate_token: signRideQuote({ rideType: "standard", miles: 3.2, minutes: 12, pickup, destination, riderId: "RIDER_1", estimate, secret: process.env.RIDE_QUOTE_SECRET, ttlMinutes: 15 }),
      ride_type: "standard",
      rider_id: "RIDER_1",
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      destination_lat: destination.lat,
      destination_lng: destination.lng,
      pickup: "123 Main St, Nashville, TN",
      destination: "456 Oak Ave, Nashville, TN"
    });
  expect(res.status).toBe(201);
  const rideId = res.body.ride.id;
  expect(res.body.tracking_token).toBe(tokenFor(rideId));
  const ok = await request(app).get(`/api/rides/${rideId}/status`).set({ "x-ride-tracking-token": res.body.tracking_token });
  expect(ok.status).toBe(200);
  const other = await status({ "x-ride-tracking-token": res.body.tracking_token });
  expect(other.status).toBe(404);
});
