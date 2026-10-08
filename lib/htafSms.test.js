const s = require("./htafSms");

describe("consent record", () => {
  test("only an explicit true opts in; the server sets version, source and time", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(s.consentRecord({ applicationId: "HTAF1", phone: "(615) 555-0100", smsConsent: true, now })).toEqual({
      application_id: "HTAF1",
      phone: "+16155550100",
      event: "opt_in",
      consent_version: "htaf-sms-v1",
      source: "htaf-application-web-form",
      created_at: "2026-10-05T12:00:00.000Z"
    });
    for (const v of [false, undefined, null, "true", 1, "yes"]) {
      expect(s.consentRecord({ applicationId: "HTAF1", phone: "6155550100", smsConsent: v, now }).event).toBe("declined");
    }
  });

  test("the wording names HTAF, the number, the message types, frequency, rates, STOP/HELP, that consent is optional, and both policies", () => {
    const t = s.CONSENT_TEXT[s.CONSENT_VERSION];
    for (const part of [
      "Harvey Transportation Assistance Foundation (HTAF)",
      "(844) 795-0299",
      "application updates, transportation scheduling, pickup reminders, service changes and support",
      "Message frequency varies.",
      "Message and data rates may apply.",
      "Reply STOP to opt out at any time, or HELP for help.",
      "Consent is not required to apply for or receive assistance.",
      "Privacy Policy",
      "Terms of Use"
    ]) {
      expect(t).toContain(part);
    }
    expect(t).not.toMatch(/Harvey Taxi/);
  });
});

describe("reply keywords", () => {
  test.each([
    ["STOP", "opt_out"], ["stop", "opt_out"], [" Unsubscribe ", "opt_out"], ["CANCEL", "opt_out"], ["END", "opt_out"], ["QUIT", "opt_out"], ["STOPALL", "opt_out"],
    ["START", "opt_in_again"], ["unstop", "opt_in_again"],
    ["HELP", "help"], ["info", "help"],
    ["YES", null], ["stop texting me please", null], ["", null]
  ])("%p -> %p", (body, event) => {
    expect(s.keywordOf(body)).toBe(event);
  });
});

describe("may HTAF text this number?", () => {
  const at = (m) => `2026-10-05T12:${String(m).padStart(2, "0")}:00Z`;
  const on = { enabled: true, fromNumber: "+18447950299" };

  test("needs messaging on, HTAF's sender, and a recorded opt-in", () => {
    expect(s.canText({ events: [{ event: "opt_in", created_at: at(0) }], enabled: false, fromNumber: "+18447950299" }).reason).toBe("htaf_sms_disabled");
    expect(s.canText({ events: [{ event: "opt_in", created_at: at(0) }], enabled: true, fromNumber: "" }).reason).toBe("htaf_sender_not_configured");
    expect(s.canText({ events: [], ...on }).reason).toBe("no_consent");
    expect(s.canText({ events: [{ event: "declined", created_at: at(0) }], ...on }).reason).toBe("no_consent");
    expect(s.canText({ events: [{ event: "opt_in", created_at: at(0) }], ...on }).ok).toBe(true);
  });

  test("a STOP after opting in stops texts; START re-opts in; HELP and later declines don't change it", () => {
    const optIn = { event: "opt_in", created_at: at(0) };
    const stop = { event: "opt_out", created_at: at(5) };
    expect(s.canText({ events: [stop, optIn], ...on }).reason).toBe("opted_out");
    expect(s.canText({ events: [optIn, stop, { event: "help", created_at: at(6) }], ...on }).reason).toBe("opted_out");
    expect(s.canText({ events: [optIn, stop, { event: "opt_in_again", created_at: at(9) }], ...on }).ok).toBe(true);
    expect(s.canText({ events: [optIn, { event: "help", created_at: at(3) }], ...on }).ok).toBe(true);
  });

  test("US numbers only", () => {
    expect(s.normalizeUsPhone("615-555-0100")).toBe("+16155550100");
    expect(s.normalizeUsPhone("+1 (615) 555-0100")).toBe("+16155550100");
    expect(s.normalizeUsPhone("+44 20 7946 0958")).toBeNull();
    expect(s.normalizeUsPhone("")).toBeNull();
  });

  test("the welcome and HELP texts identify HTAF and carry the required disclosures", () => {
    for (const m of [s.WELCOME_MESSAGE, s.HELP_MESSAGE]) {
      expect(m).toMatch(/^HTAF \(Harvey Transportation Assistance Foundation\)/);
      expect(m).toContain("Msg frequency varies. Msg & data rates may apply.");
      expect(m).toContain("STOP");
      expect(m.length).toBeLessThanOrEqual(320);
      expect(m).not.toMatch(/Harvey Taxi/);
    }
    expect(s.HELP_MESSAGE).toContain("WillieHtaf@harveytransportationfoundation.com");
  });
});
