-- HTAF admin redesign (owner decisions 2026-10-23):
--  1. The assistant's unanswered questions become a triage inbox: each one
--     is open, dismissed, or marked to add to the FAQ, with who and when.
--     The question excerpt stays as stored (already redacted); no contact
--     details are collected or added.
--  2. A partner organization can carry a contact email for the owner's own
--     onboarding messages. The system does not send email to it.

alter table public.htaf_assistant_questions
  add column if not exists status text not null default 'open',
  add column if not exists resolved_by text,
  add column if not exists resolved_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'htaf_assistant_questions_status_check') then
    alter table public.htaf_assistant_questions
      add constraint htaf_assistant_questions_status_check
      check (status in ('open', 'dismissed', 'faq')
        and (status = 'open' or (resolved_by is not null and resolved_at is not null)));
  end if;
end
$$;

create index if not exists htaf_assistant_questions_open_idx
  on public.htaf_assistant_questions (created_at desc) where status = 'open';

alter table public.htaf_partners
  add column if not exists contact_email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'htaf_partners_contact_email_check') then
    alter table public.htaf_partners
      add constraint htaf_partners_contact_email_check
      check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
  end if;
end
$$;
