const {
  computeDriverReadiness,
  buildOrdinaryApprovalUpdate,
  buildContactVerificationOverrideUpdate,
  validateComplianceOverrideRequest,
  buildComplianceOverrideUpdate,
  MIN_OVERRIDE_REASON_LENGTH
} = require("./driverCompliance");

const ENABLED = { enablePersona: true, enableCheckr: true };

function fullyReadyDriver(overrides = {}) {
  return {
    email_verified: true,
    phone_verified: true,
    persona_verified: true,
    persona_status: "verified",
    checkr_status: "clear",
    approval_status: "approved",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    vehicle_year: "2020",
    ...overrides
  };
}

describe("computeDriverReadiness", () => {
  test("a fully compliant driver is ready", () => {
    const { ready } = computeDriverReadiness(fullyReadyDriver(), ENABLED);
    expect(ready).toBe(true);
  });

  test("a driver remains not ready while required checks are incomplete", () => {
    const freshApplicant = {
      email_verified: false,
      phone_verified: false,
      persona_verified: false,
      persona_status: "pending",
      checkr_status: "not_started",
      approval_status: "approved",
      vehicle_make: "Toyota",
      vehicle_model: "Camry",
      vehicle_year: "2020"
    };

    const { ready, checks } = computeDriverReadiness(freshApplicant, ENABLED);

    expect(ready).toBe(false);
    expect(checks.email_verified).toBe(false);
    expect(checks.phone_verified).toBe(false);
    expect(checks.persona_verified).toBe(false);
    expect(checks.checkr_ready).toBe(false);
  });

  test("approval_status alone (without email/phone/checkr) is not sufficient", () => {
    const { ready } = computeDriverReadiness(
      { approval_status: "approved", vehicle_make: "Toyota", vehicle_model: "Camry", vehicle_year: "2020" },
      ENABLED
    );
    expect(ready).toBe(false);
  });

  test("webhook-confirmed successful checks make the driver ready when all other requirements are satisfied", () => {
    // Simulates exactly what the real Checkr/Persona webhook handlers
    // write on a genuine passing result -- checkr_status: "clear" and
    // persona_verified: true, set from a verified third-party event, not
    // from an admin action.
    const driver = fullyReadyDriver();
    const { ready, checks } = computeDriverReadiness(driver, ENABLED);

    expect(ready).toBe(true);
    expect(checks.checkr_ready).toBe(true);
    expect(checks.persona_verified).toBe(true);
  });

  test("a pending/failed Checkr result cannot be satisfied by anything other than an accepted status", () => {
    for (const status of ["pending", "not_started", "consider", "suspended", "dispute"]) {
      const { ready, checks } = computeDriverReadiness(
        fullyReadyDriver({ checkr_status: status, approval_status: "approved" }),
        ENABLED
      );
      expect(checks.checkr_ready).toBe(false);
      expect(ready).toBe(false);
    }
  });

  test("Checkr falls back to approval_status only when it resolves to an accepted status (e.g. eligible_for_review from the real webhook)", () => {
    const readyViaFallback = computeDriverReadiness(
      fullyReadyDriver({ checkr_status: null, approval_status: "eligible_for_review" }),
      ENABLED
    );
    expect(readyViaFallback.checks.checkr_ready).toBe(true);

    const notReadyViaFallback = computeDriverReadiness(
      fullyReadyDriver({ checkr_status: null, approval_status: "approved" }),
      ENABLED
    );
    expect(notReadyViaFallback.checks.checkr_ready).toBe(false);
  });

  test("Persona and Checkr are bypassed when their integrations are disabled", () => {
    const { ready } = computeDriverReadiness(
      {
        email_verified: true,
        phone_verified: true,
        persona_verified: false,
        persona_status: "pending",
        checkr_status: "not_started",
        vehicle_make: "Toyota",
        vehicle_model: "Camry",
        vehicle_year: "2020"
      },
      { enablePersona: false, enableCheckr: false }
    );
    expect(ready).toBe(true);
  });

  test("missing vehicle info blocks readiness even when everything else passes", () => {
    const { ready, checks } = computeDriverReadiness(
      fullyReadyDriver({ vehicle_make: null }),
      ENABLED
    );
    expect(checks.vehicle_present).toBe(false);
    expect(ready).toBe(false);
  });
});

