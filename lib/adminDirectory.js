// Admin list/mutation/audit-log field allow-lists.
// Drivers/riders lists: docs/security-remediation/
// admin-drivers-riders-list-minimization.md. Rides/audit-logs/SSE:
// docs/security-remediation/admin-rides-audit-stream-minimization.md.
//
// GET /api/admin/drivers and GET /api/admin/riders used to select("*"),
// which returns every column on the row -- including password_hash,
// raw SMS/email verification codes and their hashes, raw Persona/Checkr
// webhook payloads, verification_payload, Stripe customer/account ids,
// and id_last4 -- to any holder of the single flat admin credential.
// These allow-lists are the single source of truth shared by server.js's
// .select() calls AND the tests below, so a column can't silently
// reappear in the list response without a test catching it.
//
// Each list only carries what a live admin page actually reads today
// (public/admin-dashboard.html, public/admin-live-dispatch-map.html,
// public/admin-home.html for drivers) plus id/created_at, which the
// route itself requires for keyset pagination (server.js's
// encodeCursor/decodeCursor/applyCursor order on created_at, then id).
// No live admin workflow was found needing a credential, verification,
// raw provider payload, or payment-linkage field at the list level --
// if one ever does, it belongs on a new GET .../:id detail endpoint
// with its own explicit allow-list, not back on this bulk list.

const ADMIN_DRIVERS_LIST_FIELDS = [
  "id",
  "created_at",
  "first_name",
  "last_name",
  "full_name",
  "name",
  "email",
  "status",
  "approval_status",
  "checkr_status",
  "online",
  "availability_status",
  "online_status",
  "current_address",
  "city"
];

const ADMIN_RIDERS_LIST_FIELDS = [
  "id",
  "created_at",
  "first_name",
  "last_name",
  "email",
  "phone",
  "status",
  "approval_status"
];

// admin-rides-audit-stream-minimization.md. Same methodology: every live
// admin page reading GET /api/admin/rides was read first
// (admin-dashboard.html, admin-live-dispatch-map.html,
// autonomous-analytics.html). Unlike drivers/riders, the rides table has
// no credential/verification-secret columns -- the fields excluded here
// (rider_phone, driver_phone, driver_vehicle, exact lat/lng, the raw
// jsonb snapshots, payment_id, delivery_pin, admin_note/notes,
// cancellation reasons, pilot_* columns) are excluded because no live
// page reads them, not because they're forbidden the way password_hash
// was. If a future workflow needs one, add it here with the same
// live-usage justification, not by reverting to select("*").
const ADMIN_RIDES_LIST_FIELDS = [
  "id",
  "created_at",
  "updated_at",
  "requested_at",
  "status",
  "ride_status",
  "dispatch_status",
  "requested_mode",
  "rider_id",
  "rider_name",
  "driver_id",
  "current_driver_id",
  "driver_name",
  "pickup_address",
  "dropoff_address",
  "payment_status",
  "estimated_fare",
  "final_fare",
  "estimated_driver_payout",
  "final_driver_payout",
  "tip_amount",
  "dispatch_attempts",
  "mission_id"
];

// Response/broadcast shape for the ride-mutation routes (PATCH .../status,
// POST .../assign-driver). No live page reads anything beyond a
// success/failure signal from these responses -- every caller just shows
// a toast and re-fetches the full list -- so unlike the list route above,
// this is deliberately smaller than "everything a page happens to use":
// it's the minimum an admin needs to see that the specific mutation they
// just performed took effect, on both the HTTP response and the
// broadcastSse() event these two routes fire. Full ride detail remains
// available through GET /api/admin/rides's own allow-list above.
const ADMIN_RIDE_MUTATION_FIELDS = [
  "id",
  "status",
  "dispatch_status",
  "driver_id",
  "updated_at"
];

// Same reasoning as ADMIN_RIDE_MUTATION_FIELDS, for PATCH
// /api/admin/drivers/:id/approve and /reject: both used to
// .select() (== select("*")) and broadcast the full driver row --
// including password_hash and every other forbidden field
// ADMIN_DRIVERS_LIST_FIELDS already excludes -- to every connected admin
// SSE client, in addition to returning it in the HTTP response. No live
// page reads either response beyond a success toast. Fields here are
// exactly what buildOrdinaryApprovalUpdate() (lib/driverCompliance.js)
// and the reject route's inline update actually change.
const ADMIN_DRIVER_MUTATION_FIELDS = [
  "id",
  "status",
  "approval_status",
  "approved_at",
  "online",
  "rejection_reason",
  "updated_at"
];

// Same reasoning, for PATCH /api/admin/riders/:id/approve.
const ADMIN_RIDER_MUTATION_FIELDS = [
  "id",
  "status",
  "approval_status",
  "approved_at",
  "email_verified",
  "sms_verified",
  "updated_at"
];

// GET /api/admin/audit-logs. Unlike the tables above, audit_logs has no
// credential/verification-secret/raw-payload column to exclude -- its
// entire schema (10 columns) is exactly what an audit trail needs to
// serve its purpose (actor, action, entity, metadata, IP, timestamp).
// This allow-list exists for the same defense-in-depth reason as the
// others -- a single source of truth so a future column addition can't
// silently start appearing in this response without a deliberate
// decision -- not because any current column is being cut.
const ADMIN_AUDIT_LOGS_LIST_FIELDS = [
  "id",
  "actor_type",
  "actor_id",
  "action",
  "entity_type",
  "entity_id",
  "metadata",
  "ip_address",
  "user_agent",
  "created_at"
];

module.exports = {
  ADMIN_DRIVERS_LIST_FIELDS,
  ADMIN_RIDERS_LIST_FIELDS,
  ADMIN_RIDES_LIST_FIELDS,
  ADMIN_RIDE_MUTATION_FIELDS,
  ADMIN_DRIVER_MUTATION_FIELDS,
  ADMIN_RIDER_MUTATION_FIELDS,
  ADMIN_AUDIT_LOGS_LIST_FIELDS
};
