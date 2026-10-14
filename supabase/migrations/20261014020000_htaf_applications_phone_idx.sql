-- Index for the HTAF review assistant's duplicate check, which matches
-- other applications by phone (lib/htafReviewAssist.js, server.js
-- findRelatedHtafApplications). Email already has htaf_applications_email_idx.
-- Additive; needs owner approval before it is applied to production.
-- Skips cleanly where htaf_applications doesn't exist (test databases built
-- from the dispatch baseline).

do $$
begin
  if to_regclass('public.htaf_applications') is not null then
    execute 'create index if not exists htaf_applications_phone_idx on public.htaf_applications (phone)';
  end if;
end
$$;
