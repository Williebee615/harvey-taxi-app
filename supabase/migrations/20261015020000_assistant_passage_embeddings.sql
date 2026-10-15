-- Vector store for the assistant pilot (owner decision 2026-10-15: own
-- model, no AI vendor; vector search and RAG first). Embeddings are made by
-- the membrane, Harvey Taxi's own model service, from APPROVED PUBLIC
-- passages only. Embeddings are derived from the documents and can leak
-- their content, so they are protected like the text: organization-scoped,
-- server-only.
--
-- pgvector is offered by Supabase (0.8.0 on this project, not installed
-- before this migration). Installed in the extensions schema, as Supabase
-- recommends.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.assistant_passage_embeddings (
  org text not null check (org in ('harvey_taxi', 'htaf')),
  passage_id text not null,
  -- The passage version (content hash) the vector was made from; retrieval
  -- ignores a vector whose version no longer matches the live passage.
  version text not null,
  source_id text not null,
  embedding_model text not null,
  embedding extensions.vector(384) not null,
  updated_at timestamptz not null default now(),
  primary key (org, embedding_model, passage_id),
  -- A passage id always starts with its own organization.
  check (passage_id like org || ':%')
);

create index if not exists assistant_passage_embeddings_hnsw
  on public.assistant_passage_embeddings using hnsw (embedding extensions.vector_cosine_ops);

alter table public.assistant_passage_embeddings enable row level security;
revoke all on public.assistant_passage_embeddings from anon, authenticated;

-- Nearest passages for ONE organization and model, by cosine similarity.
create or replace function public.match_assistant_passages(
  p_org text,
  p_model text,
  p_query extensions.vector(384),
  p_limit integer default 6
) returns table (passage_id text, version text, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select e.passage_id, e.version, 1 - (e.embedding <=> p_query) as similarity
    from public.assistant_passage_embeddings e
   where e.org = p_org and e.embedding_model = p_model
   order by e.embedding <=> p_query
   limit least(greatest(coalesce(p_limit, 6), 1), 20);
$$;

revoke all on function public.match_assistant_passages(text, text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.match_assistant_passages(text, text, extensions.vector, integer) to service_role;
