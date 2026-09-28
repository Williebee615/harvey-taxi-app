// Composition/integration tests for dispatchRide()/findAvailableDrivers()
// as rewired around the hardened dispatch_ride_atomic()/nearest_drivers()
// contract: busy-driver exclusion, the candidate-loop outcome branching
// (created / driver_no_longer_available / genuine RPC error), and the
// two-step fallback's own current_driver_id-bug fix.
//
// The fake Supabase client has no real dispatch_ride_atomic
// implementation -- by default (see test/fakeSupabase.js) it reports the
// RPC as errored, which is itself the honest "RPC unavailable" case and
// exercises the two-step fallback. Tests that care about the RPC's own
// outcome branching override mockSupabaseClient.rpc directly per test.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function defaultRpc(name) {
  if (name === "dispatch_ride_atomic") {
    return Promise.resolve({
      data: null,
      error: { message: "dispatch_ride_atomic is not implemented in the test fake" }
    });
  }

  return Promise.resolve({ data: null, error: null });
}

function resetState(seed) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  for (const table of Object.keys(seed)) {
    state[table] = seed[table].map((row) => ({ ...row }));
  }
  mockSupabaseClient.rpc = defaultRpc;
}

const RIDER = makeRider({ id: "RIDER_1" });

beforeEach(() => {
  resetState({
    riders: [RIDER],
    drivers: [],
    rides: [],
    driver_offers: []
  });
});

const TRIP_BODY = {
  pickup: "100 Main St",
  destination: "200 Elm St",
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  destination_lat: 36.17,
  destination_lng: -86.79,
  ride_type: "standard"
};

async function requestRide(riderId = RIDER.id) {
  const estimate = await request(app)
    .post("/api/rides/estimate")
    .send({ miles: 5, minutes: 12, ...TRIP_BODY, rider_id: riderId });

  return request(app)
    .post("/api/rides/request")
    .send({ ...TRIP_BODY, rider_id: riderId, estimate_token: estimate.body.estimate_token });
}

describe("findAvailableDrivers() Node fallback -- busy-driver exclusion", () => {
  test("a driver already on an active ride is never offered a second one", async () => {
    const busyDriver = makeDriver({ id: "DRIVER_BUSY", current_lat: 36.16, current_lng: -86.78 });
    const freeDriver = makeDriver({
      id: "DRIVER_FREE",
      email: "free@example.test",
      phone: "+16155550299",
      current_lat: 36.16,
      current_lng: -86.78
    });

    mockSupabaseClient._state.drivers = [busyDriver, freeDriver];
    mockSupabaseClient._state.rides = [
      {
        id: "EXISTING_RIDE",
        driver_id: "DRIVER_BUSY",
        status: "in_progress",
        rider_id: "SOMEONE_ELSE"
      }
    ];

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.driver.id).toBe("DRIVER_FREE");
  });

  test("no eligible drivers (all busy) results in no_drivers_available, not an offer to a busy driver", async () => {
    const busyDriver = makeDriver({ id: "DRIVER_BUSY", current_lat: 36.16, current_lng: -86.78 });

    mockSupabaseClient._state.drivers = [busyDriver];
    mockSupabaseClient._state.rides = [
      { id: "EXISTING_RIDE", driver_id: "DRIVER_BUSY", status: "driver_enroute", rider_id: "SOMEONE_ELSE" }
    ];

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(false);

    const newRide = mockSupabaseClient._state.rides.find((r) => r.id === res.body.ride.id);
    expect(newRide.status).toBe("failed");
    expect(newRide.dispatch_status).toBe("no_drivers_available");
  });
});

describe("dispatchRide() -- two-step fallback (RPC genuinely unavailable)", () => {
  test("creates a real offer and correctly updates the ride, writing no nonexistent rides columns", async () => {
    const driver = makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78 });
    mockSupabaseClient._state.drivers = [driver];
    // default rpc() already reports dispatch_ride_atomic as unavailable.

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.atomic).toBeUndefined();

    const newRide = mockSupabaseClient._state.rides.find((r) => r.id === res.body.ride.id);
    expect(newRide.status).toBe("awaiting_driver_acceptance");
    expect(newRide.dispatch_status).toBe("offer_sent");
    expect(newRide.dispatch_attempts).toBe(1);
    // Neither column exists on the live rides table; the offer lives on
    // driver_offers, and an offered driver is not an assigned driver.
    expect(newRide).not.toHaveProperty("current_offer_id");
    expect(newRide).not.toHaveProperty("current_driver_id");
    expect(newRide.driver_id ?? null).toBeNull();

    const offers = mockSupabaseClient._state.driver_offers.filter((o) => o.ride_id === newRide.id);
    expect(offers).toHaveLength(1);
    expect(offers[0].driver_id).toBe("DRIVER_1");
  });
});

