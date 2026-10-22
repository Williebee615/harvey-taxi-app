// Fleet management phase 1 (docs/fleet-management-plan.md; owner decisions
// 2026-10-22): the switch, the application and staff review, vehicles and
// staff-verified documents, invitations the driver must accept, the owner's
// limited view, assignments that swap the driver's vehicle and restore it,
// the go-online check and the recorded earnings split (no money moves).
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_PAYMENT_GATE = "false";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, makeRider, makeRide, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.setTimeout(60_000);

const OWNER = makeDriver({ id: "OWNER_1", first_name: "Olivia", phone: "+16155550201", online: false });
const MEMBER = makeDriver({ id: "MEMBER_1", first_name: "Sam", email: "sam@example.test", phone: "+16155550202", online: false, vehicle_make: "Honda", vehicle_model: "Civic", vehicle_year: "2019", vehicle_color: "Red", vehicle_plate: "OWN1", license_plate: "OWN1" });
const UNVERIFIED = makeDriver({ id: "NEW_1", phone: "+16155550203", email_verified: false, online: false });
const ADMIN = { "x-admin-token": "test-admin-token" };
const as = (driver) => driverAuthHeaders(signTestDriverToken(driver.id));
const FAR = "2027-06-30";

let app;
let ip = 0;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({}, { uniqueColumns: { driver_earnings: ["ride_id"] } });
  ({ app } = require("../server"));
});

function reset(flagOn = true) {
  const state = mockSupabaseClient._state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, {
    drivers: [OWNER, MEMBER, UNVERIFIED].map((d) => ({ ...d })),
    riders: [makeRider({ id: "RIDER_1" })],
    rides: [],
    driver_earnings: [],
    audit_logs: [],
    driver_online_sessions: [],
    fleets: [],
    fleet_vehicles: [],
    fleet_vehicle_documents: [],
    fleet_memberships: [],
    vehicle_assignments: [],
    system_flags: flagOn ? [{ key: "fleet_management_enabled", value: "true" }] : []
  });
}
const call = (method, path, headers, body) => {
  const r = request(app)[method](path).set("X-Forwarded-For", `10.91.${Math.floor(++ip / 250)}.${ip % 250}`).set(headers || {});
  return body === undefined ? r : r.send(body);
};
const state = () => mockSupabaseClient._state;
const actions = () => state().audit_logs.map((a) => a.action);
const memberRow = () => state().drivers.find((d) => d.id === MEMBER.id);

