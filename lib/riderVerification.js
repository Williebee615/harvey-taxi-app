// Rider-side verification helpers — pure, dependency-free (no Supabase,
// no Express), same pattern as lib/pricing.js and lib/rideDispatch.js.
//
// The `riders` table and the `drivers` table use different column
// names for the same verification concepts. `drivers` has boolean
// `phone_verified` / `persona_verified` columns; `riders` does not —
// it has `sms_verified` (not `phone_verified`) and a text
// `persona_status` column (not a boolean `persona_verified`). Several
// rider-only code paths in server.js were written assuming the
// driver-shaped columns, which made every rider signup fail and made
// the rider approval gate permanently unpassable (see the schema-drift
// production incident this module fixes). These helpers are the single
// place that translates a rider row into those verification booleans,
// so no other rider-facing code needs to know the underlying column
// names again. Driver-side code keeps reading driver.phone_verified /
// driver.persona_verified directly — those columns are real and
// correct there, and are intentionally not touched by this module.

const RIDERS_TABLE_COLUMNS = [
  "id", "full_name", "email", "phone", "verified", "approved",
  "persona_status", "created_at", "updated_at", "approval_status",
  "verification_status", "is_approved", "email_verified", "sms_verified",
  "fully_verified", "city", "state", "emergency_contact", "account_notes",
  "verification_document_type", "first_name", "last_name", "password",
  "notes", "password_hash", "payment_authorization_status",
  "payment_authorized", "payment_authorized_at", "role",
  "identity_verification_status", "identity_document_type",
  "persona_inquiry_id", "verification_completed_at", "verification_payload",
  "id_type", "id_last4", "status", "payment_status", "is_blocked",
  "is_disabled", "access_status", "approved_at", "rider_type",
  "document_type", "name", "phone_number", "mobile", "rejected_at",
  "rejection_reason", "approval_note", "stripe_customer_id",
  "persona_template_id", "persona_last_event", "persona_last_payload",
  "deletion_requested", "deletion_requested_at", "deletion_reason"
];

const PERSONA_VERIFIED_STATUSES = ["approved", "verified"];

function isRiderPhoneVerified(rider) {
  return rider?.sms_verified === true;
}

function isRiderPersonaVerified(rider) {
  return PERSONA_VERIFIED_STATUSES.includes(rider?.persona_status);
}

function isRiderVerified(rider) {
  return rider?.verified === true || rider?.fully_verified === true;
}

// Builds the exact row inserted by POST /api/riders/signup. Every key
// here must exist in RIDERS_TABLE_COLUMNS — that invariant is what the
// accompanying test locks in, using the live schema as the source of
// truth, so this class of bug (inserting a column that doesn't exist)
// can't silently return.
function buildRiderSignupRecord({
  id,
  firstName,
  lastName,
  email,
  phone,
  city,
  state,
  approvalGateEnabled,
  now
}) {
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    city,
    state,
    status: approvalGateEnabled ? "pending_verification" : "active",
    approval_status: approvalGateEnabled ? "pending" : "approved",
    email_verified: false,
    sms_verified: false,
    verified: false,
    fully_verified: false,
    persona_status: "not_started",
    created_at: now,
    updated_at: now
  };
}

module.exports = {
  RIDERS_TABLE_COLUMNS,
  isRiderPhoneVerified,
  isRiderPersonaVerified,
  isRiderVerified,
  buildRiderSignupRecord
};
