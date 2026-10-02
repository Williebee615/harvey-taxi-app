// The live Twilio check script must never send an SMS unless the
// operator names a number and explicitly authorizes it, and must never
// print credentials. Twilio is replaced by a fake fetch: no network.

const { parseArgs, assertSendAuthorized, main } = require("../scripts/twilio-live-check");

const ENV = {
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "secret-auth-token-value",
  TWILIO_VERIFY_SERVICE_SID: "VAtest00000000000000000000000000",
  TWILIO_FROM_NUMBER: "+18447950299"
};

// `tollfree`: the number's toll-free verification status. `unauthorized`:
// every request fails as Twilio does for a bad credential.
function fakeFetch({ tollfree = "IN_REVIEW", unauthorized = false } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {} });
    const u = String(url);
    if (unauthorized) return { status: 401, json: async () => ({ code: 20003, status: 401 }) };
    let body = {};
    // A Standard API key can't read the account resource.
    if (u.endsWith(`/Accounts/${ENV.TWILIO_ACCOUNT_SID}.json`)) return { status: 401, json: async () => ({ code: 20003, status: 401 }) };
    else if (u.includes("/v2/Services/") && !u.includes("Verification")) body = { code_length: 6 };
    else if (u.includes("IncomingPhoneNumbers")) body = { incoming_phone_numbers: [{ sid: "PNtest", capabilities: { sms: true } }] };
    else if (u.includes("Tollfree/Verifications")) body = { verifications: [{ status: tollfree }] };
    else if (u.endsWith("/Verifications")) return { status: 201, json: async () => ({ status: "pending" }) };
    return { status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

let logs;
let originalFetch;
beforeEach(() => {
  logs = [];
  jest.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
  originalFetch = global.fetch;
});
afterEach(() => {
  console.log.mockRestore();
  global.fetch = originalFetch;
});

test("read-only mode (the default) makes only GET requests and never prints the auth token", async () => {
  global.fetch = fakeFetch();
  await main([], ENV);
  expect(global.fetch.calls.length).toBe(3);
  expect(global.fetch.calls.every((c) => c.method === "GET")).toBe(true);
  expect(global.fetch.calls.some((c) => c.url.startsWith("https://messaging.twilio.com/"))).toBe(true);
  const out = logs.join("\n");
  expect(out).not.toContain(ENV.TWILIO_AUTH_TOKEN);
  expect(out).not.toContain(Buffer.from(`${ENV.TWILIO_ACCOUNT_SID}:${ENV.TWILIO_AUTH_TOKEN}`).toString("base64"));
  // The toll-free number is reported as not yet approved.
  expect(out).toMatch(/FAIL\s+tollfree_verification: status=IN_REVIEW/);
});

test("a send is refused without an explicit authorization flag", () => {
  expect(() => assertSendAuthorized(parseArgs(["--send-verify", "--to", "+16155550101"]))).toThrow(/Refusing to send/);
});

test("a send is refused without a valid destination", () => {
  expect(() => assertSendAuthorized(parseArgs(["--send-verify", "--i-authorize-one-sms"]))).toThrow(/valid phone/);
  expect(() => assertSendAuthorized(parseArgs(["--send-verify", "--to", "555-0101", "--i-authorize-one-sms"]))).toThrow(/valid phone/);
});

test("an authorized send makes exactly one Verify request to the formatted number", async () => {
  global.fetch = fakeFetch();
  const ok = await main(["--send-verify", "--to", "6155550101", "--i-authorize-one-sms"], ENV);
  expect(ok).toBe(true);
  expect(global.fetch.calls).toHaveLength(1);
  expect(global.fetch.calls[0].method).toBe("POST");
  expect(global.fetch.calls[0].url).toBe(`https://verify.twilio.com/v2/Services/${ENV.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
  expect(logs.join("\n")).not.toContain("6155550101");
});

test("unknown arguments are rejected rather than ignored", () => {
  expect(() => parseArgs(["--send"])).toThrow(/Unknown argument/);
});

describe("access is validated through Verify and IncomingPhoneNumbers, not /Accounts", () => {
  test("a Standard API key passes: /Accounts is never read and account status is reported as not checked", async () => {
    global.fetch = fakeFetch({ tollfree: "TWILIO_APPROVED" });
    const ok = await main([], ENV);
    expect(ok).toBe(true);
    expect(global.fetch.calls.some((c) => /\/Accounts\/[^/]+\.json/.test(c.url))).toBe(false);
    expect(global.fetch.calls.map((c) => new URL(c.url).hostname)).toEqual([
      "verify.twilio.com",
      "api.twilio.com",
      "messaging.twilio.com"
    ]);
    const out = logs.join("\n");
    expect(out).toMatch(/SKIP\s+account_status: not checked/);
    expect(out).toMatch(/PASS\s+verify_service/);
    expect(out).toMatch(/PASS\s+from_number/);
    expect(out).toMatch(/PASS\s+tollfree_verification: status=TWILIO_APPROVED/);
  });

  test("a rejected credential fails both checks with an authentication hint", async () => {
    global.fetch = fakeFetch({ unauthorized: true });
    const ok = await main([], ENV);
    expect(ok).toBe(false);
    const out = logs.join("\n");
    expect(out).toMatch(/FAIL\s+verify_service: HTTP 401 \(Twilio error 20003\): authentication failed/);
    expect(out).toMatch(/FAIL\s+from_number: HTTP 401 \(Twilio error 20003\): authentication failed/);
    expect(global.fetch.calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("without TWILIO_ACCOUNT_SID the sender number can't be checked and the run fails", async () => {
    global.fetch = fakeFetch();
    const { TWILIO_ACCOUNT_SID, ...env } = ENV;
    const ok = await main([], env);
    expect(ok).toBe(false);
    expect(logs.join("\n")).toMatch(/FAIL\s+from_number: TWILIO_ACCOUNT_SID is not set/);
  });
});
