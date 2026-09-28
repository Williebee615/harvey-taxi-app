// Regression tests for the production dispatch hotfix on every
// ride-assignment write path in server.js:
//
//   POST /api/driver/offers/:offerId/accept
//   POST /api/driver/offers/:offerId/decline
//   POST /api/admin/rides/:id/assign-driver
//   dispatchRide()'s two-step fallback (reached via decline redispatch)
//   the offer-expiry sweep's ride adapters (runOfferExpirySweep)
//   GET /api/admin/rides (read side)
//
// Root cause of the outage: these paths wrote current_driver_id and/or
// current_offer_id to public.rides. Neither column exists in the live
// schema, so PostgREST rejected every one of those updates -- but the
// accept route never looked at the update's error and returned 200
// anyway, telling the driver the ride was theirs while the ride row was
// never assigned.
//
// These tests run the real Express routes over HTTP (supertest) with only
// Supabase replaced by the in-memory fake in test/fakeSupabase.js. The
// fake is given the live rides/driver_offers column lists (test/liveSchema.js),
// so any read or write of a column that doesn't exist fails here exactly
// as it does in production. Central property under test: a failed ride update can
// never produce a 200, a rider notification, or an SSE success event.

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.NODE_ENV = "test";
process.env.MAX_DISPATCH_ATTEMPTS = "5";

const crypto = require("crypto");
const http = require("http");
const { createFakeSupabase } = require("./fakeSupabase");

const { LIVE_COLUMNS } = require("./liveSchema");

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

// A second eligible driver, so a redispatch has somewhere real to go.
const OTHER_DRIVER = {
  ...DRIVER,
  id: "DRV-TEST0002",
  email: "other.driver@example.test",
  first_name: "Olu",
  phone: "+15555550101"
};

const RIDER = { id: "RIDER-TEST0001", email: "rider@example.test" };

const RIDE_ID = "RIDE-TEST0001";
const OFFER_ID = "OFFER-TEST0001";

function fixture({ dispatchAttempts = 1, rideOverrides = {}, offerOverrides = {}, sweepEnabled = false } = {}) {
  return {
    drivers: [DRIVER, OTHER_DRIVER],
    riders: [RIDER],
    rides: [
      {
        id: RIDE_ID,
        rider_id: RIDER.id,
        status: "awaiting_driver_acceptance",
        dispatch_status: "offer_sent",
        dispatch_attempts: dispatchAttempts,
        driver_id: null,
        pickup_address: "1 Main St",
        pickup_lat: 36.16,
        pickup_lng: -86.78,
        ...rideOverrides
      }
    ],
    driver_offers: [
      {
        id: OFFER_ID,
        ride_id: RIDE_ID,
        driver_id: DRIVER.id,
        status: "pending",
        attempt: 1,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...offerOverrides
      }
    ],
    audit_logs: [],
    system_flags: [
      { key: "review_account_login_enabled", value: "false" },
      { key: "offer_expiry_sweep_enabled", value: sweepEnabled ? "true" : "false" }
    ]
  };
}

const DB_ERROR = { code: "XX000", message: "simulated database failure" };

// Mirrors production today: the deployed dispatch_ride_atomic() references
// rides.current_driver_id, so every call raises and dispatchRide() falls
// through to its two-step Node fallback.
const LIVE_DISPATCH_RPC_ERROR = {
  code: "42703",
  message: 'record "v_ride" has no field "current_driver_id"'
};

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

const ASSIGNED_RIDE_STATUSES = ["driver_assigned", "driver_enroute", "arrived", "in_progress"];

