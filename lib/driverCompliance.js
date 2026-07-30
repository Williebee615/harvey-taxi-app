// Pure driver readiness / compliance decision logic. server.js owns the
// actual Supabase reads/writes and the real Checkr/Persona webhook
// signature verification; this module decides what "ready" means and
// exactly what each admin action is allowed to change, so those rules
// are unit-testable without a live database or third-party service —
// same split as lib/riderPayments.js / lib/pricing.js.
//
// The rule this module exists to enforce: administrative approval (an
// admin saying "this driver's application is approved") and compliance
// verification (a real background check / identity check having
// actually passed) are two different facts. Ordinary approval must
// never manufacture the second fact. checkr_status and persona_verified
// may only change via a real Checkr/Persona webhook (already wired in
// server.js — see the two webhook handlers, which write these same
// fields from verified third-party events), or through the explicit,
// elevated, audited manual-override path defined below. See
// docs/production-incidents.md for the incident this closes.

const CHECKR_CLEAR_STATUSES = new Set(["clear", "complete", "completed", "eligible_for_review"]);
const PERSONA_APPROVED_STATUSES = new Set(["verified", "approved", "completed"]);

// Mirrors GET /api/drivers/:id/readiness exactly — server.js calls this
// directly rather than re-implementing the checks inline, so what's
// tested here is what actually runs.
function computeDriverReadiness(driver, { enablePersona, enableCheckr } = {}) {
  const checks = {
    email_verified: Boolean(driver?.email_verified),
    phone_verified: Boolean(driver?.phone_verified),
    persona_verified:
      !enablePersona ||
      Boolean(driver?.persona_verified) ||
      PERSONA_APPROVED_STATUSES.has(String(driver?.persona_status || "").toLowerCase()),
    // Falls back to approval_status when checkr_status is unset: the
    // Checkr webhook (server.js) sets approval_status to
    // "eligible_for_review" on a clear result, which is itself one of
    // the accepted statuses below, so this fallback is a real path, not
    // just defensive dead code.
    checkr_ready:
      !enableCheckr ||
      CHECKR_CLEAR_STATUSES.has(
        String(driver?.checkr_status || driver?.approval_status || "").toLowerCase()
      ),
    vehicle_present: Boolean(driver?.vehicle_make && driver?.vehicle_model && driver?.vehicle_year)
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks
  };
}

// The ONLY fields ordinary admin approval may set. Deliberately excludes
// email_verified, phone_verified, checkr_status, and persona_verified —
// see the module comment above. `online: false` is included so approval
// itself never flips a driver live; going online is a separate action
// that has to pass computeDriverReadiness() on its own merits.
function buildOrdinaryApprovalUpdate({ now }) {
  return {
    status: "active",
    approval_status: "approved",
    approved_at: now,
    online: false,
    updated_at: now
  };
}

// Manual contact-verification override — a human admin attesting they
// directly confirmed a phone number or email address outside the normal
// SMS/email code flow. Only ever sets the field(s) explicitly requested;
// never silently sets the other one as a side effect.
function buildContactVerificationOverrideUpdate({ emailVerified, phoneVerified, now }) {
  const update = { updated_at: now };
  if (typeof emailVerified === "boolean") {
    update.email_verified = emailVerified;
  }
  if (typeof phoneVerified === "boolean") {
    update.phone_verified = phoneVerified;
  }
  return update;
}

const MIN_OVERRIDE_REASON_LENGTH = 10;

// Elevated authorization for the compliance-override path specifically —
// stricter than plain requireAdmin(). authMethod is req.admin.method from
// server.js's requireAdmin(): "admin_token" is the pre-shared-secret
// method, deliberately required here instead of accepting an ordinary
// admin_password/admin_session login, since this action can make a ride
// dispatch to a driver with no real background check on file.
function validateComplianceOverrideRequest({ authMethod, reason, reviewedDocumentation }) {
  if (authMethod !== "admin_token") {
    return {
      ok: false,
      error: "Elevated admin authorization is required for a compliance override.",
      statusCode: 403
    };
  }

  if (!reason || String(reason).trim().length < MIN_OVERRIDE_REASON_LENGTH) {
    return {
      ok: false,
      error: `A written reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters is required.`,
      statusCode: 400
    };
  }

  if (reviewedDocumentation !== true) {
    return {
      ok: false,
      error: "Must explicitly confirm equivalent documentation was reviewed.",
      statusCode: 400
    };
  }

  return { ok: true };
}

// Only ever sets the field(s) explicitly requested — never both as a
// side effect of overriding one, and never anything ordinary approval
// already owns (status/approval_status/approved_at/online).
function buildComplianceOverrideUpdate({ checkrStatus, personaVerified, now }) {
  const update = { updated_at: now };
  if (checkrStatus !== undefined) {
    update.checkr_status = checkrStatus;
  }
  if (typeof personaVerified === "boolean") {
    update.persona_verified = personaVerified;
  }
  return update;
}

module.exports = {
  CHECKR_CLEAR_STATUSES,
  PERSONA_APPROVED_STATUSES,
  MIN_OVERRIDE_REASON_LENGTH,
  computeDriverReadiness,
  buildOrdinaryApprovalUpdate,
  buildContactVerificationOverrideUpdate,
  validateComplianceOverrideRequest,
  buildComplianceOverrideUpdate
};
