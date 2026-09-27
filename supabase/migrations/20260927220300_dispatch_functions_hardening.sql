-- Hardens the two dispatch-matching Postgres functions that already
-- exist live in production (dispatch_ride_atomic, nearest_drivers) but
-- are not represented anywhere in this repo's migration history --
-- confirmed by direct schema inspection (mcp__Supabase__execute_sql,
-- 2026-09-27), not assumed. This migration is the first time their
-- definitions are captured in version control.
--
-- ============================================================
-- HISTORICAL RECORD: definitions as they exist live today, captured
-- verbatim via pg_get_functiondef() before this migration's changes.
-- Kept here for the record, not executed.
-- ============================================================
--
-- dispatch_ride_atomic(p_ride_id text, p_driver_id text, p_expires_seconds integer default 30)
--   returns table(offer_id text)
--   language plpgsql
-- as $function$
-- declare
--   v_ride        public.rides%rowtype;
--   v_offer_id    text;
--   v_attempt     integer;
-- begin
--   select * into v_ride from public.rides where id = p_ride_id for update;
--   if not found then
--     raise exception 'Ride % not found', p_ride_id;
--   end if;
--   if v_ride.current_driver_id is not null
--      and v_ride.dispatch_status = 'offer_sent' then
--     raise exception 'Ride % already has a live offer', p_ride_id;
--   end if;
--   v_attempt := coalesce(v_ride.dispatch_attempts, 0) + 1;
--   v_offer_id := 'OFFER-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));
--   insert into public.driver_offers (id, ride_id, driver_id, status, attempt, expires_at, created_at, updated_at)
--     values (v_offer_id, p_ride_id, p_driver_id, 'pending', v_attempt,
--             now() + make_interval(secs => p_expires_seconds), now(), now());
--   update public.rides
--     set status = 'awaiting_driver_acceptance', dispatch_status = 'offer_sent',
--         current_offer_id = v_offer_id, current_driver_id = p_driver_id,
--         dispatch_attempts = v_attempt, updated_at = now()
--     where id = p_ride_id;
--   offer_id := v_offer_id;
--   return next;
-- end;
-- $function$;
--
-- *** IMPORTANT DISCOVERY, not previously known: this live definition
-- references public.rides.current_driver_id, which DOES NOT EXIST as a
-- column on public.rides (confirmed: information_schema.columns has no
-- such column; the closest real columns are driver_id,
-- assigned_driver_id, current_dispatch_id -- none is current_driver_id).
-- PL/pgSQL does not validate embedded DML against the catalog at CREATE
-- FUNCTION time, only at execution time, so this function has compiled
-- successfully but would raise "column current_driver_id does not
-- exist" on its very first real invocation, the moment it reaches the
-- UPDATE statement. server.js's caller (dispatchRide()) wraps this RPC
-- call in try/catch and silently falls back to the non-atomic two-step
-- path on ANY error, logging only a console.warn -- meaning every
-- dispatch has almost certainly been running through the fallback path
-- this entire time, invisibly, regardless of the "preferred atomic
-- path" comments in server.js. This is consistent with rides/
-- driver_offers both being empty in production today (no ride has
-- completed a real end-to-end dispatch in this environment yet to have
-- ever surfaced the failure). The replacement function below fixes this
-- (drops the current_driver_id write -- current_offer_id already exists
-- and, joined with driver_offers.driver_id, serves the same "who has
-- the live offer" purpose) in addition to the approved hardening.
--
-- nearest_drivers(p_lat double precision, p_lng double precision, p_radius_miles double precision default 25, p_limit integer default 10)
--   returns table(id text, first_name text, last_name text, email text, phone text,
--                 current_lat double precision, current_lng double precision, distance_miles double precision)
--   language sql stable
-- as $function$
--   select d.id, d.first_name, d.last_name, d.email, d.phone, d.current_lat, d.current_lng,
--          (ST_Distance(d.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 1609.34)::double precision as distance_miles
--   from public.drivers d
--   where d.online = true and d.status = 'active' and d.approval_status = 'approved'
--     and d.geog is not null
--     and ST_DWithin(d.geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_miles * 1609.34)
--   order by d.geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
--   limit p_limit;
-- $function$;
--
-- Both confirmed SECURITY INVOKER (prosecdef = false, the safe default --
-- unchanged below), with no search_path pinned (proconfig = null --
-- the already-known, separately-flagged advisor WARN
-- function_search_path_mutable, fixed below), and both had EXECUTE
-- granted to PUBLIC/anon/authenticated/service_role -- meaning, before
-- this migration, any caller holding just the app's public API key
-- could invoke either function directly over PostgREST
-- (/rest/v1/rpc/dispatch_ride_atomic), completely bypassing server.js's
-- own dispatch authorization. Only the backend's service-role client
-- ever legitimately calls these (server.js's supabase.rpc(...)), so
-- EXECUTE is narrowed to service_role only below.
--
-- ============================================================
-- REPLACEMENT: dispatch_ride_atomic, with the column-name bug fixed,
-- the approved busy-driver exclusion made a real concurrency guarantee
-- (not just a matching-time filter -- see the in-lock re-check below),
-- and search_path pinned.
-- ============================================================

create or replace function public.dispatch_ride_atomic(
  p_ride_id text,
  p_driver_id text,
  p_expires_seconds integer default 30
)
returns table (offer_id text, outcome text)
language plpgsql
set search_path = public, pg_catalog
as $function$
declare
  v_ride     public.rides%rowtype;
  v_offer_id text;
  v_attempt  integer;
  v_lock_key bigint;
begin
  -- Driver-scoped advisory lock, held for the rest of this transaction.
  -- Acquiring this lock alone is NOT the concurrency guarantee -- it
  -- only serializes two concurrent calls that happen to target the same
  -- driver (from different rides, so their `for update` row locks below
  -- don't conflict with each other and wouldn't otherwise block one
  -- another at all). What actually prevents a second transaction from
  -- assigning this driver to a different ride after the first commits
  -- is the eligibility re-check performed AFTER this lock is held,
  -- below -- the lock just ensures that re-check can't be evaluated by
  -- two transactions concurrently against stale information.
  --
  -- hashtext() maps the driver id to a single 32-bit signed integer
  -- lock key; a collision between two different driver ids is possible
  -- (documented here rather than switched to a two-key advisory lock
  -- for this phase, since the consequence of a collision is bounded and
  -- non-corrupting: the two unrelated drivers' dispatch attempts
  -- serialize against each other unnecessarily -- extra latency, never
  -- an authorization or data-integrity failure, since the re-check
  -- below is what actually enforces correctness regardless of which
  -- lock key got a transaction here).
  v_lock_key := hashtext('dispatch_driver:' || p_driver_id);
  perform pg_advisory_xact_lock(v_lock_key);

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'Ride % not found', p_ride_id;
  end if;

  if v_ride.current_offer_id is not null
     and v_ride.dispatch_status = 'offer_sent' then
    raise exception 'Ride % already has a live offer', p_ride_id;
  end if;

  -- Post-lock, in-transaction eligibility re-check. A driver is not
  -- eligible if any of the following is true at this exact moment:
  --   1. already assigned to another active ride
  --   2. already holds another live (pending, unexpired) offer
  --   3. no longer online/active/approved
  -- This does NOT include a location/heartbeat-recency check -- that
  -- eligibility rule was not part of this phase's approved scope
  -- (dispatch has never filtered on driver location staleness; it's
  -- display-only today) and is not added here.
  --
  -- On ineligibility, this returns a normal (non-exception) row with
  -- outcome = 'driver_no_longer_available' and creates no offer and
  -- changes no ride column -- distinct on purpose from the two
  -- exception cases above, which indicate a caller-level problem
  -- (unknown ride, or a ride that already has a live offer) rather
  -- than an ordinary, expected "try the next candidate driver" outcome
  -- of normal concurrent dispatch load. server.js's caller must branch
  -- on this outcome and pick the next candidate driver -- it must NOT
  -- fall back to the non-atomic two-step path for this specific
  -- outcome, since that path has no equivalent eligibility re-check and
  -- would simply re-offer to the same driver this function just
  -- rejected.
  if exists (
    select 1
    from public.rides r
    where r.driver_id = p_driver_id
      and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
  ) then
    return query select null::text, 'driver_no_longer_available'::text;
    return;
  end if;

  if exists (
    select 1
    from public.driver_offers o
    where o.driver_id = p_driver_id
      and o.status = 'pending'
      and o.expires_at > now()
  ) then
    return query select null::text, 'driver_no_longer_available'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.drivers d
    where d.id = p_driver_id
      and d.online = true
      and d.status = 'active'
      and d.approval_status = 'approved'
  ) then
    return query select null::text, 'driver_no_longer_available'::text;
    return;
  end if;

  v_attempt := coalesce(v_ride.dispatch_attempts, 0) + 1;
  v_offer_id := 'OFFER-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));

  insert into public.driver_offers (
    id, ride_id, driver_id, status, attempt,
    expires_at, created_at, updated_at
  ) values (
    v_offer_id,
    p_ride_id,
    p_driver_id,
    'pending',
    v_attempt,
    now() + make_interval(secs => p_expires_seconds),
    now(),
    now()
  );

  update public.rides
    set status            = 'awaiting_driver_acceptance',
        dispatch_status   = 'offer_sent',
        current_offer_id  = v_offer_id,
        dispatch_attempts = v_attempt,
        updated_at        = now()
    where id = p_ride_id;

  return query select v_offer_id, 'created'::text;
end;
$function$;

-- ============================================================
-- REPLACEMENT: nearest_drivers, with the same busy-driver exclusion as
-- a matching-time filter (not a concurrency guarantee -- that lives in
-- dispatch_ride_atomic above, which is what actually creates an offer),
-- and search_path pinned.
-- ============================================================

create or replace function public.nearest_drivers(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision default 25,
  p_limit integer default 10
)
returns table (
  id text,
  first_name text,
  last_name text,
  email text,
  phone text,
  current_lat double precision,
  current_lng double precision,
  distance_miles double precision
)
language sql
stable
set search_path = public, pg_catalog
as $function$
  select
    d.id,
    d.first_name,
    d.last_name,
    d.email,
    d.phone,
    d.current_lat,
    d.current_lng,
    (ST_Distance(
       d.geog,
       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
     ) / 1609.34)::double precision as distance_miles
  from public.drivers d
  where d.online = true
    and d.status = 'active'
    and d.approval_status = 'approved'
    and d.geog is not null
    and ST_DWithin(
      d.geog,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_miles * 1609.34
    )
    and not exists (
      select 1
      from public.rides r
      where r.driver_id = d.id
        and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
    )
  order by d.geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  limit p_limit;
$function$;

-- ============================================================
-- Grant hardening: only the backend's service-role client may call
-- either function. Functions otherwise inherit PUBLIC execute by
-- default; both had it before this migration (see the historical
-- record above), which is closed here.
-- ============================================================

revoke execute on function public.dispatch_ride_atomic(text, text, integer)
  from public, anon, authenticated;

grant execute on function public.dispatch_ride_atomic(text, text, integer)
  to service_role;

revoke execute on function public.nearest_drivers(double precision, double precision, double precision, integer)
  from public, anon, authenticated;

grant execute on function public.nearest_drivers(double precision, double precision, double precision, integer)
  to service_role;
