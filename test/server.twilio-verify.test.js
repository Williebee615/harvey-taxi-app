// Route-level regression tests for the Twilio integration, over real
// HTTP via supertest. Twilio itself is replaced by an in-memory fake
// (no SMS is sent, no network is used) and Supabase by test/fakeSupabase.
//
// 1. Driver login sends Twilio Verify a valid E.164 number for every
//    form a driver's phone can be stored in, and uses the same number
//    for the code check. A bare 10-digit number previously became
//    "+6155550101", which Twilio rejects, so that driver could never
//    receive a login code.
// 2. Server logs never contain a verification code or a full phone
//    number: neither the "SMS skipped" log (SMS disabled) nor a Twilio
//    error message that echoes the number back.

const BASE_ENV = {
  NODE_ENV: "test",
  HARVEY_ISOLATED_TEST: "1",
  API_RATE_LIMIT_PER_MINUTE: "100000",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RIDER_SESSION_SECRET: "test-rider-session-secret",
  DRIVER_SESSION_SECRET: "test-driver-session-secret",
  RIDE_QUOTE_SECRET: "test-ride-quote-secret",
  ADMIN_API_TOKEN: "test-admin-token"
};
const TWILIO_ENV = {
  ENABLE_REAL_SMS: "true",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_VERIFY_SERVICE_SID: "VAtest00000000000000000000000000",
  TWILIO_FROM_NUMBER: "+15005550006"
};

const { createFakeSupabase } = require("./fakeSupabase");
const request = require("supertest");

let mockSupabaseClient;
// server.js keeps the client it gets at load time; forward to whichever
// fake the current test installed.
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => new Proxy({}, { get: (_target, key) => mockSupabaseClient && mockSupabaseClient[key] })
}));

// Records every Verify call; tests program the next result.
const mockTwilio = {
  sends: [],
  checks: [],
  messages: [],
  sendError: null,
  checkStatus: "approved"
};
jest.mock("twilio", () =>
  jest.fn(() => ({
    verify: {
      services: () => ({
        verifications: {
          create: async (params) => {
            mockTwilio.sends.push(params);
            if (mockTwilio.sendError) throw mockTwilio.sendError;
            return { sid: "VEtest", status: "pending" };
          }
        },
        verificationChecks: {
          create: async (params) => {
            mockTwilio.checks.push(params);
            return { status: mockTwilio.checkStatus };
          }
        }
      })
    },
    messages: {
      create: async (params) => {
        mockTwilio.messages.push(params);
        return { sid: "SMtest" };
      }
    }
  }))
);

function loadServer(env) {
  const saved = { ...process.env };
  for (const key of Object.keys(TWILIO_ENV)) delete process.env[key];
  delete process.env.ENABLE_REAL_SMS;
  Object.assign(process.env, BASE_ENV, env);
  let server;
  jest.isolateModules(() => {
    server = require("../server");
  });
  process.env = saved;
  return server.app;
}

// Everything the server writes to the console during `fn`, as one string.
async function captureLogs(fn) {
  const lines = [];
  const spies = ["log", "info", "warn", "error"].map((level) =>
    jest.spyOn(console, level).mockImplementation((...args) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    })
  );
  try {
    await fn();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return lines.join("\n");
}

function resetTwilio() {
  mockTwilio.sends = [];
  mockTwilio.checks = [];
  mockTwilio.messages = [];
  mockTwilio.sendError = null;
  mockTwilio.checkStatus = "approved";
}

function driverRow(phone) {
  return { id: "DRIVER_1", first_name: "Test", last_name: "Driver", email: "driver@example.test", phone, access_revoked: false, status: "approved" };
}

describe("driver login with Twilio Verify", () => {
  let app;
  beforeAll(() => {
    app = loadServer(TWILIO_ENV);
  });
  beforeEach(resetTwilio);

  test.each([
    ["6155550101"], // the regression: previously sent as "+6155550101"
    ["(615) 555-0101"],
    ["16155550101"],
    ["+16155550101"]
  ])("phone stored as %j: the code is sent to and checked against +16155550101", async (stored) => {
    mockSupabaseClient = createFakeSupabase({ drivers: [driverRow(stored)] });

    const start = await request(app).post("/api/driver/session/start").send({ driver_id: "DRIVER_1" });
    expect(start.status).toBe(200);
    expect(start.body.sent).toBe(true);
    expect(mockTwilio.sends).toEqual([{ to: "+16155550101", channel: "sms" }]);

    const verify = await request(app).post("/api/driver/session/verify").send({ driver_id: "DRIVER_1", code: "123456" });
    expect(verify.status).toBe(200);
    expect(mockTwilio.checks).toEqual([{ to: "+16155550101", code: "123456" }]);
  });

  test("a phone that can't be formatted fails closed without calling Twilio", async () => {
    mockSupabaseClient = createFakeSupabase({ drivers: [driverRow("555-0101")] });

    const start = await request(app).post("/api/driver/session/start").send({ driver_id: "DRIVER_1" });
    expect(start.status).toBe(422);
    const verify = await request(app).post("/api/driver/session/verify").send({ driver_id: "DRIVER_1", code: "123456" });
    expect(verify.status).toBe(400);
    expect(mockTwilio.sends).toHaveLength(0);
    expect(mockTwilio.checks).toHaveLength(0);
  });

  test("a wrong code is rejected", async () => {
    mockSupabaseClient = createFakeSupabase({ drivers: [driverRow("6155550101")] });
    mockTwilio.checkStatus = "pending";

    const verify = await request(app).post("/api/driver/session/verify").send({ driver_id: "DRIVER_1", code: "000000" });
    expect(verify.status).toBe(400);
  });

  test("a Twilio error is logged by code and status only, never with the phone number", async () => {
    mockSupabaseClient = createFakeSupabase({ drivers: [driverRow("6155550101")] });
    mockTwilio.sendError = Object.assign(new Error("Invalid parameter `To`: +16155550101"), { code: 60200, status: 400 });

    let res;
    const logs = await captureLogs(async () => {
      res = await request(app).post("/api/driver/session/start").send({ driver_id: "DRIVER_1" });
    });
    expect(res.status).toBe(502);
    expect(logs).toContain("code=60200 status=400");
    expect(logs).not.toContain("6155550101");
  });
});

describe("SMS disabled: the 'SMS skipped' log", () => {
  let app;
  beforeAll(() => {
    app = loadServer({ ENABLE_REAL_SMS: "false" });
  });
  beforeEach(resetTwilio);

  test("never contains the verification code or the full phone number", async () => {
    mockSupabaseClient = createFakeSupabase({});

    // makeOtpCode() draws from Math.random(): pin it so the code is known.
    const random = jest.spyOn(Math, "random").mockReturnValue(0.3);
    const code = "370000";
    let res;
    let logs;
    try {
      logs = await captureLogs(async () => {
        res = await request(app)
          .post("/api/verify/sms/start")
          .send({ phone: "+16155550101", purpose: "rider_verification", user_type: "rider" });
      });
    } finally {
      random.mockRestore();
    }
    expect(res.status).toBe(200);
    expect(mockSupabaseClient._state.verification_codes).toHaveLength(1);

    expect(logs).toContain("SMS skipped");
    expect(logs).not.toContain(code);
    expect(logs).not.toContain("6155550101");
    expect(mockTwilio.messages).toHaveLength(0);
  });
});
