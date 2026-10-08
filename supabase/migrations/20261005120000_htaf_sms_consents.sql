-- HTAF text-message consent records (lib/htafSms.js).
--
-- One row per consent event for a phone number: the choice made on the
-- HTAF application form (opt_in or declined, with the wording version and
-- source), and reply keywords received on HTAF's number (opt_out,
-- opt_in_again, help). Append-only. HTAF may text a number only when its
-- latest opt_in / opt_in_again / opt_out row is an opt-in.
--
-- Additive: a new table only. htaf_applications is unchanged, and an
-- application is saved whether or not this table accepts a row.
-- HTAF only: Harvey Taxi Service LLC messaging never reads or writes it.

create table if not exists public.htaf_sms_consents (
  id bigint generated always as identity primary key,
  phone text not null check (phone ~ '^\+1[0-9]{10}$'),
  application_id text,
  event text not null check (event in ('opt_in', 'declined', 'opt_out', 'opt_in_again', 'help')),
  consent_version text,
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists htaf_sms_consents_phone_idx on public.htaf_sms_consents (phone, created_at);
create index if not exists htaf_sms_consents_application_idx on public.htaf_sms_consents (application_id);

-- Server-only, like the other HTAF records.
alter table public.htaf_sms_consents enable row level security;
revoke all on table public.htaf_sms_consents from anon, authenticated;
