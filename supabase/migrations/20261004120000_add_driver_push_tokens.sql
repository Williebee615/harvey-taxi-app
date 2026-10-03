-- Native push tokens for the Harvey Taxi Driver app (docs/driver-app.md).
--
-- One row per device token (Expo push token). The server registers a
-- token for the driver in the signed session (POST /api/driver/push-token)
-- and sends through Expo's push service only while
-- system_flags.driver_native_push_enabled is "true" (absent = off).
-- Existing web push (push_subscriptions) is untouched.
--
-- driver_id is not a foreign key, matching deletion_requests: driver rows
-- are anonymized, never deleted. Tokens for a deleted driver are removed
-- by the account-deletion runbook and by Expo's DeviceNotRegistered
-- receipts.
--
-- Server-only, like every recent table: RLS on, no policies, and no
-- anon/authenticated privileges.
--
-- Status: NOT applied to any environment.

create table if not exists public.driver_push_tokens (
  token text primary key
    check (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$'),
  driver_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now()
);

create index if not exists driver_push_tokens_driver_idx
  on public.driver_push_tokens (driver_id);

alter table public.driver_push_tokens enable row level security;

revoke all on table public.driver_push_tokens from anon, authenticated;
