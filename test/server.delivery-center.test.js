// Delivery Center separation (server side). All data is test fixtures.
//  - Food and grocery deliveries are offered only to drivers set up for
//    that delivery type; passenger rides keep the existing eligibility.
//  - Offer push titles name deliveries as deliveries.
//  - The recipient's delivery PIN never reaches a driver (missions,
//    history, ride status).
//  - A rider with an active ride and an active delivery sees each in its
//    own list; another rider sees neither.
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
const { offerPushTitle, pushKindForTitle } = require("../lib/driverApp");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let app;

const RIDER = makeRider({ id: "RIDER_1" });
const OTHER_RIDER = makeRider({ id: "RIDER_2", email: "o@example.test", phone: "+16155550199" });

function driverAt(id, n, extra = {}) {
  return makeDriver({
    id,
    email: `${id.toLowerCase()}@example.test`,
    phone: `+1615555${String(1000 + n)}`,
    current_lat: 36.16,
    current_lng: -86.78,
    last_seen_at: new Date().toISOString(),
    ...extra
  });
}

function reset(seed = {}) {
  const s = mockSupabaseClient._state;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, {
    riders: [{ ...RIDER }, { ...OTHER_RIDER }],
    drivers: [],
    rides: [],
    driver_offers: [],
    audit_logs: [],
    system_flags: [{ key: "rider_history_enabled", value: "true" }],
    ...seed
  });
  mockSupabaseClient.rpc = (name) =>
    Promise.resolve(
      name === "dispatch_ride_atomic"
        ? { data: null, error: { message: "not implemented in the fake" } }
        : { data: null, error: null }
    );
}

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const TRIP = {
  pickup: "TEST Merchant, 100 Main St",
  destination: "TEST Customer, 200 Elm St",
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  destination_lat: 36.17,
  destination_lng: -86.79
};

async function requestService(rideType) {
  const body = { ...TRIP, ride_type: rideType, rider_id: RIDER.id };
  const estimate = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...body });
  return request(app).post("/api/rides/request").send({ ...body, estimate_token: estimate.body.estimate_token });
}

describe("dispatch: deliveries reach eligible delivery drivers", () => {
  test("a food delivery skips a driver not set up for food and goes to one who is", async () => {
    reset({ drivers: [driverAt("DRIVER_NOFOOD", 1, { supports_food_delivery: false }), driverAt("DRIVER_FOOD", 2, { supports_food_delivery: true })] });
    const res = await requestService("food");
    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.driver.id).toBe("DRIVER_FOOD");
    const offered = mockSupabaseClient._state.driver_offers.map((o) => o.driver_id);
    expect(offered).toEqual(["DRIVER_FOOD"]);
  });

  test("a grocery delivery checks the grocery flag (the food flag does not matter)", async () => {
    reset({
      drivers: [
        driverAt("DRIVER_NOGROCERY", 1, { supports_grocery_delivery: false, supports_food_delivery: true }),
        driverAt("DRIVER_GROCERY", 2, { supports_grocery_delivery: true, supports_food_delivery: false })
      ]
    });
    const res = await requestService("grocery");
    expect(res.body.dispatch.driver.id).toBe("DRIVER_GROCERY");
  });

  test("no driver set up for that delivery: no offer is sent to an ineligible driver", async () => {
    reset({ drivers: [driverAt("DRIVER_NOFOOD", 1, { supports_food_delivery: false })] });
    const res = await requestService("food");
    expect(res.body.dispatch.dispatched).toBe(false);
    expect(mockSupabaseClient._state.driver_offers).toEqual([]);
  });

  test("a driver with the flag unset stays eligible, as before", async () => {
    reset({ drivers: [driverAt("DRIVER_UNSET", 1, { supports_food_delivery: null })] });
    const res = await requestService("food");
    expect(res.body.dispatch.driver.id).toBe("DRIVER_UNSET");
  });

  test("passenger rides are unchanged: delivery flags are not checked", async () => {
    reset({ drivers: [driverAt("DRIVER_RIDES_ONLY", 1, { supports_food_delivery: false, supports_grocery_delivery: false })] });
    const res = await requestService("standard");
    expect(res.body.dispatch.driver.id).toBe("DRIVER_RIDES_ONLY");
  });
});

