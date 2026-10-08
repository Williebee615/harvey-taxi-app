// HTAF text-message consent: optional and separate from applying, recorded
// by the server (choice, time, source, wording version), honored before any
// HTAF text, and STOP/START/HELP replies recorded from a signed Twilio
// webhook addressed to HTAF's number. HTAF only: Harvey Taxi's sender is
// never used.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ENABLE_REAL_SMS = "true";
process.env.TWILIO_ACCOUNT_SID = "AC_test_only";
process.env.TWILIO_AUTH_TOKEN = "test-only-auth-token";
process.env.TWILIO_FROM_NUMBER = "+16155550999"; // Harvey Taxi's (test) sender
process.env.HTAF_SMS_FROM_NUMBER = "+18447950299";
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const mockSent = [];
const mockValid = { value: true, calls: [] };
jest.mock("twilio", () => {
  const factory = () => ({ messages: { create: jest.fn(async (msg) => { mockSent.push(msg); return { sid: "SM_test" }; }) } });
  factory.validateRequest = (token, signature, url, params) => {
    mockValid.calls.push({ signature, url, params });
    return mockValid.value && signature === "good-signature";
  };
  return factory;
});

const request = require("supertest");

const APPLICATION = {
  first_name: "Test",
  last_name: "Applicant",
  email: "applicant@example.test",
  phone: "(615) 555-0100",
  county: "Davidson County",
  city: "Nashville",
  program_type: "medical",
  pickup_city: "Nashville",
  destination: "Clinic",
  ride_date: "2026-10-20",
  transportation_need: "Appointment"
};

function loadApp({ enabled = false, failConsentInsert = false, failConsentRead = false } = {}) {
  process.env.HTAF_SMS_ENABLED = enabled ? "true" : "false";
  mockSupabaseClient = createFakeSupabase(
    { htaf_applications: [], htaf_sms_consents: [], audit_logs: [] },
    {
      failInsert: (table) => (failConsentInsert && table === "htaf_sms_consents" ? { message: "relation does not exist" } : null),
      failSelect: (table) => (failConsentRead && table === "htaf_sms_consents" ? { message: "read failed" } : null)
    }
  );
  mockSent.length = 0;
  let app;
  jest.isolateModules(() => {
    ({ app } = require("../server"));
  });
  return { app, state: mockSupabaseClient._state };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("the application form's consent choice", () => {
  test("declining texts still submits the application and records 'declined'", async () => {
    const { app, state } = loadApp();
    const res = await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: false });
    expect(res.status).toBe(201);
    await settle();
    expect(state.htaf_applications).toHaveLength(1);
    expect(state.htaf_sms_consents).toEqual([
      expect.objectContaining({ phone: "+16155550100", event: "declined", consent_version: "htaf-sms-v1", source: "htaf-application-web-form", application_id: state.htaf_applications[0].id })
    ]);
  });

  test("an old page that sends no consent field is treated as declined", async () => {
    const { app, state } = loadApp();
    expect((await request(app).post("/api/foundation/apply").send(APPLICATION)).status).toBe(201);
    await settle();
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["declined"]);
  });

  test("opting in records the choice, server time, source and wording version; browser-sent versions are ignored", async () => {
    const { app, state } = loadApp();
    const before = Date.now();
    const res = await request(app)
      .post("/api/foundation/apply")
      .send({ ...APPLICATION, sms_consent: true, sms_consent_version: "made-up", consent_source: "elsewhere" });
    expect(res.status).toBe(201);
    await settle();
    const [row] = state.htaf_sms_consents;
    expect(row).toMatchObject({ event: "opt_in", consent_version: "htaf-sms-v1", source: "htaf-application-web-form", phone: "+16155550100" });
    expect(Date.parse(row.created_at)).toBeGreaterThanOrEqual(before - 1000);
  });

  test("only a real true opts in", async () => {
    const { app, state } = loadApp();
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: "true" });
    await settle();
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["declined"]);
  });

  test("if the consent record can't be saved, the application is still accepted (and nothing is texted)", async () => {
    const { app, state } = loadApp({ enabled: true, failConsentInsert: true });
    const res = await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    expect(res.status).toBe(201);
    await settle();
    expect(state.htaf_applications).toHaveLength(1);
    expect(mockSent).toHaveLength(0);
  });
});

describe("sending honors consent", () => {
  test("while HTAF messaging is off (the default), an opt-in sends nothing", async () => {
    const { app } = loadApp({ enabled: false });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    expect(mockSent).toHaveLength(0);
  });

  test("when switched on, an opt-in gets one welcome text from HTAF's number, never Harvey Taxi's", async () => {
    const { app } = loadApp({ enabled: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0]).toMatchObject({ to: "+16155550100", from: "+18447950299" });
    expect(mockSent[0].body).toMatch(/^HTAF \(Harvey Transportation Assistance Foundation\)/);
  });

  test("when switched on, a declined applicant is never texted", async () => {
    const { app } = loadApp({ enabled: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: false });
    await settle();
    expect(mockSent).toHaveLength(0);
  });
});

