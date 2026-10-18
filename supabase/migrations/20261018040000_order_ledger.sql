-- Merchant portal, step 3c-1: substitutions, missing-item refund proposals
-- and the store ledger (owner decisions 2026-10-18: "Approved as
-- recommended" for driver pay, commission basis, an append-only ledger and
-- extending the existing item status; refund proposal statuses gain
-- refunded and refund_failed; the 48-hour claim window runs from
-- delivered_at). Test mode only. No money moves to stores in phase 3.
--
-- Server-only, like orders: RLS on, no policies, no anon/authenticated
-- access.

-- "Contact me first" (term 5). The existing fulfilment column stays the
-- item's only status; these record the question and the rider's answer.
-- refunded_quantity is what missing-item refunds have already returned.
alter table public.order_items add column if not exists substitution_asked_at timestamptz;
alter table public.order_items add column if not exists substitution_expires_at timestamptz;
alter table public.order_items add column if not exists substitution_answer text;
alter table public.order_items add column if not exists substitution_answered_at timestamptz;
alter table public.order_items add column if not exists refunded_quantity integer not null default 0;

alter table public.order_items drop constraint if exists order_items_substitution_answer_check;
alter table public.order_items add constraint order_items_substitution_answer_check
  check (substitution_answer is null or substitution_answer in ('substitute', 'refund'));
alter table public.order_items drop constraint if exists order_items_substitution_contact_check;
alter table public.order_items add constraint order_items_substitution_contact_check
  check (substitution_asked_at is null or substitution_choice = 'contact');
alter table public.order_items drop constraint if exists order_items_substitution_times_check;
alter table public.order_items add constraint order_items_substitution_times_check check (
  (substitution_asked_at is null and substitution_expires_at is null and substitution_answer is null and substitution_answered_at is null)
  or (substitution_asked_at is not null and substitution_expires_at > substitution_asked_at
      and (substitution_answer is null) = (substitution_answered_at is null)
      and (substitution_answered_at is null or substitution_answered_at >= substitution_asked_at))
);
alter table public.order_items drop constraint if exists order_items_refunded_quantity_check;
alter table public.order_items add constraint order_items_refunded_quantity_check
  check (refunded_quantity between 0 and quantity);

-- Missing-item refund proposals (term 4; agent rule 8: a person approves
-- every refund). Built by lib/refundEngine.js buildRefundProposal().
-- "approved" means a person said yes; only "refunded" means Stripe
-- confirmed the money moved.
create table if not exists public.order_refund_proposals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  rider_id text not null,
  market text not null default 'nashville' check (market ~ '^[a-z][a-z0-9_]{1,39}$'),
  type text not null default 'missing_item_refund' check (type = 'missing_item_refund'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'declined', 'refunded', 'refund_failed')),
  -- high_risk_review: the rider is over the monthly claim limit (more than 3).
  review_priority text not null default 'routine' check (review_priority in ('routine', 'high_risk_review')),
  reasons text[] not null default '{}',
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  idempotency_key text not null unique check (idempotency_key ~ '^mir_[0-9a-f]{32}$'),
  claimed_at timestamptz not null,
  -- Money, whole cents. The rider gets the items and their tax back; the
  -- store gives back its share of those items; Harvey Taxi its commission.
  customer_refund_cents integer not null check (customer_refund_cents > 0),
  item_cents integer not null check (item_cents > 0),
  tax_cents integer not null check (tax_cents >= 0),
  merchant_deduction_cents integer not null check (merchant_deduction_cents >= 0),
  commission_reversed_cents integer not null check (commission_reversed_cents >= 0),
  reviewed_by text,
  reviewed_at timestamptz,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 500),
  stripe_refund_id text unique check (stripe_refund_id is null or stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9]+$'),
  refunded_at timestamptz,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  -- The store's 48-hour dispute window (term 4, merchantDeductionStatus).
  merchant_notified_at timestamptz,
  dispute_filed_at timestamptz,
  dispute_outcome text check (dispute_outcome is null or dispute_outcome in ('pending', 'merchant_wins', 'merchant_loses')),
  dispute_decided_at timestamptz,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_refund_cents = item_cents + tax_cents),
  check (merchant_deduction_cents + commission_reversed_cents = item_cents),
  check (status = 'pending_review' or (reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'declined' or length(btrim(coalesce(decision_reason, ''))) >= 3),
  check (status <> 'refunded' or (stripe_refund_id is not null and refunded_at is not null)),
  check (status <> 'refund_failed' or length(btrim(coalesce(failure_reason, ''))) >= 3),
  check ((dispute_filed_at is null) = (dispute_outcome is null)),
  check (dispute_decided_at is null or dispute_outcome in ('merchant_wins', 'merchant_loses'))
);

