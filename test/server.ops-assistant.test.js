// Operations assistant over the real Express routes (supertest), with
// Supabase replaced by the in-memory fake seeded from the labelled test
// fixtures (test/fixtures/opsScenarios.js). Covers the three demo cases
// (complicated investigation, staff-approved action verified, escalation),
// rider/driver isolation, follow-up questions, case memory, concurrency,
// the action switches and retention/deletion.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.OPS_CASES_PER_MINUTE = "100000";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { LIVE_COLUMNS } = require("./liveSchema");
const { signTestRiderToken, signTestDriverToken, riderAuthHeaders, driverAuthHeaders } = require("./rideTestHelpers");
const { buildSeed, DEMO } = require("./fixtures/opsScenarios");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy({}, {
  get(_t, prop) {
    const v = currentFake[prop];
    return typeof v === "function" ? v.bind(currentFake) : v;
  }
});

const ADMIN = { "x-admin-token": "test-admin-token" };
const riderA = riderAuthHeaders(signTestRiderToken("TEST-RIDER-A"));
const riderB = riderAuthHeaders(signTestRiderToken("TEST-RIDER-B"));

function useFake({ flags = {}, options = {} } = {}) {
  const seed = buildSeed(Date.now());
  seed.system_flags = Object.entries({ ops_assistant_enabled: "true", ...flags }).map(([key, value]) => ({ key, value }));
  currentFake = createFakeSupabase(seed, { columns: { rides: LIVE_COLUMNS.rides, driver_offers: LIVE_COLUMNS.driver_offers }, ...options });
  currentFake.rpc = jest.fn(async (fn) =>
    fn === "dispatch_ride_atomic" ? { data: null, error: { message: "rpc unavailable in fake" } } : { data: null, error: null }
  );
  return currentFake;
}
const openRider = (headers, body) => request(app).post("/api/ops/rider/cases").set(headers).send(body);
const activity = (action) => currentFake._state.audit_logs.filter((a) => a.action === action);

let app;
beforeAll(() => {
  useFake();
  ({ app } = require("../server"));
});

describe("availability", () => {
  test("rider and driver routes are off unless ops_assistant_enabled", async () => {
    useFake({ flags: { ops_assistant_enabled: "false" } });
    expect((await openRider(riderA, { message: "hi", ride_id: "TEST-RIDE-HOLD" })).status).toBe(503);
  });

  test("a verified session is required", async () => {
    useFake();
    expect([401, 403]).toContain((await openRider({}, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId })).status);
  });
});

