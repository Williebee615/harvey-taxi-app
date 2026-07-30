const {
  computeDriverReadiness,
  buildOrdinaryApprovalUpdate,
  validateComplianceOverrideRequest,
  applyContactVerificationOverride,
  applyComplianceOverride,
  CONTACT_OVERRIDE_RPC,
  COMPLIANCE_OVERRIDE_RPC,
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

// Regression coverage for the audit-atomicity revision: these two
// functions are the ONLY code path that applies a manual override, and
// each makes a single call to a Postgres RPC that does the driver UPDATE
// and the audit_logs INSERT in one transaction. There is no separate
// "update, then try to audit" step to diverge -- if the RPC call fails
// for any reason (including the audit INSERT failing inside it), nothing
// is applied and no driver data is returned.
describe("applyContactVerificationOverride — an audit failure cannot leave an unaudited successful override", () => {
  test("a successful atomic RPC call returns the updated driver", async () => {
    const updatedDriver = { id: "d1", email_verified: true, phone_verified: false };
    const callRpc = jest.fn().mockResolvedValue({ data: updatedDriver, error: null });

    const result = await applyContactVerificationOverride({
      callRpc,
      driverId: "d1",
      emailVerified: true,
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_contact_verification_override",
      metadata: { reason: "confirmed by phone" },
      ipAddress: "1.2.3.4",
      userAgent: "test-agent"
    });

    expect(result).toEqual({ ok: true, driver: updatedDriver });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith(CONTACT_OVERRIDE_RPC, expect.objectContaining({
      p_driver_id: "d1",
      p_email_verified: true,
      p_phone_verified: null,
      p_actor_id: "admin@example.com"
    }));
  });

  test("when the atomic call fails (e.g. the audit INSERT failed and rolled back the whole transaction), no override is applied and no driver is returned", async () => {
    const callRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "insert into audit_logs violates not-null constraint" }
    });

    const result = await applyContactVerificationOverride({
      callRpc,
      driverId: "d1",
      emailVerified: true,
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_contact_verification_override",
      metadata: {},
      ipAddress: null,
      userAgent: null
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(502);
    expect(result).not.toHaveProperty("driver");
    // Exactly one call: there is no fallback path that could apply the
    // driver update through a second, separate mechanism after this fails.
    expect(callRpc).toHaveBeenCalledTimes(1);
  });

  test("only one RPC call is ever made per request — there is no separate update-then-audit code path", async () => {
    const callRpc = jest.fn().mockResolvedValue({ data: { id: "d1" }, error: null });

    await applyContactVerificationOverride({
      callRpc,
      driverId: "d1",
      phoneVerified: true,
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_contact_verification_override",
      metadata: {},
      ipAddress: null,
      userAgent: null
    });

    expect(callRpc).toHaveBeenCalledTimes(1);
  });
});

describe("applyComplianceOverride — an audit failure cannot leave an unaudited successful override", () => {
  test("a successful atomic RPC call returns the updated driver", async () => {
    const updatedDriver = { id: "d2", checkr_status: "clear", persona_verified: true };
    const callRpc = jest.fn().mockResolvedValue({ data: updatedDriver, error: null });

    const result = await applyComplianceOverride({
      callRpc,
      driverId: "d2",
      checkrStatus: "clear",
      personaVerified: true,
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_compliance_override",
      metadata: { reason: "Reviewed physical ID and background report in person.", reviewed_documentation: true },
      ipAddress: "1.2.3.4",
      userAgent: "test-agent"
    });

    expect(result).toEqual({ ok: true, driver: updatedDriver });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith(COMPLIANCE_OVERRIDE_RPC, expect.objectContaining({
      p_driver_id: "d2",
      p_checkr_status: "clear",
      p_persona_verified: true
    }));
  });

  test("when the atomic call fails, no override is applied and no driver is returned — a compliance override cannot succeed without its audit record", async () => {
    const callRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "audit_logs insert failed" }
    });

    const result = await applyComplianceOverride({
      callRpc,
      driverId: "d2",
      checkrStatus: "clear",
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_compliance_override",
      metadata: {},
      ipAddress: null,
      userAgent: null
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(502);
    expect(result).not.toHaveProperty("driver");
    expect(callRpc).toHaveBeenCalledTimes(1);
  });

  test("only one RPC call is ever made per request", async () => {
    const callRpc = jest.fn().mockResolvedValue({ data: { id: "d2" }, error: null });

    await applyComplianceOverride({
      callRpc,
      driverId: "d2",
      personaVerified: true,
      actorType: "admin",
      actorId: "admin@example.com",
      action: "driver_compliance_override",
      metadata: {},
      ipAddress: null,
      userAgent: null
    });

    expect(callRpc).toHaveBeenCalledTimes(1);
  });
});
