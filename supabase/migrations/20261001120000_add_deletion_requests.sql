-- deletion_requests: the account-deletion record that server.js already
-- reads and writes (rider self-service deletion, driver deletion
-- requests, the admin approve/reject queue) but that was never created
-- in production. Without it, a driver deletion request fails and rider
-- deletions leave no record.
--
-- Columns mirror exactly what server.js uses. user_id is not a foreign
-- key because it points at riders or drivers depending on user_type,
-- and the account rows are anonymized, never deleted, so the id stays
-- valid.
--
-- status:
--   pending           driver request awaiting admin review
--   completed         deletion carried out (rider self-service, or admin approval)
--   rejected          admin rejected the request; access restored
--   review_simulated  designated App Review account: request recorded and
--                     confirmed, account intentionally preserved

create table if not exists public.deletion_requests (
  request_id text primary key,
  user_type text not null check (user_type in ('rider', 'driver')),
  user_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'rejected', 'review_simulated')),
  reason text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  reviewed_by text,
  admin_notes text,
  created_at timestamptz not null default now()
);

-- Admin queue: GET /api/admin/deletion-requests filters by status and
-- pages by (requested_at, request_id) descending.
create index if not exists deletion_requests_status_requested_idx
  on public.deletion_requests (status, requested_at desc, request_id desc);

create index if not exists deletion_requests_user_idx
  on public.deletion_requests (user_type, user_id);

-- At most one open request per account.
create unique index if not exists deletion_requests_one_pending_per_user
  on public.deletion_requests (user_type, user_id)
  where status = 'pending';

-- Server-only table: the backend uses the service role, which bypasses
-- RLS. No policies, so the anon/authenticated keys can read or write
-- nothing.
alter table public.deletion_requests enable row level security;