// Owner applies, staff approve, owner adds a vehicle with staff-verified
// documents, staff activate it, owner invites Sam, Sam accepts.
async function activeFleetWithMember() {
  expect((await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" })).status).toBe(201);
  const fleetId = state().fleets[0].id;
  expect((await call("post", `/api/admin/fleets/${fleetId}/review`, ADMIN, { decision: "approve" })).status).toBe(200);
  const v = await call("post", "/api/driver/fleet/vehicles", as(OWNER), { vehicle_year: 2022, make: "Toyota", model: "Camry", color: "Blue", plate: "ABC123", plate_state: "TN", vin_last6: "A1B2C3" });
  expect(v.status).toBe(201);
  const vehicleId = v.body.vehicle.id;
  for (const type of ["insurance", "registration"]) {
    expect((await call("post", `/api/admin/fleet-vehicles/${vehicleId}/documents`, ADMIN, { document_type: type, expires_on: FAR })).status).toBe(201);
  }
  expect((await call("post", `/api/admin/fleet-vehicles/${vehicleId}/status`, ADMIN, { status: "active" })).status).toBe(200);
  const inv = await call("post", "/api/driver/fleet/invitations", as(OWNER), { phone: "(615) 555-0202", owner_share_pct: 20 });
  expect(inv.status).toBe(201);
  expect((await call("post", `/api/driver/fleet/invitations/${inv.body.invitation.id}/respond`, as(MEMBER), { accept: true })).status).toBe(200);
  return { fleetId, vehicleId, membershipId: inv.body.invitation.id };
}

test("with the switch off, driver fleet routes answer 404 and nothing changes", async () => {
  reset(false);
  expect((await call("get", "/api/driver/fleet", as(OWNER))).status).toBe(404);
  expect((await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" })).status).toBe(404);
  expect(state().fleets).toHaveLength(0);
});

test("only a fully verified driver can apply; the owner can't add vehicles until staff approve", async () => {
  reset();
  expect((await call("post", "/api/driver/fleet/apply", as(UNVERIFIED), { name: "Unready" })).status).toBe(403);
  expect((await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" })).status).toBe(201);
  expect(state().fleets[0]).toMatchObject({ owner_driver_id: OWNER.id, status: "pending" });
  expect((await call("post", "/api/driver/fleet/vehicles", as(OWNER), { vehicle_year: 2022, make: "Toyota", model: "Camry", color: "Blue", plate: "ABC123", plate_state: "TN", vin_last6: "A1B2C3" })).status).toBe(403);
  const fleetId = state().fleets[0].id;
  expect((await call("post", `/api/admin/fleets/${fleetId}/review`, ADMIN, { decision: "decline" })).status).toBe(400);
  expect((await call("post", `/api/admin/fleets/${fleetId}/review`, {}, { decision: "approve" })).status).toBe(401);
  expect((await call("post", `/api/admin/fleets/${fleetId}/review`, ADMIN, { decision: "approve" })).status).toBe(200);
  expect(actions()).toEqual(expect.arrayContaining(["fleet_applied", "fleet_approved"]));
});

test("pilot limit: no more than 3 fleets", async () => {
  reset();
  for (let i = 0; i < 3; i += 1) state().fleets.push({ id: `F${i}`, owner_driver_id: `X${i}`, name: "x", status: "active" });
  expect((await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" })).status).toBe(409);
});

test("an autonomous vehicle is refused; a vehicle activates only with staff-verified documents", async () => {
  reset();
  await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" });
  await call("post", `/api/admin/fleets/${state().fleets[0].id}/review`, ADMIN, { decision: "approve" });
  const av = await call("post", "/api/driver/fleet/vehicles", as(OWNER), { vehicle_year: 2025, make: "X", model: "Y", color: "White", plate: "AV1", plate_state: "TN", vin_last6: "A1B2C3", automation: "driverless" });
  expect(av.status).toBe(400);
  expect(av.body.error).toMatch(/Autonomous rides are not available yet/);
  const v = await call("post", "/api/driver/fleet/vehicles", as(OWNER), { vehicle_year: 2022, make: "Toyota", model: "Camry", color: "Blue", plate: "ABC123", plate_state: "TN", vin_last6: "A1B2C3" });
  const vehicleId = v.body.vehicle.id;
  // Dates typed by the owner are unverified: staff can't activate yet.
  for (const type of ["insurance", "registration"]) {
    expect((await call("post", `/api/driver/fleet/vehicles/${vehicleId}/documents`, as(OWNER), { document_type: type, expires_on: FAR })).status).toBe(201);
  }
  const blocked = await call("post", `/api/admin/fleet-vehicles/${vehicleId}/status`, ADMIN, { status: "active" });
  expect(blocked.status).toBe(409);
  expect(blocked.body.reasons).toEqual(["insurance_unverified", "registration_unverified"]);
  for (const type of ["insurance", "registration"]) await call("post", `/api/admin/fleet-vehicles/${vehicleId}/documents`, ADMIN, { document_type: type, expires_on: FAR });
  expect((await call("post", `/api/admin/fleet-vehicles/${vehicleId}/status`, ADMIN, { status: "active" })).status).toBe(200);
  // History kept: the owner's entries are superseded, not deleted.
  expect(state().fleet_vehicle_documents.filter((d) => d.superseded_at)).toHaveLength(2);
});

test("invitations: unknown number, share above 50%, and only the invited driver can answer", async () => {
  reset();
  await call("post", "/api/driver/fleet/apply", as(OWNER), { name: "Music City Cars" });
  await call("post", `/api/admin/fleets/${state().fleets[0].id}/review`, ADMIN, { decision: "approve" });
  expect((await call("post", "/api/driver/fleet/invitations", as(OWNER), { phone: "6155550999", owner_share_pct: 20 })).status).toBe(404);
  expect((await call("post", "/api/driver/fleet/invitations", as(OWNER), { phone: "6155550202", owner_share_pct: 60 })).status).toBe(400);
  expect((await call("post", "/api/driver/fleet/invitations", as(OWNER), { phone: "6155550201", owner_share_pct: 10 })).status).toBe(400);
  const inv = await call("post", "/api/driver/fleet/invitations", as(OWNER), { phone: "6155550202", owner_share_pct: 20 });
  expect(inv.status).toBe(201);
  expect((await call("post", `/api/driver/fleet/invitations/${inv.body.invitation.id}/respond`, as(OWNER), { accept: true })).status).toBe(404);
  expect((await call("post", `/api/driver/fleet/invitations/${inv.body.invitation.id}/respond`, as(MEMBER), { accept: true })).status).toBe(200);
  expect(state().fleet_memberships[0]).toMatchObject({ status: "active", owner_share_pct: 20, agreement_version: "fleet-draft-2026-10-22" });
});

test("the owner sees the driver's first name, vehicle, status and fleet totals, never contact or screening details", async () => {
  reset();
  await activeFleetWithMember();
  const res = await call("get", "/api/driver/fleet", as(OWNER));
  expect(res.status).toBe(200);
  const [member] = res.body.owned_fleet.members;
  expect(member).toMatchObject({ first_name: "Sam", owner_share_pct: 20, online: false });
  const text = JSON.stringify(res.body);
  for (const secret of ["+16155550202", "sam@example.test", "checkr", "current_lat"]) expect(text).not.toContain(secret);
  expect(res.body.payouts_note).toMatch(/recorded only/);
});

test("assignment swaps the driver's vehicle, needs the driver offline, and ending it restores the old one", async () => {
  reset();
  const { vehicleId, membershipId } = await activeFleetWithMember();
  memberRow().online = true;
  expect((await call("post", "/api/driver/fleet/assignments", as(OWNER), { vehicle_id: vehicleId, membership_id: membershipId })).status).toBe(409);
  memberRow().online = false;
  const a = await call("post", "/api/driver/fleet/assignments", as(OWNER), { vehicle_id: vehicleId, membership_id: membershipId });
  expect(a.status).toBe(201);
  expect(memberRow()).toMatchObject({ vehicle_make: "Toyota", vehicle_model: "Camry", vehicle_year: "2022", license_plate: "ABC123" });
  // Can't release the vehicle mid-trip.
  state().rides.push(makeRide({ id: "RIDE_T", status: "in_progress", driver_id: MEMBER.id }));
  expect((await call("post", `/api/driver/fleet/assignments/${a.body.assignment.id}/end`, as(OWNER))).status).toBe(409);
  state().rides[0].status = "completed";
  expect((await call("post", `/api/driver/fleet/assignments/${a.body.assignment.id}/end`, as(MEMBER))).status).toBe(200);
  expect(memberRow()).toMatchObject({ vehicle_make: "Honda", vehicle_model: "Civic", vehicle_year: "2019", license_plate: "OWN1", online: false });
});

test("going online in a fleet vehicle needs its documents current; expired insurance blocks it", async () => {
  reset();
  const { vehicleId, membershipId } = await activeFleetWithMember();
  await call("post", "/api/driver/fleet/assignments", as(OWNER), { vehicle_id: vehicleId, membership_id: membershipId });
  expect((await call("post", "/api/driver/status", as(MEMBER), { online: true })).status).toBe(200);
  await call("post", "/api/driver/status", as(MEMBER), { online: false });
  state().fleet_vehicle_documents.find((d) => d.document_type === "insurance" && !d.superseded_at).expires_on = "2026-01-01";
  const res = await call("post", "/api/driver/status", as(MEMBER), { online: true });
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ code: "fleet_vehicle_not_ready", reasons: ["insurance_expired"] });
  // Drivers without a fleet vehicle are unaffected.
  expect((await call("post", "/api/driver/status", as(OWNER), { online: true })).status).toBe(200);
});

test("a completed fleet trip records the owner's share of the fare, not the tip; no payout is made", async () => {
  reset();
  const { fleetId, vehicleId, membershipId } = await activeFleetWithMember();
  await call("post", "/api/driver/fleet/assignments", as(OWNER), { vehicle_id: vehicleId, membership_id: membershipId });
  memberRow().online = true;
  state().rides.push(makeRide({ id: "RIDE_F", status: "in_progress", rider_id: "RIDER_1", driver_id: MEMBER.id, payment_id: null, payment_status: "not_required", driver_payout: 20, tip_amount: 5, estimated_fare: 26 }));
  const done = await call("post", "/api/driver/rides/RIDE_F/complete", as(MEMBER), {});
  expect(done.status).toBe(200);
  const earning = state().driver_earnings.find((e) => e.ride_id === "RIDE_F");
  expect(earning).toMatchObject({ fleet_id: fleetId, fleet_vehicle_id: vehicleId, fleet_owner_share_pct: 20, fleet_owner_share_amount: 4, total_earning: 25 });
  expect(earning.payout_id ?? null).toBeNull();
  expect(earning.status).toBe("earned");
  const view = await call("get", "/api/driver/fleet", as(MEMBER));
  expect(view.body.fleet_earnings).toEqual({ trips: 1, earnings: 25, owner_share: 4 });
});

test("suspending a fleet releases its vehicles and sets their drivers offline", async () => {
  reset();
  const { fleetId, vehicleId, membershipId } = await activeFleetWithMember();
  await call("post", "/api/driver/fleet/assignments", as(OWNER), { vehicle_id: vehicleId, membership_id: membershipId });
  memberRow().online = true;
  expect((await call("post", `/api/admin/fleets/${fleetId}/review`, ADMIN, { decision: "suspend", reason: "Insurance lapsed" })).status).toBe(200);
  expect(state().vehicle_assignments[0].ends_at).toBeTruthy();
  expect(memberRow()).toMatchObject({ vehicle_make: "Honda", online: false });
  expect(actions()).toEqual(expect.arrayContaining(["fleet_suspended", "fleet_assignment_ended"]));
});

test("the switch routes are admin-only and audited", async () => {
  reset(false);
  expect((await call("post", "/api/admin/system/enable-fleet-management", {}, {})).status).toBe(401);
  expect((await call("post", "/api/admin/system/enable-fleet-management", ADMIN, { reason: "test" })).status).toBe(200);
  expect(state().system_flags.find((f) => f.key === "fleet_management_enabled").value).toBe("true");
  expect(actions()).toContain("fleet_management_enabled");
});
