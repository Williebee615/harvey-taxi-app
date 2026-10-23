const p = require("./htafPartnerAccess");

const SECRET = "test-partner-secret";
const partner = { id: "p1", enabled: true, agreement_ref: "AGR-1" };
const user = { id: "u1", partner_id: "p1", status: "active", session_version: 2 };

describe("partner sessions", () => {
  test("round trip", () => {
    const token = p.signPartnerSession({ partnerUserId: "u1", partnerId: "p1", sessionVersion: 2, secret: SECRET, ttlHours: 1 });
    const check = p.verifyPartnerSession({ token, secret: SECRET });
    expect(check.ok).toBe(true);
    expect(check.payload).toMatchObject({ sub: "htaf-partner", partner_user_id: "u1", partner_id: "p1", session_version: 2 });
  });
  test("wrong secret, tampering and expiry are refused", () => {
    const token = p.signPartnerSession({ partnerUserId: "u1", partnerId: "p1", sessionVersion: 0, secret: SECRET, ttlHours: 1, now: 0 });
    expect(p.verifyPartnerSession({ token, secret: "other", now: 1 }).ok).toBe(false);
    expect(p.verifyPartnerSession({ token: `x${token}`, secret: SECRET, now: 1 }).ok).toBe(false);
    expect(p.verifyPartnerSession({ token, secret: SECRET, now: 3_600_000 }).reason).toBe("expired");
    expect(p.verifyPartnerSession({ token: "", secret: SECRET }).ok).toBe(false);
  });
});

describe("accessDecision: both switches, active user, matching session", () => {
  const session = { partner_id: "p1", session_version: 2 };
  test("allowed only when everything holds", () => {
    expect(p.accessDecision({ masterOn: true, partner, user, session })).toEqual({ allowed: true, reason: null });
  });
  test.each([
    [{ masterOn: false, partner, user, session }, "master_off"],
    [{ masterOn: true, partner: { ...partner, enabled: false }, user, session }, "partner_off"],
    [{ masterOn: true, partner: { ...partner, agreement_ref: null }, user, session }, "no_agreement"],
    [{ masterOn: true, partner, user: { ...user, status: "disabled" }, session }, "user_inactive"],
    [{ masterOn: true, partner: { ...partner, id: "p2" }, user, session }, "partner_missing"],
    [{ masterOn: true, partner, user, session: { ...session, session_version: 1 } }, "stale_session"],
    [{ masterOn: true, partner, user, session: { ...session, partner_id: "p2" } }, "stale_session"]
  ])("%#: refused", (input, reason) => {
    expect(p.accessDecision(input)).toEqual({ allowed: false, reason });
  });
});

test("partner view keeps no contact, income or notes", () => {
  const view = p.toPartnerApplicationView({
    id: "HTAF-1", application_code: "HTAF-X", first_name: "Ada", last_name: "lovelace", email: "a@example.test",
    phone: "6155550100", notes: "internal", household_income: 1, program_type: "medical", status: "submitted",
    ride_date: "2026-11-01", created_at: "2026-10-23T00:00:00Z", updated_at: null
  });
  expect(view).toEqual({ application_code: "HTAF-X", client: "Ada L.", program_type: "medical", status: "submitted", ride_date: "2026-11-01", submitted_at: "2026-10-23T00:00:00Z", updated_at: null });
});

test("validatePartnerInput", () => {
  expect(p.validatePartnerInput({ name: " Safe Haven ", partner_type: "shelter" })).toEqual({ ok: true, value: { name: "Safe Haven", partner_type: "shelter", agreement_ref: null, contact_email: null } });
  expect(p.validatePartnerInput({ name: "x" }).ok).toBe(false);
  expect(p.validatePartnerInput({ name: "Safe Haven", partner_type: "bank" }).ok).toBe(false);
  expect(p.validatePartnerInput({ name: "Safe Haven", contact_email: " Intake@Example.org " }).value.contact_email).toBe("intake@example.org");
  expect(p.validatePartnerInput({ name: "Safe Haven", contact_email: "not-an-email" }).ok).toBe(false);
});

test("buildPartnerInvite: portal link and sign-in instructions, no secrets", () => {
  const text = p.buildPartnerInvite({ partnerName: "Safe Haven", portalUrl: "https://harveytransportationfoundation.com/htaf-partner.html" });
  expect(text).toContain("Safe Haven");
  expect(text).toContain("https://harveytransportationfoundation.com/htaf-partner.html");
  expect(text).toContain("one-time code");
  expect(text).toContain("HTAF reviews and decides every application");
});
