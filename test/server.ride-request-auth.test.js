// Security fix (owner decision 2026-10-18): POST /api/rides/request needs
// a signed-in rider whose account is approved or active and not
// suspended or revoked, whatever rider_auth_enforced says. Before this, a
// request with no rider_id skipped every rider check. The approval gate
// is switched off here on purpose: the status rule must hold anyway.

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
const { makeRider, riderAuthHeaders, signTestRiderToken } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

jest.setTimeout(30_000);

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { rides: ["quote_jti"] } });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

function seed(riders) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, { riders: riders.map((r) => ({ ...r })), drivers: [], rides: [], driver_offers: [], system_flags: [] });
}

const TRIP = {
  pickup: "100 Main St",
  destination: "200 Elm St",
  pickup_lat: 36.16,
  pickup_lng: -86.78,
  destination_lat: 36.17,
  destination_lng: -86.79,
  ride_type: "standard"
};

async function requestRide({ riderId, signedInAs }) {
  const estimate = await request(app).post("/api/rides/estimate").send({ miles: 5, minutes: 12, ...TRIP, rider_id: riderId });
  const req = request(app).post("/api/rides/request");
  if (signedInAs) req.set(riderAuthHeaders(signTestRiderToken(signedInAs)));
  return req.send({ ...TRIP, ...(riderId ? { rider_id: riderId } : {}), estimate_token: estimate.body.estimate_token });
}

const rides = () => mockSupabaseClient._state.rides;

test("no session and no rider_id: 401, no ride", async () => {
  seed([makeRider({ id: "RIDER_1" })]);
  const res = await requestRide({});
  expect(res.status).toBe(401);
  expect(rides()).toHaveLength(0);
});

test("no session but a real rider_id in the body: still 401, no ride", async () => {
  seed([makeRider({ id: "RIDER_1" })]);
  const res = await requestRide({ riderId: "RIDER_1" });
  expect(res.status).toBe(401);
  expect(rides()).toHaveLength(0);
});

test("a signed-in, approved rider books; the ride belongs to the session rider", async () => {
  seed([makeRider({ id: "RIDER_1" })]);
  const res = await requestRide({ riderId: "RIDER_1", signedInAs: "RIDER_1" });
  expect(res.status).toBe(201);
  expect(rides()).toHaveLength(1);
  expect(rides()[0].rider_id).toBe("RIDER_1");
});

test.each([
  ["pending", { status: "pending_verification", approval_status: "pending" }],
  ["suspended", { status: "suspended", approval_status: "suspended", is_blocked: true }],
  ["rejected", { status: "rejected", approval_status: "rejected" }]
])("a signed-in %s rider is refused with 403 even with the approval gate off", async (_label, overrides) => {
  seed([makeRider({ id: "RIDER_1", ...overrides })]);
  const res = await requestRide({ riderId: "RIDER_1", signedInAs: "RIDER_1" });
  expect(res.status).toBe(403);
  expect(rides()).toHaveLength(0);
});

test("a revoked account's session is refused, no ride", async () => {
  seed([makeRider({ id: "RIDER_1", access_revoked: true })]);
  const res = await requestRide({ riderId: "RIDER_1", signedInAs: "RIDER_1" });
  expect([401, 403]).toContain(res.status);
  expect(rides()).toHaveLength(0);
});
