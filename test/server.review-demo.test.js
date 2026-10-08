// Standalone App Review demonstrations (lib/reviewDemo.js): the rider demo
// (simulated driver, 25-second stages), the driver demo (simulated offer
// after 20 seconds online and idle), the connected two-app test, rider
// cancellation, offer expiry and simultaneous requests. Payment gate ON as
// in production; Stripe is mocked so that ANY call fails the test.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "true";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

const { createFakeSupabase } = require("./fakeSupabase");
const { hashReviewPassword } = require("../lib/reviewAccounts");
const { signRideQuote } = require("../lib/rideQuote");
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestRiderToken,
  signTestDriverToken,
  riderAuthHeaders,
  driverAuthHeaders
} = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

// Every Stripe method records the call and throws: a review ride must
// never get this far.
const mockStripeCalls = [];
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => {
    const trap = (name) => (...args) => {
      mockStripeCalls.push({ name, args });
      throw new Error(`Stripe ${name} must not be called in this test`);
    };
    return {
      paymentIntents: {
        create: trap("paymentIntents.create"),
        retrieve: trap("paymentIntents.retrieve"),
        update: trap("paymentIntents.update"),
        capture: trap("paymentIntents.capture"),
        cancel: trap("paymentIntents.cancel")
      },
      customers: { create: trap("customers.create"), retrieve: trap("customers.retrieve") },
      paymentMethods: { list: trap("paymentMethods.list") },
      refunds: { create: trap("refunds.create") },
      transfers: { create: trap("transfers.create") }
    };
  })
);

const request = require("supertest");

// Test-only fixtures, hashed into the fake database below. Not real
// credentials; the real review passwords live only in the store consoles.
const RIDER_PASSWORD = "AppReviewRiderPass123!";
const DRIVER_PASSWORD = "AppReviewDriverPass456!";
const riderCreds = hashReviewPassword(RIDER_PASSWORD);
const driverCreds = hashReviewPassword(DRIVER_PASSWORD);

const REVIEW_RIDER = makeRider({
  id: "RIDER_APP_REVIEW",
  email: "app-review-rider@example.test",
  phone: "+15555550100",
  is_review_account: true,
  review_password_salt: riderCreds.salt,
  review_password_hash: riderCreds.hash
});
const REVIEW_DRIVER = makeDriver({
  id: "DRIVER_APP_REVIEW",
  email: "app-review-driver@example.test",
  phone: "+15555550200",
  is_review_account: true,
  review_password_salt: driverCreds.salt,
  review_password_hash: driverCreds.hash,
  current_lat: 36.163,
  current_lng: -86.781
});
const ORDINARY_RIDER = makeRider({ id: "RIDER_REAL" });
const ORDINARY_DRIVER = makeDriver({ id: "DRIVER_REAL", email: "real.driver@example.test", phone: "+16155550299" });

const RIDER_CLIENT_HEADER = { "x-requested-with": "harvey-rider-app" };


let app;
let runReviewDemoTick;

function resetState({ demo = true, driverOnline = true } = {}) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [{ ...REVIEW_RIDER }, { ...ORDINARY_RIDER }],
    drivers: [{ ...REVIEW_DRIVER, online: driverOnline }, { ...ORDINARY_DRIVER, online: true }],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    driver_online_sessions: driverOnline ? [{ driver_id: REVIEW_DRIVER.id, started_at: new Date(Date.now() - 60_000).toISOString(), ended_at: null }] : [],
    payments: [],
    audit_logs: [],
    system_flags: [
      { key: "review_account_login_enabled", value: "true" },
      { key: "rider_history_enabled", value: "true" },
      { key: "review_demo_autopilot_enabled", value: demo ? "true" : "false" }
    ]
  });
}

// Same in-memory port of accept_driver_offer_atomic the dispatch tests use
// (copied from test/server.driver-offer-dispatch.test.js).
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

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase(
    {},
    {
      uniqueColumns: { driver_earnings: ["ride_id"] },
      rpc: { accept_driver_offer_atomic: (args, state) => ({ data: acceptDriverOfferAtomic(state, args), error: null }) }
    }
  );
  resetState();
  ({ app, runReviewDemoTick } = require("../server"));
});

beforeEach(() => {
  mockStripeCalls.length = 0;
});

