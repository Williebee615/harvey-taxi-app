// Regression tests for the production dispatch hotfix on the three
// ride-assignment write paths in server.js:
//
//   POST /api/driver/offers/:offerId/accept
//   POST /api/driver/offers/:offerId/decline
//   POST /api/admin/rides/:id/assign-driver
//
// Root cause of the outage: all three wrote current_driver_id and/or
// current_offer_id to public.rides. Neither column exists in the live
// schema, so PostgREST rejected every one of those updates -- but the
// accept route never looked at the update's error and returned 200
// anyway, telling the driver the ride was theirs while the ride row was
// never assigned.
//
// These tests run the real Express routes over HTTP (supertest) with only
// Supabase replaced by the in-memory fake in test/fakeSupabase.js. The
// fake is given the live rides/driver_offers column lists, so any write
// to a column that doesn't exist fails here exactly as it does in
// production. Central property under test: a failed ride update can
// never produce a 200, a rider notification, or an SSE success event.

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
process.env.MAX_DISPATCH_ATTEMPTS = "5";

const crypto = require("crypto");
const http = require("http");
const { createFakeSupabase } = require("./fakeSupabase");

// Column lists copied from information_schema.columns on the live
// project's public.rides / public.driver_offers. Note: no
// current_driver_id and no current_offer_id.
const LIVE_COLUMNS = {
  rides: (
    "id,rider_id,rider_name,rider_phone,driver_id,driver_name,driver_phone,driver_vehicle," +
    "pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,ride_type," +
    "payment_method,distance_miles,duration_minutes,distance_text,duration_text,estimated_fare," +
    "estimated_driver_payout,estimated_platform_fee,surge_multiplier,fare_config,final_tip," +
    "final_fare,final_driver_payout,final_platform_fee,status,driver_eta_to_pickup_minutes," +
    "driver_eta_to_pickup_text,driver_distance_to_pickup_miles,driver_distance_to_pickup_text," +
    "requested_at,search_started_at,search_restarted_at,mission_sent_at,driver_accepted_at," +
    "driver_arrived_at,trip_started_at,trip_in_progress_at,trip_completed_at,payment_processed_at," +
    "cancelled_at,cancellation_reason,created_at,updated_at,requested_mode,autonomous_vehicle_name," +
    "accepted_at,started_at,completed_at,cancel_reason,notes,scheduled_time,ride_status," +
    "dispatch_status,current_dispatch_id,dispatch_lock_until,last_dispatch_at,assigned_at," +
    "arrived_at,tip_amount,payment_id,assigned_driver_id,cancelled_by,public_code," +
    "estimated_distance_miles,estimated_duration_minutes,pricing_snapshot,payment_status," +
    "en_route_at,cancelled_by_type,cancelled_by_id,driver_payout,platform_revenue,mission_id," +
    "dispatch_id,service_type,miles_estimate,minutes_estimate,fare_total,fare_snapshot," +
    "route_snapshot,current_mission_id,dispatch_attempts,canceled_at,canceled_by,enroute_at," +
    "payment_captured,admin_note,assigned_by_admin,htaf_application_id,delivery_stage," +
    "delivery_pin,merchant_name,item_count,pickup_instructions,delivery_instructions," +
    "delivered_at,delivery_handoff,delivery_proof_url,dispatch_claimed_at,autonomous_pilot," +
    "pilot_status,pilot_zone_id,pilot_provider,pilot_vehicle_id,remote_supervision_status," +
    "human_fallback_allowed,human_fallback_reason,pilot_consent_at,pilot_disclosure_version," +
    "boarding_confirmed_at,is_review_ride"
  ).split(","),
  driver_offers:
    "id,ride_id,driver_id,status,attempt,decline_reason,responded_at,expires_at,created_at,updated_at".split(
      ","
    )
};

const DRIVER = {
  id: "DRV-TEST0001",
  email: "driver@example.test",
  first_name: "Dana",
  last_name: "Driver",
  phone: "+15555550100",
  vehicle_year: 2022,
  vehicle_make: "Toyota",
  vehicle_model: "Camry",
  access_revoked: false,
  is_review_account: false,
  online: true,
  status: "active",
  approval_status: "approved"
};

