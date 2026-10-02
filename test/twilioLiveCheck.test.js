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

function fakeFetch() {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {} });
    const u = String(url);
    let body = {};
    if (u.endsWith(`/Accounts/${ENV.TWILIO_ACCOUNT_SID}.json`)) body = { status: "active", type: "Full" };
    else if (u.includes("/v2/Services/") && !u.includes("Verification")) body = { code_length: 6 };
    else if (u.includes("IncomingPhoneNumbers")) body = { incoming_phone_numbers: [{ sid: "PNtest", capabilities: { sms: true } }] };
    else if (u.includes("Tollfree/Verifications")) body = { verifications: [{ status: "IN_REVIEW" }] };
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
  expect(global.fetch.calls.length).toBeGreaterThanOrEqual(4);
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
