// POST /api/persona/inquiry writes persona_inquiry_id/persona_status on a
// rider or driver row, so only the signed-in account itself may call it.
// Synthetic data; Persona is not configured, so an allowed call stops at
// the Persona step (502) without contacting Persona.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.PERSONA_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, makeDriver } = require("./rideTestHelpers");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  ({ app } = require("../server"));
});
beforeEach(() => {
  mockClient = createFakeSupabase({
    drivers: [makeDriver({ id: "DRV_SELF", persona_status: "approved", persona_inquiry_id: "inq_KEEP" }), makeDriver({ id: "DRV_OTHER", persona_status: "approved", persona_inquiry_id: "inq_OTHER" })],
    riders: [{ id: "RIDER_X", persona_status: "approved", persona_inquiry_id: "inq_R" }],
    audit_logs: [],
    system_flags: []
  });
});

const body = (user_type, user_id) => ({ user_type, user_id, email: "synthetic@example.test", first_name: "Syn", last_name: "Thetic" });
const writes = () => mockClient._log.filter((e) => e.op === "update" && (e.table === "drivers" || e.table === "riders"));

test("no sign-in: refused, nothing written", async () => {
  for (const [type, id] of [["driver", "DRV_OTHER"], ["rider", "RIDER_X"]]) {
    const res = await request(app).post("/api/persona/inquiry").send(body(type, id));
    expect(res.status).toBe(401);
  }
  expect(writes()).toEqual([]);
  expect(mockClient._state.drivers.find((d) => d.id === "DRV_OTHER").persona_inquiry_id).toBe("inq_OTHER");
});

test("signed in as another driver: refused, nothing written", async () => {
  const res = await request(app).post("/api/persona/inquiry").set(driverAuthHeaders(signTestDriverToken("DRV_SELF"))).send(body("driver", "DRV_OTHER"));
  expect(res.status).toBe(403);
  expect(writes()).toEqual([]);
});

test("a driver token can't start a rider's check", async () => {
  const res = await request(app).post("/api/persona/inquiry").set(driverAuthHeaders(signTestDriverToken("DRV_SELF"))).send(body("rider", "RIDER_X"));
  expect(res.status).toBe(401);
  expect(writes()).toEqual([]);
});

test("signed in as the same driver: allowed through to the Persona step", async () => {
  const res = await request(app).post("/api/persona/inquiry").set(driverAuthHeaders(signTestDriverToken("DRV_SELF"))).send(body("driver", "DRV_SELF"));
  expect([401, 403]).not.toContain(res.status);
});