// In-memory port of public.accept_driver_offer_atomic (migration
// 20260927220400), applied to the fake's state as one step -- the real
// function commits the offer accept, competing-offer supersede and ride
// assignment in a single transaction, so there is no partial state to
// model. Its SQL, locking and concurrency are covered against real
// PostgreSQL in test/db/acceptDriverOfferAtomic.db.test.js; this port
// only lets the HTTP-level regression tests below run the real route.
function acceptDriverOfferAtomic(state, { p_offer_id: offerId, p_driver_id: driverId }) {
  const offers = state.driver_offers || [];
  const rides = state.rides || [];
  const found = offers.find((o) => o.id === offerId);
  if (!found) return [{ outcome: "offer_not_found" }];
  if (found.driver_id !== driverId) return [{ outcome: "not_offer_owner" }];

  const theRide = rides.find((r) => r.id === found.ride_id);

  if (found.status === "accepted") {
    if (theRide && theRide.driver_id === driverId && ASSIGNED_RIDE_STATUSES.includes(theRide.status)) {
      return [
        { outcome: "already_accepted", ride_id: theRide.id, offer_id: found.id, driver_id: driverId, ride_status: theRide.status }
      ];
    }
    return [{ outcome: "offer_not_pending" }];
  }
  if (found.status !== "pending") return [{ outcome: "offer_not_pending" }];
  if (found.expires_at && new Date(found.expires_at).getTime() <= Date.now()) return [{ outcome: "offer_expired" }];
  if (!theRide || theRide.driver_id || !["payment_authorized", "awaiting_driver_acceptance"].includes(theRide.status)) {
    return [{ outcome: "ride_not_assignable" }];
  }

  const driver = (state.drivers || []).find((d) => d.id === driverId);
  const busy =
    rides.some((r) => r.driver_id === driverId && r.id !== theRide.id && ASSIGNED_RIDE_STATUSES.includes(r.status)) ||
    offers.some((o) => {
      if (o.driver_id !== driverId || o.status !== "accepted" || o.ride_id === theRide.id) return false;
      const r = rides.find((x) => x.id === o.ride_id);
      return !!r && !["completed", "cancelled", "failed"].includes(r.status) && (!r.driver_id || r.driver_id === driverId);
    });
  if (!driver || driver.approval_status !== "approved" || driver.access_revoked || busy) {
    return [{ outcome: "driver_unavailable" }];
  }

  const now = new Date().toISOString();
  Object.assign(found, { status: "accepted", responded_at: now, updated_at: now });
  for (const o of offers) {
    if (o.ride_id === theRide.id && o.id !== found.id && o.status === "pending") {
      Object.assign(o, { status: "superseded", updated_at: now });
    }
  }
  Object.assign(theRide, {
    driver_id: driverId,
    status: "driver_assigned",
    dispatch_status: "accepted",
    accepted_at: now,
    driver_name: [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "Driver",
    driver_vehicle: [driver.vehicle_year, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" "),
    driver_phone: driver.phone || null,
    updated_at: now
  });

  return [
    {
      outcome: "accepted",
      ride_id: theRide.id,
      offer_id: found.id,
      driver_id: driverId,
      ride_status: theRide.status,
      rider_id: theRide.rider_id,
      rider_phone: theRide.rider_phone || null,
      ride_type: theRide.ride_type || null,
      is_review_ride: theRide.is_review_ride || false,
      driver_name: theRide.driver_name,
      driver_vehicle: theRide.driver_vehicle,
      driver_phone: theRide.driver_phone
    }
  ];
}

// options.acceptRpcResult: override the accept function's result, e.g.
// { error } for a database failure or { data } for an unexpected outcome.
function useFake(seed, options = {}) {
  const { acceptRpcResult, ...fakeOptions } = options;
  currentFake = createFakeSupabase(seed, { columns: LIVE_COLUMNS, ...fakeOptions });
  const fake = currentFake;
  fake.rpc = jest.fn(async (fn, args) => {
    if (fn === "dispatch_ride_atomic") return { data: null, error: LIVE_DISPATCH_RPC_ERROR };
    if (fn === "accept_driver_offer_atomic") {
      if (acceptRpcResult) return { data: null, error: null, ...acceptRpcResult };
      return { data: acceptDriverOfferAtomic(fake._state, args), error: null };
    }
    return { data: null, error: null };
  });
  return fake;
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
let runOfferExpirySweep;
let server;
let baseUrl;
const openStreams = [];

beforeAll(async () => {
  currentFake = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app, runOfferExpirySweep } = require("../server"));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  while (openStreams.length) openStreams.pop().destroy();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Opens a real SSE stream and collects every event name it receives.
function subscribe(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${baseUrl}${path}`, { headers }, (res) => {
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

// The rider-facing per-ride stream; a "stage" event is the SSE success
// signal these routes emit after a committed assignment.
const subscribeRideStream = (rideId) => subscribe(`/api/rides/${rideId}/stream`);

const subscribeAdminStream = () =>
  subscribe("/api/admin/stream", {
    "x-admin-token": process.env.ADMIN_API_TOKEN,
    "x-admin-email": "ops@example.test"
  });

// notifyRideStage() and friends are fire-and-forget; let them run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function ridesUpdates(fake) {
  return fake._log.filter((e) => e.table === "rides" && e.op === "update");
}

function offerInserts(fake) {
  return fake._log.filter((e) => e.table === "driver_offers" && e.op === "insert");
}

// notifyRideStage() looks up the rider's email as its first database
// read, so a riders select is the observable signal that a rider
// notification was sent.
function riderNotificationCount(fake) {
  return fake._log.filter((e) => e.table === "riders" && e.op === "select").length;
}

const offer = (fake, id = OFFER_ID) => fake._state.driver_offers.find((o) => o.id === id);
const ride = (fake) => fake._state.rides[0];

function acceptOffer(driverId = DRIVER.id, offerId = OFFER_ID) {
  return request(server)
    .post(`/api/driver/offers/${offerId}/accept`)
    .set("x-driver-token", driverToken(driverId))
    .send({});
}

function declineOffer(driverId = DRIVER.id, offerId = OFFER_ID) {
  return request(server)
    .post(`/api/driver/offers/${offerId}/decline`)
    .set("x-driver-token", driverToken(driverId))
    .send({ reason: "too far" });
}

function adminAssign(rideId = RIDE_ID) {
  return request(server)
    .post(`/api/admin/rides/${rideId}/assign-driver`)
    .set("x-admin-token", process.env.ADMIN_API_TOKEN)
    .set("x-admin-email", "ops@example.test")
    .send({ driver_id: DRIVER.id });
}

function expectNoNonexistentColumnWrites(fake) {
  for (const { patch } of ridesUpdates(fake)) {
    expect(patch).not.toHaveProperty("current_driver_id");
    expect(patch).not.toHaveProperty("current_offer_id");
    expect(patch).not.toHaveProperty("assigned_driver_id");
  }
}

// Same token format as signAdminSession() in server.js: a genuine, valid
// admin dashboard session cookie.
function adminSessionCookie() {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email: "ops@example.test", iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.ADMIN_SESSION_SECRET)
    .update(encoded)
    .digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}

describe("offer accept/decline require the driver's own session -- admin credentials never act as a driver", () => {
  const ADMIN_CREDENTIALS = [
    ["x-admin-token header", (r) => r.set("x-admin-token", process.env.ADMIN_API_TOKEN)],
    ["x-harvey-admin-token header", (r) => r.set("x-harvey-admin-token", process.env.ADMIN_API_TOKEN)],
    ["admin session cookie", (r) => r.set("Cookie", [adminSessionCookie()])]
  ];

  test.each(ADMIN_CREDENTIALS)(
    "accept with a valid %s and a body driver_id is rejected and changes nothing",
    async (_label, withAdmin) => {
      const fake = useFake(fixture());

      const res = await withAdmin(request(server).post(`/api/driver/offers/${OFFER_ID}/accept`)).send({
        driver_id: DRIVER.id
      });
      await settle();

      expect([401, 403]).toContain(res.status);
      expect(res.body.ok).toBe(false);
      expect(offer(fake).status).toBe("pending");
      expect(ridesUpdates(fake)).toHaveLength(0);
      expect(riderNotificationCount(fake)).toBe(0);
    }
  );

  test.each(ADMIN_CREDENTIALS)(
    "decline with a valid %s and a body driver_id is rejected and changes nothing",
    async (_label, withAdmin) => {
      const fake = useFake(fixture());

      const res = await withAdmin(request(server).post(`/api/driver/offers/${OFFER_ID}/decline`)).send({
        driver_id: DRIVER.id,
        reason: "admin attempt"
      });

      expect([401, 403]).toContain(res.status);
      expect(res.body.ok).toBe(false);
      expect(offer(fake).status).toBe("pending");
      expect(ridesUpdates(fake)).toHaveLength(0);
      expect(offerInserts(fake)).toHaveLength(0);
    }
  );

  test("admin credentials alongside a driver's own session act only as that driver", async () => {
    const fake = useFake(fixture());

    const res = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/accept`)
      .set("x-driver-token", driverToken(OTHER_DRIVER.id))
      .set("x-admin-token", process.env.ADMIN_API_TOKEN)
      .send({ driver_id: DRIVER.id });

    // OTHER_DRIVER's session, DRIVER's offer: ownership check, not an admin bypass.
    expect(res.status).toBe(403);
    expect(offer(fake).status).toBe("pending");
  });

  test("a valid driver session still accepts and declines", async () => {
    let fake = useFake(fixture());
    const accepted = await acceptOffer();
    expect(accepted.status).toBe(200);
    expect(offer(fake).status).toBe("accepted");

    fake = useFake(fixture({ dispatchAttempts: 5 }));
    const declined = await declineOffer();
    expect(declined.status).toBe(200);
    expect(offer(fake).status).toBe("declined");
  });

  test("the admin ops override still works on other driver routes (change is scoped to accept/decline)", async () => {
    useFake(fixture());

    const res = await request(server)
      .post("/api/driver/status")
      .set("x-admin-token", process.env.ADMIN_API_TOKEN)
      .send({ driver_id: DRIVER.id, online: false });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/driver/offers/:offerId/accept", () => {
  test("assigns the ride via rides.driver_id against the live schema and notifies exactly once", async () => {
    const fake = useFake(fixture());
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ride_id: RIDE_ID, driver_id: DRIVER.id });

    expect(ride(fake).driver_id).toBe(DRIVER.id);
    expect(ride(fake).status).toBe("driver_assigned");
    expect(ride(fake).dispatch_status).toBe("accepted");
    expect(ride(fake).assigned_driver_id).toBeUndefined();
    expect(offer(fake).status).toBe("accepted");
    expectNoNonexistentColumnWrites(fake);

    expect(riderNotificationCount(fake)).toBe(1);
    expect(stream.events.filter((e) => e === "stage")).toHaveLength(1);
  });

  test("calls accept_driver_offer_atomic once with the session's driver id and writes nothing else", async () => {
    const fake = useFake(fixture());

    await acceptOffer();

    const acceptCalls = fake.rpc.mock.calls.filter(([fn]) => fn === "accept_driver_offer_atomic");
    expect(acceptCalls).toEqual([["accept_driver_offer_atomic", { p_offer_id: OFFER_ID, p_driver_id: DRIVER.id }]]);
    // No separate offer or ride write: the assignment commits inside the
    // one transaction, so there is no multi-step flow left to compensate.
    expect(ridesUpdates(fake)).toHaveLength(0);
    expect(fake._log.filter((e) => e.table === "driver_offers" && e.op === "update")).toHaveLength(0);
  });

  test("a database error returns 500, commits nothing, and sends no notification or SSE event", async () => {
    const fake = useFake(fixture(), { acceptRpcResult: { error: DB_ERROR } });
    const stream = await subscribeRideStream(RIDE_ID);
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(ride(fake).driver_id).toBeNull();
    expect(ride(fake).status).toBe("awaiting_driver_acceptance");
    expect(offer(fake).status).toBe("pending");
    expect(riderNotificationCount(fake)).toBe(0);
    expect(stream.events).not.toContain("stage");
  });

  test("an unexpected outcome returns 500 and never notifies", async () => {
    const fake = useFake(fixture(), { acceptRpcResult: { data: [{ outcome: "something_new" }] } });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(500);
    expect(riderNotificationCount(fake)).toBe(0);
  });

  test.each([
    ["cancelled", { status: "cancelled" }],
    ["already assigned to another driver", { status: "driver_assigned", driver_id: OTHER_DRIVER.id }],
    ["completed", { status: "completed" }]
  ])("a ride that is %s returns 409 and changes neither the ride nor the offer", async (_label, rideOverrides) => {
    const fake = useFake(fixture({ rideOverrides }));
    const before = { ...ride(fake) };

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(ride(fake)).toEqual(before);
    expect(offer(fake).status).toBe("pending");
    expect(riderNotificationCount(fake)).toBe(0);
  });

  test("an offer whose ride no longer exists returns 409, not 200", async () => {
    const fake = useFake(fixture({ offerOverrides: { ride_id: "RIDE-DOES-NOT-EXIST" } }));

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(409);
    expect(offer(fake).status).toBe("pending");
    expect(riderNotificationCount(fake)).toBe(0);
  });

  test("a driver already on another active ride gets 409 and nothing is assigned", async () => {
    const seed = fixture();
    seed.rides.push({ id: "RIDE-TEST0002", rider_id: RIDER.id, status: "in_progress", driver_id: DRIVER.id });
    const fake = useFake(seed);

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(409);
    expect(ride(fake).driver_id).toBeNull();
    expect(offer(fake).status).toBe("pending");
    expect(riderNotificationCount(fake)).toBe(0);
  });

  test("a retried accept of the driver's own assigned offer returns 200 without a second notification", async () => {
    const fake = useFake(
      fixture({
        rideOverrides: { status: "driver_assigned", driver_id: DRIVER.id },
        offerOverrides: { status: "accepted" }
      })
    );

    const res = await acceptOffer();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ride_id: RIDE_ID, driver_id: DRIVER.id, idempotent_replay: true });
    expect(riderNotificationCount(fake)).toBe(0);
  });

  test("the response carries no rider contact fields", async () => {
    useFake(fixture({ rideOverrides: { rider_phone: "+15555550199" } }));

    const res = await acceptOffer();

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("+15555550199");
    expect(res.body).not.toHaveProperty("rider_id");
  });

  test("an unknown offer returns 404", async () => {
    useFake(fixture());

    const res = await acceptOffer(DRIVER.id, "OFFER-DOES-NOT-EXIST");

    expect(res.status).toBe(404);
  });

  test("another driver's offer returns 403 whatever its status, and changes nothing", async () => {
    for (const status of ["pending", "expired"]) {
      const fake = useFake(fixture({ offerOverrides: { status } }));

      const res = await acceptOffer(OTHER_DRIVER.id);

      expect(res.status).toBe(403);
      expect(offer(fake).status).toBe(status);
      expect(ride(fake).driver_id).toBeNull();
    }
  });

  test.each(["expired", "declined", "accepted", "cancelled"])(
    "an offer that is already %s returns 409",
    async (status) => {
      const fake = useFake(fixture({ offerOverrides: { status } }));

      const res = await acceptOffer();

      expect(res.status).toBe(409);
      expect(ride(fake).driver_id).toBeNull();
      expect(riderNotificationCount(fake)).toBe(0);
    }
  );

  test("an offer past its expiry time returns 409 even while still pending", async () => {
    const fake = useFake(fixture({ offerOverrides: { expires_at: new Date(Date.now() - 1000).toISOString() } }));

    const res = await acceptOffer();

    expect(res.status).toBe(409);
    expect(ride(fake).driver_id).toBeNull();
  });
});

