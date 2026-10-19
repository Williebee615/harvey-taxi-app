// Traffic-aware pickup ETA (owner-approved 2026-10-19): with
// dispatch_route_api_enabled on, a driver's location update on the way to
// pickup stores Mapbox's "driving-traffic" ETA; off, it stays Haversine
// with no Mapbox call. Fares keep the plain "driving" profile. The admin
// switch is audited and refuses to turn on without ETA persistence.

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { createFakeMapbox, TEST_TOKEN } = require("./fixtures/fakeMapbox");
const { makeDriver, makeRide, driverAuthHeaders, signTestDriverToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

jest.setTimeout(30_000);

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
const fake = createFakeMapbox();
const ADMIN = { "x-admin-token": "test-admin-token" };
const PICKUP = { lat: 36.1263, lng: -86.6774 };
const DRIVER_AT = { lat: 36.1612, lng: -86.7775 };

let app;
let counter = 0;
// Location updates are throttled per driver and route results cached per
// ride, so every test uses a fresh driver and ride.
let n = 0;

function seed(flags) {
  n += 1;
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    drivers: [makeDriver({ id: `DRIVER_${n}`, phone: `+1615555${String(1000 + n)}` })],
    rides: [makeRide({ id: `RIDE_${n}`, driver_id: `DRIVER_${n}`, status: "driver_enroute", pickup_lat: PICKUP.lat, pickup_lng: PICKUP.lng, driver_eta_to_pickup_minutes: null })],
    driver_offers: [],
    audit_logs: [],
    usage_counters: [],
    system_flags: Object.entries(flags).map(([key, value]) => ({ key, value }))
  });
  counter = 0;
  fake.reset();
}

beforeAll(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    RIDER_SESSION_SECRET: "test-rider-session-secret",
    DRIVER_SESSION_SECRET: "test-driver-session-secret",
    RIDE_QUOTE_SECRET: "test-ride-quote-secret",
    ADMIN_API_TOKEN: "test-admin-token",
    MAPBOX_ACCESS_TOKEN: TEST_TOKEN
  };
  delete process.env.GOOGLE_ROUTES_API_KEY;
  delete process.env.CANONICAL_HOST;
  globalThis.fetch = fake.fetchImpl;
  mockSupabaseClient = createFakeSupabase({}, { rpc: { increment_usage_counter: () => ({ data: (counter += 1), error: null }) } });
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

const ride = () => mockSupabaseClient._state.rides.find((r) => r.id === `RIDE_${n}`);
const directions = (profile) => fake.calls.filter((c) => c.path.startsWith(`/directions/v5/mapbox/${profile}/`));

async function sendLocation() {
  const res = await request(app)
    .post("/api/driver/location")
    .set(driverAuthHeaders(signTestDriverToken(`DRIVER_${n}`)))
    .send({ latitude: DRIVER_AT.lat, longitude: DRIVER_AT.lng, accuracy: 10 });
  expect(res.status).toBe(200);
  // The ETA write is fire-and-forget; wait for it.
  for (let i = 0; i < 50 && ride().driver_eta_to_pickup_minutes == null; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("switch on: the pickup ETA comes from Mapbox driving-traffic", async () => {
  seed({ dispatch_eta_persistence_enabled: "true", dispatch_route_api_enabled: "true" });
  await sendLocation();
  expect(directions("driving-traffic")).toHaveLength(1);
  expect(directions("driving")).toHaveLength(0);
  // The fake answers 1,260 s with traffic.
  expect(ride().driver_eta_to_pickup_minutes).toBe(21);
  expect(ride().driver_distance_to_pickup_miles).toBeCloseTo(5.2, 1);
  expect(counter).toBe(1);
});

test("switch off: Haversine only, no Mapbox call", async () => {
  seed({ dispatch_eta_persistence_enabled: "true", dispatch_route_api_enabled: "false" });
  await sendLocation();
  expect(fake.calls).toHaveLength(0);
  expect(ride().driver_eta_to_pickup_minutes).toEqual(expect.any(Number));
  expect(counter).toBe(0);
});

test("Mapbox failing: falls back to Haversine; the location update still succeeds", async () => {
  seed({ dispatch_eta_persistence_enabled: "true", dispatch_route_api_enabled: "true" });
  fake.setMode("http_500");
  await sendLocation();
  expect(directions("driving-traffic")).toHaveLength(1);
  expect(ride().driver_eta_to_pickup_minutes).toEqual(expect.any(Number));
  expect(ride().driver_eta_to_pickup_minutes).not.toBe(21);
});

test("over the monthly call cap: no Mapbox call", async () => {
  seed({ dispatch_eta_persistence_enabled: "true", dispatch_route_api_enabled: "true" });
  counter = 20000;
  await sendLocation();
  expect(fake.calls).toHaveLength(0);
});

test("fare routing keeps the plain driving profile", async () => {
  seed({ dispatch_eta_persistence_enabled: "true", dispatch_route_api_enabled: "true" });
  const res = await request(app).post("/api/geo/route").send({ from: DRIVER_AT, to: PICKUP });
  expect(res.status).toBe(200);
  expect(res.body.duration_minutes).toBe(14);
  expect(directions("driving")).toHaveLength(1);
  expect(directions("driving-traffic")).toHaveLength(0);
});

test("admin switch: refused without persistence; on and off are audited; status reports the cap", async () => {
  seed({ dispatch_eta_persistence_enabled: "false" });
  const refused = await request(app).post("/api/admin/system/enable-traffic-eta").set(ADMIN).send({});
  expect(refused.status).toBe(409);
  expect(mockSupabaseClient._state.system_flags.find((f) => f.key === "dispatch_route_api_enabled")).toBeUndefined();

  seed({ dispatch_eta_persistence_enabled: "true" });
  expect((await request(app).post("/api/admin/system/enable-traffic-eta").send({})).status).toBe(401);
  const on = await request(app).post("/api/admin/system/enable-traffic-eta").set(ADMIN).send({ reason: "owner approved 2026-10-19" });
  expect(on.status).toBe(200);
  expect(on.body).toMatchObject({ traffic_eta_enabled: true, provider: "mapbox_driving_traffic", monthly_call_cap: 20000 });
  expect(mockSupabaseClient._state.system_flags.find((f) => f.key === "dispatch_route_api_enabled").value).toBe("true");

  const status = await request(app).get("/api/admin/system/traffic-eta").set(ADMIN);
  expect(status.body).toMatchObject({ traffic_eta_enabled: true, eta_persistence_enabled: true, provider: "mapbox_driving_traffic", calls_this_month: 0, monthly_call_cap: 20000 });

  const off = await request(app).post("/api/admin/system/disable-traffic-eta").set(ADMIN).send({});
  expect(off.body).toMatchObject({ traffic_eta_enabled: false });
  const actions = mockSupabaseClient._state.audit_logs.map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(["traffic_eta_enabled", "traffic_eta_disabled"]));
});
