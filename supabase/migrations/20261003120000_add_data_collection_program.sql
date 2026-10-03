-- Optional Data Collection program (docs/data-collection-program.md).
--
-- Harvey Taxi Service LLC manages the program; participating drivers,
-- separately approved for it, perform eligible non-driving tasks and
-- record them in the Minute app. Recording and uploading stay in Minute:
-- nothing here stores a Minute password or a raw recording. The Minute
-- organization code is not stored here either (server environment only).
--
-- Program earnings live in their own tables and never touch
-- driver_earnings (ride earnings). Nothing here sends a payment or
-- deducts equipment costs.
--
-- Access: every table is server-only. The backend uses the service role,
-- which bypasses RLS; anon and authenticated get no table privileges and
-- no policies. Drivers authenticate through server-signed session tokens,
-- not Supabase JWTs, so a JWT-keyed "own rows" policy would never match a
-- real driver; the server enforces ownership (driver_id always comes from
-- the authenticated session) and this denies every direct client path.
--
-- driver_id is not a foreign key, matching deletion_requests: driver
-- rows are anonymized, never deleted, so the id stays valid, and the
-- server only ever writes the authenticated driver's own id.
--
-- Status: NOT applied to any environment. Enrollment and collection stay
-- off (system_flags rows absent = false) until the contributor model,
-- contract and insurance questions are resolved.

/* ---------------------------------------------------------------
   Applications: program approval, separate from driver approval
--------------------------------------------------------------- */

create table if not exists public.data_collection_applications (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'suspended', 'withdrawn')),
  phone_model text not null check (length(phone_model) between 1 and 80),
  -- U.S. only for the initial rollout.
  country text not null check (country = 'US'),
  proposed_location text not null check (length(proposed_location) between 1 and 300),
  location_state text not null check (location_state ~ '^[A-Z]{2}$'),
  proposed_tasks jsonb not null check (jsonb_typeof(proposed_tasks) = 'array' and jsonb_array_length(proposed_tasks) between 1 and 5),
  ineligible_tasks_acknowledged boolean not null check (ineligible_tasks_acknowledged),
  -- Keyword hints for the reviewer (driving / seated / repetitive).
  task_review_flags jsonb not null default '[]'::jsonb,
  -- Linked by an admin once the participant has joined Minute; used to
  -- match imported sessions to this driver.
  minute_contributor_id text,
  status_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open application per driver (submitted, approved or suspended).
create unique index if not exists data_collection_applications_one_active_per_driver
  on public.data_collection_applications (driver_id)
  where status in ('submitted', 'approved', 'suspended');

-- A Minute contributor id belongs to one application at most.
create unique index if not exists data_collection_applications_contributor_unique
  on public.data_collection_applications (lower(minute_contributor_id))
  where minute_contributor_id is not null;

create index if not exists data_collection_applications_status_idx
  on public.data_collection_applications (status, submitted_at desc);

/* ---------------------------------------------------------------
   Agreements and consents (append-only history; latest row per type wins)
--------------------------------------------------------------- */

create table if not exists public.data_collection_agreements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.data_collection_applications (id) on delete restrict,
  driver_id text not null,
  agreement_type text not null check (agreement_type in ('contributor_agreement', 'recording_consent')),
  status text not null check (status in ('pending', 'signed', 'revoked')),
  document_version text,
  signed_at timestamptz,
  recorded_by text not null,
  notes text,
  recorded_at timestamptz not null default now(),
  check (status <> 'signed' or (signed_at is not null and document_version is not null))
);

create index if not exists data_collection_agreements_application_idx
  on public.data_collection_agreements (application_id, agreement_type, recorded_at desc);

/* ---------------------------------------------------------------
   Equipment assignments (no cost columns: costs are never deducted here)
--------------------------------------------------------------- */

create table if not exists public.data_collection_equipment (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.data_collection_applications (id) on delete restrict,
  driver_id text not null,
  item text not null check (length(item) between 1 and 120),
  asset_tag text,
  status text not null default 'assigned' check (status in ('assigned', 'returned', 'lost', 'damaged')),
  notes text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_collection_equipment_application_idx
  on public.data_collection_equipment (application_id);

/* ---------------------------------------------------------------
   Import batches (Minute session-level exports, or manual entries)
--------------------------------------------------------------- */

create table if not exists public.data_collection_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('minute_import', 'manual_entry')),
  filename text,
  -- Not unique: re-importing a file (for example after linking a
  -- contributor) is allowed with an explicit acknowledgement; every
  -- already-stored session in it is still rejected as a duplicate.
  file_sha256 text,
  column_mapping jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  imported_by text not null,
  notes text,
  created_at timestamptz not null default now(),
  check (source <> 'minute_import' or (file_sha256 is not null and filename is not null))
);

create index if not exists data_collection_import_batches_sha_idx
  on public.data_collection_import_batches (file_sha256);

/* ---------------------------------------------------------------
   Hour records: program earnings (separate from ride earnings)
--------------------------------------------------------------- */

