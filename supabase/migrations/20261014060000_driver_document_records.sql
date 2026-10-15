-- Driver document expiration dates, with where each date came from and
-- whether it was verified (owner decision 2026-10-14: separate PR,
-- preserve source and verification status).
--
-- Append-only history: a new record for the same driver and document
-- supersedes the previous one (superseded_at / superseded_by) instead of
-- overwriting it. Nothing here deletes records; automatic deletion waits
-- for the retention policy (docs/data-retention-policy.md, draft).
-- Server-only: RLS on, no policies, no anon/authenticated access.

create table if not exists public.driver_document_records (
  id bigint generated always as identity primary key,
  driver_id text not null references public.drivers(id) on delete restrict,
  document_type text not null check (document_type in ('drivers_license', 'insurance', 'vehicle_registration')),
  expires_on date not null,
  -- Where the date came from:
  --   driver_entered      typed by the driver; nobody has looked at a document
  --   staff_from_document entered by staff while looking at the document
  --   provider            reported by a verification provider integration
  source text not null check (source in ('driver_entered', 'staff_from_document', 'provider')),
  -- Whether the date has been checked against the document:
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'staff_verified', 'provider_verified')),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  verified_by text,
  verified_at timestamptz,
  superseded_at timestamptz,
  superseded_by text,
  -- A staff verification names who verified it and when.
  check (verification_status <> 'staff_verified' or (verified_by is not null and verified_at is not null)),
  -- Only a provider can report a provider verification.
  check (verification_status <> 'provider_verified' or source = 'provider'),
  -- A driver-entered date is never "verified" without a separate staff check.
  check (source <> 'driver_entered' or verification_status <> 'provider_verified'),
  check (superseded_at is null or superseded_by is not null)
);

-- One current record per driver and document type.
create unique index if not exists driver_document_records_current_uniq
  on public.driver_document_records (driver_id, document_type) where superseded_at is null;

alter table public.driver_document_records enable row level security;
revoke all on public.driver_document_records from anon, authenticated;
