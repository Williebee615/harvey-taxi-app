-- Live map tracking (docs/live-map-tracking.md, lib/liveLocation.js).
--
-- A rider may share their phone's position with the assigned driver,
-- only until pickup. One current position per ride, no history:
--   rider_live_lat / rider_live_lng  last position the rider's page sent
--   rider_live_accuracy_m            reported accuracy, metres
--   rider_live_at                    when it was received
--
-- The server shows it to the assigned driver only while the ride is
-- driver_assigned, driver_enroute or arrived, and only if under two
-- minutes old. A sweep sets all four back to null once the ride leaves
-- that window or after ten minutes without an update, and the rider can
-- clear it at any time (DELETE /api/rides/:id/rider-location).
--
-- Additive and nullable: existing rows and code are unaffected.

alter table public.rides
  add column if not exists rider_live_lat double precision,
  add column if not exists rider_live_lng double precision,
  add column if not exists rider_live_accuracy_m integer,
  add column if not exists rider_live_at timestamptz;

-- The purge sweep only looks at rows holding a position.
create index if not exists rides_rider_live_at_idx
  on public.rides (rider_live_at)
  where rider_live_at is not null;