afterEach(() => {
  expect(mockStripeCalls).toEqual([]);
});

function quoteBody(riderId) {
  const pickup = { lat: 36.1627, lng: -86.7816 };
  const destination = { lat: 36.1745, lng: -86.7679 };
  const estimate = { total: 18.5, driver_payout: 14, platform_fee: 4.5, miles: 3.2, minutes: 12 };
  return {
    estimate_token: signRideQuote({ rideType: "standard", miles: 3.2, minutes: 12, pickup, destination, riderId, estimate, secret: process.env.RIDE_QUOTE_SECRET, ttlMinutes: 15 }),
    ride_type: "standard",
    rider_id: riderId,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    pickup: "501 Broadway, Nashville, TN",
    destination: "600 Charlotte Ave, Nashville, TN",
    rider_name: "App Reviewer",
    rider_phone: "+15555550100"
  };
}

const reviewer = () => riderAuthHeaders(signTestRiderToken(REVIEW_RIDER.id));
const driverHeaders = () => driverAuthHeaders(signTestDriverToken(REVIEW_DRIVER.id));
const rides = () => mockSupabaseClient._state.rides;
const rideById = (id) => rides().find((r) => r.id === id);
const offers = () => mockSupabaseClient._state.driver_offers;
const later = (seconds) => Date.now() + seconds * 1000;

async function requestReviewRide() {
  const res = await request(app).post("/api/rides/request").set(reviewer()).send(quoteBody(REVIEW_RIDER.id));
  expect(res.status).toBe(201);
  return res.body.ride.id;
}

async function tickThrough(rideId, seconds) {
  for (let t = 5; t <= seconds; t += 5) await runReviewDemoTick({ now: later(t) });
  return rideById(rideId);
}

describe("switch off (the default): nothing changes", () => {
  test("a reviewer ride with the review driver offline fails as before, and the tick does nothing", async () => {
    resetState({ demo: false, driverOnline: false });
    const id = await requestReviewRide();
    expect(rideById(id).status).toBe("failed");
    expect(await runReviewDemoTick({ now: later(60) })).toBeNull();
    expect(rides()).toHaveLength(1);
  });
});

describe("rider demo: simulated driver", () => {
  test("review driver offline: the simulated driver takes the ride and completes it in 25-second stages, no payment, no earnings", async () => {
    resetState({ driverOnline: false });
    const id = await requestReviewRide();
    let ride = rideById(id);
    expect(ride).toMatchObject({ status: "driver_assigned", review_demo: "autopilot", driver_id: null, driver_name: "Simulated driver", payment_status: "not_required" });

    // Nothing moves before 25 seconds.
    await runReviewDemoTick({ now: later(20) });
    expect(rideById(id).status).toBe("driver_assigned");

    const seen = [];
    for (let t = 25; t <= 110; t += 5) {
      await runReviewDemoTick({ now: later(t) });
      const status = rideById(id).status;
      if (seen[seen.length - 1] !== status) seen.push(status);
    }
    expect(seen).toEqual(["driver_enroute", "arrived", "in_progress", "completed"]);
    ride = rideById(id);
    expect(ride.final_fare).toBe(ride.estimated_fare);
    expect(ride.payment_status).toBe("not_required");
    expect(mockSupabaseClient._state.driver_earnings).toHaveLength(0);
  });

  test("the rider sees a labelled simulated driver and location", async () => {
    resetState({ driverOnline: false });
    const id = await requestReviewRide();
    await runReviewDemoTick({ now: later(26) });
    const res = await request(app).get(`/api/rides/${id}/status`).set(reviewer());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ simulated: true, driver: { name: "Simulated driver", simulated: true, phone: null } });
    expect(res.body.simulated_label).toMatch(/simulated driver, location and trip/);
    expect(res.body.driver.location).toMatchObject({ simulated: true, label: "Simulated location" });
    expect(res.body.tracking).toMatchObject({ simulated: true, label: "Simulated location", target: "pickup" });
  });

  test("cancelling stops the simulated driver", async () => {
    resetState({ driverOnline: false });
    const id = await requestReviewRide();
    await runReviewDemoTick({ now: later(26) });
    expect(rideById(id).status).toBe("driver_enroute");
    const cancel = await request(app).post(`/api/rides/${id}/cancel`).set(reviewer()).send({ reason: "App Review test", expected_fee_cents: 0 });
    expect(cancel.status).toBe(200);
    await tickThrough(id, 120);
    expect(rideById(id).status).toBe("cancelled");
  });

  test("offer expiry: the review driver is online but lets the offer expire, so the simulated driver takes over", async () => {
    resetState();
    const id = await requestReviewRide();
    expect(rideById(id).status).toBe("awaiting_driver_acceptance");
    const offer = offers().find((o) => o.ride_id === id);
    expect(offer.driver_id).toBe(REVIEW_DRIVER.id);
    // Still live: nothing happens.
    await runReviewDemoTick({ now: Date.now() });
    expect(rideById(id).status).toBe("awaiting_driver_acceptance");
    offer.expires_at = new Date(Date.now() - 1000).toISOString();
    await runReviewDemoTick({ now: Date.now() });
    expect(rideById(id)).toMatchObject({ status: "driver_assigned", review_demo: "autopilot" });
    expect(offer.status).toBe("expired");
  });

  test("ordinary riders are never affected: an ordinary ride with no driver still fails", async () => {
    resetState({ driverOnline: false });
    mockSupabaseClient._state.drivers.find((d) => d.id === ORDINARY_DRIVER.id).online = false;
    const res = await request(app).post("/api/rides/request").set(riderAuthHeaders(signTestRiderToken(ORDINARY_RIDER.id))).send({ ...quoteBody(ORDINARY_RIDER.id), payment_intent_id: undefined });
    const created = rides().find((r) => r.rider_id === ORDINARY_RIDER.id);
    expect(created.review_demo || null).toBeNull();
    expect(created.status).not.toBe("driver_assigned");
    expect(res.status).toBeLessThan(500);
  });
});

