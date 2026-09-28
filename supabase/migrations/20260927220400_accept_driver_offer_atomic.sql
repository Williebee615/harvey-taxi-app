-- accept_driver_offer_atomic: the durable, single-transaction replacement
-- for the driver offer-accept flow (POST /api/driver/offers/:offerId/accept).
--
-- The Node flow it replaces made two separate writes -- flip the offer to
-- "accepted", then assign the ride -- so any failure between them could
-- leave an accepted offer with no ride assignment (PR #131 papers over
-- that with a checked compensating revert; this removes the gap). Here
-- every state change commits together or not at all:
--
--   * the winning offer -> accepted
--   * every other pending offer for the same ride -> superseded
--   * rides.driver_id (the canonical assigned-driver column), status,
--     dispatch_status, accepted_at and the driver display fields
--
-- Invariant: no accepted offer exists without the corresponding committed
-- ride assignment.
--
-- Schema contract (verified against the live project, 2026-09-28):
--   * public.rides.driver_id text -- canonical assigned driver, matches
--     public.drivers.id ("DRV-xxxx", text).
--   * public.driver_offers -- authoritative offer relationship. There is no
--     rides.current_offer_id / rides.current_driver_id and none is added.
--   * public.rides.assigned_driver_id uuid -- unused schema debt; cannot
--     hold a DRV-xxxx id. Not read, written, repurposed or dropped.
--
-- Lock order (identical in dispatch_ride_atomic, so the two can never
-- deadlock against each other):
--   1. ride row            (SELECT ... FOR UPDATE)
--   2. offer rows for that ride, the accepted offer included
--                          (SELECT ... FOR UPDATE, ordered by id)
--   3. driver advisory lock (pg_advisory_xact_lock on the driver id)
-- The ride is locked before the offer, not after: the competing-offer
-- cleanup below writes other offers of the same ride, so an
-- offer-then-ride order would deadlock two drivers accepting competing
-- offers for one ride (each holding its own offer, waiting on the ride,
-- then on the other's offer). The offer's ride_id is read unlocked only to
-- find which ride to lock; the offer is then locked and fully re-validated
-- before anything is decided.
--
-- Outcomes (one row, never an exception for an expected result):
--   accepted          -- this call assigned the ride; notify exactly once
--   already_accepted  -- idempotent retry by the winning driver; no writes,
--                        caller must not notify again
--   offer_not_found   -- no such offer
--   not_offer_owner   -- offer belongs to a different driver (checked
--                        before status, so nothing else is disclosed)
--   offer_expired     -- still pending but past expires_at (left pending
--                        for the offer-expiry sweep to claim and redispatch)
--   offer_not_pending -- declined, expired, superseded, cancelled, or
--                        accepted by this driver for a ride no longer theirs
--   ride_not_assignable -- ride missing, already assigned, or in a status
--                        that can't be assigned
--   driver_unavailable -- the driver holds another active ride or a
--                        conflicting accepted offer, or is no longer
--                        approved / has had access revoked
-- Result columns are an explicit allow-list, never the whole rides row
-- (which carries payment identifiers, pricing/route snapshots, locations,
-- reconciliation and audit fields):
--   * losing outcomes: only `outcome`; every other column is null.
--   * already_accepted: outcome, ride_id, offer_id, driver_id, ride_status
--     -- enough for the winning driver's idempotent success response.
--   * accepted: the above plus exactly what server.js needs to notify the
--     rider once (rider_id, rider_phone, ride_type, is_review_ride) and to
--     describe the driver (driver_name, driver_vehicle, driver_phone).
--     These stay server-side; the HTTP response is built from its own
--     allow-list (ride_id, driver_id, status).
--
-- Security: SECURITY INVOKER (no SECURITY DEFINER: the only caller is the
-- backend's service_role client, which already has the table privileges it
-- needs). search_path is pinned to (pg_catalog, public) so nothing created
-- in public can shadow a built-in function or operator, and every
-- application object is schema-qualified. EXECUTE granted to service_role
-- only, revoked from PUBLIC, anon and authenticated.
--
-- Backward compatibility: this adds a new function and changes nothing the
-- currently deployed server calls.

create or replace function public.accept_driver_offer_atomic(
  p_offer_id text,
  p_driver_id text
)
returns table (
  outcome        text,
  ride_id        text,
  offer_id       text,
  driver_id      text,
  ride_status    text,
  rider_id       text,
  rider_phone    text,
  ride_type      text,
  is_review_ride boolean,
  driver_name    text,
  driver_vehicle text,
  driver_phone   text
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $function$
#variable_conflict use_column
declare
  v_offer_ride_id text;
  v_offer         public.driver_offers%rowtype;
  v_ride          public.rides%rowtype;
  v_driver        public.drivers%rowtype;
  v_now           timestamptz := pg_catalog.now();
begin
  -- Every result column is an OUT parameter that starts null. A losing
  -- outcome sets `outcome` alone and returns, so it can't disclose anything.

  if p_offer_id is null or p_driver_id is null then
    raise exception 'accept_driver_offer_atomic: p_offer_id and p_driver_id are required'
      using errcode = '22023';
  end if;

  -- Unlocked read: only to learn which ride to lock first.
  select o.ride_id into v_offer_ride_id
  from public.driver_offers o
  where o.id = p_offer_id;

  if not found then
    outcome := 'offer_not_found';
    return next;
    return;
  end if;

  -- 1. Ride row lock. Every accept and dispatch for this ride serializes
  -- here, so exactly one competing accept can win.
  select r.* into v_ride
  from public.rides r
  where r.id = v_offer_ride_id
  for update;

  -- 2. Offer row locks: this ride's offers in a fixed order (the accepted
  -- offer and every competitor the cleanup below may write), then re-read
  -- the offer under its lock.
  perform 1
  from public.driver_offers o
  where o.ride_id = v_offer_ride_id
  order by o.id
  for update;

  select o.* into v_offer
  from public.driver_offers o
  where o.id = p_offer_id;

  if not found then
    outcome := 'offer_not_found';
    return next;
    return;
  end if;

  if v_offer.driver_id is distinct from p_driver_id then
    outcome := 'not_offer_owner';
    return next;
    return;
  end if;

  if v_offer.status = 'accepted' then
    -- Idempotent retry by the winning driver: the assignment this offer
    -- produced is still in place. Nothing is written, and nothing beyond
    -- what the success response needs is returned.
    if v_ride.id is not null
       and v_ride.driver_id = p_driver_id
       and v_ride.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress') then
      outcome     := 'already_accepted';
      ride_id     := v_ride.id;
      offer_id    := v_offer.id;
      driver_id   := p_driver_id;
      ride_status := v_ride.status;
      return next;
      return;
    end if;

    outcome := 'offer_not_pending';
    return next;
    return;
  end if;

  if v_offer.status <> 'pending' then
    outcome := 'offer_not_pending';
    return next;
    return;
  end if;

  if v_offer.expires_at is not null and v_offer.expires_at <= v_now then
    outcome := 'offer_expired';
    return next;
    return;
  end if;

  if v_ride.id is null
     or v_ride.driver_id is not null
     or v_ride.status not in ('payment_authorized', 'awaiting_driver_acceptance') then
    outcome := 'ride_not_assignable';
    return next;
    return;
  end if;

  -- 3. Driver-scoped advisory lock (same key as dispatch_ride_atomic).
  -- Serializes this driver's concurrent accepts across different rides,
  -- and against a concurrent offer to this driver, so the re-check below
  -- always sees any assignment committed by another transaction first.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dispatch_driver:' || p_driver_id));

  -- In-lock eligibility re-check.
  select d.* into v_driver
  from public.drivers d
  where d.id = p_driver_id;

  if not found
     or v_driver.approval_status is distinct from 'approved'
     or coalesce(v_driver.access_revoked, false) then
    outcome := 'driver_unavailable';
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.rides r
    where r.driver_id = p_driver_id
      and r.id <> v_ride.id
      and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
  ) or exists (
    -- An accepted offer on another ride that is neither finished nor
    -- assigned to someone else: the driver holds that ride, or holds an
    -- accepted offer never matched by an assignment (needs reconciliation).
    select 1
    from public.driver_offers o
    join public.rides r on r.id = o.ride_id
    where o.driver_id = p_driver_id
      and o.status = 'accepted'
      and o.ride_id <> v_ride.id
      and r.status not in ('completed', 'cancelled', 'failed')
      and (r.driver_id is null or r.driver_id = p_driver_id)
  ) then
    outcome := 'driver_unavailable';
    return next;
    return;
  end if;

  -- All checks passed under all three locks. Every write below commits
  -- together with the others or not at all.
  update public.driver_offers o
    set status       = 'accepted',
        responded_at = v_now,
        updated_at   = v_now
    where o.id = v_offer.id;

  update public.driver_offers o
    set status     = 'superseded',
        updated_at = v_now
    where o.ride_id = v_ride.id
      and o.id <> v_offer.id
      and o.status = 'pending';

  update public.rides r
    set driver_id       = p_driver_id,
        status          = 'driver_assigned',
        dispatch_status = 'accepted',
        accepted_at     = v_now,
        -- Same derivation as buildDriverRideFields() in server.js.
        driver_name     = coalesce(
                            nullif(pg_catalog.concat_ws(' ', nullif(v_driver.first_name, ''), nullif(v_driver.last_name, '')), ''),
                            nullif(v_driver.name, ''),
                            nullif(v_driver.full_name, ''),
                            'Driver'
                          ),
        driver_vehicle  = pg_catalog.concat_ws(' ', nullif(v_driver.vehicle_year, ''), nullif(v_driver.vehicle_make, ''), nullif(v_driver.vehicle_model, '')),
        driver_phone    = coalesce(nullif(v_driver.phone, ''), nullif(v_driver.phone_number, '')),
        updated_at      = v_now
    where r.id = v_ride.id
    returning r.* into v_ride;

  outcome        := 'accepted';
  ride_id        := v_ride.id;
  offer_id       := v_offer.id;
  driver_id      := p_driver_id;
  ride_status    := v_ride.status;
  rider_id       := v_ride.rider_id;
  rider_phone    := v_ride.rider_phone;
  ride_type      := v_ride.ride_type;
  is_review_ride := v_ride.is_review_ride;
  driver_name    := v_ride.driver_name;
  driver_vehicle := v_ride.driver_vehicle;
  driver_phone   := v_ride.driver_phone;
  return next;
end;
$function$;

comment on function public.accept_driver_offer_atomic(text, text) is
  'Atomically accepts a pending driver offer: locks ride, offers and driver; re-checks eligibility; marks the offer accepted, supersedes competing pending offers, and assigns rides.driver_id. Returns an allow-listed result row (never the full ride). service_role only.';

REVOKE ALL ON FUNCTION public.accept_driver_offer_atomic(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_driver_offer_atomic(text, text) TO service_role;
