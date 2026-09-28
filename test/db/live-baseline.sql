-- Test-only baseline mirroring the live production objects the dispatch
-- migrations touch, so the migrations can be applied and exercised
-- against a real Postgres (see test/db/pgHarness.js). Generated from
-- pg_attribute/pg_proc on the live project, 2026-09-28. NOT a migration;
-- never applied to any Supabase environment.
--
-- Mirrors: public.drivers / public.rides / public.driver_offers /
-- public.driver_earnings column lists and types, their live constraints
-- and secondary indexes (foreign keys to tables not mirrored here --
-- payments, riders, autonomous_pilot_zones -- are omitted; no PR #130
-- migration touches them), Supabase's anon/authenticated/service_role roles and its
-- default function privileges, and the two dispatch functions exactly as
-- deployed (including the live dispatch_ride_atomic's reference to the
-- nonexistent rides.current_driver_id), with their live grants.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create extension if not exists postgis with schema public;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.drivers (
  id text,
  full_name text,
  email text,
  phone text,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text,
  verified boolean default false,
  approved boolean default false,
  persona_status text default 'pending'::text,
  checkr_status text default 'pending'::text,
  online boolean default false,
  available boolean default false,
  driver_status text default 'offline'::text,
  current_address text,
  last_known_address text,
  home_address text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  email_verified boolean default false,
  sms_verified boolean default false,
  email_verification_token text,
  email_verified_at timestamp with time zone,
  email_verification_sent_at timestamp with time zone,
  email_verification_expires_at timestamp with time zone,
  sms_verification_code text,
  sms_verified_at timestamp with time zone,
  sms_verification_sent_at timestamp with time zone,
  sms_verification_expires_at timestamp with time zone,
  sms_verification_attempts integer default 0,
  first_name text,
  last_name text,
  city text,
  state text,
  password text,
  vehicle_year text,
  license_plate text,
  license_number text,
  verification_status text default 'pending'::text,
  background_check_status text default 'pending'::text,
  status text default 'offline'::text,
  driver_type text default 'human'::text,
  terms_accepted boolean default false,
  background_check_accepted boolean default false,
  insurance_confirmed boolean default false,
  latitude double precision,
  longitude double precision,
  approval_status text default 'pending'::text,
  fully_verified boolean default false,
  approved_at timestamp without time zone,
  rejected_reason text,
  availability_status text default 'offline'::text,
  is_available boolean default false,
  drivers_license_number text,
  accepted_terms boolean default false,
  accepted_background_check_consent boolean default false,
  accepted_driver_policy boolean default false,
  password_hash text,
  role text default 'driver'::text,
  is_approved boolean default false,
  identity_status text default 'not_started'::text,
  persona_inquiry_id text,
  email_verification_token_hash text,
  sms_verification_code_hash text,
  is_online boolean default false,
  rating numeric default 5,
  acceptance_rate numeric default 1,
  distance_miles numeric default 9999,
  is_priority boolean default false,
  current_ride_id text,
  current_mission_id text,
  is_blocked boolean default false,
  is_disabled boolean default false,
  last_seen_at timestamp with time zone,
  name text,
  phone_number text,
  mobile text,
  access_status text default 'pending'::text,
  online_status text default 'offline'::text,
  rejected_at timestamp with time zone,
  rejection_reason text,
  approval_note text,
  phone_verified boolean default false,
  sms_code text,
  sms_code_expires_at timestamp without time zone,
  phone_verification_code_hash text,
  phone_verification_expires_at timestamp with time zone,
  identity_verified boolean default false,
  persona_template_id text,
  persona_last_event text,
  persona_last_payload jsonb,
  checkr_candidate_id text,
  checkr_invitation_id text,
  checkr_invitation_url text,
  checkr_report_id text,
  checkr_last_event text,
  checkr_last_payload jsonb,
  review_reason text,
  current_lat numeric,
  current_lng numeric,
  last_location_at timestamp with time zone,
  last_available_at timestamp with time zone,
  last_unavailable_at timestamp with time zone,
  consents jsonb,
  zipcode text,
  stripe_account_id text,
  preferred_score numeric default 0,
  supports_rides boolean default true,
  supports_food_delivery boolean default true,
  supports_grocery_delivery boolean default true,
  current_delivery_order_id uuid,
  phone_verified_at timestamp with time zone,
  deletion_requested boolean default false,
  deletion_requested_at timestamp with time zone,
  deletion_reason text,
  persona_verified boolean default false,
  total_trips integer default 0,
  heading double precision,
  speed double precision,
  insurance_status text,
  license_status text,
  geog geography(Point,4326),
  photo_url text,
  location_accuracy_meters numeric,
  access_revoked boolean default false,
  deleted_at timestamp with time zone,
  deleted_reason text,
  deleted_by text,
  is_review_account boolean default false,
  review_password_hash text,
  review_password_salt text,
  primary key (id)
);