describe("missing or failed consent records never allow a text", () => {
  test("no record at all for a number: nothing is sent", async () => {
    const { app, state } = loadApp({ enabled: true });
    // A number with no consent row (for example an old application from
    // before consent existed) is never texted, even with messaging on.
    state.htaf_sms_consents.length = 0;
    await request(app).post("/api/htaf/sms/inbound").set("X-Twilio-Signature", "good-signature").type("form").send({ From: "+16155550100", To: "+18447950299", Body: "HELP" });
    expect(mockSent).toHaveLength(0);
  });

  test("the consent record can't be read: nothing is sent, even right after an opt-in", async () => {
    const { app, state } = loadApp({ enabled: true, failConsentRead: true });
    const res = await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    expect(res.status).toBe(201);
    await settle();
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in"]);
    expect(mockSent).toHaveLength(0);
  });

  test("the consent record can't be saved: nothing is sent (already covered above), and the application is kept", async () => {
    const { app, state } = loadApp({ enabled: true, failConsentInsert: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    expect(state.htaf_applications).toHaveLength(1);
    expect(mockSent).toHaveLength(0);
  });
});

describe("STOP stays in effect across later applications", () => {
  const inbound = (app, Body) =>
    request(app).post("/api/htaf/sms/inbound").set("X-Twilio-Signature", "good-signature").type("form").send({ From: "+16155550100", To: "+18447950299", Body });

  test("a later application with the box unchecked does not re-subscribe a number that replied STOP", async () => {
    const { app, state } = loadApp({ enabled: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    await inbound(app, "STOP");
    mockSent.length = 0;

    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: false });
    await request(app).post("/api/foundation/apply").send(APPLICATION); // an old page: no field at all
    await settle();
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in", "opt_out", "declined", "declined"]);
    expect(mockSent).toHaveLength(0);
  });

  test("only an explicit new opt-in (checking the box again) or a START reply re-subscribes", async () => {
    const { app, state } = loadApp({ enabled: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    await inbound(app, "STOP");
    mockSent.length = 0;

    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in", "opt_out", "opt_in"]);
    expect(mockSent).toHaveLength(1); // the welcome text for the new opt-in

    await inbound(app, "STOP");
    await inbound(app, "START");
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in", "opt_out", "opt_in", "opt_out", "opt_in_again"]);
  });
});

describe("reply keywords (POST /api/htaf/sms/inbound)", () => {
  const inbound = (app, body, signature = "good-signature") =>
    request(app).post("/api/htaf/sms/inbound").set("X-Twilio-Signature", signature).type("form").send(body);

  test("an unsigned or badly signed request is refused and records nothing", async () => {
    const { app, state } = loadApp();
    expect((await request(app).post("/api/htaf/sms/inbound").type("form").send({ From: "+16155550100", To: "+18447950299", Body: "STOP" })).status).toBe(403);
    expect((await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "STOP" }, "bad")).status).toBe(403);
    expect(state.htaf_sms_consents).toHaveLength(0);
  });

  test("the signature is checked against HTAF's public webhook URL", async () => {
    const { app } = loadApp();
    mockValid.calls.length = 0;
    await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "STOP" });
    expect(mockValid.calls[0].url).toBe("https://harveytransportationfoundation.com/api/htaf/sms/inbound");
  });

  test("STOP after opting in is recorded and blocks every later HTAF text; START re-opts in", async () => {
    const { app, state } = loadApp({ enabled: true });
    await request(app).post("/api/foundation/apply").send({ ...APPLICATION, sms_consent: true });
    await settle();
    expect(mockSent).toHaveLength(1);

    const res = await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "Stop" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("<Response></Response>"); // Twilio/the carrier reply; this app adds nothing
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in", "opt_out"]);

    // HELP is recorded but changes nothing: still opted out.
    mockSent.length = 0;
    await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "HELP" });
    expect(state.htaf_sms_consents.map((r) => r.event)).toEqual(["opt_in", "opt_out", "help"]);
    expect(mockSent).toHaveLength(0);
  });

  test("the message text is never stored, and keywords to another number (Harvey Taxi's) are ignored", async () => {
    const { app, state } = loadApp();
    await inbound(app, { From: "+16155550100", To: "+16155550999", Body: "STOP" });
    await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "my address is 1 Main St" });
    expect(state.htaf_sms_consents).toHaveLength(0);
    await inbound(app, { From: "+16155550100", To: "+18447950299", Body: "STOP" });
    expect(JSON.stringify(state.htaf_sms_consents)).not.toMatch(/Body|STOP/);
  });
});