create table if not exists public.data_collection_hour_records (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null,
  application_id uuid not null references public.data_collection_applications (id) on delete restrict,
  batch_id uuid not null references public.data_collection_import_batches (id) on delete restrict,
  source text not null check (source in ('minute_import', 'manual_entry')),
  external_session_id text not null check (length(external_session_id) between 1 and 200),
  external_contributor_id text,
  session_date date not null,
  -- Whole seconds, at most 24 hours per session.
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 86400),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'payable', 'paid')),
  -- Rates snapshotted per record, integer cents per accepted hour.
  driver_rate_cents integer not null check (driver_rate_cents > 0),
  company_rate_cents integer not null check (company_rate_cents >= driver_rate_cents),
  -- cents = seconds x rate / 3600, rounded half-up (lib/dataCollection.js
  -- amountCents). The checks below make a mis-computed amount impossible
  -- to store.
  driver_amount_cents integer not null,
  company_amount_cents integer not null,
  margin_cents integer generated always as (company_amount_cents - driver_amount_cents) stored,
  status_reason text,
  payout_reference text,
  paid_at timestamptz,
  created_by text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (driver_amount_cents = ((duration_seconds::bigint * driver_rate_cents + 1800) / 3600)),
  check (company_amount_cents = ((duration_seconds::bigint * company_rate_cents + 1800) / 3600)),
  check (status <> 'paid' or (payout_reference is not null and paid_at is not null)),
  check (status <> 'rejected' or status_reason is not null)
);

-- Duplicate sessions are rejected, whether they arrive by import or by
-- manual entry.
create unique index if not exists data_collection_hour_records_session_unique
  on public.data_collection_hour_records (lower(external_session_id));

create index if not exists data_collection_hour_records_driver_idx
  on public.data_collection_hour_records (driver_id, status);

create index if not exists data_collection_hour_records_status_idx
  on public.data_collection_hour_records (status, session_date desc);

/* ---------------------------------------------------------------
   Import exceptions: unmatched contributors, inactive participants
--------------------------------------------------------------- */

create table if not exists public.data_collection_import_exceptions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.data_collection_import_batches (id) on delete restrict,
  row_number integer,
  reason text not null check (reason in ('unmatched_contributor', 'inactive_participant')),
  external_contributor_id text,
  external_session_id text,
  session_date date,
  duration_seconds integer,
  resolved_at timestamptz,
  resolved_by text,
  resolved_hour_record_id uuid references public.data_collection_hour_records (id),
  created_at timestamptz not null default now()
);

create index if not exists data_collection_import_exceptions_open_idx
  on public.data_collection_import_exceptions (created_at desc)
  where resolved_at is null;

/* ---------------------------------------------------------------
   Audit log (append-only)
--------------------------------------------------------------- */

create table if not exists public.data_collection_audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists data_collection_audit_log_created_idx
  on public.data_collection_audit_log (created_at desc);

create or replace function public.data_collection_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'data_collection_audit_log is append-only';
end;
$$;

drop trigger if exists data_collection_audit_log_no_change on public.data_collection_audit_log;
create trigger data_collection_audit_log_no_change
  before update or delete on public.data_collection_audit_log
  for each row execute function public.data_collection_audit_log_immutable();

drop trigger if exists data_collection_audit_log_no_truncate on public.data_collection_audit_log;
create trigger data_collection_audit_log_no_truncate
  before truncate on public.data_collection_audit_log
  for each statement execute function public.data_collection_audit_log_immutable();

/* ---------------------------------------------------------------
   Atomic writes with their audit entry
--------------------------------------------------------------- */

