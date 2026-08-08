-- P0 follow-up (lower risk, same RLS hardening PR): usage_counters and
-- preferred_drivers currently have RLS disabled and zero policies
-- (relrowsecurity = false, confirmed via pg_class before this migration).
-- Both are application tables, both are currently empty. This migration
-- brings them in line with the existing deny_all_X/service_role_X
-- pattern already used by riders, drivers, and ~35 other tables in this
-- schema.
--
-- Before state (captured 2026-08-04 ~21:00 UTC):
--   usage_counters:     relrowsecurity=false, 0 policies
--   preferred_drivers:  relrowsecurity=false, 0 policies
--   usage_counters table grants: anon/authenticated hold SELECT, INSERT,
--     UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER at the table-grant
--     level (default Postgres/Supabase template grants) - live-exploitable
--     while RLS is disabled.
--   preferred_drivers table grants: only postgres/service_role - no
--     anon/authenticated table grants exist, so this table's RLS gap is
--     defense-in-depth, not a currently-open hole.
--
-- Confirmed via grep across server.js and public/: usage_counters is
-- touched only by increment_usage_counter(), called from exactly one
-- call site (server.js, backend service-role client). preferred_drivers
-- has zero application code references anywhere. The app does not
-- depend on direct anon/authenticated REST access to either table.

alter table public.usage_counters enable row level security;

create policy "service_role_usage_counters"
  on public.usage_counters
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "deny_all_usage_counters"
  on public.usage_counters
  as permissive
  for all
  to public
  using (false);

alter table public.preferred_drivers enable row level security;

create policy "service_role_preferred_drivers"
  on public.preferred_drivers
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "deny_all_preferred_drivers"
  on public.preferred_drivers
  as permissive
  for all
  to public
  using (false);

-- Mandatory RPC check (per review): increment_usage_counter() is
-- SECURITY INVOKER (confirmed via pg_proc.prosecdef = false before this
-- migration), so it does NOT bypass the RLS policies above - once RLS is
-- enabled, an anon/authenticated caller invoking it directly would
-- already be blocked by deny_all_usage_counters. EXECUTE is nonetheless
-- revoked from anon/authenticated/PUBLIC here as defense-in-depth, since
-- only the backend (service_role) ever calls it and unrestricted EXECUTE
-- serves no purpose.
revoke execute on function public.increment_usage_counter(text)
  from public, anon, authenticated;
