-- Adds the account-revocation/soft-delete columns that
-- server.js has referenced on both drivers and riders since the
-- account-deletion feature was built, but which were never migrated
-- into the live schema.
--
-- Found while investigating a live production bug: every driver OTP
-- login call (POST /api/driver/session/start and /session/verify)
-- explicitly selects "id, phone, access_revoked" from drivers. Since
-- access_revoked did not exist, Postgres returned a column-does-not-
-- exist error on every single call, and the route's `if (error ||
-- !driver)` check collapsed that into a generic "Driver not found." --
-- meaning no driver could sign in at all, not just the one being
-- tested.
--
-- The same four columns are referenced for the same reason (self- and
-- admin-initiated account deletion, and reactivation on a rejected
-- deletion request) on both drivers and riders:
--   - access_revoked: set true the moment a deletion is requested, so
--     the account is immediately locked out of login even though the
--     deletion itself waits for review; set back to false if the
--     request is rejected.
--   - deleted_at / deleted_reason / deleted_by: written by
--     anonymizeAccount() once a deletion is finalized.
--
-- Confirmed via information_schema.columns against the live database
-- that neither table had any of these four columns -- this is a
-- missing migration, not schema drift between the two tables.

alter table public.drivers
  add column if not exists access_revoked boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text,
  add column if not exists deleted_by text;

alter table public.riders
  add column if not exists access_revoked boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text,
  add column if not exists deleted_by text;
