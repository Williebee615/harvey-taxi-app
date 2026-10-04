// Support handoff (docs/ai-knowledge.md, phase 4): the draft is the user's
// own questions; nothing is sent without approval and sign-in; a request
// is recorded in the human-review queue and only then gets a reference;
// a failed save is reported as not sent.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, signTestRiderToken, riderAuthHeaders, makeRider, makeDriver, makeRide } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };

// Each test calls from its own address, so the per-IP route limit (shared
// by the whole file otherwise) doesn't leak between tests.
let testIp = 0;
const post = (path) => request(app).post(path).set("X-Forwarded-For", `198.51.100.${testIp}`);

function useFake({ enabled = true, failAudit = false } = {}) {
  testIp += 1;
  currentFake = createFakeSupabase(
    {
      riders: [makeRider(), ...["A", "B", "C", "D", "E", "F", "G"].map((x, i) => makeRider({ id: `RIDER_${x}`, phone: `+1615555030${i}`, email: `rider-${x.toLowerCase()}@example.test` }))],
      drivers: [makeDriver()],
      rides: [
        // Test fixtures: one recent completed trip each, plus another rider's.
        makeRide({ id: "TEST-RIDE-R1", rider_id: "RIDER_1", driver_id: "DRIVER_1", status: "completed", pickup_address: "TEST 1 Broadway", dropoff_address: "TEST BNA", created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), completed_at: new Date(Date.now() - 2 * 3600e3).toISOString() }),
        makeRide({ id: "TEST-RIDE-RF", rider_id: "RIDER_F", driver_id: "DRIVER_1", status: "completed", pickup_address: "TEST 1 Broadway", dropoff_address: "TEST BNA", created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), completed_at: new Date(Date.now() - 2 * 3600e3).toISOString() }),
        makeRide({ id: "TEST-RIDE-OTHER", rider_id: "RIDER_9", driver_id: "DRIVER_9", status: "completed", created_at: new Date(Date.now() - 3600e3).toISOString() })
      ],
      driver_offers: [],
      audit_logs: [],
      system_flags: [
        { key: "agent_assist_enabled", value: enabled ? "true" : "false" },
        { key: "agent_kill_switch", value: "false" }
      ]
    },
    failAudit ? { failInsert: (table) => (table === "audit_logs" ? { message: "database unavailable" } : null) } : {}
  );
  return currentFake;
}

let app;
beforeAll(() => {
  useFake();
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const RIDER = (id = "RIDER_1") => riderAuthHeaders(signTestRiderToken(id));
const DRIVER = () => driverAuthHeaders(signTestDriverToken("DRIVER_1"));
const SUMMARY = "I need help from Harvey Taxi support.\n\nWhat I asked the assistant:\n- What is the cancellation fee?\n\nMore details: I was charged after cancelling.";
const cases = () => currentFake._state.audit_logs.filter((a) => a.action === "agent.case_opened");
const emails = () => currentFake._state.audit_logs.filter((a) => a.action === "agent.handoff_email");

test("draft: the user's own recent questions only; works signed out; nothing recorded", async () => {
  useFake();
  const res = await request(app)
    .post("/api/agent/rider/handoff/draft")
    .send({ context: [{ role: "user", text: "What is the cancellation fee?" }, { role: "assistant", text: "I don't have approved information." }] });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ signed_in: false, note: expect.stringMatching(/Nothing is sent until you tap Send to support/) });
  expect(res.body.draft).toContain("- What is the cancellation fee?");
  expect(res.body.draft).not.toContain("approved information");
  expect(currentFake._state.audit_logs).toEqual([]);
});

test("send: signed-out riders are asked to sign in; nothing is recorded", async () => {
  useFake();
  const res = await post("/api/agent/rider/handoff").send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(401);
  expect(cases()).toEqual([]);
});

test("send: refused without explicit approval or with an empty summary", async () => {
  useFake();
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY })).status).toBe(400);
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: "yes" })).status).toBe(400);
  expect((await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: "  ", approved: true })).status).toBe(400);
  expect(cases()).toEqual([]);
});

