-- HTAF test records (owner decision 2026-10-23): applications the owner
-- submitted to test the form are marked as tests, with who and when, and
-- left out of counts, public statistics and exports. Nothing is deleted.
-- Skipped where htaf_applications doesn't exist (the test baseline).

do $$
begin
  if to_regclass('public.htaf_applications') is not null then
    alter table public.htaf_applications
      add column if not exists is_test boolean not null default false,
      add column if not exists test_marked_by text,
      add column if not exists test_marked_at timestamptz;
    if not exists (select 1 from pg_constraint where conname = 'htaf_applications_test_marker_check') then
      alter table public.htaf_applications
        add constraint htaf_applications_test_marker_check
        check (not is_test or (test_marked_by is not null and test_marked_at is not null));
    end if;
  end if;
end
$$;