const RIDER = { id: "RIDER-TEST0001", email: "rider@example.test" };

function fixture({ dispatchAttempts = 1 } = {}) {
  return {
    drivers: [DRIVER],
    riders: [RIDER],
    rides: [
      {
        id: "RIDE-TEST0001",
        rider_id: RIDER.id,
        status: "awaiting_driver_acceptance",
        dispatch_status: "offer_sent",
        dispatch_attempts: dispatchAttempts,
        driver_id: null,
        pickup_address: "1 Main St"
      }
    ],
    driver_offers: [
      {
        id: "OFFER-TEST0001",
        ride_id: "RIDE-TEST0001",
        driver_id: DRIVER.id,
        status: "pending",
        attempt: 1,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      }
    ],
    system_flags: [{ key: "review_account_login_enabled", value: "false" }]
  };
}

const DB_ERROR = { code: "XX000", message: "simulated database failure" };

// server.js captures its Supabase client once, at require time, so the
// mock handed to it forwards every call to whichever fake the current
// test installed via useFake().
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

function useFake(seed, options = {}) {
  currentFake = createFakeSupabase(seed, { columns: LIVE_COLUMNS, ...options });
  currentFake.rpc = jest.fn(async () => ({ data: null, error: null }));
  return currentFake;
}

// Same token format as signDriverSession() in server.js.
function driverToken(driverId) {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "harvey-driver", driver_id: driverId, iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.DRIVER_SESSION_SECRET)
    .update(encoded)
    .digest("hex");
  return `${encoded}.${sig}`;
}

const request = require("supertest");

let app;
let server;
let baseUrl;
const openStreams = [];

