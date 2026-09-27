-- Recoverable completion and cancellation workflows need durable,
-- independently-resumable state for the payment side of each -- "the
-- ride's status says completed/cancelled" is not proof that the Stripe
-- side finished, so that fact has to live somewhere a retry can inspect
-- it after a crash at any point in the sequence. See lib/
-- ridePaymentCapture.js and lib/rideCancellation.js for the decision
-- logic these columns back.
--
-- rides.payment_status already exists (text, unconstrained, currently
-- only ever written by the Stripe webhook handler to 'failed') --
-- reused and now standardized with a CHECK constraint rather than adding
-- a parallel column, since nothing else in the codebase depends on its
-- current looseness.
--
-- Pre-migration production check (2026-09-27, read-only): `select
-- payment_status, count(*) from rides group by payment_status` returns
-- zero rows -- the rides table itself is currently empty (the live
-- dispatch pipeline has not yet processed a real ride), so there is no
-- existing value this CHECK constraint could reject today.

alter table public.rides
  add constraint rides_payment_status_check
  check (
    payment_status is null or payment_status in (
      'pending',
      'capture_pending',
      'captured',
      'capture_failed',
      'not_required',
      -- pre-existing value, written by the Stripe webhook on
      -- payment_intent.payment_failed / .canceled -- kept for backward
      -- compatibility with that handler rather than renamed here.
      'failed'
    )
  );

alter table public.rides
  add column if not exists payment_capture_idempotency_key text;

alter table public.rides
  add column if not exists payment_capture_attempted_at timestamptz;

alter table public.rides
  add column if not exists payment_capture_error text;

-- Cancellation-payment reconciliation, deliberately a separate column
-- from payment_status: a ride's *trip* can be cancelled while its
-- *payment capture* was never attempted at all (most cancellations,
-- pre-trip) -- these are independent facts, not one shared enum.
alter table public.rides
  add column if not exists cancellation_payment_status text;

alter table public.rides
  add constraint rides_cancellation_payment_status_check
  check (
    cancellation_payment_status is null or cancellation_payment_status in (
      'not_required',
      'cancel_pending',
      'cancelled',
      'cancel_failed'
    )
  );

alter table public.rides
  add column if not exists cancellation_payment_idempotency_key text;

alter table public.rides
  add column if not exists cancellation_payment_attempted_at timestamptz;

alter table public.rides
  add column if not exists cancellation_payment_error text;

-- Admin-readable failure queues (both capture and cancellation
-- reconciliation) are simple filtered queries against these columns --
-- GET /api/admin/rides?payment_status=capture_failed and
-- ?cancellation_payment_status=cancel_failed -- not a new table. Partial
-- indexes keep those lookups cheap without indexing the common,
-- resolved-state rows.
create index if not exists rides_payment_capture_failed_idx
  on public.rides (updated_at)
  where payment_status = 'capture_failed';

create index if not exists rides_cancellation_payment_failed_idx
  on public.rides (updated_at)
  where cancellation_payment_status = 'cancel_failed';
