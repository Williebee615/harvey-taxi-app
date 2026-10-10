-- Harvey Assistant: explicit permission to use AI answers (lib/agent/aiConsent.js).
--
-- One row per decision a rider or driver makes on the "Allow AI answers?"
-- notice: granted true (allowed) or false (declined / turned off), with
-- the notice version shown. Append-only. The latest row for an account
-- decides; no row means no permission, so the assistant answers without
-- the AI model.
--
-- Additive: a new table only. Nothing else reads it, and the assistant
-- keeps working (without the model) if it can't be read.

create table if not exists public.agent_ai_consents (
  id bigint generated always as identity primary key,
  role text not null check (role in ('rider', 'driver')),
  account_id text not null check (char_length(account_id) between 1 and 80),
  granted boolean not null,
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  client text not null check (client in ('web', 'driver_app')),
  created_at timestamptz not null default now()
);

create index if not exists agent_ai_consents_account_idx on public.agent_ai_consents (role, account_id, created_at desc);

-- Server-only, like the other assistant records.
alter table public.agent_ai_consents enable row level security;
revoke all on table public.agent_ai_consents from anon, authenticated;