beforeAll(async () => {
  currentFake = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  while (openStreams.length) openStreams.pop().destroy();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Opens the real rider-facing SSE stream for a ride and collects every
// event name it receives, so a test can assert whether a "stage" success
// event was broadcast.
function subscribeRideStream(rideId) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${baseUrl}/api/rides/${rideId}/stream`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        for (const match of chunk.matchAll(/^event: (\S+)$/gm)) events.push(match[1]);
        if (events.includes("connected")) resolve({ events });
      });
    });
    req.on("error", (err) => {
      if (err.code !== "ECONNRESET") reject(err);
    });
    openStreams.push(req);
  });
}

// notifyRideStage() and friends are fire-and-forget; let them run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function ridesUpdates(fake) {
  return fake._log.filter((e) => e.table === "rides" && e.op === "update");
}

// notifyRideStage() looks up the rider's email as its first database
// read, so a riders select is the observable signal that a rider
// notification was sent.
function riderNotified(fake) {
  return fake._log.some((e) => e.table === "riders" && e.op === "select");
}

function acceptOffer() {
  return request(server)
    .post("/api/driver/offers/OFFER-TEST0001/accept")
    .set("x-driver-token", driverToken(DRIVER.id))
    .send({});
}

function declineOffer() {
  return request(server)
    .post("/api/driver/offers/OFFER-TEST0001/decline")
    .set("x-driver-token", driverToken(DRIVER.id))
    .send({ reason: "too far" });
}

function adminAssign(rideId = "RIDE-TEST0001") {
  return request(server)
    .post(`/api/admin/rides/${rideId}/assign-driver`)
    .set("x-admin-token", process.env.ADMIN_API_TOKEN)
    .set("x-admin-email", "ops@example.test")
    .send({ driver_id: DRIVER.id });
}

describe("POST /api/driver/offers/:offerId/accept", () => {
  test("assigns the ride via rides.driver_id against the live schema and only then notifies", async () => {
    const fake = useFake(fixture());
    const stream = await subscribeRideStream("RIDE-TEST0001");

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ride_id: "RIDE-TEST0001", driver_id: DRIVER.id });

    const ride = fake._state.rides[0];
    expect(ride.driver_id).toBe(DRIVER.id);
    expect(ride.status).toBe("driver_assigned");
    expect(ride.dispatch_status).toBe("accepted");
    expect(fake._state.driver_offers[0].status).toBe("accepted");

    for (const { patch } of ridesUpdates(fake)) {
      expect(patch).not.toHaveProperty("current_driver_id");
      expect(patch).not.toHaveProperty("current_offer_id");
    }

    expect(riderNotified(fake)).toBe(true);
    expect(stream.events).toContain("stage");
  });

  test("a failed ride update returns 500, reverts the offer, and sends no notification or SSE event", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });
    const stream = await subscribeRideStream("RIDE-TEST0001");

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);

    expect(fake._state.rides[0].driver_id).toBeNull();
    expect(fake._state.rides[0].status).toBe("awaiting_driver_acceptance");
    expect(fake._state.driver_offers[0].status).toBe("pending");

    expect(riderNotified(fake)).toBe(false);
    expect(stream.events).not.toContain("stage");
  });

  test("a ride update that matches no row returns 500, not 200", async () => {
    const seed = fixture();
    seed.driver_offers[0].ride_id = "RIDE-DOES-NOT-EXIST";
    const fake = useFake(seed);

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(fake._state.driver_offers[0].status).toBe("pending");
    expect(riderNotified(fake)).toBe(false);
  });

  test("a failed offer update returns 500 and never touches the ride", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "driver_offers" ? DB_ERROR : null)
    });

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(ridesUpdates(fake)).toHaveLength(0);
    expect(riderNotified(fake)).toBe(false);
  });
});

describe("POST /api/driver/offers/:offerId/decline", () => {
  test("a failed redispatch update returns 500 and does not redispatch", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 1 }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake._log.some((e) => e.table === "driver_offers" && e.op === "insert")).toBe(false);
  });

  test("a failed max-attempts update returns 500", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 5 }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(fake._state.rides[0].status).toBe("awaiting_driver_acceptance");
  });

  test("the max-attempts path succeeds against the live schema", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 5 }));

    const res = await declineOffer();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, declined: true });
    expect(fake._state.rides[0].dispatch_status).toBe("max_attempts_reached");
    expect(fake._state.driver_offers[0].status).toBe("declined");
  });

  test("the redispatch ride update no longer writes nonexistent columns", async () => {
    // Fail only the *second* rides write (inside dispatchRide) so this test
    // isolates the decline route's own redispatch update: it must be
    // accepted by the live-schema column check.
    let ridesWrites = 0;
    const fake = useFake(fixture({ dispatchAttempts: 1 }), {
      failUpdate: (table) => (table === "rides" && ++ridesWrites > 1 ? DB_ERROR : null)
    });

    await declineOffer();

    const [firstUpdate] = ridesUpdates(fake);
    expect(firstUpdate.patch).toMatchObject({ dispatch_status: "redispatching", dispatch_attempts: 2 });
    expect(firstUpdate.patch).not.toHaveProperty("current_driver_id");
    expect(firstUpdate.patch).not.toHaveProperty("current_offer_id");
    expect(fake._state.rides[0].dispatch_status).toBe("redispatching");
  });

  test("a failed offer update returns 500 and never touches the ride", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "driver_offers" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(ridesUpdates(fake)).toHaveLength(0);
  });
});

describe("POST /api/admin/rides/:id/assign-driver", () => {
  test("assigns the ride via rides.driver_id against the live schema", async () => {
    const fake = useFake(fixture());
    const stream = await subscribeRideStream("RIDE-TEST0001");

    const res = await adminAssign();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ride.driver_id).toBe(DRIVER.id);

    const ride = fake._state.rides[0];
    expect(ride.driver_id).toBe(DRIVER.id);
    expect(ride.status).toBe("driver_assigned");
    expect(ride.dispatch_status).toBe("admin_assigned");
    expect(ridesUpdates(fake)[0].patch).not.toHaveProperty("current_driver_id");

    expect(riderNotified(fake)).toBe(true);
    expect(stream.events).toContain("stage");
  });

  test("a failed ride update returns 500 and sends no notification or SSE event", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });
    const stream = await subscribeRideStream("RIDE-TEST0001");

    const res = await adminAssign();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).not.toBe(true);
    expect(fake._state.rides[0].driver_id).toBeNull();
    expect(riderNotified(fake)).toBe(false);
    expect(stream.events).not.toContain("stage");
  });

  test("an unknown ride returns 404, not 200", async () => {
    const fake = useFake(fixture());

    const res = await adminAssign("RIDE-DOES-NOT-EXIST");
    await settle();

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(riderNotified(fake)).toBe(false);
  });
});