describe("dispatchRide() -- atomic RPC candidate-loop outcome branching", () => {
  test("a driver_no_longer_available outcome for the first candidate tries the next one instead of falling back", async () => {
    const declinedDriver = makeDriver({ id: "DRIVER_DECLINED", current_lat: 36.16, current_lng: -86.78 });
    const acceptedDriver = makeDriver({
      id: "DRIVER_ACCEPTED",
      email: "accepted@example.test",
      phone: "+16155550298",
      current_lat: 36.16,
      current_lng: -86.78
    });

    mockSupabaseClient._state.drivers = [declinedDriver, acceptedDriver];

    const calls = [];
    mockSupabaseClient.rpc = (name, params) => {
      if (name !== "dispatch_ride_atomic") return defaultRpc(name);

      calls.push(params.p_driver_id);

      if (params.p_driver_id === "DRIVER_DECLINED") {
        return Promise.resolve({ data: [{ offer_id: null, outcome: "driver_no_longer_available" }], error: null });
      }

      return Promise.resolve({ data: [{ offer_id: "OFFER-TEST-1", outcome: "created" }], error: null });
    };

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(true);
    expect(res.body.dispatch.atomic).toBe(true);
    expect(res.body.dispatch.driver.id).toBe("DRIVER_ACCEPTED");
    // Both candidates were actually tried through the RPC, in order.
    expect(calls).toEqual(["DRIVER_DECLINED", "DRIVER_ACCEPTED"]);
  });

  test("every candidate declined (RPC working, all ineligible) results in no_drivers_available, not the two-step fallback", async () => {
    const driver = makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78 });
    mockSupabaseClient._state.drivers = [driver];

    mockSupabaseClient.rpc = (name) => {
      if (name !== "dispatch_ride_atomic") return defaultRpc(name);
      return Promise.resolve({ data: [{ offer_id: null, outcome: "driver_no_longer_available" }], error: null });
    };

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.dispatched).toBe(false);

    const newRide = mockSupabaseClient._state.rides.find((r) => r.id === res.body.ride.id);
    expect(newRide.status).toBe("failed");
    expect(newRide.dispatch_status).toBe("no_drivers_available");
    // No fallback offer was created for the declined driver.
    expect(mockSupabaseClient._state.driver_offers).toHaveLength(0);
  });

  test("a real RPC success (outcome=created) is used directly, no fallback offer duplicated", async () => {
    const driver = makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78 });
    mockSupabaseClient._state.drivers = [driver];

    mockSupabaseClient.rpc = (name) => {
      if (name !== "dispatch_ride_atomic") return defaultRpc(name);
      return Promise.resolve({ data: [{ offer_id: "OFFER-TEST-2", outcome: "created" }], error: null });
    };

    const res = await requestRide();

    expect(res.status).toBe(201);
    expect(res.body.dispatch.atomic).toBe(true);
    expect(res.body.dispatch.offer.id).toBe("OFFER-TEST-2");
    // The atomic path doesn't touch driver_offers itself in this test
    // fake (that write happens inside the real Postgres function) -- the
    // two-step fallback's own insert must not ALSO have run.
    expect(mockSupabaseClient._state.driver_offers).toHaveLength(0);
  });

  test.each(["ride_has_live_offer", "ride_not_dispatchable", "ride_not_found"])(
    "a ride-level %s outcome stops dispatch: no next candidate, no fallback offer, ride untouched",
    async (outcome) => {
      mockSupabaseClient._state.drivers = [
        makeDriver({ id: "DRIVER_1", current_lat: 36.16, current_lng: -86.78 }),
        makeDriver({ id: "DRIVER_2", email: "d2@example.test", current_lat: 36.16, current_lng: -86.78 })
      ];
      const calls = [];

      mockSupabaseClient.rpc = (name, params) => {
        if (name !== "dispatch_ride_atomic") return defaultRpc(name);
        calls.push(params.p_driver_id);
        return Promise.resolve({ data: [{ offer_id: null, outcome }], error: null });
      };

      const res = await requestRide();

      expect(res.status).toBe(201);
      expect(res.body.dispatch).toMatchObject({ dispatched: false, reason: outcome });
      expect(calls).toHaveLength(1);
      expect(mockSupabaseClient._state.driver_offers).toHaveLength(0);
      const ride = mockSupabaseClient._state.rides.find((r) => r.id === res.body.ride.id);
      expect(ride.status).not.toBe("failed");
    }
  );
});
