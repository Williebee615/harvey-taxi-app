-- ============================================================================
-- NOT APPLIED IN PRODUCTION. Do not assume this migration ran just
-- because it is committed to this repo's migrations directory.
--
-- This file documents the INTENDED forward SQL for revoking unnecessary
-- write grants on spatial_ref_sys. It was executed against production
-- on 2026-08-04 and the tool reported success, but it was a verified
-- no-op: spatial_ref_sys is owned by supabase_admin, and this project's
-- postgres role holds no grant option on supabase_admin's grants, so
-- the REVOKE below silently changed nothing. Confirmed via pg_class.relacl
-- immediately after, and reconfirmed after PR #98 merged (2026-08-04
-- ~21:22 UTC): anon/authenticated still hold INSERT/UPDATE/DELETE/
-- TRUNCATE on this table in production, unchanged.
--
-- Remediation requires either a Supabase support request (drafted in
-- docs/security-remediation/pr-04-rls-hardening.md, not yet submitted)
-- or direct action by a role with sufficient privilege over
-- supabase_admin-owned objects. No trigger or other application-level
-- workaround has been or should be used to compensate - see that same
-- doc for why.
--
-- Before re-running this file against a fresh project or after Supabase
-- support acts on the request above, re-verify pg_class.relacl and
-- information_schema.table_privileges first to confirm which parts (if
-- any) still need to run.
-- ============================================================================
--
-- spatial_ref_sys is a PostGIS-extension-owned system table (public
-- SRID/coordinate-reference-system metadata), not application data.
-- Per review decision: do NOT enable custom RLS on this table - it is
-- extension-managed, and adding RLS to it risks compatibility/upgrade
-- issues with PostGIS. The real defect is write access, not read access.
--
-- Before state (captured 2026-08-04 ~21:00 UTC):
--   relrowsecurity = false, 0 policies (unchanged by this migration).
--   Grants: PUBLIC has SELECT. anon and authenticated additionally hold
--     INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER directly
--     (left over from the extension's default table-creation grants) -
--     live-exploitable: anon/authenticated could currently write to or
--     truncate this table.
--
-- Compatibility basis for keeping SELECT public: nearest_drivers()
-- (public.nearest_drivers, SECURITY INVOKER) has EXECUTE granted to
-- anon/authenticated and performs ST_Distance/ST_DWithin geography
-- calculations against SRID 4326, which PostGIS resolves by reading
-- spatial_ref_sys under the invoking role. Revoking SELECT here would
-- risk breaking that RPC for any caller other than service_role.
-- Verification queries below confirm SRID 4326 remains readable and
-- nearest_drivers() still executes after this migration.
--
-- ATTEMPTED-NOT-APPLIED (2026-08-04 ~21:08 UTC): this migration was run
-- against production and the tool reported success, but it was a no-op.
-- spatial_ref_sys is owned by supabase_admin, not postgres; confirmed via
-- pg_class.relacl that every grant on this table, including postgres's
-- own, was made BY supabase_admin with no WITH GRANT OPTION (no "*" in
-- the ACL). A REVOKE issued by a non-owner role without grant option
-- succeeds as a silent no-op with a warning rather than raising an
-- error, which is why apply_migration returned success while nothing
-- changed. `SET ROLE supabase_admin` returns "permission denied to set
-- role" - postgres is not a member of supabase_admin (checked
-- pg_auth_members). Re-queried information_schema.table_privileges
-- immediately after: anon/authenticated still hold INSERT/UPDATE/DELETE/
-- TRUNCATE on spatial_ref_sys, unchanged. This migration is left here as
-- the correct intended forward SQL, but as of this commit it has NOT
-- taken effect in production - the write-access gap on spatial_ref_sys
-- remains open. See docs/security-remediation/pr-04-rls-hardening.md
-- for full evidence and status; do not treat this file as applied
-- without re-verifying pg_class.relacl first.

revoke insert, update, delete, truncate
  on table public.spatial_ref_sys
  from public, anon, authenticated;

grant select
  on table public.spatial_ref_sys
  to public;
