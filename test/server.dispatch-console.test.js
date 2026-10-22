// Dispatch exception console v1 (owner decisions 2026-10-22): admin-only
// queue from real ride data; staff reassign with a note (audited), only
// to a live, ready, free driver and only before the trip starts; driver
// bounties are switched off.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, makeRide } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.setTimeout(60_000);

const ADMIN = { "x-admin-token": "test-admin-token" };
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const ahead = (m) => new Date(Date.now() + m * 60000).toISOString();
const PICKUP = { pickup_lat: 36.1627, pickup_lng: -86.7816 };

let app;
let ip = 0;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
});
function reset({ rides = [], drivers = [], flags = [] } = {}) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, { rides, drivers, driver_offers: [], audit_logs: [], system_flags: flags, push_subscriptions: [], ride_driver_bounties: [] });
}
const call = (method, path, headers, body) => {
  const r = request(app)[method](path).set("X-Forwarded-For", `10.93.${Math.floor(++ip / 250)}.${ip % 250}`).set(headers || {});
  return body === undefined ? r : r.send(body);
};
const state = () => mockSupabaseClient._state;

const LIVE = makeDriver({ id: "LIVE_1", first_name: "Sam", last_name: "Ortiz", online: true, last_seen_at: ago(1), current_lat: 36.17, current_lng: -86.78 });
const OFFLINE = makeDriver({ id: "OFF_1", online: false, last_seen_at: ago(30) });

test("admin only", async () => {
  reset();
  expect((await call("get", "/api/admin/dispatch/exceptions")).status).toBe(401);
  expect((await call("post", "/api/admin/dispatch/rides/R/reassign", {}, { driver_id: "LIVE_1", note: "test note" })).status).toBe(401);
});

test("the queue flags real problems, most severe first, and suggests live ready drivers", async () => {
  reset({
    drivers: [LIVE, OFFLINE],
    rides: [
      makeRide({ id: "R_LATE", status: "driver_enroute", driver_id: "OFF_1", accepted_at: ago(40), driver_eta_to_pickup_minutes: 8, ...PICKUP }),
      makeRide({ id: "R_WAIT", status: "awaiting_driver_acceptance", driver_id: null, last_dispatch_at: ago(3), ...PICKUP }),
      makeRide({ id: "R_OK", status: "awaiting_driver_acceptance", driver_id: null, last_dispatch_at: ago(0.5), ...PICKUP }),
      makeRide({ id: "R_DONE", status: "completed", driver_id: "OFF_1", ...PICKUP })
    ]
  });
  const res = await call("get", "/api/admin/dispatch/exceptions", ADMIN);
  expect(res.status).toBe(200);
  expect(res.body.items.map((i) => [i.ride_id, i.severity])).toEqual([["R_LATE", "critical"], ["R_WAIT", "warning"]]);
  expect(res.body.items[0].exceptions.map((e) => e.code)).toEqual(["driver_not_live", "late_pickup"]);
  expect(res.body.items[1].candidates).toEqual([expect.objectContaining({ driver_id: "LIVE_1", name: "Sam O." })]);
  expect(res.body).toMatchObject({ counts: { critical: 1, warning: 1, info: 0 }, drivers_live: 1, bounty_enabled: false });
  expect(JSON.stringify(res.body)).not.toMatch(/\+1615|@example\.test/);
});

test("a scheduled pickup within 30 minutes with nobody live nearby is critical", async () => {
  reset({ drivers: [OFFLINE], rides: [makeRide({ id: "R_SCHED", status: "payment_authorized", driver_id: null, scheduled_time: ahead(25), ...PICKUP })] });
  const res = await call("get", "/api/admin/dispatch/exceptions", ADMIN);
  expect(res.body.items[0]).toMatchObject({ ride_id: "R_SCHED", severity: "critical", exceptions: [expect.objectContaining({ code: "scheduled_no_coverage" })] });
});