describe("connected two-app test is unchanged", () => {
  test("the online review driver gets the rider's request, accepts and drives it; the simulated driver never steps in", async () => {
    resetState();
    const id = await requestReviewRide();
    const offer = offers().find((o) => o.ride_id === id);
    const accept = await request(app).post(`/api/driver/offers/${offer.id}/accept`).set(driverHeaders()).send({});
    expect(accept.status).toBe(200);
    expect(rideById(id)).toMatchObject({ status: "driver_assigned", driver_id: REVIEW_DRIVER.id });
    expect(rideById(id).review_demo || null).toBeNull();
    await tickThrough(id, 60);
    expect(rideById(id).status).toBe("driver_assigned"); // only the driver moves it
    for (const step of ["enroute", "arrived", "start", "complete"]) {
      const res = await request(app).post(`/api/driver/rides/${id}/${step}`).set(driverHeaders()).send({});
      expect({ step, status: res.status }).toEqual({ step, status: 200 });
    }
    expect(rideById(id).status).toBe("completed");
    // While a reviewer ride was open, no simulated offer was created.
    expect(rides().filter((r) => r.review_demo === "auto_offer")).toHaveLength(0);
  });
});

describe("driver demo: simulated offer", () => {
  test("after 20 seconds online and idle, one labelled simulated ride is offered to the review driver only", async () => {
    resetState();
    const session = mockSupabaseClient._state.driver_online_sessions[0];
    session.started_at = new Date(Date.now() - 10_000).toISOString();
    await runReviewDemoTick({ now: Date.now() });
    expect(rides()).toHaveLength(0); // only 10 seconds idle

    await runReviewDemoTick({ now: later(11) });
    expect(rides()).toHaveLength(1);
    const demo = rides()[0];
    expect(demo).toMatchObject({ review_demo: "auto_offer", is_review_ride: true, rider_id: null, payment_status: "not_required", status: "awaiting_driver_acceptance" });
    expect(offers().filter((o) => o.ride_id === demo.id).map((o) => o.driver_id)).toEqual([REVIEW_DRIVER.id]);

    // More ticks (within the offer's 30-second window) never add a second one.
    await runReviewDemoTick({ now: later(15) });
    await runReviewDemoTick({ now: later(20) });
    expect(rides()).toHaveLength(1);

    // The driver sees it labelled, accepts and completes it; simulated earnings.
    const state = await request(app).get("/api/driver/state").set(driverHeaders());
    expect({ status: state.status, body: state.body }).toMatchObject({ status: 200, body: { offers: [{ is_review_ride: true }] } });
    const offer = offers().find((o) => o.ride_id === demo.id);
    expect((await request(app).post(`/api/driver/offers/${offer.id}/accept`).set(driverHeaders()).send({})).status).toBe(200);
    for (const step of ["enroute", "arrived", "start", "complete"]) {
      expect((await request(app).post(`/api/driver/rides/${demo.id}/${step}`).set(driverHeaders()).send({})).status).toBe(200);
    }
    const earnings = await request(app).get(`/api/driver/${REVIEW_DRIVER.id}/earnings`).set(driverHeaders());
    expect(earnings.body.review_mode).toBe(true);
    expect(earnings.body.review_label).toMatch(/simulated/i);
  });

  test("an unanswered simulated offer is withdrawn when it expires, and the next comes only after another 20 idle seconds", async () => {
    resetState();
    await runReviewDemoTick({ now: Date.now() });
    const demo = rides()[0];
    const offer = offers().find((o) => o.ride_id === demo.id);
    offer.expires_at = new Date(Date.now() - 1000).toISOString();
    await runReviewDemoTick({ now: Date.now() });
    expect(rideById(demo.id).status).toBe("cancelled");
    expect(offer.status).toBe("expired");
    expect(rides().filter((r) => r.status !== "cancelled")).toHaveLength(0);
    await runReviewDemoTick({ now: later(25) });
    expect(rides().filter((r) => r.status !== "cancelled")).toHaveLength(1);
  });

  test("not when the review driver is offline", async () => {
    resetState({ driverOnline: false });
    await runReviewDemoTick({ now: later(60) });
    expect(rides()).toHaveLength(0);
  });
});

