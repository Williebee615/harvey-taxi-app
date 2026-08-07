// Admin RBAC Phase 1: additive foundation only (docs/security-
// remediation/admin-rbac-phase1-foundation.md, admin-rbac-architecture-
// audit.md). Nothing in this file is wired into any route yet -- every
// /api/admin/* route still authorizes purely through requireAdmin()/
// requireElevatedAdmin() in server.js, exactly as before this file
// existed. This module exists so the next phases (shadow-mode logging,
// then per-route-group enforcement) have a real, tested permission
// model to consult instead of inventing one at the same time
// enforcement is flipped on.
//
// Permissions are capabilities, not route names (e.g.
// "htaf.applications.read", not "GET /api/admin/foundation/
// applications") -- a route can require one capability, a future route
// covering the same resource can require the same capability, and the
// six-role model doesn't need to change shape as the API surface grows.
//
// Every export here is a pure function or a plain data structure -- no
// I/O, no Supabase calls, fully unit-testable in isolation.

// The six roles from the approved architecture
// (admin-rbac-architecture-audit.md's "Proposed role matrix").
// super_admin is not special-cased in hasCapability() below -- it is
// simply the role granted every capability in ADMIN_CAPABILITIES, so
// removing a capability from it works exactly like removing it from
// any other role.
const ADMIN_ROLES = Object.freeze([
  "super_admin",
  "htaf_caseworker",
  "dispatcher",
  "support",
  "finance",
  "compliance"
]);

// Every capability this rollout currently knows about, grouped by
// domain and mapped to the route inventory in admin-rbac-architecture-
// audit.md. hasCapability() treats a capability string not in this set
// as unknown and denies it by default, the same as an unknown role --
// a typo in a future route's permission check can never accidentally
// resolve to an allow.
const ADMIN_CAPABILITIES = Object.freeze([
  // HTAF (route table #4-#10)
  "htaf.applications.read",
  "htaf.applications.read_detail",
  "htaf.applications.update",
  "htaf.applications.export",
  "htaf.applications.triage",
  "htaf.rides.create",

  // Rides (route table #16-#18)
  "rides.read",
  "rides.dispatch",

  // Drivers (route table #19, #21-#24, #36)
  "drivers.read",
  "drivers.approve",
  "drivers.reject",
  "drivers.contact_verification.override",
  "drivers.compliance.override",
  "drivers.compliance.read",

  // Riders (route table #20, #25)
  "riders.read",
  "riders.approve",

  // Finance (no dedicated route today -- fare/payout data embedded in
  // rides/metrics; see architecture doc's note on this)
  "finance.read",
  "finance.export",

  // Compliance / audit / deletion (route table #26, #33-#35)
  "audit.read",
  "deletion_requests.read",
  "deletion_requests.approve",
  "deletion_requests.reject",

  // Cross-cutting admin/system (route table #8, #11-#15, #27-#29,
  // #30-#32, #12)
  "admin.dashboard.read",
  "admin.config.read",
  "admin.system.dispatch.control",
  "admin.system.flags.manage",
  "admin.stream.connect",
  "admin.rbac.manage"
]);

const ADMIN_CAPABILITY_SET = new Set(ADMIN_CAPABILITIES);

// Grant lists per non-super_admin role, straight from the architecture
// doc's role matrix. super_admin is derived below as "all of
// ADMIN_CAPABILITIES" rather than hand-duplicated, so it can never
// silently drift out of sync with the master capability list.
const ROLE_CAPABILITIES = Object.freeze({
  super_admin: Object.freeze([...ADMIN_CAPABILITIES]),

  htaf_caseworker: Object.freeze([
    "htaf.applications.read",
    "htaf.applications.read_detail",
    "htaf.applications.update",
    "htaf.applications.export",
    "htaf.applications.triage",
    "htaf.rides.create"
  ]),

  dispatcher: Object.freeze([
    "rides.read",
    "rides.dispatch",
    "drivers.read",
    "drivers.approve",
    "drivers.reject",
    "admin.dashboard.read"
  ]),

  support: Object.freeze([
    "drivers.read",
    "riders.read",
    "riders.approve",
    "admin.dashboard.read"
  ]),

  finance: Object.freeze([
    "finance.read",
    "finance.export",
    "admin.dashboard.read"
  ]),

  compliance: Object.freeze([
    "drivers.compliance.override",
    "drivers.compliance.read",
    "drivers.contact_verification.override",
    "audit.read",
    "deletion_requests.read",
    "deletion_requests.approve",
    "deletion_requests.reject"
  ])
});

// The deny-by-default resolver. Three ways this can say no, and
// exactly one way it can say yes:
//   - role isn't a recognized key in ROLE_CAPABILITIES -> deny
//   - capability isn't a recognized member of ADMIN_CAPABILITY_SET ->
//     deny, even if some role's grant list happens to contain the
//     string (defends against a typo'd capability added to a grant
//     list without also being added to the master list)
//   - capability recognized but not in this role's grant list -> deny
//   - capability recognized AND in this role's grant list -> allow
// There is no "unknown role/capability, allow anyway" branch anywhere
// in this function.
function hasCapability(role, capability) {
  if (!ADMIN_CAPABILITY_SET.has(capability)) return false;
  const grants = ROLE_CAPABILITIES[role];
  if (!grants) return false;
  return grants.includes(capability);
}

// Maps today's requireAdmin() output (server.js: { id, email, method },
// method one of "admin_token" | "admin_password" | "admin_session") to
// a role. This is the entire "preserve the existing administrator as
// super_admin" guarantee for Phase 1: since every current admin
// identity uses one of these three methods, every one of them resolves
// to super_admin -- full access, unchanged. An unrecognized method
// (there is no such thing today, but a future auth method added
// without also updating this function) resolves to null, the same
// deny-by-default posture as hasCapability(), rather than guessing.
//
// This function does not query admin_roles (the table added in this
// phase's migration) -- that lookup is Phase 2+'s job, once real
// per-account role assignment is wired to something enforcement
// actually consults. Keeping this phase's role resolution entirely
// code-based, with no database dependency, is what makes it impossible
// for this phase to introduce a lockout: there is no row that could be
// missing, malformed, or out of sync.
const LEGACY_ADMIN_METHODS_ARE_SUPER_ADMIN = new Set([
  "admin_token",
  "admin_password",
  "admin_session"
]);

function resolveAdminRole(admin) {
  if (!admin || typeof admin !== "object") return null;
  if (LEGACY_ADMIN_METHODS_ARE_SUPER_ADMIN.has(admin.method)) {
    return "super_admin";
  }
  return null;
}

module.exports = {
  ADMIN_ROLES,
  ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
  hasCapability,
  resolveAdminRole
};