describe("TEST CASE 1: complicated report investigated", () => {
  test("facts, conflicts, missing information and hypotheses are separated; rider sees a safe view", async () => {
    useFake();
    const res = await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId });
    expect(res.status).toBe(200);
    const view = res.body.case;
    expect(view.state).toBe("needs_human_review");
    expect(view.issues).toEqual(expect.arrayContaining(["Missed pickup", "Payment discrepancy"]));
    expect(view.summary).toMatch(/passed this to the Harvey Taxi team/);
    expect(view.your_actions.map((a) => a.action)).toEqual(["cancel_ride_no_fee"]);
    // The rider's view carries no hypotheses, conflicts, driver location or internal notes.
    expect(JSON.stringify(view)).not.toMatch(/hypothes|conflict|1\.42 mi|location snapshot|heartbeat|decision_summary/i);

    const full = (await request(app).get(`/api/admin/ops/cases/${view.case_id}`).set(ADMIN)).body.case;
    const missed = full.summary.findings.find((f) => f.category === "missed_pickup");
    const payment = full.summary.findings.find((f) => f.category === "payment_discrepancy");
    expect(missed.facts.map((f) => f.source)).toEqual(expect.arrayContaining(["rides.arrived_at", "audit_logs driver_arrived (location snapshot)"]));
    expect(missed.conflicts[0]).toMatchObject({ claim: expect.stringMatching(/never arrived/), source: "audit_logs driver_arrived" });
    expect(missed.conflicts[0].evidence).toMatch(/1\.42 mi/);
    expect(missed.hypotheses[0].text).toMatch(/may have marked arrived before reaching/);
    expect(missed.missing.map((m) => m.text).join(" ")).toMatch(/15-minute wait/);
    expect(payment.conflicts[0].reading).toMatch(/authorization hold/);
    expect(full.summary.timeline.map((e) => e.kind)).toEqual(expect.arrayContaining(["driver_accepted", "driver_arrived", "audit_driver_arrived"]));
    expect(full.summary.policy_refs.map((p) => p.id)).toEqual(expect.arrayContaining(["POL-CANCEL-NO-FEE", "POL-FINANCIAL-LIMIT"]));
    expect(full.summary.decision_summary).toMatch(/Investigated ride TEST-RIDE-ARRIVED-FAR/);
    expect(JSON.stringify(full)).not.toMatch(/confidence|probability|\d+%/i);
    // Investigating never changed the ride.
    expect(currentFake._log.filter((e) => e.table === "rides" && e.op !== "select")).toHaveLength(0);
  });

  test("the rider cancels in the app; the case verifies it from the ride record and stays with staff", async () => {
    useFake();
    const caseId = (await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId })).body.case.case_id;
    // Rider confirms through the existing cancel route (not through the assistant).
    const cancel = await request(app).post(`/api/rides/${DEMO.complicated.rideId}/cancel`).set(riderA).send({ reason: "driver did not arrive" });
    expect(cancel.status).toBe(200);
    const view = (await request(app).get(`/api/ops/rider/cases/${caseId}`).set(riderA)).body.case;
    expect(view.your_actions).toEqual([]);
    expect(view.state).toBe("needs_human_review");
    const full = (await request(app).get(`/api/admin/ops/cases/${caseId}`).set(ADMIN)).body.case;
    expect(full.queue[0]).toMatchObject({ action: "cancel_ride_no_fee", status: "verified", result: { observed: { ride_status: "cancelled" } } });
  });

  test("a second report about the same ride continues the same case (memory)", async () => {
    useFake();
    const first = (await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId })).body.case;
    const second = (await openRider(riderA, { message: "also, the driver drove off", ride_id: DEMO.complicated.rideId })).body.case;
    expect(second.case_id).toBe(first.case_id);
    expect(currentFake._state.agent_ops_cases).toHaveLength(1);
    // No raw text is stored.
    expect(JSON.stringify(currentFake._state.agent_ops_cases)).not.toMatch(/waited 15 minutes at the corner/);
  });
});

describe("isolation", () => {
  test("another rider cannot open or read a case about someone else's ride", async () => {
    useFake();
    const caseId = (await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId })).body.case.case_id;
    expect((await openRider(riderB, { message: "driver never came", ride_id: DEMO.complicated.rideId })).status).toBe(404);
    expect((await request(app).get(`/api/ops/rider/cases/${caseId}`).set(riderB)).status).toBe(404);
  });

  test("the ride's driver cannot read the rider's case, and gets their own case with a driver view", async () => {
    useFake();
    const caseId = (await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId })).body.case.case_id;
    const driver = driverAuthHeaders(signTestDriverToken("TEST-DRIVER-1"));
    expect((await request(app).get(`/api/ops/driver/cases/${caseId}`).set(driver)).status).toBe(404);
    const own = await request(app).post("/api/ops/driver/cases").set(driver).send({ message: "The rider says I never came but I was there", ride_id: DEMO.complicated.rideId });
    expect(own.status).toBe(200);
    expect(own.body.case.case_id).not.toBe(caseId);
    expect(JSON.stringify(own.body.case)).not.toMatch(/\+1615|example\.test/);
  });

  test("a rider without a ride gets a follow-up question listing only their own rides; answering continues the case", async () => {
    useFake();
    const res = await openRider(riderB, { message: "nobody accepted my ride" });
    expect(res.body.case.state).toBe("investigating");
    const q = res.body.case.questions[0];
    expect(q.id).toBe("which_ride");
    expect(q.options.map((o) => o.ride_id)).toEqual(["TEST-RIDE-EXHAUSTED"]);
    const answered = await request(app).post(`/api/ops/rider/cases/${res.body.case.case_id}/reply`).set(riderB).send({ answers: { which_ride: "TEST-RIDE-EXHAUSTED" } });
    expect(answered.body.case.state).toBe("needs_human_review");
    expect(answered.body.case.ride_id).toBe("TEST-RIDE-EXHAUSTED");
    // Naming another rider's ride in an answer is refused.
    const res2 = await openRider(riderB, { message: "nobody accepted my ride" });
    const hijack = await request(app).post(`/api/ops/rider/cases/${res2.body.case.case_id}/reply`).set(riderB).send({ answers: { which_ride: "TEST-RIDE-HOLD" } });
    expect(hijack.status).toBe(404);
  });
});

