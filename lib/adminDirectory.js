// Admin drivers/riders list field allow-lists
// (docs/security-remediation/admin-drivers-riders-list-minimization.md).
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

module.exports = {
  ADMIN_DRIVERS_LIST_FIELDS,
  ADMIN_RIDERS_LIST_FIELDS
};
