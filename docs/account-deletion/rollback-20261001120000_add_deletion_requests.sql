-- Rollback for supabase/migrations/20261001120000_add_deletion_requests.sql.
--
-- WARNING: dropping the table discards every deletion record. Export it
-- first if any rows exist:
--   select * from public.deletion_requests order by requested_at;
-- Rolling back the table without also reverting the server code returns
-- production to today's state: driver deletion requests fail and rider
-- deletions are not recorded.

begin;
drop index if exists public.deletion_requests_one_pending_per_user;
drop index if exists public.deletion_requests_user_idx;
drop index if exists public.deletion_requests_status_requested_idx;
drop table if exists public.deletion_requests;
commit;
