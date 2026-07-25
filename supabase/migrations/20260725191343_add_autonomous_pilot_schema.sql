-- Autonomous Pilot V1 — foundation schema.
--
-- rides keeps its existing `status` (RIDE_STATUS) untouched as the
-- canonical ride lifecycle used by dispatch/payment/admin code
-- everywhere else in the app. The new `pilot_status` column is a
-- separate, additive substate specific to autonomous-pilot requests
-- (eligibility/waitlist/reservation/boarding/fallback) so nothing that
-- already pattern-matches on rides.status can be affected by it.
--
-- rides.autonomous_vehicle_name (pre-existing) is left untouched and is
-- explicitly legacy/decorative — no new code reads or writes it. Real
-- vehicle/provider state lives in autonomous_provider_reservations.
--
-- Idempotent: safe to re-run against an environment where this has
-- already been applied.

alter table public.rides
  add column if not exists autonomous_pilot boolean not null default false,
  add column if not exists pilot_status text null,
  add column if not exists pilot_zone_id text null,
  add column if not exists pilot_provider text null,
  add column if not exists pilot_vehicle_id text null,
  add column if not exists remote_supervision_status text null,
  add column if not exists human_fallback_allowed boolean not null default false,
  add column if not exists human_fallback_reason text null,
  add column if not exists pilot_consent_at timestamptz null,
  add column if not exists pilot_disclosure_version text null,
  add column if not exists boarding_confirmed_at timestamptz null;

comment on column public.rides.autonomous_pilot is
  'True only for rides requested through the Autonomous Pilot flow. Every other pilot_* column is meaningless when this is false.';
comment on column public.rides.pilot_status is
  'Autonomous-pilot-specific substate (pilot_requested, eligibility_check, waitlisted, vehicle_reserved, vehicle_enroute, vehicle_arrived, boarding_confirmation, trip_in_progress, trip_completed, human_fallback_offered, cancelled). Deliberately separate from rides.status, which stays the canonical ride lifecycle every non-pilot code path already depends on.';
comment on column public.rides.pilot_zone_id is
  'References autonomous_pilot_zones.id — the zone this request was validated against.';
comment on column public.rides.pilot_provider is
  'Adapter identifier (e.g. manual_operations) that served this request. Never a real fleet provider until one is actually integrated and authorized.';
comment on column public.rides.pilot_vehicle_id is
  'Vehicle identifier as reported by the provider adapter. Under the manual_operations adapter this is an admin-entered label, not a real vehicle telemetry ID.';
comment on column public.rides.remote_supervision_status is
  'Honest, provider-reported (or manually-set) remote-supervision state. Must never be set to imply supervision that is not actually happening.';
comment on column public.rides.human_fallback_allowed is
  'Set true only when the system has explicitly transitioned this request to human-driver fallback. dispatchRide() must treat this as the single gate for whether an autonomous_pilot ride may enter the normal driver offer pool.';
comment on column public.rides.human_fallback_reason is
  'Why human fallback was offered/used (e.g. outside_zone, no_vehicle_available, rider_requested, safety_requirement_unmet).';
comment on column public.rides.pilot_consent_at is
  'Timestamp the rider accepted the pilot disclosure. Null means no valid consent has been recorded for this ride.';
comment on column public.rides.pilot_disclosure_version is
  'Version identifier of the disclosure text the rider consented to, so a later disclosure-copy change never gets attributed to a prior consent.';
comment on column public.rides.boarding_confirmed_at is
  'Timestamp the rider confirmed boarding the assigned vehicle.';

-- Configurable pilot service zones. Availability must never be
-- Nashville-wide by default — a request is only eligible if it falls
-- inside an active zone's radius (or, later, a polygon) during that
-- zone's configured service hours.
create table if not exists public.autonomous_pilot_zones (
  id text primary key,
  name text not null,
  active boolean not null default false,
  center_lat numeric not null,
  center_lng numeric not null,
  radius_miles numeric not null,
  polygon jsonb null,
  service_hours jsonb null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.autonomous_pilot_zones is
  'Configurable geographic + hours boundaries the pilot is allowed to operate in. A zone with active=false or no zone match at all means "outside pilot zone", never a silent Nashville-wide fallback.';
comment on column public.autonomous_pilot_zones.polygon is
  'Optional GeoJSON-style polygon for a non-circular zone. When null, center_lat/center_lng/radius_miles (a simple circle) is the zone boundary.';
comment on column public.autonomous_pilot_zones.service_hours is
  'jsonb schedule (e.g. {"mon": [["08:00","20:00"]], ...}) the zone is open during. Null means always-open whenever the zone itself is active.';

-- Append-only pilot lifecycle + audit trail, and the idempotency record
-- for inbound provider callbacks (a provider must never be able to
-- double-apply the same event by retrying a webhook).
create table if not exists public.autonomous_pilot_events (
  id bigint generated always as identity primary key,
  ride_id text not null references public.rides(id),
  event_type text not null,
  pilot_status text null,
  actor_type text not null,
  actor_id text null,
  provider_event_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists autonomous_pilot_events_ride_id_idx
  on public.autonomous_pilot_events (ride_id);

-- Partial unique index (rather than a plain unique column) because most
-- events are internal state transitions with no provider_event_id at
-- all — only inbound provider callbacks need the idempotency guarantee.
create unique index if not exists autonomous_pilot_events_provider_event_id_idx
  on public.autonomous_pilot_events (provider_event_id)
  where provider_event_id is not null;

comment on table public.autonomous_pilot_events is
  'Append-only audit trail of every pilot lifecycle transition and inbound provider callback. provider_event_id is unique (when present) so a retried provider callback is a no-op, not a duplicate transition.';

-- One row per reservation attempt. Unique on ride_id so a ride can
-- never end up with two concurrent/duplicate vehicle reservations no
-- matter how many times reserveVehicle() is called for it.
create table if not exists public.autonomous_provider_reservations (
  id text primary key,
  ride_id text not null references public.rides(id),
  provider text not null,
  provider_reservation_id text null,
  vehicle_id text null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reserved_at timestamptz null,
  cancelled_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_provider_reservations_ride_id_key unique (ride_id)
);

comment on table public.autonomous_provider_reservations is
  'One row per ride ever reserved through a pilot provider adapter. The unique ride_id constraint is what actually prevents duplicate reservations at the database level, not just application logic.';
comment on column public.autonomous_provider_reservations.provider_reservation_id is
  'Provider-assigned reservation identifier. Under the manual_operations adapter this is an admin-entered label, never a fabricated ID standing in for a real provider confirmation.';

-- Off by default. V1 ships disabled; an admin must explicitly enable it
-- through the new admin routes once migration, tests, disclosures, and
-- admin controls have all been reviewed.
insert into public.system_flags (key, value)
values ('autonomous_pilot_enabled', 'false')
on conflict (key) do nothing;
