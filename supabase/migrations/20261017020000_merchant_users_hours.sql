-- Merchant portal, phase 1b: merchant sign-in and store hours (owner
-- decision 2026-10-17). Staff give an approved store sign-in access
-- (merchant_users); the store signs in with a one-time code texted to that
-- phone (Twilio Verify, as for riders) and sets its weekly opening hours
-- (merchant_hours). No catalog, orders or payouts yet.
--
-- Server-only, like merchants: RLS on, no policies, no anon/authenticated
-- access.

create table if not exists public.merchant_users (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  phone text not null check (phone ~ '^\+1[0-9]{10}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  role text not null default 'owner' check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- Raised on sign-out and when access is disabled; a session token
  -- carrying an older version is refused.
  session_version integer not null default 0 check (session_version >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  disabled_by text,
  disabled_at timestamptz,
  last_sign_in_at timestamptz,
  check (status = 'active' or (disabled_by is not null and disabled_at is not null))
);

-- A phone signs in to exactly one store at a time.
create unique index if not exists merchant_users_active_phone_idx
  on public.merchant_users (phone) where status = 'active';
create index if not exists merchant_users_merchant_idx on public.merchant_users (merchant_id);

-- One opening window per weekday, in Nashville time (America/Chicago).
-- day_of_week: 0 = Sunday ... 6 = Saturday.
create table if not exists public.merchant_hours (
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  closed boolean not null default false,
  opens_at time,
  closes_at time,
  updated_by uuid references public.merchant_users (id),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, day_of_week),
  check (
    (closed and opens_at is null and closes_at is null)
    or (not closed and opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);

alter table public.merchant_users enable row level security;
alter table public.merchant_hours enable row level security;
revoke all on public.merchant_users from anon, authenticated;
revoke all on public.merchant_hours from anon, authenticated;

-- Sign-out and access removal: raise session_version atomically, so a
-- concurrent sign-in can't keep a stale token alive.
create or replace function public.bump_merchant_user_session_version(p_user_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  update public.merchant_users
     set session_version = session_version + 1
   where id = p_user_id
  returning session_version;
$$;

revoke all on function public.bump_merchant_user_session_version(uuid) from public, anon, authenticated;
grant execute on function public.bump_merchant_user_session_version(uuid) to service_role;
