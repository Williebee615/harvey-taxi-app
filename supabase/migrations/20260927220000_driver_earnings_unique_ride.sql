-- Closes a real gap: driver_earnings had no uniqueness guarantee on
-- ride_id at all. POST /api/driver/rides/:rideId/complete used to write
-- the ride's status to 'completed' and insert an earnings row as two
-- separate, unguarded steps -- a duplicate/concurrent call (double-tap,
-- client retry after a timeout, or a driver-app bug) could insert a
-- second driver_earnings row for the same ride, double-paying the
-- driver. This constraint is the database-level backstop; the
-- application-level fix (claim ride-completion atomically before doing
-- any side effect, then upsert earnings with ON CONFLICT DO NOTHING) is
-- the primary defense, added alongside this migration in server.js.
--
-- Pre-migration production check (2026-09-27, read-only, via
-- mcp__Supabase__execute_sql):
--   select ride_id, count(*), array_agg(id), array_agg(total_earning)
--   from driver_earnings where ride_id is not null
--   group by ride_id having count(*) > 1;
--   -> zero rows. No existing duplicates -- in fact `select count(*) from
--   driver_earnings` is 0 (and so is `rides` and `driver_offers`): the
--   live dispatch pipeline has not yet processed a real ride, so this
--   migration has no production data to conflict with at all today. It
--   is written to be equally safe later, once that's no longer true.
--
-- Fails safely if this is ever re-run against a database that somehow
-- does have duplicates by the time this applies: ADD CONSTRAINT UNIQUE
-- itself refuses to apply over conflicting data and the migration simply
-- errors out -- nothing is deleted, merged, or rewritten automatically.
-- If that happens, stop and report the conflicting ride_ids/amounts for
-- manual review before retrying this migration.
--
-- A plain UNIQUE constraint (not a partial index) is correct here: under
-- Postgres semantics, NULL is never considered equal to another NULL for
-- uniqueness purposes, so any historical rows with no ride_id link (or
-- future non-ride adjustments) remain unaffected and can't be forced
-- into a false collision with each other.

alter table public.driver_earnings
  add constraint driver_earnings_ride_id_unique
  unique (ride_id);