test("reassignment: note required, live ready free driver only, never after the trip starts; audited", async () => {
  const ride = makeRide({ id: "R1", status: "driver_enroute", driver_id: "OFF_1", ...PICKUP });
  reset({ drivers: [LIVE, OFFLINE], rides: [ride] });
  state().driver_offers.push({ id: "O1", ride_id: "R1", driver_id: "X", status: "pending" });
  expect((await call("post", "/api/admin/dispatch/rides/R1/reassign", ADMIN, { driver_id: "LIVE_1", note: "no" })).status).toBe(400);
  expect((await call("post", "/api/admin/dispatch/rides/R1/reassign", ADMIN, { driver_id: "OFF_1", note: "Same driver test" })).status).toBe(400);
  expect((await call("post", "/api/admin/dispatch/rides/R1/reassign", ADMIN, { driver_id: "NOPE", note: "Unknown driver" })).status).toBe(404);
  const ok = await call("post", "/api/admin/dispatch/rides/R1/reassign", ADMIN, { driver_id: "LIVE_1", note: "Assigned driver offline, rider waiting", exception_code: "driver_not_live" });
  expect(ok.status).toBe(200);
  expect(state().rides[0]).toMatchObject({ driver_id: "LIVE_1", status: "driver_assigned", dispatch_status: "admin_reassigned", assigned_by_admin: true });
  expect(state().driver_offers[0].status).toBe("superseded");
  const audit = state().audit_logs.find((a) => a.action === "dispatch_ride_reassigned");
  expect(audit.metadata).toMatchObject({ from_driver_id: "OFF_1", to_driver_id: "LIVE_1", note: "Assigned driver offline, rider waiting", exception_code: "driver_not_live" });

  reset({ drivers: [LIVE, OFFLINE], rides: [makeRide({ id: "R2", status: "in_progress", driver_id: "OFF_1" })] });
  expect((await call("post", "/api/admin/dispatch/rides/R2/reassign", ADMIN, { driver_id: "LIVE_1", note: "Mid-trip attempt" })).status).toBe(409);
  reset({ drivers: [LIVE, OFFLINE], rides: [makeRide({ id: "R3", status: "awaiting_driver_acceptance", driver_id: null })] });
  expect((await call("post", "/api/admin/dispatch/rides/R3/reassign", ADMIN, { driver_id: "OFF_1", note: "Offline driver" })).status).toBe(409);
  reset({ drivers: [LIVE], rides: [makeRide({ id: "R4", status: "awaiting_driver_acceptance", driver_id: null }), makeRide({ id: "R5", status: "in_progress", driver_id: "LIVE_1" })] });
  expect((await call("post", "/api/admin/dispatch/rides/R4/reassign", ADMIN, { driver_id: "LIVE_1", note: "Busy driver" })).status).toBe(409);
  reset({ drivers: [makeDriver({ ...LIVE, checkr_status: "pending", approval_status: "pending" })], rides: [makeRide({ id: "R6", status: "awaiting_driver_acceptance", driver_id: null })] });
  expect((await call("post", "/api/admin/dispatch/rides/R6/reassign", ADMIN, { driver_id: "LIVE_1", note: "Unverified driver" })).status).toBe(409);
});

test("driver bounties are switched off: refused and nothing recorded", async () => {
  reset({ rides: [makeRide({ id: "R1", status: "awaiting_driver_acceptance", driver_id: null })] });
  const res = await call("post", "/api/admin/dispatch/rides/R1/bounty", ADMIN, { amount_dollars: 8, reason: "Hard to fill trip" });
  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/switched off/);
  expect(state().ride_driver_bounties).toHaveLength(0);
});

test("if switched on later: a budget is required, and a proposal is only recorded", async () => {
  reset({ rides: [makeRide({ id: "R1", status: "awaiting_driver_acceptance", driver_id: null })], flags: [{ key: "driver_bounty_enabled", value: "true" }] });
  expect((await call("post", "/api/admin/dispatch/rides/R1/bounty", ADMIN, { amount_dollars: 8, reason: "Hard to fill trip" })).status).toBe(409);
  state().system_flags.push({ key: "driver_bounty_monthly_budget_cents", value: "5000" });
  const res = await call("post", "/api/admin/dispatch/rides/R1/bounty", ADMIN, { amount_dollars: 8, reason: "Hard to fill trip" });
  expect(res.status).toBe(201);
  expect(res.body.note).toMatch(/nothing is paid/);
  expect(state().ride_driver_bounties[0]).toMatchObject({ ride_id: "R1", amount_cents: 800, status: "proposed" });
});
