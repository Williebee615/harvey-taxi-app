-- Tips during or after a trip, and rider ratings of drivers (owner
-- decisions 2026-10-22: "Separate tip charge", "1-5 stars after trip",
-- "Score + staff review"). Both are switched off by system flags until the
-- owner approves. A tip is its own card charge, 100% to the driver; it is
-- recorded as succeeded only after the server confirms it with Stripe. A
-- rating never acts on a driver by itself: a low score is flagged for staff.
-- The older public.tips table is left untouched.
-- Server-only: RLS on, no policies, no anon/authenticated access.

create table if not exists public.ride_tips (
  id uuid primary key default gen_random_uuid(),
  ride_id text not null references public.rides(id) on delete restrict,
  rider_id text not null,
  driver_id text not null,
  amount_cents integer not null check (amount_cents between 100 and 10000),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'cancelled', 'simulated')),
  -- 'test' until the owner approves live tips; 'simulated' for App Review rides.
  mode text not null check (mode in ('test', 'live', 'simulated')),
  payment_intent_id text unique,
  created_at timestamptz not null default now(),
  succeeded_at timestamptz,
  check (status not in ('succeeded', 'simulated') or succeeded_at is not null),
  check ((mode = 'simulated') = (payment_intent_id is null))
);
-- At most one paid (or simulated) tip per ride.
create unique index if not exists ride_tips_one_paid_idx
  on public.ride_tips (ride_id) where status in ('succeeded', 'simulated');
create index if not exists ride_tips_driver_idx on public.ride_tips (driver_id, created_at);

create table if not exists public.driver_ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id text not null unique references public.rides(id) on delete restrict,
  rider_id text not null,
  driver_id text not null,
  stars smallint not null check (stars between 1 and 5),
  tags text[] not null default '{}' check (tags <@ array['safe_driving', 'clean_car', 'friendly', 'great_route', 'late', 'route_issue', 'unsafe_driving', 'rude']::text[] and cardinality(tags) <= 8),
  comment text check (comment is null or length(comment) <= 500),
  -- App Review and test rides are kept but never counted in a score.
  counted boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists driver_ratings_driver_idx on public.driver_ratings (driver_id, created_at desc);

alter table public.ride_tips enable row level security;
alter table public.driver_ratings enable row level security;
revoke all on public.ride_tips from anon, authenticated;
revoke all on public.driver_ratings from anon, authenticated;
