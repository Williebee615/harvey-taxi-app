-- HTAF assistant: questions it could not answer from HTAF's published
-- pages (lib/htafAssistant.js), for HTAF staff to add an approved answer.
--
-- Only a short redacted excerpt is kept (emails, phone numbers, card and
-- long numbers, HTAF application codes removed); no visitor identity, IP
-- address or conversation. HTAF only: separate from Harvey Taxi's
-- assistant records. Additive: a new table only.

create table if not exists public.htaf_assistant_questions (
  id bigint generated always as identity primary key,
  question_excerpt text not null check (char_length(question_excerpt) <= 200),
  intent text not null,
  created_at timestamptz not null default now()
);

create index if not exists htaf_assistant_questions_created_idx on public.htaf_assistant_questions (created_at desc);

alter table public.htaf_assistant_questions enable row level security;
revoke all on table public.htaf_assistant_questions from anon, authenticated;