// Regression coverage for docs/production-incidents.md, "admin driver
// approval now sets verification/background-check fields" -- revised so
// ordinary approval can never manufacture a compliance result.
describe("buildOrdinaryApprovalUpdate", () => {
  test("ordinary approval cannot clear Checkr or Persona", () => {
    const update = buildOrdinaryApprovalUpdate({ now: "2026-07-30T00:00:00.000Z" });

    expect(update).not.toHaveProperty("checkr_status");
    expect(update).not.toHaveProperty("persona_verified");
    expect(update).not.toHaveProperty("persona_status");
  });

  test("ordinary approval also never touches contact verification", () => {
    const update = buildOrdinaryApprovalUpdate({ now: "2026-07-30T00:00:00.000Z" });

    expect(update).not.toHaveProperty("email_verified");
    expect(update).not.toHaveProperty("phone_verified");
  });

  test("ordinary approval sets exactly status/approval_status/approved_at/online/updated_at, and keeps the driver offline", () => {
    const update = buildOrdinaryApprovalUpdate({ now: "2026-07-30T00:00:00.000Z" });

    expect(update).toEqual({
      status: "active",
      approval_status: "approved",
      approved_at: "2026-07-30T00:00:00.000Z",
      online: false,
      updated_at: "2026-07-30T00:00:00.000Z"
    });
  });

  test("failed/pending checks cannot be overridden through the ordinary approval route", () => {
    // Applying the ordinary-approval update on top of a freshly-applied,
    // unverified driver must still leave computeDriverReadiness() false --
    // approval alone must never be enough.
    const freshApplicant = {
      email_verified: false,
      phone_verified: false,
      persona_verified: false,
      persona_status: "pending",
      checkr_status: "not_started",
      vehicle_make: "Toyota",
      vehicle_model: "Camry",
      vehicle_year: "2020"
    };

    const approved = { ...freshApplicant, ...buildOrdinaryApprovalUpdate({ now: "2026-07-30T00:00:00.000Z" }) };

    const { ready, checks } = computeDriverReadiness(approved, ENABLED);

    expect(approved.approval_status).toBe("approved");
    expect(ready).toBe(false);
    expect(checks.checkr_ready).toBe(false);
    expect(checks.persona_verified).toBe(false);
    expect(checks.email_verified).toBe(false);
    expect(checks.phone_verified).toBe(false);
  });
});

describe("buildContactVerificationOverrideUpdate", () => {
  test("sets only the field(s) explicitly provided", () => {
    expect(
      buildContactVerificationOverrideUpdate({ emailVerified: true, now: "t" })
    ).toEqual({ updated_at: "t", email_verified: true });

    expect(
      buildContactVerificationOverrideUpdate({ phoneVerified: true, now: "t" })
    ).toEqual({ updated_at: "t", phone_verified: true });
  });

  test("never touches compliance fields", () => {
    const update = buildContactVerificationOverrideUpdate({ emailVerified: true, phoneVerified: true, now: "t" });
    expect(update).not.toHaveProperty("checkr_status");
    expect(update).not.toHaveProperty("persona_verified");
  });

  test("setting nothing produces no field changes beyond updated_at", () => {
    expect(buildContactVerificationOverrideUpdate({ now: "t" })).toEqual({ updated_at: "t" });
  });
});

describe("validateComplianceOverrideRequest — every manual override is authenticated and audited", () => {
  const validReason = "Reviewed the applicant's physical ID and a clean state background report in person.";

  test("rejects anything other than the elevated admin_token auth method", () => {
    for (const authMethod of ["admin_password", "admin_session", undefined, "", "driver"]) {
      const result = validateComplianceOverrideRequest({
        authMethod,
        reason: validReason,
        reviewedDocumentation: true
      });
      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(403);
    }
  });

  test("accepts admin_token with a sufficient reason and confirmed documentation review", () => {
    const result = validateComplianceOverrideRequest({
      authMethod: "admin_token",
      reason: validReason,
      reviewedDocumentation: true
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects a missing or too-short reason even with elevated auth", () => {
    for (const reason of [undefined, "", "too short"]) {
      const result = validateComplianceOverrideRequest({
        authMethod: "admin_token",
        reason,
        reviewedDocumentation: true
      });
      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(400);
    }
    expect(validReason.length).toBeGreaterThanOrEqual(MIN_OVERRIDE_REASON_LENGTH);
  });

  test("rejects when documentation review isn't explicitly confirmed", () => {
    for (const reviewedDocumentation of [false, undefined, "yes", 1]) {
      const result = validateComplianceOverrideRequest({
        authMethod: "admin_token",
        reason: validReason,
        reviewedDocumentation
      });
      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(400);
    }
  });
});

describe("buildComplianceOverrideUpdate", () => {
  test("sets only the field(s) explicitly provided", () => {
    expect(
      buildComplianceOverrideUpdate({ checkrStatus: "clear", now: "t" })
    ).toEqual({ updated_at: "t", checkr_status: "clear" });

    expect(
      buildComplianceOverrideUpdate({ personaVerified: true, now: "t" })
    ).toEqual({ updated_at: "t", persona_verified: true });
  });

  test("never touches administrative approval fields", () => {
    const update = buildComplianceOverrideUpdate({ checkrStatus: "clear", personaVerified: true, now: "t" });
    expect(update).not.toHaveProperty("status");
    expect(update).not.toHaveProperty("approval_status");
    expect(update).not.toHaveProperty("approved_at");
    expect(update).not.toHaveProperty("online");
  });
});