create index if not exists order_refund_proposals_order_idx on public.order_refund_proposals (order_id);
create index if not exists order_refund_proposals_review_idx on public.order_refund_proposals (status, created_at);
create index if not exists order_refund_proposals_rider_month_idx on public.order_refund_proposals (rider_id, claimed_at);
create index if not exists order_refund_proposals_market_idx on public.order_refund_proposals (market, status);

-- The store ledger: append-only. A completed order adds a credit; a
-- confirmed missing-item deduction (after the store's 48-hour dispute
-- window, or a dispute the store lost) adds a debit. Rows are never
-- edited; a store's balance for a payout week is the sum of its rows.
-- Commission is on the item subtotal only (term 1). Tax, the delivery fee
-- and the tip are recorded for the books but never belong to the store.
create table if not exists public.store_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  refund_proposal_id uuid references public.order_refund_proposals (id) on delete restrict,
  market text not null default 'nashville' check (market ~ '^[a-z][a-z0-9_]{1,39}$'),
  entry_type text not null check (entry_type in ('order_credit', 'refund_deduction')),
  -- Monday of the Nashville-time week (term 7, lib/refundEngine.js payoutWeek).
  payout_week_start date not null check (extract(isodow from payout_week_start) = 1),
  items_cents integer not null check (items_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  tip_cents integer not null default 0 check (tip_cents >= 0),
  commission_rate_bps integer not null default 1200 check (commission_rate_bps between 0 and 5000),
  -- Signed: a credit earns commission and pays the store; a deduction
  -- reverses both.
  commission_cents integer not null,
  store_amount_cents integer not null,
  livemode boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'order_credit' and refund_proposal_id is null
      and commission_cents = round(items_cents * commission_rate_bps / 10000.0)
      and store_amount_cents = items_cents - commission_cents)
    or
    (entry_type = 'refund_deduction' and refund_proposal_id is not null
      and delivery_fee_cents = 0 and tip_cents = 0
      and commission_cents = -round(items_cents * commission_rate_bps / 10000.0)
      and store_amount_cents = -items_cents - commission_cents)
  )
);

create unique index if not exists store_ledger_one_credit_per_order on public.store_ledger_entries (order_id) where entry_type = 'order_credit';
create unique index if not exists store_ledger_one_deduction_per_proposal on public.store_ledger_entries (refund_proposal_id) where entry_type = 'refund_deduction';
create index if not exists store_ledger_merchant_week_idx on public.store_ledger_entries (merchant_id, payout_week_start);
create index if not exists store_ledger_market_week_idx on public.store_ledger_entries (market, payout_week_start);

create or replace function public.store_ledger_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'store_ledger_entries is append-only';
end;
$$;

drop trigger if exists store_ledger_no_update on public.store_ledger_entries;
create trigger store_ledger_no_update before update or delete on public.store_ledger_entries
  for each row execute function public.store_ledger_append_only();

alter table public.order_refund_proposals enable row level security;
alter table public.store_ledger_entries enable row level security;
revoke all on public.order_refund_proposals from anon, authenticated;
revoke all on public.store_ledger_entries from anon, authenticated;
revoke all on function public.store_ledger_append_only() from public, anon, authenticated;
