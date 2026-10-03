// End to end over real HTTP, with the App Review accounts (simulated
// payment, no Stripe): the review rider requests a ride, the review driver
// signs in through the driver app's login, sees the offer in
// GET /api/driver/state, accepts it, sends location, and drives every step
// to completion. At each step the rider's own status endpoint reports the
// same trip state, an ordinary driver never sees the ride, and the driver
// stream is nudged when the offer arrives.
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
const { hashReviewPassword } = require("../lib/reviewAccounts");
const { signRideQuote } = require("../lib/rideQuote");
const { makeDriver, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const RIDER_PW = "ReviewerRiderPass123!";
const DRIVER_PW = "ReviewerDriverPass456!";
const riderCreds = hashReviewPassword(RIDER_PW);
const driverCreds = hashReviewPassword(DRIVER_PW);

const REVIEW_RIDER = {
  id: "RIDER_REVIEW_1",
  email: "reviewer-rider@example.test",
  first_name: "App",
  last_name: "Reviewer",
  phone: "+15555550100",
  is_review_account: true,
  review_password_salt: riderCreds.salt,
  review_password_hash: riderCreds.hash,
  access_revoked: false,
  deleted_at: null,
  session_version: 0,
  status: "active",
  approval_status: "approved",
  email_verified: true,
  sms_verified: true,
  persona_status: "verified"
};
const REVIEW_DRIVER = makeDriver({
  id: "DRIVER_REVIEW_1",
  email: "reviewer-driver@example.test",
  phone: "+15555550200",
  is_review_account: true,
  review_password_salt: driverCreds.salt,
  review_password_hash: driverCreds.hash,
  online: false
});
const ORDINARY_DRIVER = makeDriver({ id: "DRIVER_REAL_1", email: "real@example.test", phone: "+16155550222", online: true });
const RIDER_CLIENT = { "x-requested-with": "harvey-rider-app" };

let app;
let server;
let base;
const state = () => mockSupabaseClient._state;

beforeAll(async () => {
  mockSupabaseClient = createFakeSupabase({
    riders: [REVIEW_RIDER],
    drivers: [REVIEW_DRIVER, ORDINARY_DRIVER],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    audit_logs: [],
    driver_push_tokens: [],
    system_flags: [{ key: "review_account_login_enabled", value: "true" }]
  });
  installAcceptRpc();
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

// accept_driver_offer_atomic, mirrored outcome for outcome from the
// migration (its concurrency is tested on real Postgres in
// test/db/acceptDriverOfferAtomic.db.test.js). Dispatch's own RPC keeps the
// fake's default (unavailable), so dispatch takes its tested fallback path.
function installAcceptRpc() {
  const fallback = mockSupabaseClient.rpc;
  const ACTIVE = ["driver_assigned", "driver_enroute", "arrived", "in_progress"];
  mockSupabaseClient.rpc = async (name, params) => {
    if (name !== "accept_driver_offer_atomic") return fallback(name, params);
    const s = mockSupabaseClient._state;
    const row = (outcome, extra = {}) => ({ data: [{ outcome, ...extra }], error: null });
    const offer = s.driver_offers.find((o) => o.id === params.p_offer_id);
    if (!offer) return row("offer_not_found");
    const ride = s.rides.find((r) => r.id === offer.ride_id);
    if (offer.driver_id !== params.p_driver_id) return row("not_offer_owner");
    if (offer.status === "accepted") {
      return ride && ride.driver_id === params.p_driver_id && ACTIVE.includes(ride.status)
        ? row("already_accepted", { ride_id: ride.id, offer_id: offer.id, driver_id: params.p_driver_id, ride_status: ride.status })
        : row("offer_not_pending");
    }
    if (offer.status !== "pending") return row("offer_not_pending");
    if (offer.expires_at && Date.parse(offer.expires_at) <= Date.now()) return row("offer_expired");
    if (!ride || ride.driver_id || !["payment_authorized", "awaiting_driver_acceptance"].includes(ride.status)) return row("ride_not_assignable");
    const driver = s.drivers.find((d) => d.id === params.p_driver_id);
    if (!driver || driver.approval_status !== "approved" || driver.access_revoked) return row("driver_unavailable");
    if (s.rides.some((r) => r.driver_id === driver.id && r.id !== ride.id && ACTIVE.includes(r.status))) return row("driver_unavailable");
    const now = new Date().toISOString();
    Object.assign(offer, { status: "accepted", responded_at: now, updated_at: now });
    s.driver_offers.filter((o) => o.ride_id === ride.id && o.id !== offer.id && o.status === "pending").forEach((o) => (o.status = "superseded"));
    Object.assign(ride, { driver_id: driver.id, status: "driver_assigned", dispatch_status: "accepted", accepted_at: now, driver_name: `${driver.first_name} ${driver.last_name}`, driver_phone: driver.phone, updated_at: now });
    return row("accepted", {
      ride_id: ride.id, offer_id: offer.id, driver_id: driver.id, ride_status: ride.status, rider_id: ride.rider_id, rider_phone: ride.rider_phone,
      ride_type: ride.ride_type, is_review_ride: ride.is_review_ride, driver_name: ride.driver_name, driver_vehicle: "", driver_phone: ride.driver_phone
    });
  };
}

function rideRequestBody() {
  const pickup = { lat: 36.1627, lng: -86.7816 };
  const destination = { lat: 36.1745, lng: -86.7679 };
  const estimate = { total: 18.5, driver_payout: 14, platform_fee: 4.5, miles: 3.2, minutes: 12 };
  return {
    estimate_token: signRideQuote({ rideType: "standard", miles: 3.2, minutes: 12, pickup, destination, riderId: REVIEW_RIDER.id, estimate, secret: process.env.RIDE_QUOTE_SECRET, ttlMinutes: 15 }),
    ride_type: "standard",
    rider_id: REVIEW_RIDER.id,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    pickup: "123 Main St, Nashville, TN",
    destination: "456 Oak Ave, Nashville, TN"
  };
}

function openStream(headers) {
  return new Promise((resolve) => {
    const events = [];
    const req = http.get(`${base}/api/driver/stream`, { headers }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        for (const m of chunk.matchAll(/event: (\S+)/g)) events.push(m[1]);
      });
      resolve({ events, close: () => req.destroy() });
    });
  });
}

