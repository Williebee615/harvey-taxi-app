-- Recoverable completion and cancellation workflows need durable,
-- independently-resumable state for the payment side of each -- "the
-- ride's status says completed/cancelled" is not proof that the Stripe
-- side finished, so that fact has to live somewhere a retry can inspect
-- it after a crash at any point in the sequence. See lib/
-- ridePaymentCapture.js and lib/rideCancellation.js for the decision
-- logic these columns back.
--
-- rides.payment_status already exists (text, nullable, no default) --
-- reused and now standardized with a CHECK constraint rather than adding
-- a parallel column. The allowed list is exactly the set of values the
-- application writes today (inventory re-checked 2026-09-28 against
-- main, #131 and this branch):
--
--   NULL             no payment state recorded yet (new ride; the
--                    capture decision treats it as a first attempt)
--   pending          lib/ridePaymentCapture.js CAPTURE_STATUS.PENDING:
--                    defined initial state, treated like NULL
--   authorized       Stripe webhook payment_intent.amount_capturable_updated:
--                    funds held on the manual-capture PaymentIntent, not
--                    yet captured
--   capture_pending  written by /complete just before calling Stripe
--                    capture (crash-recovery marker)
--   captured         /complete's own Stripe capture call succeeded
--   succeeded        Stripe webhook payment_intent.succeeded: Stripe
--                    confirms the funds were collected (after a manual
--                    capture, or directly under automatic capture)
--   capture_failed   /complete's capture call failed; admin
--                    reconciliation queue
--   not_required     nothing to capture (no payment_id / payment gate off)
--   failed           Stripe webhook payment_intent.payment_failed /
--                    payment_intent.canceled
--
-- 'authorized', 'succeeded' and 'failed' are written by the currently
-- deployed server's webhook handler, so they must stay valid for as long
-- as that server (or any later one) runs. Existing values are neither
-- mapped nor rewritten; any other string is rejected.
--
-- Pre-migration production check (2026-09-27, re-checked 2026-09-28,
-- read-only): the rides table is empty, no database function or trigger
-- writes payment_status, and no constraint with this name or an
-- equivalent definition exists, so there is no existing value this CHECK
-- constraint could reject today.
--
-- Single-application: like the other versioned migrations, this file is
-- applied once by the migration runner. Re-running it raises "already
-- exists" for the two ADD CONSTRAINT statements rather than skipping.

alter table public.rides
  add constraint rides_payment_status_check
  check (
    payment_status is null or payment_status in (
      'pending',
      'authorized',
      'capture_pending',
      'captured',
      'succeeded',
      'capture_failed',
      'not_required',
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
