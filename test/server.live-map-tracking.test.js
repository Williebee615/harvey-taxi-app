// Live map tracking (docs/live-map-tracking.md): the website gets only a
// public Mapbox token; a rider may share their own position with the
// assigned driver, only until pickup; only that ride's rider can share;
// the driver sees it in the app's state only while fresh and before
// pickup; and a sweep deletes it afterwards.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
process.env.MAPBOX_PUBLIC_TOKEN = "pk.test-web-token";
process.env.MAPBOX_APP_TOKEN = "pk.test-app-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const {
  signTestDriverToken,
  signTestRiderToken,
  riderAuthHeaders,
  driverAuthHeaders,
  makeRider,
  makeDriver,
  makeRide
} = require("./rideTestHelpers");
const { deriveTrackingSecret, signRideTrackingToken } = require("../lib/rideAccess");

let currentFake;
let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

function useFake({ status = "driver_enroute", ride = {} } = {}) {
  currentFake = createFakeSupabase(
    {
      riders: [makeRider(), makeRider({ id: "RIDER_2", phone: "+16155550199" })],
      drivers: [makeDriver({ online: true }), makeDriver({ id: "DRIVER_2", first_name: "Ola" })],
      rides: [makeRide({ id: "RIDE_9", rider_id: "RIDER_1", driver_id: "DRIVER_1", status, ...ride })],
      driver_offers: [],
      audit_logs: [],
      system_flags: []
    },
    { columns: LIVE_COLUMNS }
  );
  return currentFake;
}

let app;
let purgeRiderLocations;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app, purgeRiderLocations } = require("../server"));
});

const trackingToken = (rideId) =>
  signRideTrackingToken(rideId, deriveTrackingSecret({ trackingSecret: "", quoteSecret: process.env.RIDE_QUOTE_SECRET }));
const RIDER = () => ({ "x-ride-tracking-token": trackingToken("RIDE_9") });
const DRIVER = () => driverAuthHeaders(signTestDriverToken("DRIVER_1"));
const share = (headers, body = {}) =>
  request(app).post("/api/rides/RIDE_9/rider-location").set(headers).send({ latitude: 36.1627, longitude: -86.7816, accuracy: 12, ...body });
const ride = () => currentFake._state.rides.find((r) => r.id === "RIDE_9");
const ago = (ms) => new Date(Date.now() - ms).toISOString();

describe("GET /api/maps/config", () => {
  test("returns the public web token only", async () => {
    const res = await request(app).get("/api/maps/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, token: "pk.test-web-token" });
    expect(JSON.stringify(res.body)).not.toContain("pk.test-app-token");
  });

  test("never returns a secret token", async () => {
    const saved = process.env.MAPBOX_PUBLIC_TOKEN;
    process.env.MAPBOX_PUBLIC_TOKEN = "sk.secret-token";
    try {
      const res = await request(app).get("/api/maps/config");
      expect(res.body).toMatchObject({ enabled: false, token: null });
      expect(JSON.stringify(res.body)).not.toContain("sk.");
    } finally {
      process.env.MAPBOX_PUBLIC_TOKEN = saved;
    }
  });
});

describe("rider shares location", () => {
  test.each([
    ["tracking token", RIDER],
    ["rider session", () => riderAuthHeaders(signTestRiderToken("RIDER_1"))]
  ])("the ride's rider (%s) can share before pickup", async (_name, headers) => {
    useFake();
    const res = await share(headers());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sharing: true, stored: true });
    expect(ride()).toMatchObject({ rider_live_lat: 36.1627, rider_live_lng: -86.7816, rider_live_accuracy_m: 12 });
    expect(ride().rider_live_at).toBeTruthy();
  });

  test.each([
    ["another rider", () => riderAuthHeaders(signTestRiderToken("RIDER_2"))],
    ["the assigned driver", DRIVER],
    ["admin", () => ({ "x-admin-token": process.env.ADMIN_API_TOKEN })],
    ["no credentials", () => ({})],
    ["another ride's token", () => ({ "x-ride-tracking-token": trackingToken("RIDE_OTHER") })]
  ])("%s cannot", async (_name, headers) => {
    useFake();
    const res = await share(headers());
    expect(res.status).toBe(404);
    expect(ride().rider_live_lat ?? null).toBeNull();
  });

  test.each(["in_progress", "completed", "cancelled", "awaiting_driver_acceptance"])(
    "refused once the ride is %s",
    async (status) => {
      useFake({ status });
      const res = await share(RIDER());
      expect(res.status).toBe(409);
      expect(ride().rider_live_lat ?? null).toBeNull();
    }
  );

  test("past pickup, a refused share also deletes a leftover position", async () => {
    useFake({ status: "in_progress", ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(5_000) } });
    expect((await share(RIDER())).status).toBe(409);
    expect(ride()).toMatchObject({ rider_live_lat: null, rider_live_lng: null, rider_live_at: null });
  });

  test.each([
    [{ latitude: "x", longitude: 1 }],
    [{ latitude: 91, longitude: 1 }],
    [{ latitude: 0, longitude: 0 }]
  ])("rejects invalid coordinates %j", async (body) => {
    useFake();
    expect((await share(RIDER(), body)).status).toBe(400);
  });

  test("updates closer than the minimum interval are acknowledged but not stored", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(1_000) } });
    const res = await share(RIDER());
    expect(res.body).toMatchObject({ sharing: true, stored: false });
    expect(ride().rider_live_lat).toBe(36.1);
  });

  test("the rider can stop sharing", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_accuracy_m: 5, rider_live_at: ago(5_000) } });
    const res = await request(app).delete("/api/rides/RIDE_9/rider-location").set(RIDER());
    expect(res.status).toBe(200);
    expect(ride()).toMatchObject({ rider_live_lat: null, rider_live_lng: null, rider_live_accuracy_m: null, rider_live_at: null });
  });

  test("only the rider can stop sharing", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(5_000) } });
    expect((await request(app).delete("/api/rides/RIDE_9/rider-location").set(DRIVER())).status).toBe(404);
    expect(ride().rider_live_lat).toBe(36.1);
  });
});

