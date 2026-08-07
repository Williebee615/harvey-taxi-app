// Admin RBAC Phase 2: shadow-mode authorization logging (docs/
// security-remediation/admin-rbac-phase2-shadow-mode.md). Every
// function here is pure -- no Supabase calls, no I/O -- so the
// decision logic can be fully unit-tested in isolation from the actual
// database round-trip, which lives in server.js next to the routes it
// instruments.
//
// This module never denies, blocks, or redirects anything. It only
// computes what the proposed RBAC model *would* decide, for recording
// alongside the real decision (which is always "requireAdmin already
// allowed this request" -- Phase 2 doesn't touch that).

const { hasCapability } = require("./adminRbac");

// Which capability a given route requires, keyed by "METHOD path"
// using the same :param placeholder style as server.js's Express route
// definitions. This is Phase 2's representative starting mix, not the
// full 36-route inventory -- expand this map as instrumentation
// expands, per the plan to start narrow and widen once this first
// batch produces sane evidence.
const ROUTE_CAPABILITIES = Object.freeze({
  "GET /api/admin/foundation/applications": "htaf.applications.read",
  "PATCH /api/admin/foundation/applications/:id": "htaf.applications.update",
  "POST /api/admin/rides/:id/assign-driver": "rides.dispatch",
  "PATCH /api/admin/drivers/:id/approve": "drivers.approve",
  "PATCH /api/admin/drivers/:id/compliance-override": "drivers.compliance.override",
  "GET /api/admin/audit-logs": "audit.read",
  "POST /api/admin/system/enable-rider-auth-ui": "admin.system.flags.manage"
});

// Resolution-source labels. Every branch of resolveShadowRole() below
// returns exactly one of these, so shadow telemetry can always tell
// "the database told us the real role" apart from "the database
// couldn't be reached" apart from "there was truly no row for this
// email" -- collapsing any of these into a single "role unknown" state
// would make a real outage look identical to a real, intentional
// access gap in the analysis data.
const RESOLUTION_SOURCE = Object.freeze({
  DB_ROW: "db_row",
  DB_ERROR_LEGACY_FALLBACK: "db_error_legacy_fallback",
  DB_ERROR_NO_FALLBACK: "db_error_no_fallback",
  MISSING_ROW_LEGACY_FALLBACK: "missing_row_legacy_fallback",
  MISSING_ROW_NO_FALLBACK: "missing_row_no_fallback"
});

// The Phase-2-specific role resolution path. Deliberately NOT
// lib/adminRbac.js's resolveAdminRole(), which maps every one of
// today's three legacy auth methods straight to super_admin -- using
// that here would make every shadow check trivially "would_allow:
// true" and produce no useful evidence about whether the proposed
// role/capability model actually matches real usage.
//
// Inputs are pre-computed by the caller (server.js does the actual
// Supabase round-trip and passes in the outcome) so this function
// itself never touches the network and is fully unit-testable:
//   - dbLookupFailed: true if the admin_roles query itself errored
//     (network/DB issue), as opposed to succeeding with zero rows.
//   - roleRow: the admin_roles row for this email if the lookup
//     succeeded and found one, otherwise null/undefined.
//   - isLegacyAdmin: true only if the authenticated email matches the
//     env-var-configured ADMIN_EMAIL this codebase has always used --
//     never derived from anything client-supplied.
//
// The fallback-to-super_admin branches exist ONLY for isLegacyAdmin,
// and only cover "the lookup itself couldn't tell us" (error or
// missing row) -- a real row that says something other than
// super_admin for the legacy admin's email is respected as-is, not
// overridden.
function resolveShadowRole({ dbLookupFailed, roleRow, isLegacyAdmin }) {
  if (dbLookupFailed) {
    return isLegacyAdmin
      ? { role: "super_admin", source: RESOLUTION_SOURCE.DB_ERROR_LEGACY_FALLBACK }
      : { role: null, source: RESOLUTION_SOURCE.DB_ERROR_NO_FALLBACK };
  }

  if (roleRow && typeof roleRow.role === "string" && roleRow.role) {
    return { role: roleRow.role, source: RESOLUTION_SOURCE.DB_ROW };
  }

  return isLegacyAdmin
    ? { role: "super_admin", source: RESOLUTION_SOURCE.MISSING_ROW_LEGACY_FALLBACK }
    : { role: null, source: RESOLUTION_SOURCE.MISSING_ROW_NO_FALLBACK };
}

// hasCapability() already denies by default for a null/unrecognized
// role -- this is a thin, named wrapper so callers don't need to
// import hasCapability() separately just to compute the shadow
// decision, and so the "role could be null" case reads clearly at the
// call site rather than relying on hasCapability()'s general-purpose
// deny-by-default behavior implicitly.
function computeWouldAllow(role, capability) {
  if (!role) return false;
  return hasCapability(role, capability);
}

// Builds the exact, allow-listed row this phase writes to
// admin_rbac_shadow_log. Explicit allow-list, same discipline as every
// other data-minimization fix in this codebase's admin surface: only
// these fields are ever included, regardless of what's on the input
// objects -- there is no request body, HTAF/rider/driver record
// content, payment data, or secret anywhere in this function's inputs
// or output.
function buildShadowLogEntry({ admin, route, httpMethod, capability, role, source, wouldAllow, at }) {
  return {
    actor_email: admin && typeof admin.email === "string" ? admin.email : null,
    auth_method: admin && typeof admin.method === "string" ? admin.method : null,
    route,
    http_method: httpMethod,
    required_capability: capability,
    resolved_role: role || null,
    resolution_source: source,
    would_allow: wouldAllow,
    created_at: at || new Date().toISOString()
  };
}

module.exports = {
  ROUTE_CAPABILITIES,
  RESOLUTION_SOURCE,
  resolveShadowRole,
  computeWouldAllow,
  buildShadowLogEntry
};
