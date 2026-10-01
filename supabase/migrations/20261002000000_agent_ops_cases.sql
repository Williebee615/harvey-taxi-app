-- Operations assistant case memory (lib/ops/caseStore.js).
-- NOT applied by the PR that adds it; apply only with owner approval.
-- Service-role access only: the server enforces rider/driver isolation and
-- returns reduced views; no client ever reads this table directly.

create table if not exists public.agent_ops_cases (
  id text primary key,
  subject_role text not null check (subject_role in ('rider', 'driver', 'admin')),
  subject_id text not null,
  ride_id text,
  state text not null check (state in ('investigating', 'awaiting_confirmation', 'resolved', 'needs_human_review')),
  categories text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  queue jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  created_by_role text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists agent_ops_cases_subject_idx on public.agent_ops_cases (subject_role, subject_id);
create index if not exists agent_ops_cases_ride_idx on public.agent_ops_cases (ride_id);
create index if not exists agent_ops_cases_state_idx on public.agent_ops_cases (state, updated_at desc);
create index if not exists agent_ops_cases_expires_idx on public.agent_ops_cases (expires_at);

alter table public.agent_ops_cases enable row level security;

drop policy if exists "service_role_agent_ops_cases" on public.agent_ops_cases;
create policy "service_role_agent_ops_cases"
  on public.agent_ops_cases
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.agent_ops_cases from anon, authenticated;

-- Rollback:
--   drop table if exists public.agent_ops_cases;