describe("POST /api/driver/offers/:offerId/decline", () => {
  test("redispatches through the Node fallback: offers the next driver without assigning them", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 1 }));

    const res = await declineOffer();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, declined: true });
    expect(offer(fake).status).toBe("declined");

    const newOffer = fake._state.driver_offers.find((o) => o.id !== OFFER_ID);
    expect(newOffer).toMatchObject({ ride_id: RIDE_ID, driver_id: OTHER_DRIVER.id, status: "pending", attempt: 2 });

    expect(ride(fake).status).toBe("awaiting_driver_acceptance");
    expect(ride(fake).dispatch_status).toBe("offer_sent");
    expect(ride(fake).dispatch_attempts).toBe(2);
    // Offered, not assigned: rides.driver_id is only written on accept.
    expect(ride(fake).driver_id).toBeNull();
    expectNoNonexistentColumnWrites(fake);
  });

  test("a failed dispatch-fallback ride update cancels the new offer and returns 500", async () => {
    let ridesWrites = 0;
    const fake = useFake(fixture({ dispatchAttempts: 1 }), {
      // 1st rides write: the decline route's own redispatch bookkeeping.
      // 2nd rides write: dispatchRide()'s fallback recording offer_sent.
      failUpdate: (table) => (table === "rides" && ++ridesWrites === 2 ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    const newOffer = fake._state.driver_offers.find((o) => o.id !== OFFER_ID);
    expect(newOffer.status).toBe("cancelled");
    expect(ride(fake).dispatch_status).toBe("redispatching");
  });

  test("a failed redispatch update returns 500 and does not redispatch", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 1 }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalledWith("dispatch_ride_atomic", expect.anything());
    expect(offerInserts(fake)).toHaveLength(0);
  });

  test("a failed max-attempts update returns 500", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 5 }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(ride(fake).status).toBe("awaiting_driver_acceptance");
  });

  test("the max-attempts path succeeds against the live schema", async () => {
    const fake = useFake(fixture({ dispatchAttempts: 5 }));

    const res = await declineOffer();

    expect(res.status).toBe(200);
    expect(ride(fake).status).toBe("failed");
    expect(ride(fake).dispatch_status).toBe("max_attempts_reached");
    expect(offer(fake).status).toBe("declined");
  });

  test("another driver's offer returns 403 and changes nothing", async () => {
    const fake = useFake(fixture());

    const res = await declineOffer(OTHER_DRIVER.id);

    expect(res.status).toBe(403);
    expect(offer(fake).status).toBe("pending");
    expect(ridesUpdates(fake)).toHaveLength(0);
    expect(offerInserts(fake)).toHaveLength(0);
  });

  test("an already-resolved offer returns 409 and does not redispatch", async () => {
    const fake = useFake(fixture({ offerOverrides: { status: "expired" } }));

    const res = await declineOffer();

    expect(res.status).toBe(409);
    expect(ridesUpdates(fake)).toHaveLength(0);
    expect(offerInserts(fake)).toHaveLength(0);
  });

  test("a failed offer update returns 500 and never touches the ride", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "driver_offers" ? DB_ERROR : null)
    });

    const res = await declineOffer();

    expect(res.status).toBe(500);
    expect(ridesUpdates(fake)).toHaveLength(0);
  });

  test("a failed offer lookup returns 500, not 404", async () => {
    useFake(fixture(), { failSelect: (table) => (table === "driver_offers" ? DB_ERROR : null) });

    const res = await declineOffer();

    expect(res.status).toBe(500);
  });
});

