// Harvey Taxi Driver app routes through the real server: phone sign-in
// (uniform answers, no enumeration), the driver state snapshot (own data
// only, offers without rider contact details), location while online,
// push-token registration, the authenticated real-time stream, native push
// gating, and paginated trips/earnings.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest00000000000000000000000000";
process.env.TWILIO_FROM_NUMBER = "+15005550006";
process.env.ENABLE_PAYMENT_GATE = "false";
process.env.ENABLE_RIDER_APPROVAL_GATE = "false";

const http = require("http");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const {
  makeRider,
  makeDriver,
  makeRide,
  signTestDriverToken,
  signTestRiderToken,
  driverAuthHeaders,
  riderAuthHeaders
} = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => new Proxy({}, { get: (_t, key) => mockSupabaseClient && mockSupabaseClient[key] })
}));

const mockTwilio = { sends: [], checks: [], checkStatus: "approved" };
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: {
          create: async (params) => {
            mockTwilio.sends.push(params);
            return { sid: "VEtest", status: "pending" };
          }
        },
        verificationChecks: {
          create: async (params) => {
            mockTwilio.checks.push(params);
            return { status: mockTwilio.checkStatus };
          }
        }
      })
    },
    messages: { create: async () => ({ sid: "SMtest" }) }
  }))
);

const ADMIN = { "x-admin-token": "test-admin-token" };
const DRIVER_A = makeDriver({ id: "DRIVER_A", phone: "(615) 555-0201", online: true });
const DRIVER_B = makeDriver({ id: "DRIVER_B", email: "b@example.test", phone: "+16155550202", online: false });
const REVIEW_DRIVER = makeDriver({ id: "DRIVER_REVIEW", email: "review@example.test", phone: "+15555550200", is_review_account: true });
const RIDER = makeRider({ id: "RIDER_1" });

let app;
const state = () => mockSupabaseClient._state;
const asDriver = (id) => driverAuthHeaders(signTestDriverToken(id));
const future = (s) => new Date(Date.now() + s * 1000).toISOString();

function reset(extra = {}) {
  mockTwilio.sends = [];
  mockTwilio.checks = [];
  mockTwilio.checkStatus = "approved";
  const s = state();
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, {
    drivers: [{ ...DRIVER_A }, { ...DRIVER_B }, { ...REVIEW_DRIVER }],
    riders: [{ ...RIDER }],
    rides: [],
    driver_offers: [],
    driver_earnings: [],
    driver_push_tokens: [],
    system_flags: [],
    audit_logs: [],
    push_subscriptions: [],
    ...extra
  });
}

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
});
beforeEach(() => reset());

