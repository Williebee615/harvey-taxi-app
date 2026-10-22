-- Fleet management, phase 1 (docs/fleet-management-plan.md; owner
-- decisions 2026-10-22). A verified Harvey Taxi driver owns a fleet,
-- registers vehicles and invites other verified drivers to drive them.
-- Earnings record the fleet owner's agreed share; no money moves.
-- Human-driven vehicles only: automation is 'none' until counsel and the
-- insurer sign off on autonomous vehicles.
--
-- Server-only: RLS on, no policies, no anon/authenticated access.
-- Nothing is deleted; changes are status changes. Additive only: the one
-- existing table touched (driver_earnings) gains nullable columns.

create table if not exists public.fleets (
  id uuid primary key default gen_random_uuid(),
  owner_driver_id text not null references public.drivers(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 80),
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'suspended')),
  review_reason text check (review_reason is null or length(review_reason) <= 500),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A decision names who made it and when; declining or suspending gives a reason.
  check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null)),
  check (status not in ('declined', 'suspended') or length(btrim(coalesce(review_reason, ''))) >= 3)
);
-- One fleet per owner (a declined one doesn't block a new application).
create unique index if not exists fleets_one_per_owner_idx
  on public.fleets (owner_driver_id) where status <> 'declined';

create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete restrict,
  vehicle_year integer not null check (vehicle_year between 1990 and 2100),
  make text not null check (length(btrim(make)) between 1 and 40),
  model text not null check (length(btrim(model)) between 1 and 40),
  color text not null check (length(btrim(color)) between 1 and 30),
  plate text not null check (plate ~ '^[A-Z0-9 -]{2,10}$'),
  plate_state text not null check (plate_state ~ '^[A-Z]{2}$'),
  vin_last6 text not null check (vin_last6 ~ '^[A-HJ-NPR-Z0-9]{6}$'),
  -- Phase 1: human-driven only.
  automation text not null default 'none' check (automation = 'none'),
  status text not null default 'pending_review' check (status in ('pending_review', 'active', 'inactive', 'suspended')),
  status_reason text check (status_reason is null or length(status_reason) <= 500),
  status_changed_by text,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (status_changed_by is not null and status_changed_at is not null)),
  check (status <> 'suspended' or length(btrim(coalesce(status_reason, ''))) >= 3)
);
create index if not exists fleet_vehicles_fleet_idx on public.fleet_vehicles (fleet_id);
-- A plate can be in use in only one fleet at a time.
create unique index if not exists fleet_vehicles_plate_idx
  on public.fleet_vehicles (plate_state, plate) where status <> 'inactive';

-- Same model as driver_document_records: append-only history, one current
-- record per vehicle and type, source and verification kept.
create table if not exists public.fleet_vehicle_documents (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  document_type text not null check (document_type in ('insurance', 'registration')),
  expires_on date not null,
  source text not null check (source in ('owner_entered', 'staff_from_document')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'staff_verified')),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  verified_by text,
  verified_at timestamptz,
  superseded_at timestamptz,
  superseded_by text,
  check (verification_status <> 'staff_verified' or (verified_by is not null and verified_at is not null and source = 'staff_from_document')),
  check (superseded_at is null or superseded_by is not null)
);
create unique index if not exists fleet_vehicle_documents_current_idx
  on public.fleet_vehicle_documents (vehicle_id, document_type) where superseded_at is null;

create table if not exists public.fleet_memberships (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets(id) on delete restrict,
  driver_id text not null references public.drivers(id) on delete restrict,
  status text not null default 'invited' check (status in ('invited', 'active', 'declined', 'ended')),
  -- Agreed between the fleet owner and the driver; Harvey Taxi records it.
  owner_share_pct numeric(5,2) not null check (owner_share_pct between 0 and 50),
  agreement_version text not null,
  invited_by text not null,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  ended_by text,
  ended_at timestamptz,
  end_reason text check (end_reason is null or length(end_reason) <= 500),
  check (status = 'invited' or responded_at is not null),
  check (status <> 'ended' or (ended_by is not null and ended_at is not null))
);
-- One open invitation or membership per fleet and driver.
create unique index if not exists fleet_memberships_open_idx
  on public.fleet_memberships (fleet_id, driver_id) where status in ('invited', 'active');
-- A driver drives for one fleet at a time.
create unique index if not exists fleet_memberships_one_active_idx
  on public.fleet_memberships (driver_id) where status = 'active';

create table if not exists public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  driver_id text not null references public.drivers(id) on delete restrict,
  membership_id uuid not null references public.fleet_memberships(id) on delete restrict,
  -- The driver's own vehicle fields before the assignment, restored after.
  previous_vehicle jsonb not null default '{}'::jsonb,
  assigned_by text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  ended_by text,
  check (ends_at is null or ended_by is not null)
);
create unique index if not exists vehicle_assignments_open_vehicle_idx
  on public.vehicle_assignments (vehicle_id) where ends_at is null;
create unique index if not exists vehicle_assignments_open_driver_idx
  on public.vehicle_assignments (driver_id) where ends_at is null;

-- Earnings: which fleet and vehicle a trip used, and the owner's share
-- (snapshot of the agreed percentage; fare earning only, never tips).
alter table public.driver_earnings
  add column if not exists fleet_id uuid references public.fleets(id) on delete set null,
  add column if not exists fleet_vehicle_id uuid references public.fleet_vehicles(id) on delete set null,
  add column if not exists fleet_owner_share_pct numeric(5,2) check (fleet_owner_share_pct is null or fleet_owner_share_pct between 0 and 50),
  add column if not exists fleet_owner_share_amount numeric(10,2) check (fleet_owner_share_amount is null or fleet_owner_share_amount >= 0);

alter table public.fleets enable row level security;
alter table public.fleet_vehicles enable row level security;
alter table public.fleet_vehicle_documents enable row level security;
alter table public.fleet_memberships enable row level security;
alter table public.vehicle_assignments enable row level security;
revoke all on public.fleets, public.fleet_vehicles, public.fleet_vehicle_documents, public.fleet_memberships, public.vehicle_assignments from anon, authenticated;
