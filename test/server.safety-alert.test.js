// POST /api/safety/911: anyone can raise an emergency alert, but it is
// linked to a ride (and its rider and driver) only for a caller proven to
// be on that ride -- the ride's rider (session or tracking token), its
// assigned driver, or an admin. A ride id alone links nothing, and body
// ids are never trusted. Writes only columns the live table has.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_EMAIL = "ops@example.test";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.NODE_ENV = "test";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const {
  signTestDriverToken,
  signTestRiderToken,
  riderAuthHeaders,
  driverAuthHeaders,
  makeRider,
  makeDriver,
  makeRide
} = require("./rideTestHelpers");

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

const TOKEN_ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const PASSWORD_ADMIN = { "x-admin-email": process.env.ADMIN_EMAIL, "x-admin-password": process.env.ADMIN_PASSWORD };
const tenMinutesAgo = () => new Date(Date.now() - 10 * 60_000).toISOString();

const { deriveTrackingSecret, signRideTrackingToken } = require("../lib/rideAccess");

const RIDE = () => makeRide({ id: "RIDE_9", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "in_progress" });
function useFake({ drivers = [makeDriver(), makeDriver({ id: "DRIVER_2", first_name: "Ola" })] } = {}) {
  currentFake = createFakeSupabase(
    { riders: [makeRider(), makeRider({ id: "RIDER_2", phone: "+16155550199" })], drivers, rides: [RIDE()], emergency_alerts: [], audit_logs: [], system_flags: [] },
    { columns: LIVE_COLUMNS }
  );
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const trackingToken = (rideId) => signRideTrackingToken(rideId, deriveTrackingSecret({ trackingSecret: "", quoteSecret: process.env.RIDE_QUOTE_SECRET }));
const alert = (headers = {}, body = {}) => request(app).post("/api/safety/911").set(headers).send({ ride_id: "RIDE_9", message: "Help", latitude: 36.16, longitude: -86.78, ...body });
const stored = (fake) => fake._state.emergency_alerts[fake._state.emergency_alerts.length - 1];

describe("linked to the ride only for someone on it", () => {
  test.each([
    ["rider via tracking token", () => ({ "x-ride-tracking-token": trackingToken("RIDE_9") }), "sos_rider"],
    ["rider via session", () => riderAuthHeaders(signTestRiderToken("RIDER_1")), "sos_rider"],
    ["assigned driver", () => driverAuthHeaders(signTestDriverToken("DRIVER_1")), "sos_driver"],
    ["admin", () => TOKEN_ADMIN, "sos_admin"]
  ])("%s", async (_name, headers, type) => {
    const fake = useFake();
    const res = await alert(headers());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dispatched: true, linked_to_ride: true });
    expect(stored(fake)).toMatchObject({ ride_id: "RIDE_9", rider_id: "RIDER_1", driver_id: "DRIVER_1", alert_type: type, status: "open" });
    expect(stored(fake).message).toMatch(/Reported location: 36\.160000,-86\.780000/);
  });
});

describe("a ride id alone links nothing, but the alert is still recorded", () => {
  test("anonymous caller with only a ride id (and a forged rider_id)", async () => {
    const fake = useFake();
    const res = await alert({}, { rider_id: "RIDER_1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dispatched: true, linked_to_ride: false });
    expect(stored(fake)).toMatchObject({ ride_id: null, rider_id: null, driver_id: null, alert_type: "sos_unverified" });
    expect(stored(fake).message).toMatch(/Ride not verified/);
    const audit = fake._state.audit_logs.find((r) => r.action === "911_alert");
    expect(audit.metadata).toMatchObject({ verified: false, claimed_ride_id: "RIDE_9", ride_id: null });
  });

  test.each([
    ["a different rider's session", () => riderAuthHeaders(signTestRiderToken("RIDER_2")), { rider_id: "RIDER_2", alert_type: "sos_rider_no_ride" }],
    ["another driver", () => driverAuthHeaders(signTestDriverToken("DRIVER_2")), { driver_id: "DRIVER_2", alert_type: "sos_driver_no_ride" }],
    ["a tracking token for another ride", () => ({ "x-ride-tracking-token": trackingToken("RIDE_OTHER") }), { rider_id: null, alert_type: "sos_unverified" }],
    ["a forged tracking token", () => ({ "x-ride-tracking-token": "A".repeat(32) }), { alert_type: "sos_unverified" }]
  ])("%s", async (_name, headers, expected) => {
    const fake = useFake();
    const res = await alert(headers());
    expect(res.status).toBe(200);
    expect(res.body.linked_to_ride).toBe(false);
    expect(stored(fake)).toMatchObject({ ride_id: null, ...expected });
  });

  test("a revoked driver is not linked", async () => {
    const fake = useFake({ drivers: [makeDriver({ access_revoked: true })] });
    const res = await alert(driverAuthHeaders(signTestDriverToken("DRIVER_1")));
    expect(res.body.linked_to_ride).toBe(false);
    expect(stored(fake)).toMatchObject({ ride_id: null, driver_id: null, alert_type: "sos_unverified" });
  });

  test("an unknown ride id, or none at all, still records the alert", async () => {
    const fake = useFake();
    expect((await alert({}, { ride_id: "NOPE" })).status).toBe(200);
    expect((await request(app).post("/api/safety/911").send({ message: "Help" })).status).toBe(200);
    expect(fake._state.emergency_alerts).toHaveLength(2);
    expect(fake._state.emergency_alerts.every((a) => a.ride_id === null)).toBe(true);
  });
});
