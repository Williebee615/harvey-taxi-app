-- Concurrency-safe usage counter for the (currently disabled) paid routing-API
-- circuit breaker described in docs/eta-persistence-plan.md §5.1.
--
-- A plain system_flags read-then-write from application code is not atomic:
-- two concurrent routing-API calls could both read the same count, both
-- compute count + 1 in the app, and both write the same value back, silently
-- losing an increment. For a cost-control counter specifically, undercounting
-- is the one failure mode that defeats the entire point. This table +
-- function are incremented with a single atomic
-- `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` statement, the
-- same class of guarantee dispatch_ride_atomic() already relies on elsewhere
-- in this schema.
--
-- Purely additive and unused until dispatch_route_api_enabled is turned on
-- (it stays false after this migration — see lib/etaEstimation.js). Idempotent:
-- safe to re-run against an environment where this has already been applied.

create table if not exists public.usage_counters (
  key text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.usage_counters is
  'Generic atomic usage counters (e.g. routing-API calls per month for the dispatch_route_api_enabled circuit breaker). Incremented only via increment_usage_counter().';

create or replace function public.increment_usage_counter(p_key text)
returns bigint
language sql
as $$
  insert into public.usage_counters (key, count, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = public.usage_counters.count + 1,
        updated_at = now()
  returning count;
$$;

comment on function public.increment_usage_counter(text) is
  'Atomically increments and returns the named usage counter in one round trip. Callers check the returned count against a configured cap (check-after-increment, not check-then-increment) and fail closed on any error from this call.';
