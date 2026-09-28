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
-- ever surfaced the failure). The replacement function below fixes this.
--
-- CORRECTION (2026-09-28): an earlier revision of this migration kept a
-- write to public.rides.current_offer_id on the stated assumption that
-- the column "already exists". It does not: information_schema.columns
-- on the live project has neither current_driver_id nor current_offer_id
-- on public.rides. This migration adds neither column. The authoritative
-- record of which driver holds a live offer for a ride is
-- public.driver_offers (ride_id, driver_id, status, expires_at), and the
-- canonical assigned-driver column is public.rides.driver_id (text,
-- matching public.drivers.id "DRV-xxxx"). public.rides.assigned_driver_id
-- (uuid) is unused schema debt -- it cannot hold a DRV-xxxx id -- and is
-- deliberately neither read, written, repurposed nor dropped here.
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
-- REPLACEMENT: dispatch_ride_atomic
--
--   * no reference to the nonexistent rides.current_driver_id /
--     rides.current_offer_id -- the "ride already has a live offer" guard
--     reads public.driver_offers instead;
--   * returns (offer_id, outcome). Every expected, non-exceptional result
--     is an outcome row rather than a raised exception, so the caller can
--     tell "try the next candidate" (driver_no_longer_available) from
--     "stop, this ride can't be dispatched right now" (ride_not_found,
--     ride_not_dispatchable, ride_has_live_offer) from a genuine error --
--     a raised exception previously sent the Node caller into its
--     non-atomic two-step fallback, which could create a second live
--     offer for a ride that already had one;
--   * lock order is ride row first, then the driver-scoped advisory lock
--     -- the same order accept_driver_offer_atomic() uses, so the two
--     functions can never deadlock against each other;
--   * every object reference is schema-qualified and search_path is
--     pinned to (public, pg_catalog) -- public is where PostGIS lives in
--     this project;
--   * SECURITY INVOKER (the default; unchanged). The only legitimate
--     caller is the backend's service_role client.
--
-- Backward compatibility with the currently deployed server: the
-- argument list is unchanged and the result still carries offer_id, so
-- the deployed caller's `result.offer_id` read keeps working. The deployed
-- caller treats a null offer_id as "RPC unavailable" and uses its Node
-- fallback -- exactly what it does today, since the live function raises
-- on every call.
--
-- The result type changes (a new `outcome` column), which CREATE OR
-- REPLACE cannot do, so the function is dropped and recreated inside this
-- migration's transaction; the grants are re-applied explicitly below.
-- ============================================================

drop function if exists public.dispatch_ride_atomic(text, text, integer);

create function public.dispatch_ride_atomic(
  p_ride_id text,
  p_driver_id text,
  p_expires_seconds integer default 30
)
returns table (offer_id text, outcome text)
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $function$
#variable_conflict use_column
declare
  v_ride     public.rides%rowtype;
  v_offer_id text;
  v_attempt  integer;