describe("simultaneous requests never create duplicate rides", () => {
  test("a rider reviewer booking while a simulated offer is pending: the simulated offer is withdrawn and the rider's request reaches the driver", async () => {
    resetState();
    await runReviewDemoTick({ now: Date.now() });
    const demo = rides().find((r) => r.review_demo === "auto_offer");
    expect(demo.status).toBe("awaiting_driver_acceptance");

    const id = await requestReviewRide();
    expect(rideById(demo.id).status).toBe("cancelled");
    expect(offers().find((o) => o.ride_id === demo.id).status).toBe("expired");
    expect(rideById(id).status).toBe("awaiting_driver_acceptance");
    expect(offers().find((o) => o.ride_id === id && o.status === "pending").driver_id).toBe(REVIEW_DRIVER.id);
    const open = rides().filter((r) => !["cancelled", "completed", "failed"].includes(r.status));
    expect(open.map((r) => r.id)).toEqual([id]);
  });

  test("no simulated offer is created while a rider reviewer ride is open", async () => {
    resetState();
    // The rider's ride exists but the tick's snapshot missed it.
    const id = await requestReviewRide();
    await runReviewDemoTick({ now: Date.now() });
    expect(rides().filter((r) => r.review_demo === "auto_offer")).toHaveLength(0);
    expect(rideById(id).status).toBe("awaiting_driver_acceptance");
  });

  test("overlapping ticks (two instances) create at most one simulated offer", async () => {
    resetState();
    await Promise.all([runReviewDemoTick({ now: Date.now() }), runReviewDemoTick({ now: Date.now() })]);
    expect(rides().filter((r) => r.review_demo === "auto_offer")).toHaveLength(1);
  });

  test("abandoned demo rides are cancelled after 30 minutes; real rides are never touched", async () => {
    resetState({ driverOnline: false });
    const id = await requestReviewRide();
    mockSupabaseClient._state.rides.push({ id: "RIDE_REAL_OPEN", rider_id: ORDINARY_RIDER.id, status: "driver_enroute", is_review_ride: false, updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    rideById(id).updated_at = new Date(Date.now() - 31 * 60_000).toISOString();
    rideById(id).review_demo_next_at = new Date(Date.now() + 3600_000).toISOString();
    await runReviewDemoTick({ now: Date.now() });
    expect(rideById(id).status).toBe("cancelled");
    expect(rideById("RIDE_REAL_OPEN").status).toBe("driver_enroute");
  });
});