test("rider send: recorded as a support case with the approved text (masked), then a reference", async () => {
  useFake();
  const res = await request(app)
    .post("/api/agent/rider/handoff")
    .set(RIDER())
    .set("User-Agent", "Mozilla/5.0 (iPhone) HarveyTaxiRider/1.0.2 (ios)")
    .send({ summary: `${SUMMARY} Card 4242 4242 4242 4242.`, approved: true });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ sent: true, reference: expect.stringMatching(/^HT-SUP-\d{8}-[A-Z0-9]{6}$/) });
  expect(res.body.message).toContain(res.body.reference);
  const [row] = cases();
  expect(row).toMatchObject({ entity_id: res.body.reference, entity_type: "agent_case" });
  expect(row.metadata).toMatchObject({ category: "support_request", reporter_role: "rider", reporter_id: "RIDER_1", app_target: "rider_ios_app", approved_by_user: true });
  expect(row.metadata.summary).toContain("I was charged after cancelling.");
  expect(row.metadata.summary).toContain("[card]");
  expect(row.metadata.summary).not.toContain("4242");

  // Visible to staff in the existing human-review queue.
  const overview = await request(app).get("/api/admin/agent/overview").set(ADMIN);
  const listed = overview.body.cases.find((c) => c.case_id === res.body.reference);
  expect(listed).toMatchObject({ category: "support_request", status: "open", reporter_id: "RIDER_1", source: "handoff", app_target: "rider_ios_app" });
  expect(listed.summary).toContain("I was charged after cancelling.");
});

test("driver send from the app: own account only, platform recorded", async () => {
  useFake();
  const res = await post("/api/agent/driver/handoff").set(DRIVER()).send({ summary: SUMMARY, approved: true, client: "driver_app", platform: "android" });
  expect(res.status).toBe(200);
  expect(cases()[0].metadata).toMatchObject({ reporter_role: "driver", reporter_id: "DRIVER_1", app_target: "driver_android_app" });
  // The account comes from the session, never the body.
  await post("/api/agent/driver/handoff").set(DRIVER()).send({ summary: `${SUMMARY} (second request)`, approved: true, driver_id: "DRIVER_2", reporter_id: "DRIVER_2" });
  expect(cases()[1].metadata.reporter_id).toBe("DRIVER_1");
  expect((await post("/api/agent/driver/handoff").send({ summary: SUMMARY, approved: true })).status).toBe(401);
});

test("a failed save is reported as not sent, with no reference", async () => {
  useFake({ failAudit: true });
  const res = await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(503);
  expect(res.body).toMatchObject({ ok: false, sent: false });
  expect(res.body.reference).toBeUndefined();
  expect(res.body.error).toMatch(/was not sent/);
});

test("assistant switched off: nothing sent", async () => {
  useFake({ enabled: false });
  const res = await post("/api/agent/rider/handoff").set(RIDER()).send({ summary: SUMMARY, approved: true });
  expect(res.status).toBe(503);
  expect(res.body.sent).toBe(false);
  expect(cases()).toEqual([]);
  expect((await post("/api/agent/rider/handoff/draft").send({})).status).toBe(503);
});

test("at most 5 requests per account per hour", async () => {
  useFake();
  let n = 0;
  const send = () => {
    n += 1;
    return post("/api/agent/driver/handoff").set(driverAuthHeaders(signTestDriverToken("DRIVER_LIMIT"))).send({ summary: `${SUMMARY} #${n}`, approved: true });
  };
  currentFake._state.drivers.push(makeDriver({ id: "DRIVER_LIMIT", phone: "+16155550999" }));
  for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(200);
  const sixth = await send();
  expect(sixth.status).toBe(429);
  expect(sixth.body.sent).toBe(false);
});

