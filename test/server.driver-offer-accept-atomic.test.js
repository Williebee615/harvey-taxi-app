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
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";

const crypto = require("crypto");
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

// The rider's per-ride tracking token, as POST /api/rides/request issues it
// (lib/rideAccess.js); the ride stream requires it.
const { signRideTrackingToken, deriveTrackingSecret } = require("../lib/rideAccess");
const rideTrackingQuery = (rideId) =>
  `?t=${encodeURIComponent(signRideTrackingToken(rideId, deriveTrackingSecret({ trackingSecret: process.env.RIDE_TRACKING_SECRET, quoteSecret: process.env.RIDE_QUOTE_SECRET })))}`;

function subscribeRideStream(rideId) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${baseUrl}/api/rides/${rideId}/stream${rideTrackingQuery(rideId)}`, (res) => {
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

const NULL_RESULT = {
  ride_id: null,
  offer_id: null,
  driver_id: null,
  ride_status: null,
  rider_id: null,
  rider_phone: null,
  ride_type: null,
  is_review_ride: null,
  driver_name: null,
  driver_vehicle: null,
  driver_phone: null
};

// Shapes returned by accept_driver_offer_atomic() for each kind of outcome
// (see the migration's result-column allow-list).
function rpcRow(outcome) {
  if (outcome === "accepted") {
    return {
      data: [{
        outcome,
        ride_id: RIDE_ID,
        offer_id: OFFER_ID,
        driver_id: DRIVER.id,
        ride_status: "driver_assigned",
        rider_id: RIDER.id,
        rider_phone: RIDER.phone,
        ride_type: "standard",
        is_review_ride: false,
        driver_name: "Morgan Blake",
        driver_vehicle: "2020 Toyota Camry",
        driver_phone: DRIVER.phone
      }],
      error: null
    };
  }

  if (outcome === "already_accepted") {
    return {
      data: [{ ...NULL_RESULT, outcome, ride_id: RIDE_ID, offer_id: OFFER_ID, driver_id: DRIVER.id, ride_status: "driver_assigned" }],
      error: null
    };
  }

  return { data: [{ ...NULL_RESULT, outcome }], error: null };
}

const SUCCESS_BODY_KEYS = ["driver_id", "ok", "ride_id", "status"];

describe("POST /api/driver/offers/:offerId/accept (accept_driver_offer_atomic)", () => {
  test("calls the RPC with the authenticated driver's id, never a body-supplied one", async () => {
    rpcImpl = () => rpcRow("accepted");

    await accept(DRIVER.id, { driver_id: OTHER_DRIVER.id });

    expect(rpcCalls).toEqual([
      { name: "accept_driver_offer_atomic", params: { p_offer_id: OFFER_ID, p_driver_id: DRIVER.id } }
    ]);
  });

  test("a body-, query- or header-supplied driver id can never replace the session's driver", async () => {
    rpcImpl = () => rpcRow("offer_not_found");

    await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/accept?driver_id=${OTHER_DRIVER.id}`)
      .set(driverAuthHeaders(signTestDriverToken(DRIVER.id)))
      .set("x-driver-id", OTHER_DRIVER.id)
      .send({ driver_id: OTHER_DRIVER.id, p_driver_id: OTHER_DRIVER.id, driverId: OTHER_DRIVER.id });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].params).toEqual({ p_offer_id: OFFER_ID, p_driver_id: DRIVER.id });
  });

  test("a body driver id with no valid session (or a forged admin token) never reaches the RPC", async () => {
    const noSession = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/accept`)
      .send({ driver_id: DRIVER.id });
    const forgedAdmin = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/accept`)
      .set("x-admin-token", "not-the-admin-token")
      .send({ driver_id: DRIVER.id });
    const tamperedSession = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/accept`)
      .set(driverAuthHeaders(signTestDriverToken(DRIVER.id, { secret: "wrong-secret" })))
      .send({ driver_id: DRIVER.id });

    expect(noSession.status).toBe(401);
    expect(forgedAdmin.status).toBe(401);
    expect(tamperedSession.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  test("the success response exposes only its allow-list -- no rider contact, payment or reconciliation fields", async () => {
    // Even if the RPC result ever carried more (a future column, or a
    // regression back to returning the whole ride), the response must not.
    rpcImpl = () => {
      const row = rpcRow("accepted");
      Object.assign(row.data[0], {
        payment_id: "pi_SECRET_PAYMENT",
        payment_status: "authorized",
        pricing_snapshot: { secret: "PRICING_SECRET" },
        cancellation_payment_status: "RECONCILIATION_SECRET",
        admin_note: "ADMIN_NOTE_SECRET",
        pickup_lat: 36.123456,
        ride: { payment_id: "pi_SECRET_PAYMENT" }
      });
      return row;
    };

    const res = await accept();
    await settle();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(SUCCESS_BODY_KEYS);
    const body = JSON.stringify(res.body);
    for (const secret of [
      RIDER.id,
      RIDER.phone,
      DRIVER.phone,
      "pi_SECRET_PAYMENT",
      "authorized",
      "PRICING_SECRET",
      "RECONCILIATION_SECRET",
      "ADMIN_NOTE_SECRET",
      "36.123456"
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  test("the idempotent-replay response exposes only its allow-list", async () => {
    rpcImpl = () => rpcRow("already_accepted");

    const res = await accept();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...SUCCESS_BODY_KEYS, "idempotent_replay"].sort());
  });

  test("an unauthenticated request is rejected before the RPC is called", async () => {
    const res = await request(server).post(`/api/driver/offers/${OFFER_ID}/accept`).send({});

    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  test("a committed accept returns 200 and notifies exactly once", async () => {
    rpcImpl = () => rpcRow("accepted");
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
    rpcImpl = () => rpcRow("accepted");
    const stream = await subscribeRideStream(RIDE_ID);
    await accept();

    rpcImpl = () => rpcRow("already_accepted");
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
      params.p_driver_id === DRIVER.id ? rpcRow("accepted") : rpcRow("offer_not_pending");

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
    rpcImpl = () => rpcRow("accepted");
    const before = JSON.parse(JSON.stringify({
      rides: mockSupabaseClient._state.rides,
      driver_offers: mockSupabaseClient._state.driver_offers
    }));

    await accept();
    await settle();

    // Apart from the pickup record (the estimate shown at acceptance, for
    // the cancellation policy), which holds no status, assignment or
    // payment column.
    const { PICKUP_RECORD_COLUMNS } = require("../lib/cancellationRecords");
    const withoutRecords = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !PICKUP_RECORD_COLUMNS.includes(k))));
    expect(withoutRecords(mockSupabaseClient._state.rides)).toEqual(withoutRecords(before.rides));
    expect(mockSupabaseClient._state.driver_offers).toEqual(before.driver_offers);
  });
});

// Same token format as signAdminSession() in server.js: a genuine, valid
// admin dashboard session cookie.
function adminSessionCookie() {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email: "ops@example.test", iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `htaf_admin_session=${encoded}.${sig}`;
}

describe("offer accept/decline require the driver's own session -- admin credentials never act as a driver", () => {
  const ADMIN_CREDENTIALS = [
    ["x-admin-token header", (r) => r.set("x-admin-token", process.env.ADMIN_API_TOKEN)],
    ["x-harvey-admin-token header", (r) => r.set("x-harvey-admin-token", process.env.ADMIN_API_TOKEN)],
    ["admin session cookie", (r) => r.set("Cookie", [adminSessionCookie()])]
  ];

  const seedOffer = (overrides = {}) => {
    mockSupabaseClient._state.driver_offers = [
      { id: OFFER_ID, ride_id: RIDE_ID, driver_id: DRIVER.id, status: "pending", attempt: 1, ...overrides }
    ];
  };

  test.each(ADMIN_CREDENTIALS)("accept with a valid %s and a body driver_id is rejected before the RPC", async (_label, withAdmin) => {
    rpcImpl = () => rpcRow("accepted");

    const res = await withAdmin(request(server).post(`/api/driver/offers/${OFFER_ID}/accept`)).send({ driver_id: DRIVER.id });
    await settle();

    expect([401, 403]).toContain(res.status);
    expect(res.body.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
    expect(riderNotifications()).toBe(0);
  });

  test.each(ADMIN_CREDENTIALS)("decline with a valid %s and a body driver_id is rejected and changes nothing", async (_label, withAdmin) => {
    seedOffer();

    const res = await withAdmin(request(server).post(`/api/driver/offers/${OFFER_ID}/decline`)).send({
      driver_id: DRIVER.id,
      reason: "admin attempt"
    });

    expect([401, 403]).toContain(res.status);
    expect(res.body.ok).toBe(false);
    expect(mockSupabaseClient._state.driver_offers[0].status).toBe("pending");
  });

  test("a valid driver session still accepts and declines", async () => {
    rpcImpl = () => rpcRow("accepted");
    expect((await accept()).status).toBe(200);

    seedOffer();
    mockSupabaseClient._state.rides[0].dispatch_attempts = 5;
    const declined = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/decline`)
      .set(driverAuthHeaders(signTestDriverToken(DRIVER.id)))
      .send({ reason: "too far" });

    expect(declined.status).toBe(200);
    expect(mockSupabaseClient._state.driver_offers[0].status).toBe("declined");
  });

  test("one driver cannot accept or decline another driver's offer", async () => {
    rpcImpl = () => rpcRow("not_offer_owner");
    const accepted = await accept(OTHER_DRIVER.id);
    expect(accepted.status).toBe(403);
    expect(rpcCalls[0].params.p_driver_id).toBe(OTHER_DRIVER.id);

    seedOffer();
    const declined = await request(server)
      .post(`/api/driver/offers/${OFFER_ID}/decline`)
      .set(driverAuthHeaders(signTestDriverToken(OTHER_DRIVER.id)))
      .send({ driver_id: DRIVER.id, reason: "not mine" });

    expect(declined.status).toBe(403);
    expect(mockSupabaseClient._state.driver_offers[0].status).toBe("pending");
  });

  test("the admin ops override still works on other driver routes (change is scoped to accept/decline)", async () => {
    const res = await request(server)
      .post("/api/driver/status")
      .set("x-admin-token", process.env.ADMIN_API_TOKEN)
      .send({ driver_id: DRIVER.id, online: false });

    expect(res.status).toBe(200);
  });
});
