-- Harvey Assistant model spending ledger (docs/ai-model.md).
--
-- One row per model-powered assistant turn: token counts reported by the
-- provider and the cost Harvey computed from the published price. The
-- server sums the current month's rows to enforce the owner-approved
-- monthly budget ($10), so spending survives restarts. No message text is
-- stored here.
--
-- Server-only access, like every recent table: RLS on, no policies, no
-- anon/authenticated privileges.

create table if not exists public.agent_model_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usage_month text not null check (usage_month ~ '^[0-9]{4}-[0-9]{2}$'),
  role text not null check (role in ('rider', 'driver', 'admin')),
  actor_id text,
  app_target text,
  model text not null,
  calls integer not null default 0 check (calls >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  outcome text not null
);

create index if not exists agent_model_usage_month_idx
  on public.agent_model_usage (usage_month);

alter table public.agent_model_usage enable row level security;
revoke all on table public.agent_model_usage from anon, authenticated;
