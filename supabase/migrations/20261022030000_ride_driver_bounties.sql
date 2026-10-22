-- Driver bounty proposals (owner decision 2026-10-22: "Design it,
-- switched off"). Extra pay on a hard-to-fill trip, chosen by staff; the
-- rider's price never changes. Phase 1 only records a proposal: drivers
-- don't see it and nothing is paid, so the only statuses are proposed and
-- cancelled. Paying needs the owner's approval, a budget and driver terms.
-- Server-only: RLS on, no policies, no anon/authenticated access.

create table if not exists public.ride_driver_bounties (
  id uuid primary key default gen_random_uuid(),
  ride_id text not null references public.rides(id) on delete restrict,
  amount_cents integer not null check (amount_cents between 300 and 1500),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  status text not null default 'proposed' check (status in ('proposed', 'cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  cancelled_by text,
  cancelled_at timestamptz,
  check (status <> 'cancelled' or (cancelled_by is not null and cancelled_at is not null))
);
-- One open bounty per ride.
create unique index if not exists ride_driver_bounties_open_idx
  on public.ride_driver_bounties (ride_id) where status = 'proposed';
create index if not exists ride_driver_bounties_created_idx
  on public.ride_driver_bounties (created_at);

alter table public.ride_driver_bounties enable row level security;
revoke all on public.ride_driver_bounties from anon, authenticated;
