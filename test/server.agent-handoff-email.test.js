// Support handoff email copy (docs/ai-knowledge.md §5a): with email
// configured, the case is saved first and the email outcome is recorded
// separately: "accepted" when the email service takes it, "failed" when it
// errors. A failed email never undoes the case. The email service is mocked.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
// Email settings for this file only; restored in afterAll so later test
// files in the same worker don't inherit them.
const EMAIL_ENV = { SENDGRID_API_KEY: "SG.test-key-not-real", SENDGRID_FROM_EMAIL: "noreply@example.test", ENABLE_REAL_EMAIL: "true" };
const savedEnv = Object.fromEntries(Object.keys(EMAIL_ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, EMAIL_ENV);
delete process.env.HANDOFF_SUPPORT_EMAIL;
delete process.env.AGENT_LLM_BASE_URL;

const mockSend = jest.fn();
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: (...args) => mockSend(...args) }));

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestRiderToken, riderAuthHeaders, makeRider, makeDriver } = require("./rideTestHelpers");

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

currentFake = createFakeSupabase({
  riders: [makeRider(), makeRider({ id: "RIDER_2", phone: "+16155550399", email: "rider-2@example.test" })],
  drivers: [makeDriver()],
  rides: [],
  audit_logs: [],
  system_flags: [
    { key: "agent_assist_enabled", value: "true" },
    { key: "agent_kill_switch", value: "false" }
  ]
});

let app;
beforeAll(() => {
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const send = (rider, summary) =>
  request(app).post("/api/agent/rider/handoff").set(riderAuthHeaders(signTestRiderToken(rider))).send({ summary, approved: true });
const emailRow = (ref) => currentFake._state.audit_logs.find((a) => a.action === "agent.handoff_email" && a.entity_id === ref);

test("accepted by the email service: sent to support@harveytaxiservice.com with the approved text", async () => {
  mockSend.mockResolvedValueOnce([{ statusCode: 202 }]);
  const res = await send("RIDER_1", "Please check my receipt from last night. (test fixture)");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ case_created: true, email: { status: "accepted" } });
  expect(mockSend).toHaveBeenCalledTimes(1);
  const mail = mockSend.mock.calls[0][0];
  expect(mail.to).toBe("support@harveytaxiservice.com");
  expect(mail.subject).toBe(`Harvey Taxi support request ${res.body.reference}`);
  expect(mail.text).toContain("Please check my receipt from last night.");
  expect(emailRow(res.body.reference).metadata).toEqual({ status: "accepted", to: "support@harveytaxiservice.com" });
});

test("email service error: the case still exists and the email is recorded as failed", async () => {
  mockSend.mockRejectedValueOnce(new Error("sendgrid down"));
  const res = await send("RIDER_2", "My receipt shows the wrong date. (test fixture)");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ sent: true, case_created: true, email: { status: "failed" } });
  expect(currentFake._state.audit_logs.some((a) => a.action === "agent.case_opened" && a.entity_id === res.body.reference)).toBe(true);
  expect(emailRow(res.body.reference).metadata.status).toBe("failed");
});
