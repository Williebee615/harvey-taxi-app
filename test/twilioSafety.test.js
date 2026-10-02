const { toVerifyE164, redactPhone, smsSkippedLogDetails, describeTwilioError } = require("../lib/twilioSafety");

describe("toVerifyE164 (Twilio Verify `to`)", () => {
  test.each([
    // The regression: a bare 10-digit US number used to become "+6155550101".
    ["6155550101", "+16155550101"],
    ["(615) 555-0101", "+16155550101"],
    ["615.555.0101", "+16155550101"],
    // Forms already on existing driver rows keep working.
    ["16155550101", "+16155550101"],
    ["1 (615) 555-0101", "+16155550101"],
    ["+16155550101", "+16155550101"],
    ["+1 (615) 555-0101", "+16155550101"],
    // A number that already carries a non-US country code is preserved.
    ["+447700900123", "+447700900123"],
    ["447700900123", "+447700900123"]
  ])("%j -> %s", (input, expected) => {
    expect(toVerifyE164(input)).toBe(expected);
  });

  test.each([null, undefined, "", "555-0101", "+12345", "+1234567890123456", "not a phone"])(
    "%j cannot be formatted and returns null (callers fail closed)",
    (input) => {
      expect(toVerifyE164(input)).toBeNull();
    }
  );
});

describe("log-safe helpers", () => {
  test("redactPhone keeps only the last two digits", () => {
    expect(redactPhone("+16155550101")).toBe("•••01");
    expect(redactPhone("")).toBe("(none)");
    expect(redactPhone(null)).toBe("(none)");
  });

  test("smsSkippedLogDetails never includes the message body or the full number", () => {
    const body = "Your Harvey Taxi verification code is 482913. It expires in 10 minutes.";
    const details = smsSkippedLogDetails({ to: "+16155550101", body });
    const text = JSON.stringify(details);
    expect(text).not.toContain("482913");
    expect(text).not.toContain("6155550101");
    expect(details).toEqual({ to: "•••01", body_chars: body.length });
  });

  test("describeTwilioError reports code and status, never the message", () => {
    const err = Object.assign(new Error("Invalid parameter `To`: +16155550101"), { code: 60200, status: 400 });
    expect(describeTwilioError(err)).toBe("code=60200 status=400");
    expect(describeTwilioError(new Error("boom +16155550101"))).toBe("twilio_error");
    expect(describeTwilioError(undefined)).toBe("twilio_error");
  });
});
