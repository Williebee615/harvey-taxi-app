-- Merchant portal, phase 1a: merchant applications and admin review
-- (owner decision 2026-10-17: merchant portal; terms locked in
-- docs/merchant-portal-plan.md section 4). Stores apply on
-- merchant-apply.html; staff approve, reject or suspend in the admin
-- dashboard. No sign-in, catalog, orders or payouts yet (later phases).
--
-- Server-only: RLS on, no policies, no anon/authenticated access. Contact
-- details are business contacts supplied by the store.

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(btrim(business_name)) between 2 and 160),
  category text not null check (category in ('restaurant', 'grocery', 'convenience')),
  address_line text not null check (length(btrim(address_line)) between 5 and 240),
  city text not null check (length(btrim(city)) between 2 and 80),
  -- Pilot is Nashville-area only.
  state text not null default 'TN' check (state = 'TN'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 120),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
  contact_phone text not null check (contact_phone ~ '^\+1[0-9]{10}$'),
  website text check (website is null or website ~* '^https://'),
  -- Decision 2: merchants set prices; when they differ from in-store, the
  -- rider app shows "Prices may be higher than in store".
  prices_differ_from_store boolean not null default false,
  -- Decision 3: the applicant confirmed it won't list excluded items.
  confirmed_exclusions boolean not null check (confirmed_exclusions),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_reason text check (review_reason is null or length(review_reason) <= 1000),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null)),
  check (status not in ('rejected', 'suspended') or length(btrim(coalesce(review_reason, ''))) >= 10)
);

-- One open application or account per contact email.
create unique index if not exists merchants_open_contact_email_idx
  on public.merchants (lower(contact_email))
  where status in ('pending', 'approved', 'suspended');

create index if not exists merchants_status_created_idx on public.merchants (status, created_at desc);

alter table public.merchants enable row level security;
revoke all on public.merchants from anon, authenticated;
