-- Rollback for supabase/migrations/20261003120000_add_data_collection_program.sql.
--
-- DESTRUCTIVE: drops every Data Collection table, including hour records,
-- payout references and the audit log. Export them first if any real
-- program data exists. Requires explicit owner approval; never run as part
-- of a routine deploy. Does not touch drivers, driver_earnings or any
-- other existing table.

begin;

drop function if exists public.data_collection_set_hour_status(uuid[], text, text, text, text, text);
drop function if exists public.data_collection_commit_hours(jsonb, jsonb, jsonb, text);

-- Children before parents (foreign keys).
drop table if exists public.data_collection_import_exceptions;
drop table if exists public.data_collection_hour_records;
drop table if exists public.data_collection_import_batches;
drop table if exists public.data_collection_equipment;
drop table if exists public.data_collection_agreements;
drop table if exists public.data_collection_applications;

-- The append-only triggers block TRUNCATE/DELETE, not DROP TABLE.
drop table if exists public.data_collection_audit_log;
drop function if exists public.data_collection_audit_log_immutable();

-- Program flags, if they were ever created.
do $$
begin
  if to_regclass('public.system_flags') is not null then
    delete from public.system_flags
     where key in (
       'data_collection_program_enabled',
       'data_collection_enrollment_enabled',
       'data_collection_collection_enabled'
     );
  end if;
end
$$;

commit;
