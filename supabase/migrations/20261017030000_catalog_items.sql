-- Merchant portal, phase 2: store catalog (owner decision 2026-10-17,
-- "Start phase 2 catalog"). Approved stores manage their own items in the
-- store portal: name, section, description, price, availability, and
-- whether the item may be substituted (merchant term 5). Items whose text
-- suggests an excluded category (term 3) are held for staff review instead
-- of being listed; staff allow them or keep them hidden with a reason.
-- No ordering yet (phase 3). No photos yet.
--
-- Server-only, like merchants: RLS on, no policies, no anon/authenticated
-- access.

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 120),
  section text check (section is null or length(btrim(section)) between 1 and 60),
  description text check (description is null or length(description) <= 500),
  -- Whole cents; $0.01 to $1,000.00.
  price_cents integer not null check (price_cents between 1 and 100000),
  available boolean not null default true,
  substitutable boolean not null default false,
  -- listed: customers will see it (when ordering opens); held: waiting for
  -- staff review; blocked: staff kept it hidden.
  review_status text not null default 'listed' check (review_status in ('listed', 'held', 'blocked')),
  review_flags text[] not null default '{}',
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or length(review_reason) <= 500),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.merchant_users (id),
  updated_by uuid references public.merchant_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_status <> 'blocked' or (reviewed_by is not null and reviewed_at is not null and length(btrim(coalesce(review_reason, ''))) >= 10))
);

-- One live item per name per store (import matches on it).
create unique index if not exists catalog_items_store_name_idx
  on public.catalog_items (merchant_id, lower(name)) where archived_at is null;
create index if not exists catalog_items_merchant_idx on public.catalog_items (merchant_id, section, sort_order);
create index if not exists catalog_items_held_idx on public.catalog_items (review_status) where review_status = 'held' and archived_at is null;

alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon, authenticated;
