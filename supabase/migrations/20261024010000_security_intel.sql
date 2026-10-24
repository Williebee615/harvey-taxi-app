-- S.A.I. Cyber Defense Intelligence, PR 1 (owner decision 2026-10-24).
--
-- security_events: an append-only log of security signals (rate-limit
-- hits, failed admin sign-ins, refused requests, sign-in texts). No raw
-- IP address or phone number is stored: only a keyed hash and a masked
-- form such as "203.0.x.x". Rows can't be edited, and can be deleted only
-- after 90 days (the retention sweep), so the record can't be quietly
-- rewritten.
--
-- security_ip_blocks: blocks the owner places by clicking in the Cyber
-- Defense panel. Every block expires (at most 7 days) and records who
-- placed it and why. Nothing here is written automatically.
--
-- admin_mfa: the admin's authenticator-app enrolment. The secret is
-- stored encrypted by the server; recovery codes only as hashes.
--
-- Server-only, like merchants: RLS on, no policies, no anon/authenticated
-- access.

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in (
    'rate_limited', 'admin_login_failed', 'admin_mfa_failed', 'access_denied',
    'sms_code_sent', 'blocked_request', 'buffer_overflow'
  )),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  route text check (route is null or length(route) <= 200),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'),
  ip_masked text check (ip_masked is null or length(ip_masked) <= 64),
  subject_hash text check (subject_hash is null or subject_hash ~ '^[0-9a-f]{32}$'),
  count integer not null default 1 check (count >= 1),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048)
);

create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_kind_created_idx on public.security_events (kind, created_at desc);

create or replace function public.security_events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'security_events is append-only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and old.created_at > now() - interval '90 days' then
    raise exception 'security_events rows are kept for 90 days' using errcode = '42501';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'security_events is append-only' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists security_events_no_update on public.security_events;
create trigger security_events_no_update before update or delete on public.security_events
  for each row execute function public.security_events_append_only();
drop trigger if exists security_events_no_truncate on public.security_events;
create trigger security_events_no_truncate before truncate on public.security_events
  for each statement execute function public.security_events_append_only();

create table if not exists public.security_ip_blocks (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{32}$'),
  ip_masked text check (ip_masked is null or length(ip_masked) <= 64),
  reason text not null check (length(btrim(reason)) between 2 and 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lifted_by text,
  lifted_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check ((lifted_by is null) = (lifted_at is null))
);

create index if not exists security_ip_blocks_active_idx on public.security_ip_blocks (ip_hash) where lifted_at is null;

create table if not exists public.admin_mfa (
  email text primary key check (length(email) between 3 and 254),
  secret_enc text not null check (secret_enc like 'v1.%'),
  status text not null default 'pending' check (status in ('pending', 'active')),
  -- The last accepted 30-second step; a code at or before it is refused.
  last_step bigint not null default -1,
  recovery_hashes text[] not null default '{}',
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status = 'pending' or activated_at is not null)
);

alter table public.security_events enable row level security;
alter table public.security_ip_blocks enable row level security;
alter table public.admin_mfa enable row level security;

revoke all on public.security_events from anon, authenticated;
revoke all on public.security_ip_blocks from anon, authenticated;
revoke all on public.admin_mfa from anon, authenticated;
