// HTTP-level tests for POST /api/driver/offers/:offerId/accept as rewired
// around accept_driver_offer_atomic() (migration 20260927220400). The
// function's own locking, eligibility and atomicity guarantees are proven
// against a real Postgres in test/db/acceptDriverOfferAtomic.db.test.js;
// these tests cover the route's side of the contract:
//
//   * the RPC is called only after requireDriver, with the authenticated
//     driver's id (never a client-supplied one);
//   * each outcome maps to the right status code, and losing outcomes
//     disclose no ride data;
//   * the rider notification, ride SSE event and audit entry happen exactly
//     once -- only for the call that committed the assignment, never for an
//     idempotent retry, a losing outcome, or an RPC error.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const http = require("http");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

const RIDER = makeRider({ id: "RIDER_1" });
const DRIVER = makeDriver({ id: "DRV-TEST0001" });
const OTHER_DRIVER = makeDriver({ id: "DRV-TEST0002", email: "other@example.test" });
const RIDE_ID = "RIDE_1";
const OFFER_ID = "OFFER-TEST0001";

let app;
let server;
let baseUrl;
let rpcCalls;
let tableReads;
let rpcImpl;
const openStreams = [];

beforeAll(async () => {
  mockSupabaseClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    riders: [{ ...RIDER }],
    drivers: [{ ...DRIVER }, { ...OTHER_DRIVER }],
    rides: [makeRide({ id: RIDE_ID, status: "awaiting_driver_acceptance" })],
    driver_offers: [],
    audit_logs: []
  });

  rpcCalls = [];
  tableReads = [];
  rpcImpl = () => ({ data: null, error: { message: "no rpc configured" } });

  mockSupabaseClient.rpc = async (name, params) => {
    rpcCalls.push({ name, params });
    return rpcImpl(name, params);
  };

  if (!mockSupabaseClient._originalFrom) mockSupabaseClient._originalFrom = mockSupabaseClient.from;
  mockSupabaseClient.from = (table) => {
    tableReads.push(table);
    return mockSupabaseClient._originalFrom(table);
  };
});

afterEach(() => {
  while (openStreams.length) openStreams.pop().destroy();
  jest.restoreAllMocks();
});

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// notifyRideStage() looks up the rider's email as its first read.
const riderNotifications = () => tableReads.filter((t) => t === "riders").length;
const acceptAudits = () =>
  mockSupabaseClient._state.audit_logs.filter((a) => a.action === "ride_offer_accepted").length;

function accept(driverId = DRIVER.id, body = {}) {
  return request(server)
    .post(`/api/driver/offers/${OFFER_ID}/accept`)
    .set(driverAuthHeaders(signTestDriverToken(driverId)))
    .send(body);
}

const committedRide = () => ({
  ...makeRide({ id: RIDE_ID }),
  status: "driver_assigned",
  dispatch_status: "accepted",
  driver_id: DRIVER.id,
  driver_name: "Morgan Blake",
  driver_vehicle: "2020 Toyota Camry",
  driver_phone: DRIVER.phone
});

const rpcRow = (outcome, withRide = false) => ({
  data: [
    withRide
      ? { outcome, ride_id: RIDE_ID, offer_id: OFFER_ID, driver_id: DRIVER.id, ride: committedRide() }
      : { outcome, ride_id: null, offer_id: null, driver_id: null, ride: null }
  ],
  error: null
});

describe("POST /api/driver/offers/:offerId/accept (accept_driver_offer_atomic)", () => {
  test("calls the RPC with the authenticated driver's id, never a body-supplied one", async () => {
    rpcImpl = () => rpcRow("accepted", true);

    await accept(DRIVER.id, { driver_id: OTHER_DRIVER.id });

    expect(rpcCalls).toEqual([
      { name: "accept_driver_offer_atomic", params: { p_offer_id: OFFER_ID, p_driver_id: DRIVER.id } }
    ]);
  });

  test("an unauthenticated request is rejected before the RPC is called", async () => {
    const res = await request(server).post(`/api/driver/offers/${OFFER_ID}/accept`).send({});

    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  test("a committed accept returns 200 and notifies exactly once", async () => {
    rpcImpl = () => rpcRow("accepted", true);
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await accept();
    await settle();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ride_id: RIDE_ID, driver_id: DRIVER.id, status: "driver_assigned" });
    expect(riderNotifications()).toBe(1);
    expect(stream.events.filter((e) => e === "stage")).toHaveLength(1);
    expect(acceptAudits()).toBe(1);
  });

  test("an idempotent retry returns the same 200 without notifying again", async () => {
    rpcImpl = () => rpcRow("accepted", true);
    const stream = await subscribeRideStream(RIDE_ID);
    await accept();

    rpcImpl = () => rpcRow("already_accepted", true);
    const retry = await accept();
    await settle();

    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, ride_id: RIDE_ID, driver_id: DRIVER.id, idempotent_replay: true });
    expect(riderNotifications()).toBe(1);
    expect(stream.events.filter((e) => e === "stage")).toHaveLength(1);
    expect(acceptAudits()).toBe(1);
  });

  test.each([
    ["offer_not_found", 404],
    ["not_offer_owner", 403],
    ["offer_expired", 409],
    ["offer_not_pending", 409],
    ["ride_not_assignable", 409],
    ["driver_unavailable", 409]
  ])("%s returns %i with no ride disclosure and no notification", async (outcome, status) => {
    rpcImpl = () => rpcRow(outcome);
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await accept();
    await settle();

    expect(res.status).toBe(status);
    expect(res.body.ok).toBe(false);
    expect(res.body).toEqual({ ok: false, error: expect.any(String), message: expect.any(String) });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(RIDE_ID);
    expect(body).not.toContain(RIDER.id);
    expect(body).not.toContain(DRIVER.id);
    expect(riderNotifications()).toBe(0);
    expect(stream.events).not.toContain("stage");
    expect(acceptAudits()).toBe(0);
  });

  test("a losing driver in a two-driver race gets 409 and only the winner triggers a notification", async () => {
    rpcImpl = (_name, params) =>
      params.p_driver_id === DRIVER.id ? rpcRow("accepted", true) : rpcRow("offer_not_pending");

    const [winner, loser] = await Promise.all([accept(DRIVER.id), accept(OTHER_DRIVER.id)]);
    await settle();

    expect(winner.status).toBe(200);
    expect(loser.status).toBe(409);
    expect(JSON.stringify(loser.body)).not.toContain(RIDE_ID);
    expect(riderNotifications()).toBe(1);
  });

  test("an RPC error returns 500 and notifies nobody", async () => {
    rpcImpl = () => ({ data: null, error: { code: "40P01", message: "deadlock detected" } });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const stream = await subscribeRideStream(RIDE_ID);

    const res = await accept();
    await settle();

    expect(res.status).toBe(500);
    expect(riderNotifications()).toBe(0);
    expect(stream.events).not.toContain("stage");
  });

  test("an unrecognised outcome is a 500, never a success", async () => {
    rpcImpl = () => rpcRow("something_new");
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await accept();

    expect(res.status).toBe(500);
    expect(riderNotifications()).toBe(0);
  });

  test("the route performs no table writes of its own -- the RPC owns every state change", async () => {
    rpcImpl = () => rpcRow("accepted", true);
    const before = JSON.parse(JSON.stringify({
      rides: mockSupabaseClient._state.rides,
      driver_offers: mockSupabaseClient._state.driver_offers
    }));

    await accept();
    await settle();

    expect(mockSupabaseClient._state.rides).toEqual(before.rides);
    expect(mockSupabaseClient._state.driver_offers).toEqual(before.driver_offers);
  });
});