-- Saves one import (or one manual entry) in a single transaction: the
-- batch, its hour records, its exceptions, and the audit entry. A
-- session that already exists (unique index) aborts the whole call, so
-- a concurrent duplicate can never be half-saved.
create or replace function public.data_collection_commit_hours(
  p_batch jsonb,
  p_records jsonb,
  p_exceptions jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_inserted integer := 0;
  v_exceptions integer := 0;
begin
  if coalesce(p_actor, '') = '' then
    raise exception 'actor is required';
  end if;

  insert into data_collection_import_batches
    (source, filename, file_sha256, column_mapping, row_count, inserted_count,
     duplicate_count, exception_count, imported_by, notes)
  values (
    p_batch->>'source',
    p_batch->>'filename',
    p_batch->>'file_sha256',
    p_batch->'column_mapping',
    coalesce((p_batch->>'row_count')::integer, 0),
    jsonb_array_length(coalesce(p_records, '[]'::jsonb)),
    coalesce((p_batch->>'duplicate_count')::integer, 0),
    jsonb_array_length(coalesce(p_exceptions, '[]'::jsonb)),
    p_actor,
    p_batch->>'notes'
  )
  returning id into v_batch_id;

  insert into data_collection_hour_records
    (driver_id, application_id, batch_id, source, external_session_id, external_contributor_id,
     session_date, duration_seconds, status, driver_rate_cents, company_rate_cents,
     driver_amount_cents, company_amount_cents, created_by, notes)
  select r.driver_id, r.application_id, v_batch_id, p_batch->>'source', r.external_session_id,
         r.external_contributor_id, r.session_date, r.duration_seconds, 'pending',
         r.driver_rate_cents, r.company_rate_cents, r.driver_amount_cents, r.company_amount_cents,
         p_actor, r.notes
    from jsonb_to_recordset(coalesce(p_records, '[]'::jsonb)) as r(
      driver_id text, application_id uuid, external_session_id text, external_contributor_id text,
      session_date date, duration_seconds integer, driver_rate_cents integer, company_rate_cents integer,
      driver_amount_cents integer, company_amount_cents integer, notes text);
  get diagnostics v_inserted = row_count;

  insert into data_collection_import_exceptions
    (batch_id, row_number, reason, external_contributor_id, external_session_id, session_date, duration_seconds)
  select v_batch_id, e.row_number, e.reason, e.external_contributor_id, e.external_session_id,
         e.session_date, e.duration_seconds
    from jsonb_to_recordset(coalesce(p_exceptions, '[]'::jsonb)) as e(
      row_number integer, reason text, external_contributor_id text, external_session_id text,
      session_date date, duration_seconds integer);
  get diagnostics v_exceptions = row_count;

  -- Earlier exceptions for sessions saved now are resolved by this batch.
  update data_collection_import_exceptions x
     set resolved_at = now(), resolved_by = p_actor, resolved_hour_record_id = h.id
    from data_collection_hour_records h
   where h.batch_id = v_batch_id
     and x.resolved_at is null
     and x.batch_id <> v_batch_id
     and lower(x.external_session_id) = lower(h.external_session_id);

  insert into data_collection_audit_log (actor, action, entity_type, entity_id, details)
  values (
    p_actor,
    case when p_batch->>'source' = 'manual_entry' then 'hours.manual_entry' else 'hours.import_committed' end,
    'import_batch',
    v_batch_id::text,
    coalesce(p_batch->'audit', '{}'::jsonb)
      || jsonb_build_object('inserted', v_inserted, 'exceptions', v_exceptions)
  );

  return jsonb_build_object('batch_id', v_batch_id, 'inserted', v_inserted, 'exceptions', v_exceptions);
end;
$$;

-- Moves hour records from one status to another, all or nothing, with
-- the audit entry in the same transaction. Every id must currently be in
-- p_from; otherwise nothing changes (a concurrent edit is reported, not
-- overwritten).
create or replace function public.data_collection_set_hour_status(
  p_ids uuid[],
  p_from text,
  p_to text,
  p_actor text,
  p_reason text default null,
  p_payout_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_matched integer;
  v_updated integer;
begin
  if coalesce(p_actor, '') = '' then
    raise exception 'actor is required';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'no records given';
  end if;
  if not (
       (p_from = 'pending'  and p_to in ('accepted', 'rejected'))
    or (p_from = 'accepted' and p_to in ('payable', 'rejected'))
    or (p_from = 'payable'  and p_to in ('paid', 'accepted'))
    or (p_from = 'rejected' and p_to = 'pending')
  ) then
    raise exception 'invalid hour status transition % -> %', p_from, p_to;
  end if;

  perform 1
     from data_collection_hour_records
    where id = any (p_ids)
      for update;

  select count(*) into v_matched
    from data_collection_hour_records
   where id = any (p_ids) and status = p_from;

  if v_matched <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'stale_status: some records are no longer %', p_from
      using errcode = 'P0001';
  end if;

  update data_collection_hour_records
     set status = p_to,
         status_reason = case when p_to = 'rejected' then p_reason else status_reason end,
         payout_reference = case when p_to = 'paid' then p_payout_reference else payout_reference end,
         paid_at = case when p_to = 'paid' then now() else paid_at end,
         updated_at = now()
   where id = any (p_ids) and status = p_from;
  get diagnostics v_updated = row_count;

  insert into data_collection_audit_log (actor, action, entity_type, entity_id, details)
  values (
    p_actor,
    'hours.status_changed',
    'hour_records',
    null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'from', p_from, 'to', p_to,
                       'reason', p_reason, 'payout_reference', p_payout_reference, 'updated', v_updated)
  );

  return jsonb_build_object('updated', v_updated);
end;
$$;

/* ---------------------------------------------------------------
   Lock down: server (service role) only
--------------------------------------------------------------- */

alter table public.data_collection_applications enable row level security;
alter table public.data_collection_agreements enable row level security;
alter table public.data_collection_equipment enable row level security;
alter table public.data_collection_import_batches enable row level security;
alter table public.data_collection_hour_records enable row level security;
alter table public.data_collection_import_exceptions enable row level security;
alter table public.data_collection_audit_log enable row level security;

revoke all on table
  public.data_collection_applications,
  public.data_collection_agreements,
  public.data_collection_equipment,
  public.data_collection_import_batches,
  public.data_collection_hour_records,
  public.data_collection_import_exceptions,
  public.data_collection_audit_log
from anon, authenticated;

revoke all on function public.data_collection_commit_hours(jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.data_collection_set_hour_status(uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.data_collection_audit_log_immutable() from public, anon, authenticated;
grant execute on function public.data_collection_commit_hours(jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.data_collection_set_hour_status(uuid[], text, text, text, text, text) to service_role;
