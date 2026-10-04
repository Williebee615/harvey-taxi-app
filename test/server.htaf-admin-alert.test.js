// HTAF new-application alerts (#133): sent only to HTAF_ADMIN_EMAIL, never
// to the Harvey Taxi ADMIN_EMAIL, and carrying only the application code
// and a portal link. Missing HTAF_ADMIN_EMAIL fails closed: nothing is
// sent anywhere and the gap is recorded for operators.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.SENDGRID_API_KEY = "SG.test-key";
process.env.ENABLE_REAL_EMAIL = "true";
process.env.ADMIN_EMAIL = "taxi-admin@harveytaxiservice.example";

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

let mockClient;
const mockProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = mockClient[prop];
      return typeof value === "function" ? value.bind(mockClient) : value;
    }
  }
);
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const mockSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: (...args) => mockSend(...args) }));

const APPLICANT = {
  first_name: "PrivateFirst",
  last_name: "PrivateLast",
  email: "applicant.private@example.test",
  phone: "6155550199",
  county: "PrivateCounty",
  city: "PrivateCity",
  pickup_city: "123 Private Pickup Rd",
  destination: "Private Dialysis Clinic",
  ride_date: "2026-10-15",
  transportation_need: "PrivateNeed: dialysis three times weekly",
  program_type: "medical",
  household_size: 4,
  monthly_income: 1987
};
const PRIVATE_VALUES = [
  "PrivateFirst",
  "PrivateLast",
  "applicant.private@example.test",
  "6155550199",
  "PrivateCounty",
  "PrivateCity",
  "123 Private Pickup Rd",
  "Private Dialysis Clinic",
  "PrivateNeed",
  "dialysis",
  "1987",
  "medical"
];

function loadApp(env) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let app;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    ({ app } = require("../server"));
  });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return app;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function adminAlerts() {
  return mockSend.mock.calls
    .map(([msg]) => msg)
    .filter((msg) => msg.to !== APPLICANT.email);
}

beforeEach(() => {
  mockSend.mockClear();
  mockClient = createFakeSupabase({ htaf_applications: [], audit_logs: [], system_flags: [] });
});

describe("with HTAF_ADMIN_EMAIL configured", () => {
  let app;
  beforeAll(() => {
    app = loadApp({ HTAF_ADMIN_EMAIL: "Alerts@HTAF.example" });
  });

  test("sends one minimal alert to the HTAF mailbox and none to the Harvey Taxi ADMIN_EMAIL", async () => {
    const res = await request(app).post("/api/foundation/apply").send(APPLICANT);
    await settle();

    expect(res.status).toBe(201);
    const alerts = adminAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to).toBe("alerts@htaf.example");
    expect(mockSend.mock.calls.some(([m]) => m.to === process.env.ADMIN_EMAIL)).toBe(false);
  });

  test("the alert carries only the application code and a portal link -- no applicant details", async () => {
    const res = await request(app).post("/api/foundation/apply").send(APPLICANT);
    await settle();

    const code = mockClient._state.htaf_applications[0].application_code;
    expect(code).toMatch(/^HTAF-/);

    const [alert] = adminAlerts();
    const everything = JSON.stringify(alert);
    expect(everything).toContain(code);
    expect(alert.html).toContain("/admin-htaf.html");
    for (const value of PRIVATE_VALUES) expect(everything).not.toContain(value);
    expect(res.status).toBe(201);
  });
});

describe("without HTAF_ADMIN_EMAIL", () => {
  let app;
  beforeAll(() => {
    app = loadApp({ HTAF_ADMIN_EMAIL: undefined });
  });

  test("fails closed: no alert to any mailbox, the application is still saved, and the gap is audited", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/foundation/apply").send(APPLICANT);
    await settle();

    expect(res.status).toBe(201);
    expect(mockClient._state.htaf_applications).toHaveLength(1);
    expect(adminAlerts()).toEqual([]);
    expect(mockSend.mock.calls.some(([m]) => m.to === process.env.ADMIN_EMAIL)).toBe(false);

    const audit = mockClient._state.audit_logs.find((a) => a.action === "htaf_admin_alert_not_configured");
    expect(audit).toBeDefined();
    expect(audit.metadata).toMatchObject({ severity: "critical" });
    const auditJson = JSON.stringify(audit);
    for (const value of PRIVATE_VALUES) expect(auditJson).not.toContain(value);

    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("HTAF_ADMIN_EMAIL is not configured"))).toBe(true);
    errorSpy.mockRestore();
  });

  test("the admin health detail reports alerts as not configured", async () => {
    const res = await request(app).get("/api/health").set("x-admin-token", process.env.ADMIN_API_TOKEN);
    expect(res.body.features).toMatchObject({ htaf_admin_alerts: false });
  });
});
