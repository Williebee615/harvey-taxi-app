-- Admin RBAC Phase 2: shadow-mode authorization logging (docs/
-- security-remediation/admin-rbac-phase2-shadow-mode.md). This table is
-- the analysis record Phase 2 produces -- what the new RBAC engine
-- would have decided for a real admin request, recorded alongside what
-- requireAdmin() actually decided (always "allow", since Phase 2 never
-- blocks anything). It is written to, never read from, by any request
-- path; requireAdmin() remains the sole actual authority through this
-- entire phase.
--
-- Deliberately metadata-only: no request body, no HTAF/rider/driver
-- record contents, no payment data, no secrets. Just enough to answer
-- "would the proposed role/capability model have agreed with today's
-- flat admin access, for this route, for this admin, at this time" --
-- see lib/adminRbacShadow.js's buildShadowLogEntry() for the exact
-- allow-listed field set this table's rows are built from.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, index uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS admin_rbac_shadow_log (
  id BIGSERIAL PRIMARY KEY,
  actor_email TEXT,
  auth_method TEXT,
  route TEXT NOT NULL,
  http_method TEXT NOT NULL,
  required_capability TEXT NOT NULL,
  resolved_role TEXT,
  resolution_source TEXT NOT NULL,
  would_allow BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_rbac_shadow_log_created_at_idx
  ON admin_rbac_shadow_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_rbac_shadow_log_would_allow_idx
  ON admin_rbac_shadow_log (would_allow)
  WHERE would_allow = false;

-- Same posture as admin_roles: RLS enabled, no policies, so only the
-- service-role backend client can read or write this table. Nothing in
-- public/ or any anon/authenticated context ever will.
ALTER TABLE admin_rbac_shadow_log ENABLE ROW LEVEL SECURITY;
