-- Pin search_path on seven public functions that Supabase's security
-- advisor flags as "Function Search Path Mutable" (lint 0011).
--
-- All seven are SECURITY INVOKER and only reference public.* tables and
-- built-ins (PostGIS ST_* functions live in public on this project), so
-- pinning search_path to pg_catalog, public keeps their behaviour and stops
-- a caller's own search_path from changing what they resolve to.
--
-- Bodies, signatures, grants and ownership are unchanged: ALTER FUNCTION
-- only sets the per-function configuration. Each function is altered only
-- if it exists, so this applies cleanly to databases that lack some of them.

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_updated_at',
        'drivers_sync_geog',
        'increment_usage_counter',
        'apply_driver_contact_verification_override',
        'apply_driver_compliance_override',
        'increment_rider_session_version',
        'create_htaf_ride_atomic'
      )
  loop
    execute format('alter function %s set search_path = pg_catalog, public', fn);
  end loop;
end
$$;
