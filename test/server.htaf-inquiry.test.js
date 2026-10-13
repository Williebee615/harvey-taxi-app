// HTAF contact form (POST /api/foundation/inquiry): the inquiry is emailed
// to HTAF's inbox with HTAF as the sender name and the visitor as reply-to;
// nothing else is stored, and the audit log keeps no personal details. The
// visitor is told it was sent only when the email actually went out.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.SENDGRID_API_KEY = "SG.test-key";
process.env.ENABLE_REAL_EMAIL = "true";
process.env.HTAF_ADMIN_EMAIL = "htaf-inbox@harveytransportationfoundation.example";
delete process.env.HTAF_INQUIRY_EMAIL;

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockClient }));
const mockSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: (...args) => mockSend(...args) }));

const INQUIRY = {
  topic: "partnership",
  name: "Dana Rivers",
  organization: "Eastside Clinic",
  email: "dana.private@example.test",
  phone: "615-555-0100",
  interest: "sponsorship",
  message: "We'd like to sponsor rides to our job-training program."
};

let app;
beforeAll(() => {
  mockClient = createFakeSupabase({ audit_logs: [], system_flags: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  mockSend.mockClear();
  mockClient._state.audit_logs.length = 0;
});

function post(body, ip) {
  return request(app).post("/api/foundation/inquiry").set("X-Forwarded-For", ip).send(body);
}

test("emails HTAF's inbox, as HTAF, with the visitor as reply-to", async () => {
  const res = await post(INQUIRY, "203.0.113.1");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, sent: true });
  expect(mockSend).toHaveBeenCalledTimes(1);
  const msg = mockSend.mock.calls[0][0];
  expect(msg.to).toBe("htaf-inbox@harveytransportationfoundation.example");
  expect(msg.from.name).toBe("Harvey Transportation Assistance Foundation");
  expect(msg.replyTo).toBe("dana.private@example.test");
  expect(msg.subject).toBe("HTAF partnership inquiry: Eastside Clinic");
  expect(msg.text).toContain("Partnership interest: Sponsoring transportation");
});

test("the audit log records the topic and outcome only", async () => {
  await post(INQUIRY, "203.0.113.2");
  const logs = mockClient._state.audit_logs;
  expect(logs.map((l) => l.action)).toEqual(["htaf_inquiry_sent"]);
  const saved = JSON.stringify(logs);
  for (const value of ["Dana", "Eastside", "dana.private", "555-0100", "job-training"]) expect(saved).not.toContain(value);
});

test("when the email fails, the visitor is told and given HTAF's contact details", async () => {
  mockSend.mockRejectedValueOnce(new Error("SendGrid down"));
  const res = await post(INQUIRY, "203.0.113.3");
  expect(res.status).toBe(503);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toContain("WillieHtaf@harveytransportationfoundation.com");
  expect(res.body.error).toContain("615-636-6201");
  expect(mockClient._state.audit_logs.map((l) => l.action)).toEqual(["htaf_inquiry_not_sent"]);
});

test("missing fields come back per field and nothing is sent", async () => {
  const res = await post({ topic: "partnership", email: "x" }, "203.0.113.4");
  expect(res.status).toBe(400);
  expect(Object.keys(res.body.fields).sort()).toEqual(["email", "interest", "message", "name", "organization"]);
  expect(mockSend).not.toHaveBeenCalled();
});

test("a filled hidden field is accepted quietly and not sent", async () => {
  const res = await post({ ...INQUIRY, website: "http://spam.test" }, "203.0.113.5");
  expect(res.status).toBe(200);
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockClient._state.audit_logs).toEqual([]);
});

test("more than five messages in ten minutes from one connection are refused", async () => {
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await post(INQUIRY, "203.0.113.9")).status);
  expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(codes[5]).toBe(429);
});