describe("phone sign-in", () => {
  test("sends a code to a known driver and gives the same answer for an unknown number", async () => {
    const known = await request(app).post("/api/driver/session/phone/start").send({ phone: "615-555-0201" });
    const unknown = await request(app).post("/api/driver/session/phone/start").send({ phone: "615-555-0999" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(JSON.stringify(known.body)).not.toMatch(/DRIVER_A|0201/);
    expect(mockTwilio.sends).toEqual([{ to: "+16155550201", channel: "sms" }]);
  });

  test("no code for review accounts, revoked accounts or a number shared by two drivers", async () => {
    state().drivers.push(makeDriver({ id: "DRIVER_DUP", phone: "+1 615 555 0202" }));
    state().drivers.find((d) => d.id === "DRIVER_A").access_revoked = true;
    for (const phone of ["5555550200", "6155550201", "6155550202"]) {
      const res = await request(app).post("/api/driver/session/phone/start").send({ phone });
      expect(res.status).toBe(200);
    }
    expect(mockTwilio.sends).toEqual([]);
  });

  test("rejects non-U.S. or malformed numbers", async () => {
    expect((await request(app).post("/api/driver/session/phone/start").send({ phone: "+44 20 7946 0958" })).status).toBe(400);
    expect((await request(app).post("/api/driver/session/phone/start").send({})).status).toBe(400);
  });

  test("verify issues a driver session for the matched driver only", async () => {
    const res = await request(app).post("/api/driver/session/phone/verify").send({ phone: "6155550201", code: "123456" });
    expect(res.status).toBe(200);
    expect(res.body.driver_id).toBe("DRIVER_A");
    expect(mockTwilio.checks).toEqual([{ to: "+16155550201", code: "123456" }]);
    const me = await request(app).get("/api/driver/state").set(driverAuthHeaders(res.body.driver_token));
    expect(me.body.driver.id).toBe("DRIVER_A");
  });

  test("wrong code or unknown number: the same refusal", async () => {
    mockTwilio.checkStatus = "pending";
    const wrong = await request(app).post("/api/driver/session/phone/verify").send({ phone: "6155550201", code: "000000" });
    const unknown = await request(app).post("/api/driver/session/phone/verify").send({ phone: "6155550999", code: "123456" });
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(wrong.body.error).toBe(unknown.body.error);
  });
});

describe("driver state snapshot", () => {
  test("requires a driver session; admin credentials cannot act as a driver", async () => {
    expect((await request(app).get("/api/driver/state")).status).toBe(401);
    expect((await request(app).get("/api/driver/state").set(ADMIN).query({ driver_id: "DRIVER_A" })).status).toBe(401);
    expect((await request(app).get("/api/driver/state").set(riderAuthHeaders(signTestRiderToken("RIDER_1")))).status).toBe(401);
  });

  test("shows only this driver's live offers, without rider contact details", async () => {
    state().rides.push(
      makeRide({ id: "RIDE_OFFER", status: "awaiting_driver_acceptance", driver_id: null, rider_name: "Jamie Rivera", rider_phone: "+16155550101", pickup_address: "1 Broadway", estimated_fare: 18.5 }),
      makeRide({ id: "RIDE_OTHER", status: "awaiting_driver_acceptance", driver_id: null })
    );
    state().driver_offers.push(
      { id: "OFFER_LIVE", ride_id: "RIDE_OFFER", driver_id: "DRIVER_A", status: "pending", expires_at: future(20) },
      { id: "OFFER_EXPIRED", ride_id: "RIDE_OFFER", driver_id: "DRIVER_A", status: "pending", expires_at: future(-5) },
      { id: "OFFER_DECLINED", ride_id: "RIDE_OFFER", driver_id: "DRIVER_A", status: "declined", expires_at: future(20) },
      { id: "OFFER_B", ride_id: "RIDE_OTHER", driver_id: "DRIVER_B", status: "pending", expires_at: future(20) }
    );
    const res = await request(app).get("/api/driver/state").set(asDriver("DRIVER_A"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("offer_pending");
    expect(res.body.poll_ms).toBe(5000);
    expect(res.body.offers.map((o) => o.offer_id)).toEqual(["OFFER_LIVE"]);
    expect(res.body.offers[0]).toMatchObject({ pickup_address: "1 Broadway", estimated_fare: 18.5 });
    expect(res.body.offers[0].seconds_left).toBeGreaterThan(10);
    expect(JSON.stringify(res.body.offers)).not.toMatch(/Jamie|5550101/);

    const other = await request(app).get("/api/driver/state").set(asDriver("DRIVER_B"));
    expect(other.body.offers.map((o) => o.offer_id)).toEqual(["OFFER_B"]);
    expect(other.body.mode).toBe("offer_pending");
  });

  test("an assigned ride is the active ride, with what the driver needs to reach the rider", async () => {
    state().rides.push(makeRide({ id: "RIDE_ACTIVE", status: "driver_enroute", driver_id: "DRIVER_A", rider_name: "Jamie Rivera", rider_phone: "+16155550101" }));
    const res = await request(app).get("/api/driver/state").set(asDriver("DRIVER_A"));
    expect(res.body.mode).toBe("on_trip");
    expect(res.body.active_ride).toMatchObject({ ride_id: "RIDE_ACTIVE", status: "driver_enroute", rider_first_name: "Jamie", rider_phone: "+16155550101" });
    const b = await request(app).get("/api/driver/state").set(asDriver("DRIVER_B"));
    expect(b.body.active_ride).toBeNull();
    expect(b.body.mode).toBe("offline");
    expect(b.body.poll_ms).toBe(0);
  });

  test("readiness comes from the stored driver row", async () => {
    state().drivers.find((d) => d.id === "DRIVER_A").phone_verified = false;
    const res = await request(app).get("/api/driver/state").set(asDriver("DRIVER_A"));
    expect(res.body.readiness.ready).toBe(false);
    expect(res.body.readiness.checks.phone_verified).toBe(false);
  });
});

describe("location", () => {
  const send = (id) => request(app).post("/api/driver/location").set(asDriver(id)).send({ latitude: 36.16, longitude: -86.78, accuracy: 12 });

  test("offline with no trip is refused and stores nothing", async () => {
    const res = await send("DRIVER_B");
    expect(res.status).toBe(409);
    expect(state().drivers.find((d) => d.id === "DRIVER_B").current_lat).not.toBe(36.16 + 1);
  });

  test("online with no trip stores the position for dispatch", async () => {
    state().drivers.find((d) => d.id === "DRIVER_A").current_lat = 1;
    const res = await send("DRIVER_A");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: true, mode: "online_idle", tracking_ride_id: null });
    expect(state().drivers.find((d) => d.id === "DRIVER_A")).toMatchObject({ current_lat: 36.16, current_lng: -86.78 });
  });

  test("on a trip keeps its existing behaviour", async () => {
    // A driver the 5-second location throttle hasn't seen in this file.
    state().drivers.push(makeDriver({ id: "DRIVER_T", phone: "+16155550277", online: false }));
    state().rides.push(makeRide({ id: "RIDE_T", status: "in_progress", driver_id: "DRIVER_T" }));
    const res = await send("DRIVER_T");
    expect(res.status).toBe(200);
    expect(res.body.tracking_ride_id).toBe("RIDE_T");
  });
});

describe("push tokens", () => {
  const TOKEN = "ExponentPushToken[abcdefghij123456]";

  test("validates, registers for the session's driver, and moves when another driver signs in on the device", async () => {
    expect((await request(app).post("/api/driver/push-token").set(asDriver("DRIVER_A")).send({ token: "nope", platform: "ios" })).status).toBe(400);
    expect((await request(app).post("/api/driver/push-token").set(asDriver("DRIVER_A")).send({ token: TOKEN, platform: "web" })).status).toBe(400);
    expect((await request(app).post("/api/driver/push-token").set(asDriver("DRIVER_A")).send({ token: TOKEN, platform: "ios", driver_id: "DRIVER_B" })).status).toBe(200);
    expect(state().driver_push_tokens).toEqual([expect.objectContaining({ token: TOKEN, driver_id: "DRIVER_A", platform: "ios" })]);
    await request(app).post("/api/driver/push-token").set(asDriver("DRIVER_B")).send({ token: TOKEN, platform: "ios" });
    expect(state().driver_push_tokens).toEqual([expect.objectContaining({ token: TOKEN, driver_id: "DRIVER_B" })]);
  });

  test("a driver can only remove their own token", async () => {
    state().driver_push_tokens.push({ token: TOKEN, driver_id: "DRIVER_A", platform: "ios" });
    await request(app).delete("/api/driver/push-token").set(asDriver("DRIVER_B")).send({ token: TOKEN });
    expect(state().driver_push_tokens).toHaveLength(1);
    await request(app).delete("/api/driver/push-token").set(asDriver("DRIVER_A")).send({ token: TOKEN });
    expect(state().driver_push_tokens).toHaveLength(0);
  });
});

describe("real-time stream and native push", () => {
  let server;
  let base;
  const realFetch = global.fetch;
  let expoCalls;

  beforeAll(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    global.fetch = realFetch;
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    expoCalls = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith("https://exp.host/")) {
        const messages = JSON.parse(init.body);
        expoCalls.push({ url, messages, headers: init.headers });
        return {
          status: 200,
          json: async () => ({
            data: messages.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" }))
          })
        };
      }
      return realFetch(url, init);
    };
  });

  function openStream(driverId) {
    return new Promise((resolve, reject) => {
      const events = [];
      const req = http.get(`${base}/api/driver/stream`, { headers: asDriver(driverId) }, (res) => {
        res.setEncoding("utf8");
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const ev = /event: (\S+)/.exec(block);
            if (ev) events.push(ev[1]);
          }
        });
        resolve({ events, status: res.statusCode, close: () => req.destroy() });
      });
      req.on("error", reject);
    });
  }
  const waitFor = async (fn, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };

  test("the stream requires a driver session", async () => {
    const res = await request(app).get("/api/driver/stream");
    expect(res.status).toBe(401);
  });

  test("a rider cancellation reaches only the assigned driver's stream; native push only when the flag is on", async () => {
    state().driver_push_tokens.push(
      { token: "ExponentPushToken[liveliveliveli1]", driver_id: "DRIVER_A", platform: "ios" },
      { token: "ExponentPushToken[deaddeaddeadde2]", driver_id: "DRIVER_A", platform: "android" },
      { token: "ExponentPushToken[otherotherothe3]", driver_id: "DRIVER_B", platform: "ios" }
    );
    const a = await openStream("DRIVER_A");
    const b = await openStream("DRIVER_B");
    expect(await waitFor(() => a.events.includes("connected") && b.events.includes("connected"))).toBe(true);

    state().rides.push(makeRide({ id: "RIDE_1", status: "driver_enroute", rider_id: "RIDER_1", driver_id: "DRIVER_A", payment_id: null }));
    const cancel = await request(app).post("/api/rides/RIDE_1/cancel").set(riderAuthHeaders(signTestRiderToken("RIDER_1"))).send({ reason: "test" });
    expect(cancel.status).toBe(200);
    expect(await waitFor(() => a.events.includes("sync"))).toBe(true);
    expect(b.events).not.toContain("sync");
    expect(expoCalls).toEqual([]); // flag off

    state().system_flags.push({ key: "driver_native_push_enabled", value: "true" });
    state().rides.push(makeRide({ id: "RIDE_2", status: "driver_assigned", rider_id: "RIDER_1", driver_id: "DRIVER_A", payment_id: null }));
    await request(app).post("/api/rides/RIDE_2/cancel").set(riderAuthHeaders(signTestRiderToken("RIDER_1"))).send({ reason: "test" });
    expect(await waitFor(() => expoCalls.length === 1)).toBe(true);
    expect(expoCalls[0].messages.map((m) => m.to).sort()).toEqual(["ExponentPushToken[deaddeaddeadde2]", "ExponentPushToken[liveliveliveli1]"]);
    expect(expoCalls[0].messages[0]).toMatchObject({ title: "Ride Cancelled", data: { kind: "ride_update" } });
    // Expo reported one token as no longer registered: it is removed.
    expect(await waitFor(() => state().driver_push_tokens.length === 2)).toBe(true);
    expect(state().driver_push_tokens.map((t) => t.token)).not.toContain("ExponentPushToken[deaddeaddeadde2]");

    a.close();
    b.close();
  });
});

