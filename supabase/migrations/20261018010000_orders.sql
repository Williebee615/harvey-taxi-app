-- Merchant portal, phase 3a: orders (owner decisions 2026-10-18: design
-- docs/merchant-portal-phase3-orders.md approved, D1-D7 as recommended,
-- "Authorize the initiation of Step 3a"). A signed-in rider orders items
-- from one approved store and pays once (one manual-capture card
-- authorization); the store accepts, rejects or marks ready. Test mode
-- only, behind ENABLE_MERCHANT_ORDERS (off). Driver pickup, delivery,
-- capture and refunds come in later steps.
--
-- Server-only, like merchants and catalog_items: RLS on, no policies, no
-- anon/authenticated access. rider_id and ride_id are text to match
-- riders.id and rides.id.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique check (order_number ~ '^HT-[A-Z0-9]{6}$'),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  rider_id text not null,
  ride_id text,
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'placed', 'accepted', 'ready', 'picked_up', 'delivered', 'completed',
    'rejected', 'expired', 'payment_abandoned', 'cancelled_by_rider', 'cancelled_by_store', 'cancelled_by_staff'
  )),
  order_type text not null check (order_type in ('food', 'grocery')),
  prep_minutes integer check (prep_minutes is null or prep_minutes between 5 and 90),
  placed_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  -- Money, whole cents.
  items_subtotal_cents integer not null check (items_subtotal_cents >= 0),
  tax_cents integer not null check (tax_cents >= 0),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 2000),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  tip_cents integer not null default 0 check (tip_cents between 0 and 50000),
  authorized_cents integer not null check (authorized_cents >= 0),
  captured_cents integer not null default 0 check (captured_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  merchant_share_cents integer not null default 0 check (merchant_share_cents >= 0),
  payment_intent_id text unique,
  livemode boolean not null default false,
  -- Makes checkout safe to retry: one order per rider per key.
  client_order_key text not null check (length(client_order_key) between 8 and 100),
  -- The signed delivery-fee quote is single-use, as for rides.
  quote_jti text not null unique,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  payout_week_start date,
  rider_notes text check (rider_notes is null or length(rider_notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (captured_cents <= authorized_cents),
  check (refunded_cents <= captured_cents),
  check (status not in ('rejected', 'cancelled_by_store', 'cancelled_by_staff') or length(btrim(coalesce(cancel_reason, ''))) >= 3),
  check (status = 'pending_payment' or status = 'payment_abandoned' or status = 'cancelled_by_rider' or status = 'cancelled_by_staff' or placed_at is not null),
  check (status <> 'accepted' or (accepted_at is not null and prep_minutes is not null))
);

create unique index if not exists orders_rider_key_idx on public.orders (rider_id, client_order_key);
create index if not exists orders_merchant_status_idx on public.orders (merchant_id, status, created_at);
create index if not exists orders_rider_idx on public.orders (rider_id, created_at);
create index if not exists orders_open_idx on public.orders (status, created_at)
  where status in ('pending_payment', 'placed', 'accepted', 'ready', 'picked_up', 'delivered');

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  catalog_item_id uuid references public.catalog_items (id) on delete restrict,
  -- Copied at checkout: later catalog edits never change a placed order.
  name text not null check (length(btrim(name)) between 2 and 120),
  unit_price_cents integer not null check (unit_price_cents between 1 and 100000),
  quantity integer not null check (quantity between 1 and 20),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  substitution_choice text not null default 'refund' check (substitution_choice in ('contact', 'best_match', 'refund')),
  fulfilment text not null default 'pending' check (fulfilment in ('pending', 'packed', 'substituted', 'out_of_stock', 'refunded')),
  substitute_name text check (substitute_name is null or length(btrim(substitute_name)) between 2 and 120),
  substitute_price_cents integer check (substitute_price_cents is null or substitute_price_cents between 1 and 100000),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- Append-only history of every state change.
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('rider', 'merchant_user', 'admin', 'system')),
  actor_id text,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

create or replace function public.order_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'order_events is append-only';
end;
$$;

drop trigger if exists order_events_no_update on public.order_events;
create trigger order_events_no_update before update or delete on public.order_events
  for each row execute function public.order_events_append_only();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.order_events from anon, authenticated;
revoke all on function public.order_events_append_only() from public, anon, authenticated;
