const { validatePartnershipInquiry, looksAutomated, planStatusChange, inquiryEmailText, MIN_FILL_MS } = require("./partnerships");

const GOOD = {
  organization_name: "Test Hotel Group",
  website: "https://example.test",
  business_type: "llc",
  industry: "hospitality",
  address_line: "100 Test Ave",
  city: "Nashville",
  state: "tn",
  postal_code: "37203",
  contact_name: "Test Contact",
  job_title: "General Manager",
  contact_email: "Contact@Example.test",
  contact_phone: "(615) 555-0100",
  interests: ["transportation_partnership", "customer_referrals"],
  message: "We'd like to discuss transportation options for our guests.",
  consent: true
};

test("a complete inquiry is normalised for storage", () => {
  const out = validatePartnershipInquiry(GOOD, { now: new Date("2026-10-22T00:00:00Z") });
  expect(out.ok).toBe(true);
  expect(out.row).toMatchObject({ state: "TN", contact_email: "contact@example.test", contact_phone: "+16155550100", status: "new", consent_version: "2026-10-22", consented_at: "2026-10-22T00:00:00.000Z" });
});

test.each([
  ["organization_name", "", /organization/],
  ["business_type", "empire", /business type/],
  ["industry", "", /industry/],
  ["state", "Tennessee", /two-letter/],
  ["postal_code", "372", /ZIP/],
  ["contact_email", "nope", /email/],
  ["contact_phone", "123", /phone/],
  ["interests", [], /interest/],
  ["interests", ["free_rides"], /interest/],
  ["message", "too short", /20 characters/],
  ["consent", false, /Confirm/],
  ["website", "not a url", /website/]
])("rejects a bad %s", (field, value, message) => {
  const out = validatePartnershipInquiry({ ...GOOD, [field]: value });
  expect(out.ok).toBe(false);
  expect(out.error).toMatch(message);
});

test("spam signals: the hidden field, or a form sent faster than a person can fill it", () => {
  const now = 1_000_000;
  expect(looksAutomated({ company_fax: "555" }, now)).toBe("honeypot");
  expect(looksAutomated({ form_started_at: now - MIN_FILL_MS + 1 }, now)).toBe("too_fast");
  expect(looksAutomated({ form_started_at: now - 60_000 }, now)).toBeNull();
  expect(looksAutomated({}, now)).toBeNull();
});

test("status changes: only new, contacted or closed; a note is kept", () => {
  expect(planStatusChange({ inquiry: { id: "P1", status: "new" }, status: "approved", reviewer: "a" })).toMatchObject({ ok: false, statusCode: 400 });
  expect(planStatusChange({ inquiry: null, status: "closed", reviewer: "a" })).toMatchObject({ ok: false, statusCode: 404 });
  const ok = planStatusChange({ inquiry: { id: "P1", status: "new" }, status: "contacted", note: "Called them", reviewer: "owner@example.test", now: new Date("2026-10-22T00:00:00Z") });
  expect(ok.update).toMatchObject({ status: "contacted", staff_note: "Called them", reviewed_by: "owner@example.test" });
});

test("the support email uses labels and says nothing is approved", () => {
  const { row } = validatePartnershipInquiry(GOOD);
  const text = inquiryEmailText(row, "P1");
  expect(text).toContain("Industry: Hospitality");
  expect(text).toContain("Interests: Transportation partnerships; Customer referral opportunities");
  expect(text).toMatch(/does not approve or commit/);
});
