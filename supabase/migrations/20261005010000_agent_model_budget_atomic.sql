-- Harvey Assistant model budget: atomic reservations (docs/ai-model.md).
--
-- Before every model-powered answer the server reserves that answer's
-- worst-case cost here; afterwards it settles the reservation with the
-- real cost. Both steps take the same per-month transaction-scoped
-- advisory lock, so simultaneous requests from any number of server
-- instances are checked one at a time against one shared total:
--
--   committed (agent_model_usage.cost_usd for the month)
-- + held      (unsettled reservations for the month)
-- + this reservation  <=  budget
--
-- The budget is capped at $10 inside the function as well as on the
-- server, so neither a configuration mistake nor a server bug can raise
-- it. A reservation that is never settled (for example the server stops
-- mid-answer) stays counted at its full worst-case amount: unknown spend
-- is treated as spent, never as free.
--
-- Server-only: RLS on, no policies, no anon/authenticated privileges;
-- EXECUTE for service_role only.

create table if not exists public.agent_model_reservations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usage_month text not null check (usage_month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_usd numeric(12, 6) not null check (amount_usd > 0),
  role text,
  actor_id text,
  settled_at timestamptz
);

create index if not exists agent_model_reservations_open_idx
  on public.agent_model_reservations (usage_month) where settled_at is null;

alter table public.agent_model_reservations enable row level security;
revoke all on table public.agent_model_reservations from anon, authenticated;

-- One ledger row per reservation, at most.
alter table public.agent_model_usage
  add column if not exists reservation_id bigint unique references public.agent_model_reservations (id);

create or replace function public.agent_model_reserve(
  p_month text,
  p_budget_usd numeric,
  p_amount_usd numeric,
  p_role text default null,
  p_actor_id text default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_budget numeric := least(coalesce(p_budget_usd, 0), 10);
  v_committed numeric;
  v_held numeric;
  v_id bigint;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'invalid month';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'reservation amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_model_budget:' || p_month, 0));

  select coalesce(sum(u.cost_usd), 0) into v_committed
    from public.agent_model_usage u
   where u.usage_month = p_month;
  select coalesce(sum(r.amount_usd), 0) into v_held
    from public.agent_model_reservations r
   where r.usage_month = p_month and r.settled_at is null;

  if v_committed + v_held + p_amount_usd > v_budget then
    return null;
  end if;

  insert into public.agent_model_reservations (usage_month, amount_usd, role, actor_id)
  values (p_month, p_amount_usd, p_role, p_actor_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- Settles a reservation with the real cost and writes the ledger row in
-- the same transaction. Returns false (and writes nothing) if the
-- reservation doesn't exist or was already settled, so a cost can never
-- be counted twice.
create or replace function public.agent_model_settle(
  p_reservation_id bigint,
  p_cost_usd numeric,
  p_calls integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_creation_input_tokens integer,
  p_cache_read_input_tokens integer,
  p_model text,
  p_role text,
  p_actor_id text,
  p_app_target text,
  p_outcome text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_month text;
begin
  if p_cost_usd is null or p_cost_usd < 0 then
    raise exception 'cost must be zero or more';
  end if;

  select r.usage_month into v_month
    from public.agent_model_reservations r
   where r.id = p_reservation_id;
  if v_month is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_model_budget:' || v_month, 0));

  update public.agent_model_reservations
     set settled_at = now()
   where id = p_reservation_id and settled_at is null;
  if not found then
    return false;
  end if;

  insert into public.agent_model_usage (
    usage_month, role, actor_id, app_target, model, calls,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
    cost_usd, outcome, reservation_id
  ) values (
    v_month, p_role, p_actor_id, p_app_target, p_model, coalesce(p_calls, 0),
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cache_creation_input_tokens, 0), coalesce(p_cache_read_input_tokens, 0),
    p_cost_usd, p_outcome, p_reservation_id
  );
  return true;
end;
$function$;

-- Month totals for the admin dashboard: committed and still-held amounts.
create or replace function public.agent_model_month_totals(p_month text)
returns table (committed_usd numeric, held_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    (select coalesce(sum(u.cost_usd), 0) from public.agent_model_usage u where u.usage_month = p_month),
    (select coalesce(sum(r.amount_usd), 0) from public.agent_model_reservations r where r.usage_month = p_month and r.settled_at is null);
$function$;

revoke all on function public.agent_model_reserve(text, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.agent_model_settle(bigint, numeric, integer, integer, integer, integer, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.agent_model_month_totals(text) from public, anon, authenticated;
grant execute on function public.agent_model_reserve(text, numeric, numeric, text, text) to service_role;
grant execute on function public.agent_model_settle(bigint, numeric, integer, integer, integer, integer, integer, text, text, text, text, text) to service_role;
grant execute on function public.agent_model_month_totals(text) to service_role;
