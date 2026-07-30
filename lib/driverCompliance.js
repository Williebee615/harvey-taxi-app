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

// POST /api/driver/status must require an actual JSON boolean.
// Boolean(req.body.online) would treat "false", 1, or any nonempty
// string as true -- a malformed or malicious client sending
// {"online": "false"} must be rejected, not silently taken online.
function parseDriverOnlineRequest(value) {
  if (typeof value !== "boolean") {
    return { ok: false, error: "online must be true or false." };
  }
  return { ok: true, online: value };
}

// Decides whether POST /api/driver/status may honor a request to go
// online. Going offline is always allowed regardless of readiness — the
// safety concern only runs in one direction. This is the server-side
// enforcement of the same rule GET /api/drivers/:id/readiness reports:
// the dashboard showing "not ready" is not what stops a driver from
// dispatch, this is. A modified client sending online:true directly
// must be rejected exactly like the dashboard's own toggle would be.
function evaluateDriverStatusChange({ driver, requestedOnline, enablePersona, enableCheckr }) {
  if (!requestedOnline) {
    return { allowed: true };
  }

  const { ready, checks } = computeDriverReadiness(driver, { enablePersona, enableCheckr });

  return ready ? { allowed: true, checks } : { allowed: false, checks };
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

// Both override actions below call a single Postgres function (applied
// in supabase/migrations/20260730180000_add_driver_override_atomic_
// functions.sql) that does the driver UPDATE and the audit_logs INSERT
// inside one plpgsql transaction. That's what makes "the override
// applied" and "the override was audited" a single atomic fact instead
// of two separate calls whose failure could diverge — the specific gap
// being closed here (auditLog(...).catch(() => {}) previously let an
// override succeed even when its audit record failed to save).
//
// callRpc is injected (server.js passes (name, params) =>
// supabase.rpc(name, params)) so this orchestration — specifically, what
// happens when the atomic call itself fails — is unit-testable without a
// live database. A single call site, success or failure, is the whole
// point: there is no code path here that could apply the driver change
// and then separately, fallibly, try to audit it.

const CONTACT_OVERRIDE_RPC = "apply_driver_contact_verification_override";
const COMPLIANCE_OVERRIDE_RPC = "apply_driver_compliance_override";

async function applyContactVerificationOverride({
  callRpc,
  driverId,
  emailVerified,
  phoneVerified,
  actorType,
  actorId,
  action,
  metadata,
  ipAddress,
  userAgent
}) {
  const { data, error } = await callRpc(CONTACT_OVERRIDE_RPC, {
    p_driver_id: driverId,
    p_email_verified: typeof emailVerified === "boolean" ? emailVerified : null,
    p_phone_verified: typeof phoneVerified === "boolean" ? phoneVerified : null,
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_action: action,
    p_metadata: metadata || {},
    p_ip_address: ipAddress || null,
    p_user_agent: userAgent || null
  });

  if (error) {
    return {
      ok: false,
      error: "The contact-verification override could not be applied and audited together, so it was not applied.",
      statusCode: 502
    };
  }

  return { ok: true, driver: data };
}

async function applyComplianceOverride({
  callRpc,
  driverId,
  checkrStatus,
  personaVerified,
  actorType,
  actorId,
  action,
  metadata,
  ipAddress,
  userAgent
}) {
  const { data, error } = await callRpc(COMPLIANCE_OVERRIDE_RPC, {
    p_driver_id: driverId,
    p_checkr_status: checkrStatus !== undefined ? checkrStatus : null,
    p_persona_verified: typeof personaVerified === "boolean" ? personaVerified : null,
    p_actor_type: actorType,
    p_actor_id: actorId,
    p_action: action,
    p_metadata: metadata || {},
    p_ip_address: ipAddress || null,
    p_user_agent: userAgent || null
  });

  if (error) {
    return {
      ok: false,
      error: "The compliance override could not be applied and audited together, so it was not applied.",
      statusCode: 502
    };
  }

  return { ok: true, driver: data };
}

module.exports = {
  CHECKR_CLEAR_STATUSES,
  PERSONA_APPROVED_STATUSES,
  MIN_OVERRIDE_REASON_LENGTH,
  CONTACT_OVERRIDE_RPC,
  COMPLIANCE_OVERRIDE_RPC,
  computeDriverReadiness,
  parseDriverOnlineRequest,
  evaluateDriverStatusChange,
  buildOrdinaryApprovalUpdate,
  validateComplianceOverrideRequest,
  applyContactVerificationOverride,
  applyComplianceOverride
};
