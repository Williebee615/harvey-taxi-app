const {
  RIDERS_TABLE_COLUMNS,
  isRiderPhoneVerified,
  isRiderPersonaVerified,
  isRiderVerified,
  buildRiderSignupRecord
} = require("./riderVerification");

describe("isRiderPhoneVerified", () => {
  it("is true only when sms_verified is exactly true", () => {
    expect(isRiderPhoneVerified({ sms_verified: true })).toBe(true);
  });

  it("ignores the driver-only phone_verified column (regression: schema-drift outage)", () => {
    // This is the exact bug that made every rider permanently fail the
    // approval gate: rider.phone_verified never exists on a real riders
    // row, but old code read it anyway and got undefined -> false forever.
    expect(isRiderPhoneVerified({ phone_verified: true, sms_verified: false })).toBe(false);
    expect(isRiderPhoneVerified({ phone_verified: true })).toBe(false);
  });

  it("is false for missing/undefined/null rider", () => {
    expect(isRiderPhoneVerified(undefined)).toBe(false);
    expect(isRiderPhoneVerified(null)).toBe(false);
    expect(isRiderPhoneVerified({})).toBe(false);
  });
});

describe("isRiderPersonaVerified", () => {
  it("is true for approved or verified persona_status", () => {
    expect(isRiderPersonaVerified({ persona_status: "approved" })).toBe(true);
    expect(isRiderPersonaVerified({ persona_status: "verified" })).toBe(true);
  });

  it("is false for pending/not_started/unknown persona_status", () => {
    expect(isRiderPersonaVerified({ persona_status: "pending" })).toBe(false);
    expect(isRiderPersonaVerified({ persona_status: "not_started" })).toBe(false);
    expect(isRiderPersonaVerified({ persona_status: undefined })).toBe(false);
  });

  it("ignores the driver-only persona_verified column (regression: schema-drift outage)", () => {
    expect(isRiderPersonaVerified({ persona_verified: true, persona_status: "pending" })).toBe(false);
    expect(isRiderPersonaVerified({ persona_verified: true })).toBe(false);
  });

  it("is false for missing/undefined/null rider", () => {
    expect(isRiderPersonaVerified(undefined)).toBe(false);
    expect(isRiderPersonaVerified(null)).toBe(false);
  });
});

describe("isRiderVerified", () => {
  it("is true when verified or fully_verified is true", () => {
    expect(isRiderVerified({ verified: true })).toBe(true);
    expect(isRiderVerified({ fully_verified: true })).toBe(true);
  });

  it("is false otherwise", () => {
    expect(isRiderVerified({ verified: false, fully_verified: false })).toBe(false);
    expect(isRiderVerified({})).toBe(false);
    expect(isRiderVerified(undefined)).toBe(false);
  });
});

describe("buildRiderSignupRecord", () => {
  const baseInput = {
    id: "RIDER-TEST-1",
    firstName: "Test",
    lastName: "Rider",
    email: "test@example.com",
    phone: "+16155551234",
    city: "Nashville",
    state: "TN",
    approvalGateEnabled: true,
    now: "2026-07-26T00:00:00.000Z"
  };

  it("only inserts columns that actually exist on riders (regression: schema-drift outage)", () => {
    // This is the exact production bug: the old insert included
    // phone_verified/persona_verified, neither of which exists on the
    // riders table (confirmed against the live schema) — every signup
    // failed with a Supabase schema-cache error, masked to a generic
    // "Internal server error." by the production error handler.
    const record = buildRiderSignupRecord(baseInput);

    for (const key of Object.keys(record)) {
      expect(RIDERS_TABLE_COLUMNS).toContain(key);
    }

    expect(record).not.toHaveProperty("phone_verified");
    expect(record).not.toHaveProperty("persona_verified");
  });

  it("sets sane defaults for a brand-new rider", () => {
    const record = buildRiderSignupRecord(baseInput);

    expect(record.email_verified).toBe(false);
    expect(record.sms_verified).toBe(false);
    expect(record.verified).toBe(false);
    expect(record.fully_verified).toBe(false);
    expect(record.persona_status).toBe("not_started");
  });

  it("gates status/approval_status on approvalGateEnabled", () => {
    const gated = buildRiderSignupRecord({ ...baseInput, approvalGateEnabled: true });
    const ungated = buildRiderSignupRecord({ ...baseInput, approvalGateEnabled: false });

    expect(gated.status).toBe("pending_verification");
    expect(gated.approval_status).toBe("pending");
    expect(ungated.status).toBe("active");
    expect(ungated.approval_status).toBe("approved");
  });

  it("never collides on id across repeated signups with identical contact info (duplicate email/phone)", () => {
    // riders has no unique constraint on email/phone, so re-signing up
    // with the same contact info is expected to succeed as a second,
    // independent row. This only proves the builder itself doesn't
    // assume/derive an id from email or phone in a way that would
    // collide -- id generation and uniqueness are the caller's
    // responsibility (makeId()).
    const first = buildRiderSignupRecord({ ...baseInput, id: "RIDER-A" });
    const second = buildRiderSignupRecord({ ...baseInput, id: "RIDER-B" });

    expect(first.id).not.toBe(second.id);
    expect(first.email).toBe(second.email);
  });
});
