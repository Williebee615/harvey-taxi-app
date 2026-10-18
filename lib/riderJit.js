// Just-in-Time rider booking (owner decision 2026-10-18, Option A):
// a rider can see the map and a fare estimate without an account, and
// signs up at "Confirm Ride" with a phone number and a texted code. A
// verified phone number approves the rider automatically under a rule
// the owner set; staff can suspend and reinstate. Everything here is
// off unless the jit_booking_enabled system flag is "true".
//
// Pure decisions only (no I/O), so each rule is unit-tested directly.

const JIT_BOOKING_FLAG = "jit_booking_enabled";

// Recorded on every automatic approval, so an audit reader can see the
// rule that approved the rider and who set it. No agent or staff member
// decides these approvals; the owner's rule does.
const AUTO_APPROVAL_RULE = Object.freeze({
  rule: "phone_verified",
  set_by: "owner",
  decision_date: "2026-10-18",
  decision: "Option A: approve automatically on phone verification"
});

const SUSPENDED = "suspended";

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function isRiderSuspended(rider) {
  return (
    lower(rider?.status) === SUSPENDED ||
    lower(rider?.approval_status) === SUSPENDED ||
    rider?.is_blocked === true
  );
}

function isRiderApproved(rider) {
  return (
    ["active", "approved"].includes(lower(rider?.status)) &&
    lower(rider?.approval_status) === "approved"
  );
}

// First name for the driver to look for at pickup. Letters (any
// language), spaces, apostrophes, hyphens and dots; 1-60 characters.
// Anything else is refused rather than cleaned up, so the driver never
// sees a mangled name.
function cleanFirstName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return "";
  if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(name)) return "";
  return name;
}

// The fields to write when a rider proves their phone number. Returns
// null when nothing should change: a suspended, revoked or deleted rider
// is never approved by the rule, and an already-approved rider with a
// verified phone needs no write.
function planRiderAutoApproval(rider, now) {
  if (!rider || rider.access_revoked === true || rider.deleted_at) return null;
  if (isRiderSuspended(rider)) return null;
  if (isRiderApproved(rider) && rider.sms_verified === true) return null;

  return {
    status: "active",
    approval_status: "approved",
    approved_at: rider.approved_at || now,
    sms_verified: true,
    updated_at: now
  };
}

// A new rider created at "Confirm Ride": first name and phone only.
// Email and last name are optional on the riders table and can be added
// later. The phone is already verified (the code check succeeded), so
// the rule approves the account at creation.
function buildQuickRiderRecord({ id, firstName, phone, now }) {
  return {
    id,
    first_name: firstName,
    last_name: null,
    email: null,
    phone,
    state: "TN",
    status: "active",
    approval_status: "approved",
    approved_at: now,
    email_verified: false,
    sms_verified: true,
    verified: false,
    fully_verified: false,
    persona_status: "not_started",
    created_at: now,
    updated_at: now
  };
}

// Staff suspension: the rider can still sign in and see their history,
// but cannot book (getRiderReadiness refuses a suspended rider).
function buildSuspensionUpdate({ reason, now }) {
  return {
    status: SUSPENDED,
    approval_status: SUSPENDED,
    is_blocked: true,
    approval_note: reason,
    updated_at: now
  };
}

// Reinstatement returns the rider to where the rules would put them:
// approved if their phone is verified, otherwise back to pending.
function buildReinstatementUpdate({ rider, reason, now }) {
  const phoneVerified = rider?.sms_verified === true;
  return {
    status: phoneVerified ? "active" : "pending_verification",
    approval_status: phoneVerified ? "approved" : "pending",
    is_blocked: false,
    approval_note: reason,
    updated_at: now
  };
}

// Suspension and reinstatement need a stated reason (recorded in the
// audit log and on the rider row), 3-500 characters.
function cleanStaffReason(raw) {
  const reason = String(raw || "").trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 500) return "";
  return reason;
}

module.exports = {
  JIT_BOOKING_FLAG,
  AUTO_APPROVAL_RULE,
  isRiderSuspended,
  isRiderApproved,
  cleanFirstName,
  planRiderAutoApproval,
  buildQuickRiderRecord,
  buildSuspensionUpdate,
  buildReinstatementUpdate,
  cleanStaffReason
};