create table public.rides (
  id text,
  rider_id text,
  rider_name text,
  rider_phone text,
  driver_id text,
  driver_name text,
  driver_phone text,
  driver_vehicle text,
  pickup_address text,
  dropoff_address text,
  pickup_lat numeric,
  pickup_lng numeric,
  dropoff_lat numeric,
  dropoff_lng numeric,
  ride_type text,
  payment_method text,
  distance_miles numeric,
  duration_minutes numeric,
  distance_text text,
  duration_text text,
  estimated_fare numeric,
  estimated_driver_payout numeric,
  estimated_platform_fee numeric,
  surge_multiplier numeric,
  fare_config jsonb,
  final_tip numeric,
  final_fare numeric,
  final_driver_payout numeric,
  final_platform_fee numeric,
  status text,
  driver_eta_to_pickup_minutes numeric,
  driver_eta_to_pickup_text text,
  driver_distance_to_pickup_miles numeric,
  driver_distance_to_pickup_text text,
  requested_at timestamp with time zone,
  search_started_at timestamp with time zone,
  search_restarted_at timestamp with time zone,
  mission_sent_at timestamp with time zone,
  driver_accepted_at timestamp with time zone,
  driver_arrived_at timestamp with time zone,
  trip_started_at timestamp with time zone,
  trip_in_progress_at timestamp with time zone,
  trip_completed_at timestamp with time zone,
  payment_processed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  requested_mode text default 'driver'::text,
  autonomous_vehicle_name text,
  accepted_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancel_reason text,
  notes text,
  scheduled_time text,
  ride_status text,
  dispatch_status text,
  current_dispatch_id text,
  dispatch_lock_until timestamp with time zone,
  last_dispatch_at timestamp with time zone,
  assigned_at timestamp with time zone,
  arrived_at timestamp with time zone,
  tip_amount numeric default 0,
  payment_id text,
  assigned_driver_id uuid,
  cancelled_by text,
  public_code text,
  estimated_distance_miles numeric(10,2),
  estimated_duration_minutes numeric(10,2),
  pricing_snapshot jsonb default '{}'::jsonb,
  payment_status text,
  en_route_at timestamp with time zone,
  cancelled_by_type text,
  cancelled_by_id text,
  driver_payout numeric(10,2),
  platform_revenue numeric(10,2),
  mission_id text,
  dispatch_id text,
  service_type text default 'ride'::text,
  miles_estimate numeric,
  minutes_estimate numeric,
  fare_total numeric,
  fare_snapshot jsonb,
  route_snapshot jsonb,
  current_mission_id uuid,
  dispatch_attempts integer default 0,
  canceled_at timestamp with time zone,
  canceled_by text,
  enroute_at timestamp with time zone,
  payment_captured boolean default false,
  admin_note text,
  assigned_by_admin text,
  htaf_application_id text,
  delivery_stage text,
  delivery_pin text,
  merchant_name text,
  item_count integer,
  pickup_instructions text,
  delivery_instructions text,
  delivered_at timestamp with time zone,
  delivery_handoff text,
  delivery_proof_url text,
  dispatch_claimed_at timestamp with time zone,
  autonomous_pilot boolean default false,
  pilot_status text,
  pilot_zone_id text,
  pilot_provider text,
  pilot_vehicle_id text,
  remote_supervision_status text,
  human_fallback_allowed boolean default false,
  human_fallback_reason text,
  pilot_consent_at timestamp with time zone,
  pilot_disclosure_version text,
  boarding_confirmed_at timestamp with time zone,
  is_review_ride boolean default false,
  primary key (id)
);

create table public.driver_offers (
  id text,
  ride_id text,
  driver_id text,
  status text default 'pending'::text,
  attempt integer default 1,
  decline_reason text,
  responded_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  primary key (id)
);