begin
  if p_ride_id is null or p_driver_id is null then
    raise exception 'dispatch_ride_atomic: p_ride_id and p_driver_id are required'
      using errcode = '22023';
  end if;

  -- 1. Ride row lock. Serializes every dispatch and accept for this ride.
  select r.* into v_ride
  from public.rides r
  where r.id = p_ride_id
  for update;

  if not found then
    return query select null::text, 'ride_not_found'::text;
    return;
  end if;

  -- Only an unassigned ride that is ready for (re)dispatch may be offered.
  if v_ride.driver_id is not null
     or v_ride.status not in ('payment_authorized', 'awaiting_driver_acceptance') then
    return query select null::text, 'ride_not_dispatchable'::text;
    return;
  end if;

  if exists (
    select 1
    from public.driver_offers o
    where o.ride_id = p_ride_id
      and o.status = 'pending'
      and o.expires_at > pg_catalog.now()
  ) then
    return query select null::text, 'ride_has_live_offer'::text;
    return;
  end if;

  -- 2. Driver-scoped advisory lock, held to end of transaction. Same key
  -- as accept_driver_offer_atomic(), so an offer to this driver and an
  -- accept by this driver can never evaluate the eligibility re-check
  -- below concurrently. The lock alone is not the guarantee; the re-check
  -- performed while holding it is.
  --
  -- hashtext() yields a 32-bit key, so two different driver ids can
  -- collide. The consequence is bounded: those two drivers' dispatch/
  -- accept calls serialize unnecessarily (latency), never a correctness
  -- failure, because the re-check below is what enforces eligibility.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dispatch_driver:' || p_driver_id));

  -- 3. In-lock eligibility re-check. Ineligible -> a normal outcome row,
  -- no offer created, no ride column changed.
  if exists (
    select 1
    from public.rides r
    where r.driver_id = p_driver_id
      and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
  ) or exists (
    select 1
    from public.driver_offers o
    where o.driver_id = p_driver_id
      and o.status = 'pending'
      and o.expires_at > pg_catalog.now()
  ) or exists (
    -- An accepted offer on a ride that is neither finished nor assigned
    -- to someone else: the driver either holds that ride or has an
    -- accepted offer that was never matched by an assignment (needs
    -- reconciliation). Either way, not free for a new offer.
    select 1
    from public.driver_offers o
    join public.rides r on r.id = o.ride_id
    where o.driver_id = p_driver_id
      and o.status = 'accepted'
      and r.status not in ('completed', 'cancelled', 'failed')
      and (r.driver_id is null or r.driver_id = p_driver_id)
  ) or not exists (
    select 1
    from public.drivers d
    where d.id = p_driver_id
      and d.online = true
      and d.status = 'active'
      and d.approval_status = 'approved'
      and coalesce(d.access_revoked, false) = false
  ) then
    return query select null::text, 'driver_no_longer_available'::text;
    return;
  end if;

  -- dispatch_attempts is maintained by the callers: the decline and
  -- offer-expiry redispatch paths increment it before calling, and a
  -- first dispatch arrives with 0/null. Record at least 1; never add a
  -- second increment here (that would halve MAX_DISPATCH_ATTEMPTS).
  v_attempt := greatest(coalesce(v_ride.dispatch_attempts, 0), 1);
  v_offer_id := 'OFFER-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 10));

  insert into public.driver_offers (
    id, ride_id, driver_id, status, attempt,
    expires_at, created_at, updated_at
  ) values (
    v_offer_id,
    p_ride_id,
    p_driver_id,
    'pending',
    v_attempt,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_expires_seconds),
    pg_catalog.now(),
    pg_catalog.now()
  );

  -- rides.driver_id is deliberately NOT written: an offered driver is not
  -- an assigned driver. It is set only by accept_driver_offer_atomic() (or
  -- an admin assignment).
  update public.rides
    set status            = 'awaiting_driver_acceptance',
        dispatch_status   = 'offer_sent',
        dispatch_attempts = v_attempt,
        updated_at        = pg_catalog.now()
    where id = p_ride_id;

  return query select v_offer_id, 'created'::text;
end;
$function$;

comment on function public.dispatch_ride_atomic(text, text, integer) is
  'Creates a pending driver_offers row for an unassigned ride and marks the ride offer_sent, under the ride row lock and the driver-scoped advisory lock. Returns (offer_id, outcome); outcome is one of created, ride_not_found, ride_not_dispatchable, ride_has_live_offer, driver_no_longer_available. service_role only.';

-- ============================================================
-- REPLACEMENT: nearest_drivers, with the same busy-driver exclusion as
-- a matching-time filter (not a concurrency guarantee -- that lives in
-- dispatch_ride_atomic above, which is what actually creates an offer),
-- revoked-access exclusion, schema-qualified references, and
-- search_path pinned. Signature and result type are unchanged, so CREATE
-- OR REPLACE applies and the deployed caller is unaffected.
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
security invoker
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
    (public.st_distance(
       d.geog,
       public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography
     ) / 1609.34)::double precision as distance_miles
  from public.drivers d
  where d.online = true
    and d.status = 'active'
    and d.approval_status = 'approved'
    and coalesce(d.access_revoked, false) = false
    and d.geog is not null
    and public.st_dwithin(
      d.geog,
      public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography,
      p_radius_miles * 1609.34
    )
    and not exists (
      select 1
      from public.rides r
      where r.driver_id = d.id
        and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
    )
  order by d.geog operator(public.<->) public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography
  limit p_limit;
$function$;

-- ============================================================
-- Grant hardening: only the backend's service_role client may call
-- either function. Functions otherwise inherit PUBLIC execute by default,
-- and Supabase's default privileges also grant anon/authenticated
-- explicitly, so all three are revoked.
-- ============================================================

revoke all on function public.dispatch_ride_atomic(text, text, integer)
  from public, anon, authenticated;

grant execute on function public.dispatch_ride_atomic(text, text, integer)
  to service_role;

revoke all on function public.nearest_drivers(double precision, double precision, double precision, integer)
  from public, anon, authenticated;

grant execute on function public.nearest_drivers(double precision, double precision, double precision, integer)
  to service_role;
