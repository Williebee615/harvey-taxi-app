// HTAF contact form: what an inquiry must contain and the email HTAF gets.
const { validateInquiry, buildInquiryEmail } = require("./htafInquiry");

const PARTNER = {
  topic: "partnership",
  name: "Dana Rivers",
  organization: "Eastside Clinic",
  email: "Dana@Example.test",
  phone: "615-555-0100",
  interest: "referrals",
  message: "We'd like to refer patients who miss appointments for lack of a ride."
};

describe("validateInquiry", () => {
  test("accepts a complete partnership inquiry and tidies it", () => {
    const r = validateInquiry(PARTNER);
    expect(r.ok).toBe(true);
    expect(r.inquiry.email).toBe("dana@example.test");
    expect(r.inquiry.interest).toBe("referrals");
  });

  test("a partnership inquiry needs an organization and an interest", () => {
    const r = validateInquiry({ ...PARTNER, organization: " ", interest: "" });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["interest", "organization"]);
  });

  test("other topics need neither, and ignore an interest sent anyway", () => {
    const r = validateInquiry({ ...PARTNER, topic: "general", organization: "", interest: "sponsorship" });
    expect(r.ok).toBe(true);
    expect(r.inquiry.interest).toBe("");
  });

  test.each([
    ["topic", { topic: "sales" }],
    ["name", { name: "" }],
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "call me" }],
    ["message", { message: "hi" }],
    ["message", { message: "x".repeat(1501) }],
    ["interest", { interest: "advertising" }]
  ])("rejects a bad %s", (field, change) => {
    const r = validateInquiry({ ...PARTNER, ...change });
    expect(r.ok).toBe(false);
    expect(r.errors[field]).toBeTruthy();
  });

  test("phone is optional", () => {
    expect(validateInquiry({ ...PARTNER, phone: "" }).ok).toBe(true);
  });
});

describe("buildInquiryEmail", () => {
  test("names HTAF, the topic and the interest", () => {
    const { inquiry } = validateInquiry(PARTNER);
    const mail = buildInquiryEmail(inquiry);
    expect(mail.subject).toBe("HTAF partnership inquiry: Eastside Clinic");
    expect(mail.text).toContain("Partnership interest: Referring people for assistance");
    expect(mail.html).toContain("Harvey Transportation Assistance Foundation: Partnership inquiry");
  });

  test("keeps the subject on one line and escapes HTML", () => {
    const { inquiry } = validateInquiry({ ...PARTNER, organization: "Evil\r\nBcc: x@y.test", message: "<script>alert(1)</script> please" });
    const mail = buildInquiryEmail(inquiry);
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