describe("TEST CASE 2: staff-approved action, executed and verified", () => {
  async function openStalled() {
    const res = await request(app).post("/api/admin/ops/cases").set(ADMIN).send({ ride_id: DEMO.action.rideId, message: DEMO.action.message });
    expect(res.status).toBe(200);
    return res.body.case;
  }

  test("planned, awaiting confirmation; approval is refused while actions are switched off", async () => {
    useFake();
    const c = await openStalled();
    expect(c.state).toBe("awaiting_confirmation");
    expect(c.queue).toEqual([expect.objectContaining({ id: "A1", action: "redispatch_ride", confirm_by: "admin", status: "awaiting_confirmation" })]);
    const res = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ops_actions_enabled/);
    expect(currentFake._state.driver_offers.filter((o) => o.status === "pending")).toHaveLength(0);
  });

  test("approved: runs through dispatchRide, verified from the database, case resolved; a second approval cannot run it again", async () => {
    useFake({ flags: { ops_actions_enabled: "true" } });
    const c = await openStalled();
    const res = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toMatchObject({ executed: true, verified: true, observed: { pending_offers: 1 } });
    expect(res.body.case.state).toBe("resolved");
    expect(res.body.case.steps.map((s) => [s.step, s.status])).toEqual([
      ["investigate", "done"],
      ["plan", "done"],
      ["policy_check", "done"],
      ["confirmation", "done"],
      ["execute", "done"],
      ["verify", "done"]
    ]);
    const pending = currentFake._state.driver_offers.filter((o) => o.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].driver_id).toBe("TEST-DRIVER-5");
    const again = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(again.status).toBe(409);
    expect(currentFake._state.driver_offers.filter((o) => o.status === "pending")).toHaveLength(1);
    expect(activity("ops.action_verified")).toHaveLength(1);
  });

  test("two staff approving at the same moment: one executes, the other gets a conflict", async () => {
    useFake({ flags: { ops_actions_enabled: "true" } });
    const c = await openStalled();
    const [a, b] = await Promise.all([
      request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({}),
      request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({})
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(currentFake._state.driver_offers.filter((o) => o.status === "pending")).toHaveLength(1);
  });

  test("the kill switch blocks execution", async () => {
    useFake({ flags: { ops_actions_enabled: "true", agent_kill_switch: "true" } });
    const c = await openStalled();
    const res = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/kill switch/);
  });

  test("if the ride changed after the investigation, the action is blocked and sent to staff, not executed", async () => {
    useFake({ flags: { ops_actions_enabled: "true" } });
    const c = await openStalled();
    Object.assign(currentFake._state.rides.find((r) => r.id === DEMO.action.rideId), { status: "cancelled" });
    const res = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome.executed).toBe(false);
    expect(res.body.case.state).toBe("needs_human_review");
    expect(res.body.case.queue[0].status).toBe("blocked");
  });

  test("dispatch finds no driver: executed but not verified, so it goes to staff instead of claiming success", async () => {
    useFake({ flags: { ops_actions_enabled: "true" } });
    currentFake._state.drivers = currentFake._state.drivers.filter((d) => d.id !== "TEST-DRIVER-5");
    const c = await openStalled();
    const res = await request(app).post(`/api/admin/ops/cases/${c.id}/actions/A1/approve`).set(ADMIN).send({});
    expect(res.body.outcome).toMatchObject({ executed: true, verified: false });
    expect(res.body.case.state).toBe("needs_human_review");
    expect(activity("ops.action_failed")).toHaveLength(1);
  });
});

describe("TEST CASE 3: escalation", () => {
  test("a disputed double charge goes to staff with no assistant action and the $0 financial limit cited", async () => {
    useFake();
    const res = await openRider(riderA, { message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId });
    expect(res.body.case.state).toBe("needs_human_review");
    expect(res.body.case.your_actions).toEqual([]);
    const full = (await request(app).get(`/api/admin/ops/cases/${res.body.case.case_id}`).set(ADMIN)).body.case;
    expect(full.summary.understanding.boundary.category).toBe("disputed_charge");
    expect(full.queue).toEqual([]);
    expect(full.summary.policy_refs.map((p) => p.id)).toContain("POL-FINANCIAL-LIMIT");
    expect(full.summary.decision_summary).toMatch(/Sent to staff/);
  });

  test("staff resolve the case with a recorded resolution", async () => {
    useFake();
    const id = (await openRider(riderA, { message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId })).body.case.case_id;
    expect((await request(app).post(`/api/admin/ops/cases/${id}/resolve`).set(ADMIN).send({ resolution: "bogus" })).status).toBe(400);
    const res = await request(app).post(`/api/admin/ops/cases/${id}/resolve`).set(ADMIN).send({ resolution: "refund_reviewed", note: "checked processor" });
    expect(res.body.case.state).toBe("resolved");
    expect(res.body.case.summary.staff_resolution).toMatchObject({ resolution: "refund_reviewed" });
  });
});