describe("finishing touches: duplicates, email vs case, lost items", () => {
  test("case creation and email are reported separately; email copy goes to support@harveytaxiservice.com", async () => {
    useFake();
    const res = await post("/api/agent/rider/handoff").set(RIDER("RIDER_A")).send({ summary: `${SUMMARY} [email]`, approved: true, request_id: "req-aaaaaaaa-1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: true, case_created: true, duplicate: false, kind: "general", email: { status: "not_configured" } });
    expect(res.body.message).toMatch(/^Received\. Your request is in Harvey Taxi's support queue as case HT-SUP-/);
    expect(res.body.message).not.toMatch(/email/i);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ entity_id: res.body.reference, metadata: { status: "not_configured", to: "support@harveytaxiservice.com" } });
    const overview = await request(app).get("/api/admin/agent/overview").set(ADMIN);
    expect(overview.body.cases.find((c) => c.case_id === res.body.reference)).toMatchObject({ email_status: "not_configured" });
    // The email row stays out of the decision log.
    expect(overview.body.decisions.some((d) => d.action === "agent.handoff_email")).toBe(false);
  });

  test("a retry or double tap with the same request id returns the first case; no second case or email", async () => {
    useFake();
    const body = { summary: `${SUMMARY} [retry]`, approved: true, request_id: "req-bbbbbbbb-2" };
    const first = await post("/api/agent/rider/handoff").set(RIDER("RIDER_B")).send(body);
    const again = await post("/api/agent/rider/handoff").set(RIDER("RIDER_B")).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, reference: first.body.reference });
    expect(again.body.message).toContain("no second case was created");
    expect(cases()).toHaveLength(1);
    expect(emails()).toHaveLength(1);
  });

  test("simultaneous duplicates share one save", async () => {
    useFake();
    const body = { summary: `${SUMMARY} [concurrent]`, approved: true, request_id: "req-cccccccc-3" };
    const [a, b] = await Promise.all([post("/api/agent/rider/handoff").set(RIDER("RIDER_C")).send(body), post("/api/agent/rider/handoff").set(RIDER("RIDER_C")).send(body)]);
    expect(a.body.reference).toBe(b.body.reference);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    expect(cases()).toHaveLength(1);
  });

  test("the same text from the same account soon after is treated as a duplicate; another account is not", async () => {
    useFake();
    const text = `${SUMMARY} [same text]`;
    const first = await post("/api/agent/rider/handoff").set(RIDER("RIDER_D")).send({ summary: text, approved: true });
    const again = await post("/api/agent/rider/handoff").set(RIDER("RIDER_D")).send({ summary: text, approved: true });
    expect(again.body).toMatchObject({ duplicate: true, reference: first.body.reference });
    const driver = await post("/api/agent/driver/handoff").set(DRIVER()).send({ summary: text, approved: true });
    expect(driver.body.duplicate).toBe(false);
    expect(cases()).toHaveLength(2);
  });

  test("a failed save is not remembered: retrying the same request id can succeed", async () => {
    useFake({ failAudit: true });
    const body = { summary: `${SUMMARY} retry`, approved: true, request_id: "req-dddddddd-4" };
    expect((await post("/api/agent/rider/handoff").set(RIDER("RIDER_E")).send(body)).status).toBe(503);
    const failed = currentFake;
    useFake();
    testIp -= 1; // same caller
    const retry = await post("/api/agent/rider/handoff").set(RIDER("RIDER_E")).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(false);
    expect(cases()).toHaveLength(1);
    expect(failed._state.audit_logs.filter((a) => a.action === "agent.case_opened")).toHaveLength(0);
  });

  test("lost item (rider): asked about it, the assistant offers a report; the draft names the rider's own recent trip", async () => {
    useFake();
    const ask = await post("/api/agent/rider/assist").set(RIDER("RIDER_F")).send({ message: "I left my phone in the car" });
    expect(ask.body.intent).toBe("lost_item");
    expect(ask.body.actions[0]).toMatchObject({ type: "support_handoff", kind: "lost_item", label: "Report a lost item" });
    expect(ask.body.reply).toMatch(/can't promise the item will be found/);
    const draft = await post("/api/agent/rider/handoff/draft").set(RIDER("RIDER_F")).send({ kind: "lost_item" });
    expect(draft.body.kind).toBe("lost_item");
    expect(draft.body.ride).toMatchObject({ id: "TEST-RIDE-RF" });
    expect(draft.body.draft).toMatch(/^Lost item report\.\n\nTrip: .+: TEST 1 Broadway to TEST BNA\nItem: /);
    const sent = await post("/api/agent/rider/handoff")
      .set(RIDER("RIDER_F"))
      .send({ kind: "lost_item", ride_id: "TEST-RIDE-RF", approved: true, summary: draft.body.draft.replace("Item: ", "Item: black phone (test fixture)") });
    expect(sent.status).toBe(200);
    expect(sent.body.message).toMatch(/Your report is in Harvey Taxi's support queue/);
    expect(cases()[0].metadata).toMatchObject({ category: "lost_item", ride_id: "TEST-RIDE-RF", reporter_id: "RIDER_F" });
  });

  test("lost item: another account's trip is refused; signed-out drafts get no trip", async () => {
    useFake();
    const res = await post("/api/agent/rider/handoff").set(RIDER("RIDER_G")).send({ kind: "lost_item", ride_id: "TEST-RIDE-OTHER", approved: true, summary: "Lost item report. Item: test fixture" });
    expect(res.status).toBe(400);
    expect(cases()).toEqual([]);
    const anon = await post("/api/agent/rider/handoff/draft").send({ kind: "lost_item" });
    expect(anon.body).toMatchObject({ signed_in: false, ride: null });
    expect(anon.body.draft).toContain("Trip: (add the date, time and route)");
  });

  test("found item (driver): the draft uses the driver's own trip", async () => {
    useFake();
    const ask = await post("/api/agent/driver/assist").set(DRIVER()).send({ message: "A rider left a bag in my car", client: "driver_app" });
    expect(ask.body.actions[0]).toMatchObject({ type: "support_handoff", kind: "lost_item", label: "Report a found item" });
    const draft = await post("/api/agent/driver/handoff/draft").set(DRIVER()).send({ kind: "lost_item" });
    expect(draft.body.ride).toMatchObject({ id: "TEST-RIDE-R1" });
    expect(draft.body.draft).toMatch(/^Found item report/);
  });
});
