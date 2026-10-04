-- Admin-managed Harvey Taxi knowledge (docs/ai-knowledge.md, phase 2).
--
-- Approved text the assistant may quote, in addition to the published
-- Terms, Privacy Policy and Support pages. Only rows with status
-- 'approved' are used. Editing an approved article puts it back to
-- 'draft' (version + 1) until an admin approves it again, so the
-- assistant never quotes unapproved wording. Retired articles are kept for
-- the record and never used.
--
-- Approved articles are public: they are listed on /policies.html, which
-- is the source link the assistant shows.
--
-- Server-only access, like every recent table: RLS on, no policies, no
-- anon/authenticated privileges. Every change is also written to
-- audit_logs (action "knowledge.*").

create table if not exists public.knowledge_articles (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(title) between 3 and 140),
  body text not null check (length(body) between 20 and 4000),
  audience text[] not null default array['rider', 'driver']::text[]
    check (audience <@ array['rider', 'driver']::text[] and cardinality(audience) >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  version integer not null default 1 check (version >= 1),
  created_by text,
  updated_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create index if not exists knowledge_articles_status_idx
  on public.knowledge_articles (status);

alter table public.knowledge_articles enable row level security;
revoke all on table public.knowledge_articles from anon, authenticated;