describe("dispatch: eligibility is checked before the nearest-driver limit", () => {
  // nearest_drivers() returns drivers nearest first. Six ineligible drivers
  // are nearer than the one eligible driver; dispatch reads at most 5
  // candidates (MAX_DISPATCH_ATTEMPTS), so a filter applied after that cut
  // would never reach the eligible one.
  function nearestRpc(ordered, seen) {
    return (name, args) => {
      if (name === "nearest_drivers") {
        seen.push(args);
        return Promise.resolve({ data: ordered.slice(0, args.p_limit).map((d, i) => ({ ...d, distance_miles: i + 1 })), error: null });
      }
      if (name === "dispatch_ride_atomic") return Promise.resolve({ data: null, error: { message: "not implemented in the fake" } });
      return Promise.resolve({ data: null, error: null });
    };
  }

  test("database search: the nearest drivers are ineligible, a farther eligible driver gets the offer", async () => {
    const near = Array.from({ length: 6 }, (_, i) => driverAt(`DRIVER_NEAR_${i}`, 10 + i, { supports_food_delivery: false }));
    const far = driverAt("DRIVER_FAR_FOOD", 30, { supports_food_delivery: true });
    reset({ drivers: [...near, far] });
    const seen = [];
    mockSupabaseClient.rpc = nearestRpc([...near, far], seen);

    const res = await requestService("food");
    expect(res.status).toBe(201);
    expect(res.body.dispatch.driver.id).toBe("DRIVER_FAR_FOOD");
    expect(mockSupabaseClient._state.driver_offers.map((o) => o.driver_id)).toEqual(["DRIVER_FAR_FOOD"]);
    // The candidate pool for a delivery is wider than the offer limit.
    expect(seen[0].p_limit).toBeGreaterThanOrEqual(200);
  });

  test("database search for a passenger ride keeps the original pool size", async () => {
    const drivers = [driverAt("DRIVER_A", 1, { supports_food_delivery: false })];
    reset({ drivers });
    const seen = [];
    mockSupabaseClient.rpc = nearestRpc(drivers, seen);
    const res = await requestService("standard");
    expect(res.body.dispatch.driver.id).toBe("DRIVER_A");
    expect(seen[0].p_limit).toBeLessThan(200);
  });

  test("fallback search: 55 ineligible online drivers do not crowd out the eligible one", async () => {
    const ineligible = Array.from({ length: 55 }, (_, i) => driverAt(`DRIVER_X_${i}`, 100 + i, { supports_food_delivery: false }));
    const eligible = driverAt("DRIVER_OK", 400, { supports_food_delivery: true, current_lat: 36.2, current_lng: -86.8 });
    reset({ drivers: [...ineligible, eligible] });
    const res = await requestService("food");
    expect(res.body.dispatch.driver.id).toBe("DRIVER_OK");
  });
});

describe("admin assignment enforces delivery eligibility", () => {
  const assign = (rideId, driverId) =>
    request(app)
      .post(`/api/admin/rides/${rideId}/assign-driver`)
      .set("x-admin-token", process.env.ADMIN_API_TOKEN)
      .set("x-admin-email", "ops@example.test")
      .send({ driver_id: driverId });

  beforeEach(() => {
    reset({
      drivers: [
        driverAt("DRIVER_NOFOOD", 1, { supports_food_delivery: false, supports_grocery_delivery: true }),
        driverAt("DRIVER_FOOD", 2, { supports_food_delivery: true, supports_grocery_delivery: false }),
        driverAt("DRIVER_UNSET", 3, { supports_food_delivery: null })
      ],
      rides: [
        makeRide({ id: "TEST-FOOD", rider_id: "RIDER_1", status: "awaiting_driver_acceptance", ride_type: "food", driver_id: null }),
        makeRide({ id: "TEST-GROCERY", rider_id: "RIDER_1", status: "awaiting_driver_acceptance", ride_type: "grocery", driver_id: null }),
        makeRide({ id: "TEST-RIDE", rider_id: "RIDER_1", status: "awaiting_driver_acceptance", ride_type: "standard", driver_id: null })
      ]
    });
  });

  const ride = (id) => mockSupabaseClient._state.rides.find((r) => r.id === id);

  test("an ineligible driver is refused and the ride is unchanged", async () => {
    const food = await assign("TEST-FOOD", "DRIVER_NOFOOD");
    expect(food.status).toBe(409);
    expect(food.body.error).toBe("This driver is not set up for food deliveries.");
    expect(ride("TEST-FOOD")).toMatchObject({ status: "awaiting_driver_acceptance", driver_id: null });

    const grocery = await assign("TEST-GROCERY", "DRIVER_FOOD");
    expect(grocery.status).toBe(409);
    expect(grocery.body.error).toBe("This driver is not set up for grocery deliveries.");
    expect(ride("TEST-GROCERY").driver_id).toBe(null);
  });

  test("eligible and unset drivers can be assigned; passenger rides are unchanged", async () => {
    expect((await assign("TEST-FOOD", "DRIVER_FOOD")).status).toBe(200);
    expect(ride("TEST-FOOD")).toMatchObject({ status: "driver_assigned", driver_id: "DRIVER_FOOD" });
    expect((await assign("TEST-GROCERY", "DRIVER_UNSET")).status).toBe(200);
    expect((await assign("TEST-RIDE", "DRIVER_NOFOOD")).status).toBe(200);
    expect(ride("TEST-RIDE").driver_id).toBe("DRIVER_NOFOOD");
  });

  test("an unknown ride is still not found", async () => {
    expect((await assign("TEST-NOPE", "DRIVER_FOOD")).status).toBe(404);
  });
});

