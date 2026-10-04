-- Cancellation and no-show records (docs/policy-cancellation-noshow-draft.md).
--
-- Owner instruction (2026-10-04): build and test the controls and records
-- first, keeping every cancellation free. These columns record what the
-- draft policy needs to know; nothing here charges anything.
--
-- All columns are additive and nullable (or defaulted), so existing rows
-- and existing code are unaffected.

-- Pickup estimate shown when the driver accepted, kept separately from
-- driver_eta_to_pickup_minutes (which moves with the driver).
alter table public.rides add column if not exists eta_at_accept_minutes numeric(6, 1);
alter table public.rides add column if not exists pickup_due_at timestamptz;

-- Driver progress toward the pickup (meters), and the latest location fix
-- before pickup.
alter table public.rides add column if not exists pickup_start_distance_m integer;
alter table public.rides add column if not exists pickup_last_distance_m integer;
alter table public.rides add column if not exists pickup_progress_at timestamptz;
alter table public.rides add column if not exists pickup_fix_lat double precision;
alter table public.rides add column if not exists pickup_fix_lng double precision;
alter table public.rides add column if not exists pickup_fix_accuracy_m numeric(8, 1);
alter table public.rides add column if not exists pickup_fix_at timestamptz;

-- Was the driver at the pickup when they tapped Arrived?
alter table public.rides add column if not exists arrival_verified boolean;
alter table public.rides add column if not exists arrival_distance_m integer;
alter table public.rides add column if not exists arrival_check text;
alter table public.rides drop constraint if exists rides_arrival_check_check;
alter table public.rides add constraint rides_arrival_check_check check (
  arrival_check is null or arrival_check in (
    'verified', 'not_at_pickup', 'location_stale', 'location_inaccurate', 'no_driver_location', 'no_pickup_location'
  )
);

-- In-app attempts by the driver to reach the rider.
alter table public.rides add column if not exists contact_attempt_count integer not null default 0;
alter table public.rides add column if not exists last_contact_attempt_at timestamptz;
alter table public.rides drop constraint if exists rides_contact_attempt_count_check;
alter table public.rides add constraint rides_contact_attempt_count_check check (contact_attempt_count >= 0);

-- Why the ride was cancelled, and what the draft policy would have
-- decided (waivers, phase). The assessment is a record, not a charge.
alter table public.rides add column if not exists cancellation_category text;
alter table public.rides drop constraint if exists rides_cancellation_category_check;
alter table public.rides add constraint rides_cancellation_category_check check (
  cancellation_category is null or cancellation_category in (
    'rider_cancelled', 'driver_no_show', 'harvey_service_failure', 'admin_incident'
  )
);
alter table public.rides add column if not exists cancellation_assessment jsonb;

-- The fee shown to the rider before they confirmed, and the fee charged.
-- Charges are not active: the database refuses any cancellation fee
-- other than $0 until the owner approves fees and a later migration
-- relaxes this constraint.
alter table public.rides add column if not exists cancellation_fee_shown_cents integer;
alter table public.rides add column if not exists cancellation_fee_cents integer not null default 0;
alter table public.rides drop constraint if exists rides_cancellation_fee_not_active_check;
alter table public.rides add constraint rides_cancellation_fee_not_active_check check (
  cancellation_fee_cents = 0 and (cancellation_fee_shown_cents is null or cancellation_fee_shown_cents = 0)
);

-- One record per contact attempt (call or message), for support review.
create table if not exists public.ride_contact_attempts (
  id bigint generated always as identity primary key,
  ride_id text not null,
  driver_id text not null,
  method text not null check (method in ('call', 'message')),
  ride_status text,
  created_at timestamptz not null default now()
);
create index if not exists ride_contact_attempts_ride_idx on public.ride_contact_attempts (ride_id, created_at);

-- Server-only, like the other ride records.
alter table public.ride_contact_attempts enable row level security;
revoke all on table public.ride_contact_attempts from anon, authenticated;