describe("offer-expiry sweep (runOfferExpirySweep)", () => {
  const expired = { expires_at: new Date(Date.now() - 60_000).toISOString() };

  test("redispatches an expired offer against the live schema without assigning the next driver", async () => {
    const fake = useFake(fixture({ sweepEnabled: true, dispatchAttempts: 1, offerOverrides: expired }));

    const result = await runOfferExpirySweep();

    expect(result.redispatched).toEqual([RIDE_ID]);
    expect(result.failed).toEqual([]);
    expect(offer(fake).status).toBe("expired");
    expect(ride(fake).dispatch_status).toBe("offer_sent");
    expect(ride(fake).dispatch_attempts).toBe(2);
    expect(ride(fake).driver_id).toBeNull();
    expectNoNonexistentColumnWrites(fake);
  });

  test("a failed redispatch ride update is recorded as failed and never dispatches", async () => {
    const fake = useFake(fixture({ sweepEnabled: true, offerOverrides: expired }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await runOfferExpirySweep();

    expect(result.failed).toEqual([OFFER_ID]);
    expect(result.redispatched).toEqual([]);
    expect(offerInserts(fake)).toHaveLength(0);
  });

  test("a failed max-attempts ride update is recorded as failed", async () => {
    const fake = useFake(fixture({ sweepEnabled: true, dispatchAttempts: 5, offerOverrides: expired }), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await runOfferExpirySweep();

    expect(result.failed).toEqual([OFFER_ID]);
    expect(result.maxedOut).toEqual([]);
    expect(ride(fake).status).toBe("awaiting_driver_acceptance");
  });

  test("a failed ride lookup is recorded as failed, not silently skipped", async () => {
    useFake(fixture({ sweepEnabled: true, offerOverrides: expired }), {
      failSelect: (table) => (table === "rides" ? DB_ERROR : null)
    });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await runOfferExpirySweep();

    expect(result.failed).toEqual([OFFER_ID]);
  });
});

describe("POST /api/admin/rides/:id/assign-driver", () => {
  test("assigns the ride via rides.driver_id against the live schema", async () => {
    const fake = useFake(fixture());
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await adminAssign();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ride.driver_id).toBe(DRIVER.id);
    expect(ride(fake).driver_id).toBe(DRIVER.id);
    expect(ride(fake).status).toBe("driver_assigned");
    expect(ride(fake).dispatch_status).toBe("admin_assigned");
    expectNoNonexistentColumnWrites(fake);

    expect(riderNotificationCount(fake)).toBe(1);
    expect(stream.events).toContain("stage");
  });

  test("a failed ride update returns 500 and sends no notification or SSE event", async () => {
    const fake = useFake(fixture(), {
      failUpdate: (table) => (table === "rides" ? DB_ERROR : null)
    });
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await adminAssign();
    await settle();

    expect(res.status).toBe(500);
    expect(res.body.ok).not.toBe(true);
    expect(ride(fake).driver_id).toBeNull();
    expect(riderNotificationCount(fake)).toBe(0);
    expect(stream.events).not.toContain("stage");
  });

  test("an unknown ride returns 404, not 200", async () => {
    const fake = useFake(fixture());

    const res = await adminAssign("RIDE-DOES-NOT-EXIST");
    await settle();

    expect(res.status).toBe(404);
    expect(riderNotificationCount(fake)).toBe(0);
  });
});

describe("GET /api/admin/rides", () => {
  test("reads only columns that exist on the live rides table", async () => {
    useFake(fixture({ rideOverrides: { driver_id: DRIVER.id, status: "driver_assigned" } }));

    const res = await request(server)
      .get("/api/admin/rides")
      .set("x-admin-token", process.env.ADMIN_API_TOKEN)
      .set("x-admin-email", "ops@example.test");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(DRIVER.id);
  });
});
