-- HTAF partner access (owner decision 2026-10-23): referral organizations
-- (shelters, clinics, workforce centres) get limited access to view their
-- own clients' applications and submit new ones. HTAF still decides every
-- application. Access needs BOTH the owner's master switch (system flag
-- htaf_partner_access_enabled) and this partner's own switch (enabled);
-- both start off.
--
-- Server-only, like merchants: RLS on, no policies, no anon/authenticated
-- access.

create table if not exists public.htaf_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  partner_type text not null default 'other' check (partner_type in ('shelter', 'clinic', 'workforce', 'other')),
  -- The signed partner agreement (design §12.2). A partner can't be
  -- switched on without one recorded.
  agreement_ref text check (agreement_ref is null or length(btrim(agreement_ref)) between 2 and 200),
  enabled boolean not null default false,
  enabled_by text,
  enabled_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or (agreement_ref is not null and enabled_by is not null and enabled_at is not null))
);

create table if not exists public.htaf_partner_users (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.htaf_partners (id) on delete restrict,
  phone text not null check (phone ~ '^\+1[0-9]{10}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- Raised on sign-out and when access is removed; an older token is refused.
  session_version integer not null default 0 check (session_version >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  disabled_by text,
  disabled_at timestamptz,
  last_sign_in_at timestamptz,
  check (status = 'active' or (disabled_by is not null and disabled_at is not null))
);

-- A phone signs in to exactly one partner at a time.
create unique index if not exists htaf_partner_users_active_phone_idx
  on public.htaf_partner_users (phone) where status = 'active';
create index if not exists htaf_partner_users_partner_idx on public.htaf_partner_users (partner_id);

-- Which partner (and which coordinator) submitted an application. Null
-- for applications people submit themselves. Skipped where
-- htaf_applications doesn't exist (the test baseline); production has it.
-- The table is small (a handful of rows), so a plain index build is brief.
do $$
begin
  if to_regclass('public.htaf_applications') is not null then
    alter table public.htaf_applications add column if not exists partner_id uuid references public.htaf_partners (id) on delete restrict;
    alter table public.htaf_applications add column if not exists partner_user_id uuid references public.htaf_partner_users (id) on delete restrict;
    create index if not exists htaf_applications_partner_idx on public.htaf_applications (partner_id) where partner_id is not null;
  end if;
end
$$;

alter table public.htaf_partners enable row level security;
alter table public.htaf_partner_users enable row level security;
revoke all on public.htaf_partners from anon, authenticated;
revoke all on public.htaf_partner_users from anon, authenticated;

create or replace function public.bump_htaf_partner_user_session_version(p_user_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  update public.htaf_partner_users
     set session_version = session_version + 1
   where id = p_user_id
  returning session_version;
$$;

revoke all on function public.bump_htaf_partner_user_session_version(uuid) from public, anon, authenticated;
grant execute on function public.bump_htaf_partner_user_session_version(uuid) to service_role;
