-- Refund ledger (owner request 2026-10-14: refunds tested in Stripe test
-- mode, including retries, partial refunds and concurrent requests; no live
-- refunds). Off by default: nothing calls these functions unless the
-- refunds_enabled system flag is "true", and the server refuses live-mode
-- refunds regardless.
--
-- One row per requested refund. The idempotency key makes a retried request
-- return the original row instead of creating a second refund. A per-intent
-- transaction lock serializes concurrent requests, so two partial refunds
-- can never together exceed the captured amount. Rows are never deleted.
-- Server-only: RLS on, no policies, no anon/authenticated access.

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  reason_code text not null check (reason_code in ('ride_cancelled_after_capture', 'fare_adjustment', 'duplicate_charge', 'service_issue', 'other')),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  -- pending:   reserved here; Stripe not yet confirmed (a retry resumes it)
  -- submitted: Stripe accepted it and reports it as still processing
  -- succeeded / failed: final, as reported by Stripe
  status text not null default 'pending' check (status in ('pending', 'submitted', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error_code text,
  check (status in ('pending', 'failed') or stripe_refund_id is not null)
);

create index if not exists payment_refunds_intent_idx on public.payment_refunds (payment_intent_id);

alter table public.payment_refunds enable row level security;
revoke all on public.payment_refunds from anon, authenticated;

-- Reserve a refund. p_captured_cents and p_stripe_refunded_cents come from
-- the PaymentIntent the server has just read from Stripe.
-- Returns {outcome, refund}: outcome is 'reserved', 'replayed',
-- 'idempotency_mismatch' or 'exceeds_refundable'.
create or replace function public.reserve_payment_refund(
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text,
  p_reason_code text,
  p_idempotency_key text,
  p_requested_by text,
  p_captured_cents integer,
  p_stripe_refunded_cents integer
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing public.payment_refunds;
  reserved_cents integer;
  row_out public.payment_refunds;
begin
  -- Serializes every request for this PaymentIntent until commit.
  perform pg_advisory_xact_lock(hashtextextended('payment_refunds:' || p_payment_intent_id, 0));

  select * into existing from public.payment_refunds where idempotency_key = p_idempotency_key;
  if found then
    if existing.payment_intent_id <> p_payment_intent_id or existing.amount_cents <> p_amount_cents then
      return jsonb_build_object('outcome', 'idempotency_mismatch');
    end if;
    return jsonb_build_object('outcome', 'replayed', 'refund', to_jsonb(existing));
  end if;

  -- Everything not failed counts against the refundable amount. Stripe's own
  -- refunded total also counts, covering refunds made outside this ledger.
  select coalesce(sum(amount_cents), 0) into reserved_cents
    from public.payment_refunds
   where payment_intent_id = p_payment_intent_id and status <> 'failed';
  if greatest(reserved_cents, coalesce(p_stripe_refunded_cents, 0)) + p_amount_cents > coalesce(p_captured_cents, 0) then
    return jsonb_build_object('outcome', 'exceeds_refundable',
      'captured_cents', coalesce(p_captured_cents, 0),
      'already_refunded_cents', greatest(reserved_cents, coalesce(p_stripe_refunded_cents, 0)));
  end if;

  insert into public.payment_refunds (payment_intent_id, amount_cents, currency, reason_code, idempotency_key, requested_by)
  values (p_payment_intent_id, p_amount_cents, lower(p_currency), p_reason_code, p_idempotency_key, p_requested_by)
  returning * into row_out;
  return jsonb_build_object('outcome', 'reserved', 'refund', to_jsonb(row_out));
end;
$$;

-- Record Stripe's answer. Only moves forward: pending -> submitted/succeeded/
-- failed, submitted -> succeeded/failed. A final row never changes.
create or replace function public.record_payment_refund_result(
  p_id uuid,
  p_status text,
  p_stripe_refund_id text,
  p_error_code text
) returns public.payment_refunds
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  row_out public.payment_refunds;
begin
  update public.payment_refunds
     set status = p_status,
         stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
         error_code = p_error_code,
         updated_at = now()
   where id = p_id
     and (status = 'pending' or (status = 'submitted' and p_status in ('succeeded', 'failed', 'submitted')))
  returning * into row_out;
  if not found then
    select * into row_out from public.payment_refunds where id = p_id;
  end if;
  return row_out;
end;
$$;

revoke all on function public.reserve_payment_refund(text, integer, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_payment_refund_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_payment_refund(text, integer, text, text, text, text, integer, integer) to service_role;
grant execute on function public.record_payment_refund_result(uuid, text, text, text) to service_role;
