-- HTAF application -> ride idempotency (docs/security-remediation/
-- pr-htaf-flow-repair.md). Closes a real gap in POST /api/admin/
-- foundation/applications/:id/create-ride: it had no check for an
-- already-existing ride before inserting a new one, so a retried
-- request or an admin double-click could create two `rides` rows for
-- the same HTAF application, silently orphaning the first one.
--
-- Pre-migration production check (2026-08-06, read-only, via
-- mcp__Supabase__execute_sql):
--   select htaf_application_id, count(*) from rides
--   where htaf_application_id is not null group by htaf_application_id
--   having count(*) > 1;
--   -> zero rows. No existing duplicates. Safe to add the unique index
--   below without any cleanup migration.
--
--   select id, ride_id from htaf_applications; -> all 4 existing rows
--   have ride_id = null (none have been scheduled into a ride yet).
--   select * from rides where htaf_application_id is not null; -> zero
--   rows. Confirms a clean slate for both sides of this relationship.
--
-- Idempotent: safe to re-run against an environment where this has
-- already been applied (index uses IF NOT EXISTS, function uses
-- CREATE OR REPLACE).

-- ============================================================
-- 1. Database-level backstop: a ride can never be linked from more
--    than one HTAF application. Partial (WHERE ... IS NOT NULL) so it
--    only constrains real links, not the many rides with no HTAF
--    application at all.
-- ============================================================

create unique index if not exists rides_htaf_application_id_unique
  on public.rides (htaf_application_id)
  where htaf_application_id is not null;

-- ============================================================
-- 2. Atomic claim-and-create function. server.js calls this via
--    supabase.rpc(...) instead of a separate select + insert + update,
--    so the whole "check for an existing ride, and if none exists,
--    create exactly one" sequence runs as a single transaction with a
--    row lock on the application, the same pattern already established
--    by apply_driver_compliance_override/apply_driver_contact_
--    verification_override (20260730180000_add_driver_override_atomic_
--    functions.sql).
--
--    `select ... for update` on the application row serializes any
--    concurrent calls for the SAME application: the second caller
--    blocks until the first's transaction commits (or rolls back), then
--    sees the first's result (ride_id now set) and returns 'existing'
--    instead of racing to insert a second ride. The unique index above
--    is the final backstop against any race this lock doesn't catch.
--
--    Returns exactly one row describing what happened:
--      outcome = 'created'      -> a new ride was made; `ride` is it.
--      outcome = 'existing'     -> the application already had a valid
--                                   ride_id; `ride` is that existing ride,
--                                   nothing new was created.
--      outcome = 'not_found'    -> no application with that id.
--      outcome = 'inconsistent' -> the application's own state doesn't
--                                   make sense (a ride_id pointing at a
--                                   ride that no longer exists, or a
--                                   status already at/past 'scheduled'
--                                   with no ride_id at all) -- returned
--                                   as a fact for the caller to surface
--                                   to an admin, never guessed at or
--                                   silently repaired here.
-- ============================================================

create or replace function public.create_htaf_ride_atomic(
  p_application_id text,
  p_ride_id text,
  p_rider_name text,
  p_rider_phone text,
  p_pickup_address text,
  p_dropoff_address text,
  p_ride_type text,
  p_scheduled_time text,
  p_status text,
  p_dispatch_status text,
  p_estimated_fare numeric,
  p_driver_payout numeric,
  p_estimated_platform_fee numeric,
  p_pricing_snapshot jsonb,
  p_estimated_distance_miles numeric,
  p_estimated_duration_minutes numeric,
  p_miles_estimate numeric,
  p_minutes_estimate numeric,
  p_notes text
)
returns table (outcome text, reason text, ride public.rides)
language plpgsql
as $function$
declare
  v_application public.htaf_applications%rowtype;
  v_existing_ride public.rides%rowtype;
  v_new_ride public.rides%rowtype;
begin
  select * into v_application
  from public.htaf_applications
  where id = p_application_id
  for update;

  if not found then
    return query select 'not_found'::text, null::text, null::public.rides;
    return;
  end if;

  if v_application.ride_id is not null then
    select * into v_existing_ride from public.rides where id = v_application.ride_id;

    if found then
      return query select 'existing'::text, null::text, v_existing_ride;
      return;
    else
      return query select 'inconsistent'::text, 'ride_id_not_found'::text, null::public.rides;
      return;
    end if;
  end if;

  if v_application.status in ('scheduled', 'completed') then
    return query select 'inconsistent'::text, 'status_ahead_of_ride_id'::text, null::public.rides;
    return;
  end if;

  insert into public.rides (
    id, rider_id, htaf_application_id, rider_name, rider_phone,
    pickup_address, dropoff_address, ride_type, scheduled_time,
    status, dispatch_status, estimated_fare, driver_payout,
    estimated_platform_fee, pricing_snapshot, estimated_distance_miles,
    estimated_duration_minutes, miles_estimate, minutes_estimate,
    notes, created_at, updated_at
  ) values (
    p_ride_id, null, p_application_id, p_rider_name, p_rider_phone,
    p_pickup_address, p_dropoff_address, p_ride_type, p_scheduled_time,
    p_status, p_dispatch_status, p_estimated_fare, p_driver_payout,
    p_estimated_platform_fee, p_pricing_snapshot, p_estimated_distance_miles,
    p_estimated_duration_minutes, p_miles_estimate, p_minutes_estimate,
    p_notes, now(), now()
  )
  returning * into v_new_ride;

  update public.htaf_applications
    set status = 'scheduled',
        ride_id = v_new_ride.id,
        updated_at = now()
    where id = p_application_id;

  return query select 'created'::text, null::text, v_new_ride;
end;
$function$;