-- public.driver_earnings, as live (columns, defaults, primary key, the
-- status CHECK and the foreign keys to rides/drivers). Its live foreign
-- keys to public.payments and public.riders are omitted because those
-- tables are not mirrored here; no PR #130 migration touches them.
create table public.driver_earnings (
  id text not null,
  ride_id text,
  driver_id text,
  rider_id text,
  gross_fare numeric,
  driver_base_earning numeric,
  tip_amount numeric,
  total_earning numeric,
  earning_status text,
  payout_id text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  payout_amount numeric(10,2) default 0,
  currency text default 'usd'::text,
  status text default 'earned'::text,
  payment_id text,
  primary key (id),
  constraint driver_earnings_status_check
    check ((status = any (array['earned'::text, 'pending'::text, 'paid'::text, 'cancelled'::text]))),
  constraint driver_earnings_ride_id_fkey
    foreign key (ride_id) references public.rides(id) on delete set null,
  constraint driver_earnings_driver_id_fkey
    foreign key (driver_id) references public.drivers(id) on delete cascade
);

-- Live secondary indexes on rides and driver_earnings (pg_indexes).
create index rides_status_idx on public.rides using btree (status);
create index rides_rider_id_idx on public.rides using btree (rider_id);
create index rides_driver_id_idx on public.rides using btree (driver_id);
create index idx_rides_status on public.rides using btree (ride_status);
create index idx_rides_driver on public.rides using btree (driver_id);
create index rides_payment_id_idx on public.rides using btree (payment_id);
create index idx_rides_dispatch_status on public.rides using btree (dispatch_status);
create index idx_rides_assigned_driver_id on public.rides using btree (assigned_driver_id);
create index idx_rides_requested_mode on public.rides using btree (requested_mode);
create index idx_rides_created_at on public.rides using btree (created_at desc);
create index idx_rides_rider_id on public.rides using btree (rider_id);
create index idx_rides_driver_id on public.rides using btree (driver_id);
create unique index rides_htaf_application_id_unique on public.rides using btree (htaf_application_id) where (htaf_application_id is not null);
create index rides_is_review_ride_idx on public.rides using btree (is_review_ride) where (is_review_ride = true);
create index idx_driver_earnings_driver_id on public.driver_earnings using btree (driver_id);
create index idx_driver_earnings_ride_id on public.driver_earnings using btree (ride_id);
create index idx_driver_earnings_rider_id on public.driver_earnings using btree (rider_id);
create index idx_driver_earnings_payment_id on public.driver_earnings using btree (payment_id);
create index idx_driver_earnings_status on public.driver_earnings using btree (status);
create index idx_driver_earnings_created_at on public.driver_earnings using btree (created_at desc);

-- Live definitions, verbatim from pg_get_functiondef().
CREATE OR REPLACE FUNCTION public.dispatch_ride_atomic(p_ride_id text, p_driver_id text, p_expires_seconds integer DEFAULT 30)
 RETURNS TABLE(offer_id text)
 LANGUAGE plpgsql
AS $function$
declare
  v_ride        public.rides%rowtype;
  v_offer_id    text;
  v_attempt     integer;
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'Ride % not found', p_ride_id;
  end if;

  if v_ride.current_driver_id is not null
     and v_ride.dispatch_status = 'offer_sent' then
    raise exception 'Ride % already has a live offer', p_ride_id;
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
        current_driver_id = p_driver_id,
        dispatch_attempts = v_attempt,
        updated_at        = now()
    where id = p_ride_id;

  offer_id := v_offer_id;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.nearest_drivers(p_lat double precision, p_lng double precision, p_radius_miles double precision DEFAULT 25, p_limit integer DEFAULT 10)
 RETURNS TABLE(id text, first_name text, last_name text, email text, phone text, current_lat double precision, current_lng double precision, distance_miles double precision)
 LANGUAGE sql
 STABLE
AS $function$
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
  order by d.geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  limit p_limit;
$function$;

-- Live grants on both functions: PUBLIC plus anon/authenticated/service_role.
grant execute on function public.dispatch_ride_atomic(text, text, integer) to public, anon, authenticated, service_role;
grant execute on function public.nearest_drivers(double precision, double precision, double precision, integer) to public, anon, authenticated, service_role;