describe("rider status shows sharing state", () => {
  test("allowed before pickup, active while fresh", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(5_000) } });
    const res = await request(app).get("/api/rides/RIDE_9/status").set(RIDER());
    expect(res.status).toBe(200);
    expect(res.body.rider_location_sharing).toEqual({ allowed: true, active: true });
  });

  test("not allowed during the trip", async () => {
    useFake({ status: "in_progress" });
    const res = await request(app).get("/api/rides/RIDE_9/status").set(RIDER());
    expect(res.body.rider_location_sharing).toEqual({ allowed: false, active: false });
  });

  test("the driver's view of the status route doesn't include it", async () => {
    useFake();
    const res = await request(app).get("/api/rides/RIDE_9/status").set(DRIVER());
    expect(res.status).toBe(200);
    expect(res.body.rider_location_sharing).toBeUndefined();
  });
});

describe("driver app state", () => {
  test("includes a fresh rider position before pickup, and the app map token", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_accuracy_m: 8, rider_live_at: ago(10_000) } });
    const res = await request(app).get("/api/driver/state").set(DRIVER());
    expect(res.status).toBe(200);
    expect(res.body.active_ride.rider_location).toMatchObject({ lat: 36.1, lng: -86.7, accuracy_meters: 8 });
    expect(res.body.map).toEqual({ token: "pk.test-app-token" });
  });

  test("omits a stale rider position", async () => {
    useFake({ ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(3 * 60_000) } });
    const res = await request(app).get("/api/driver/state").set(DRIVER());
    expect(res.body.active_ride.rider_location).toBeNull();
  });

  test("omits it once the trip has started", async () => {
    useFake({ status: "in_progress", ride: { rider_live_lat: 36.1, rider_live_lng: -86.7, rider_live_at: ago(5_000) } });
    const res = await request(app).get("/api/driver/state").set(DRIVER());
    expect(res.body.active_ride.rider_location).toBeNull();
  });
});

describe("purge sweep", () => {
  test("deletes positions past pickup or long idle, keeps current ones", async () => {
    currentFake = createFakeSupabase(
      {
        rides: [
          makeRide({ id: "R_KEEP", status: "driver_enroute", rider_live_lat: 1, rider_live_lng: 1, rider_live_at: ago(30_000) }),
          makeRide({ id: "R_TRIP", status: "in_progress", rider_live_lat: 1, rider_live_lng: 1, rider_live_at: ago(30_000) }),
          makeRide({ id: "R_IDLE", status: "arrived", rider_live_lat: 1, rider_live_lng: 1, rider_live_at: ago(11 * 60_000) }),
          makeRide({ id: "R_NONE", status: "completed" })
        ]
      },
      { columns: LIVE_COLUMNS }
    );
    const purged = await purgeRiderLocations();
    expect(purged.sort()).toEqual(["R_IDLE", "R_TRIP"]);
    const byId = (id) => currentFake._state.rides.find((r) => r.id === id);
    expect(byId("R_KEEP").rider_live_lat).toBe(1);
    expect(byId("R_TRIP")).toMatchObject({ rider_live_lat: null, rider_live_at: null });
    expect(byId("R_IDLE")).toMatchObject({ rider_live_lat: null, rider_live_at: null });
  });
});
