-- Phone index for the HTAF review assistant's duplicate check, with a
-- recorded outcome.
--
-- The duplicate check runs:
--   select ... from htaf_applications
--   where phone in ('<10 digits>', '1<10 digits>', '+1<10 digits>') and id <> $1
--   order by submitted_at limit 5
-- It compares the stored column directly, so a plain btree on (phone) is
-- the matching index. No expression index is needed.
--
-- LIVE DATABASES: build the index first, outside any transaction, so
-- writes are never blocked:
--   set lock_timeout = '5s';
--   create index concurrently if not exists htaf_applications_phone_idx
--     on public.htaf_applications (phone);
-- then apply this migration. It finds the valid index and records
-- 'already_present'. CREATE INDEX CONCURRENTLY cannot run inside this
-- file, because migration runners wrap each file in a transaction.
--
-- Outcomes, recorded in public.schema_change_outcomes:
--   created              -- this migration built the index (plain CREATE
--                           INDEX; meant for fresh or empty databases)
--   already_present      -- a valid index already existed (the concurrent
--                           pre-build above)
--   skipped_table_absent -- htaf_applications does not exist here; nothing
--                           was created
-- An index left INVALID by a failed concurrent build stops the migration
-- with an error instead of being recorded as success.

create table if not exists public.schema_change_outcomes (
  id bigint generated always as identity primary key,
  migration text not null,
  object_name text not null,
  outcome text not null check (outcome in ('created', 'already_present', 'skipped_table_absent')),
  detail text,
  recorded_at timestamptz not null default now()
);
alter table public.schema_change_outcomes enable row level security;
revoke all on public.schema_change_outcomes from anon, authenticated;

do $$
declare
  m constant text := '20261014030000_htaf_applications_phone_idx';
  idx constant text := 'public.htaf_applications_phone_idx';
  valid boolean;
begin
  if to_regclass('public.htaf_applications') is null then
    insert into public.schema_change_outcomes (migration, object_name, outcome, detail)
      values (m, idx, 'skipped_table_absent', 'public.htaf_applications does not exist; no index created');
    raise notice '%: SKIPPED, table absent', idx;
    return;
  end if;

  select i.indisvalid into valid from pg_index i where i.indexrelid = to_regclass(idx);
  if valid is false then
    raise exception '% exists but is INVALID (failed concurrent build). Drop it with DROP INDEX CONCURRENTLY and rebuild before applying this migration.', idx;
  end if;

  if valid is true then
    insert into public.schema_change_outcomes (migration, object_name, outcome, detail)
      values (m, idx, 'already_present', 'valid index found (built beforehand, e.g. CREATE INDEX CONCURRENTLY)');
    raise notice '%: already present and valid', idx;
    return;
  end if;

  execute 'create index htaf_applications_phone_idx on public.htaf_applications (phone)';
  insert into public.schema_change_outcomes (migration, object_name, outcome, detail)
    values (m, idx, 'created', 'created by this migration (non-concurrent)');
  raise notice '%: CREATED', idx;
end
$$;