describe("paginated trips and earnings", () => {
  beforeEach(() => {
    for (let i = 0; i < 25; i += 1) {
      const at = new Date(Date.UTC(2026, 8, 1, 12, i)).toISOString();
      state().rides.push(makeRide({ id: `TRIP_${i}`, status: "completed", driver_id: "DRIVER_A", completed_at: at }));
      state().driver_earnings.push({ id: `E_${i}`, ride_id: `TRIP_${i}`, driver_id: "DRIVER_A", total_earning: 10.25, tip_amount: 1, status: "earned", created_at: at });
    }
    state().rides.push(makeRide({ id: "TRIP_B", status: "completed", driver_id: "DRIVER_B", completed_at: new Date().toISOString() }));
    state().driver_earnings.push({ id: "E_B", driver_id: "DRIVER_B", total_earning: 99, created_at: new Date().toISOString() });
  });

  test("limit and next_before page through only this driver's trips", async () => {
    const first = await request(app).get("/api/driver/trips?limit=10").set(asDriver("DRIVER_A"));
    expect(first.status).toBe(200);
    expect(first.body.trips).toHaveLength(10);
    expect(first.body.next_before).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain("TRIP_B");
    expect((await request(app).get("/api/driver/trips?before=yesterday").set(asDriver("DRIVER_A"))).status).toBe(400);
    expect((await request(app).get("/api/driver/trips?limit=500").set(asDriver("DRIVER_A"))).body.trips.length).toBeLessThanOrEqual(50);
  });

  test("earnings ledger pages records and totals only this driver's earnings", async () => {
    const res = await request(app).get("/api/driver/earnings-ledger?limit=5").set(asDriver("DRIVER_A"));
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(5);
    expect(res.body.totals.all_time).toBe(256.25);
    expect(res.body.next_before).toBeTruthy();
    const b = await request(app).get("/api/driver/earnings-ledger").set(asDriver("DRIVER_B"));
    expect(b.body.totals.all_time).toBe(99);
  });

  test("the web dashboard's existing history route is unchanged", async () => {
    const res = await request(app).get("/api/driver/DRIVER_A/history").set(asDriver("DRIVER_A"));
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(25);
  });
});