describe("memory: retention, deletion, unavailable table", () => {
  test("expired cases are purged", async () => {
    useFake();
    await openRider(riderA, { message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId });
    currentFake._state.agent_ops_cases[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await request(app).post("/api/admin/ops/retention/purge").set(ADMIN).send({});
    expect(res.body.purged).toBe(1);
    expect(currentFake._state.agent_ops_cases).toHaveLength(0);
  });

  test("deleting an account deletes its cases", async () => {
    useFake();
    await openRider(riderA, { message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId });
    currentFake._state.deletion_requests = [{ request_id: "TEST-DEL-1", user_type: "rider", user_id: "TEST-RIDER-A", status: "pending" }];
    const res = await request(app).post("/api/admin/deletion-requests/TEST-DEL-1/approve").set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(currentFake._state.agent_ops_cases).toHaveLength(0);
  });

  test("without the migration, investigation still works statelessly and the overview says memory is unavailable", async () => {
    useFake({ options: { failSelect: (t) => (t === "agent_ops_cases" ? { code: "42P01", message: "relation does not exist" } : null) } });
    const orig = currentFake.from.bind(currentFake);
    currentFake.from = (t) => {
      const b = orig(t);
      if (t === "agent_ops_cases") b.insert = () => Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } });
      return b;
    };
    const res = await openRider(riderA, { message: DEMO.escalation.message, ride_id: DEMO.escalation.rideId });
    expect(res.status).toBe(200);
    expect(res.body.memory).toBe(false);
    expect(res.body.case.state).toBe("needs_human_review");
    const ov = await request(app).get("/api/admin/ops/overview").set(ADMIN);
    expect(ov.body.memory_available).toBe(false);
  });
});

describe("admin overview", () => {
  test("shows live operations, case states, the action queue and real agent activity", async () => {
    useFake();
    await openRider(riderA, { message: DEMO.complicated.message, ride_id: DEMO.complicated.rideId });
    await request(app).post("/api/admin/ops/cases").set(ADMIN).send({ ride_id: DEMO.action.rideId, message: DEMO.action.message });
    const ov = (await request(app).get("/api/admin/ops/overview").set(ADMIN)).body;
    expect(ov.case_counts).toMatchObject({ needs_human_review: 1, awaiting_confirmation: 1 });
    expect(ov.queue.map((q) => q.action)).toEqual(expect.arrayContaining(["redispatch_ride"]));
    expect(ov.activity.map((a) => a.action)).toEqual(expect.arrayContaining(["ops.case_opened", "ops.case_investigated"]));
    expect(ov.live.counts.open_rides).toBeGreaterThan(0);
    expect(ov.actions_enabled).toBe(false);
  });
});

describe("driver status changes record location evidence", () => {
  test("marking arrived logs distance to pickup and location age, not coordinates", async () => {
    useFake();
    const ride = currentFake._state.rides.find((r) => r.id === "TEST-RIDE-ENROUTE");
    const res = await request(app)
      .post("/api/driver/rides/TEST-RIDE-ENROUTE/arrived")
      .set(driverAuthHeaders(signTestDriverToken("TEST-DRIVER-4")))
      .send({});
    expect(res.status).toBe(200);
    expect(ride.status).toBe("arrived");
    const entry = currentFake._state.audit_logs.find((a) => a.action === "driver_arrived" && a.entity_id === "TEST-RIDE-ENROUTE");
    expect(entry.metadata).toMatchObject({ location_known: true, location_age_seconds: expect.any(Number) });
    expect(entry.metadata.distance_to_pickup_miles).toBeGreaterThan(0);
    expect(JSON.stringify(entry.metadata)).not.toMatch(/lat|lng/);
  });
});