describe("offer push titles", () => {
  test("deliveries are named as deliveries and keep offer priority", () => {
    expect(offerPushTitle({ ride_type: "food" })).toBe("New Delivery Request · Food");
    expect(offerPushTitle({ ride_type: "grocery" })).toBe("New Delivery Request · Grocery");
    expect(offerPushTitle({ ride_type: "standard" })).toBe("New Ride Request");
    expect(offerPushTitle(null)).toBe("New Ride Request");
    for (const t of ["food", "grocery", "standard"]) {
      expect(pushKindForTitle(offerPushTitle({ ride_type: t }))).toBe("ride_offer");
    }
  });
});

describe("the recipient's delivery PIN never reaches the driver", () => {
  beforeEach(() => {
    reset({
      drivers: [driverAt("DRIVER_1", 1)],
      rides: [
        makeRide({ id: "TEST-DELIVERY-ACTIVE", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "driver_enroute", ride_type: "food", delivery_pin: "4321" }),
        makeRide({ id: "TEST-DELIVERY-DONE", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "completed", ride_type: "grocery", delivery_pin: "8765", completed_at: new Date().toISOString() })
      ]
    });
  });

  test("missions, history and ride status omit the PIN; the rider still sees it", async () => {
    const driver = driverAuthHeaders(signTestDriverToken("DRIVER_1"));
    const missions = await request(app).get("/api/driver/DRIVER_1/missions").set(driver);
    expect(missions.status).toBe(200);
    expect(missions.body.missions.map((m) => m.id)).toEqual(["TEST-DELIVERY-ACTIVE"]);
    const history = await request(app).get("/api/driver/DRIVER_1/history").set(driver);
    expect(history.status).toBe(200);
    expect(history.body.history.map((m) => m.id)).toEqual(["TEST-DELIVERY-DONE"]);
    const status = await request(app).get("/api/rides/TEST-DELIVERY-ACTIVE/status").set(driver);
    expect(status.status).toBe(200);
    for (const res of [missions, history, status]) {
      expect(JSON.stringify(res.body)).not.toMatch(/delivery_pin|4321|8765/);
    }
    // Stored PINs are unchanged (handoff still checks them server-side).
    expect(mockSupabaseClient._state.rides.map((r) => r.delivery_pin)).toEqual(["4321", "8765"]);

    const rider = await request(app).get("/api/rides/TEST-DELIVERY-ACTIVE/status").set(riderAuthHeaders(signTestRiderToken("RIDER_1")));
    expect(rider.status).toBe(200);
    expect(rider.body.delivery.pin).toBe("4321");
  });
});

describe("a rider with an active ride and an active delivery", () => {
  beforeEach(() => {
    reset({
      drivers: [driverAt("DRIVER_1", 1), driverAt("DRIVER_2", 2)],
      rides: [
        makeRide({ id: "TEST-RIDE-ACTIVE", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "driver_enroute", ride_type: "standard" }),
        makeRide({ id: "TEST-DELIVERY-ACTIVE", rider_id: "RIDER_1", driver_id: "DRIVER_2", status: "driver_enroute", ride_type: "food", delivery_pin: "4321" })
      ]
    });
  });

  test("each appears only in its own list, and each status is available", async () => {
    const headers = riderAuthHeaders(signTestRiderToken("RIDER_1"));
    const rides = await request(app).get("/api/rider/rides?riderId=RIDER_1&status=active").set(headers);
    const deliveries = await request(app).get("/api/rider/deliveries?riderId=RIDER_1&status=active").set(headers);
    expect(rides.status).toBe(200);
    expect(deliveries.status).toBe(200);
    expect(rides.body.rides.map((r) => r.id)).toEqual(["TEST-RIDE-ACTIVE"]);
    expect(deliveries.body.deliveries.map((r) => r.id)).toEqual(["TEST-DELIVERY-ACTIVE"]);

    const rideStatus = await request(app).get("/api/rides/TEST-RIDE-ACTIVE/status").set(headers);
    const deliveryStatus = await request(app).get("/api/rides/TEST-DELIVERY-ACTIVE/status").set(headers);
    expect([rideStatus.status, rideStatus.body.ride_type]).toEqual([200, "standard"]);
    expect([deliveryStatus.status, deliveryStatus.body.ride_type]).toEqual([200, "food"]);
  });

  test("another rider can see neither", async () => {
    const other = riderAuthHeaders(signTestRiderToken("RIDER_2"));
    for (const id of ["TEST-RIDE-ACTIVE", "TEST-DELIVERY-ACTIVE"]) {
      const res = await request(app).get(`/api/rides/${id}/status`).set(other);
      expect([id, res.status]).toEqual([id, 404]);
      expect(JSON.stringify(res.body)).not.toMatch(/4321/);
    }
    const rides = await request(app).get("/api/rider/rides?riderId=RIDER_2&status=active").set(other);
    const deliveries = await request(app).get("/api/rider/deliveries?riderId=RIDER_2&status=active").set(other);
    expect(rides.body.rides).toEqual([]);
    expect(deliveries.body.deliveries).toEqual([]);
  });
});
