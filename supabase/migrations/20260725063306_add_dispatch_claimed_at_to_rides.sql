-- Adds the lease timestamp sweepScheduledRides() uses to claim a due
-- scheduled ride for dispatch, and to detect + reclaim a stale claim left
-- behind by a crashed process (see lib/rideDispatch.js).
--
-- Idempotent: safe to re-run against an environment where this has already
-- been applied.

alter table public.rides
  add column if not exists dispatch_claimed_at timestamptz null;

comment on column public.rides.dispatch_claimed_at is
  'Set when sweepScheduledRides() atomically claims a due scheduled ride for dispatch. Used as a lease timestamp so a stale claim (crashed process) can be reclaimed by a later sweep after a timeout.';