test("rider requests, review driver receives and accepts, both see the same trip through completion; no charge", async () => {
  // Driver signs in through the test-account login the app offers App Review.
  const login = await request(app).post("/api/review/driver/login").send({ email: REVIEW_DRIVER.email, password: DRIVER_PW });
  expect(login.status).toBe(200);
  const D = driverAuthHeaders(login.body.driver_token);

  // Goes online (readiness enforced by the server) and connects the stream.
  expect((await request(app).post("/api/driver/status").set(D).send({ online: true })).status).toBe(200);
  const stream = await openStream(D);
  await new Promise((r) => setTimeout(r, 50));
  expect(stream.events).toContain("connected");

  // Rider requests a ride.
  const rider = request.agent(app);
  expect((await rider.post("/api/review/rider/login").set(RIDER_CLIENT).send({ email: REVIEW_RIDER.email, password: RIDER_PW })).status).toBe(200);
  const requested = await rider.post("/api/rides/request").set(RIDER_CLIENT).send(rideRequestBody());
  expect(requested.status).toBe(201);
  expect(requested.body.ride.is_review_ride).toBe(true);
  const rideId = requested.body.ride.id;

  // The offer reaches the review driver's app (stream nudge + state), never the ordinary driver.
  await new Promise((r) => setTimeout(r, 50));
  expect(stream.events).toContain("sync");
  const offered = await request(app).get("/api/driver/state").set(D);
  expect(offered.body.mode).toBe("offer_pending");
  expect(offered.body.offers).toHaveLength(1);
  expect(offered.body.offers[0]).toMatchObject({ ride_id: rideId, is_review_ride: true });
  const other = await request(app).get("/api/driver/state").set(driverAuthHeaders(signTestDriverToken(ORDINARY_DRIVER.id)));
  expect(other.body.offers).toEqual([]);

  // Accept.
  const accepted = await request(app).post(`/api/driver/offers/${offered.body.offers[0].offer_id}/accept`).set(D).send({});
  expect(accepted.status).toBe(200);
  const assigned = await request(app).get("/api/driver/state").set(D);
  expect(assigned.body.active_ride).toMatchObject({ ride_id: rideId, status: "driver_assigned" });
  expect(assigned.body.offers).toEqual([]);

  const riderSees = async () => (await rider.get(`/api/rides/${rideId}/status`).set(RIDER_CLIENT)).body;
  expect((await riderSees()).ride?.status || (await riderSees()).status).toBe("driver_assigned");

  // Every step, with the rider seeing the same state; location accepted on the trip.
  for (const [step, status] of [["enroute", "driver_enroute"], ["arrived", "arrived"], ["start", "in_progress"]]) {
    const res = await request(app).post(`/api/driver/rides/${rideId}/${step}`).set(D).send({});
    expect([step, res.status]).toEqual([step, 200]);
    const driverView = await request(app).get("/api/driver/state").set(D);
    expect(driverView.body.active_ride.status).toBe(status);
    const r = await riderSees();
    expect((r.ride && r.ride.status) || r.status).toBe(status);
  }
  const loc = await request(app).post("/api/driver/location").set(D).send({ latitude: 36.17, longitude: -86.77, accuracy: 8 });
  expect(loc.body.tracking_ride_id).toBe(rideId);

  const done = await request(app).post(`/api/driver/rides/${rideId}/complete`).set(D).send({});
  expect(done.status).toBe(200);
  const after = await request(app).get("/api/driver/state").set(D);
  expect(after.body.active_ride).toBeNull();
  expect(after.body.mode).toBe("online_idle");
  const r = await riderSees();
  expect((r.ride && r.ride.status) || r.status).toBe("completed");

  // Simulated payment: the ride never had a real payment to capture.
  const ride = state().rides.find((x) => x.id === rideId);
  expect(ride.payment_status).toBe("not_required");
  expect(ride.payment_id || null).toBeNull();

  const trips = await request(app).get("/api/driver/trips").set(D);
  expect(trips.body.trips.map((t) => t.id)).toContain(rideId);
  stream.close();
});

test("a second accept of the same offer, or by another driver, cannot double-assign", async () => {
  // The single-winner guarantee itself is the accept_driver_offer_atomic
  // function (test/db/acceptDriverOfferAtomic.db.test.js: racing drivers,
  // busy driver, duplicate accepts). Here: the route refuses a repeat and a
  // foreign driver.
  const rideId = state().rides[0].id;
  const offerId = state().driver_offers.find((o) => o.ride_id === rideId).id;
  const again = await request(app).post(`/api/driver/offers/${offerId}/accept`).set(driverAuthHeaders(signTestDriverToken(REVIEW_DRIVER.id))).send({});
  expect(again.status).toBeGreaterThanOrEqual(400);
  const foreign = await request(app).post(`/api/driver/offers/${offerId}/accept`).set(driverAuthHeaders(signTestDriverToken(ORDINARY_DRIVER.id))).send({});
  expect(foreign.status).toBeGreaterThanOrEqual(400);
  expect(state().rides.find((x) => x.id === rideId).driver_id).toBe(REVIEW_DRIVER.id);
});
