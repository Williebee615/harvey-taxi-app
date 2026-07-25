-- Autonomous Pilot V1 — schema fixes from PR #36 review.
--
-- The three tables from the foundation migration
-- (autonomous_pilot_zones, autonomous_pilot_events,
-- autonomous_provider_reservations) were created without row-level
-- security. Every other table server.js talks to (rides, system_flags,
-- driver_offers, push_subscriptions, audit_logs) has RLS enabled with
-- no explicit policies — the service_role key server.js exclusively
-- uses bypasses RLS by default, so "RLS on, zero policies" is this
-- codebase's established way of saying "service-role-only, no direct
-- anon/authenticated access." These three tables were an oversight,
-- not a deliberate exception; this brings them in line. It also
-- fixes the identical oversight on saved_places (added in an earlier,
-- already-merged PR) while it's fresh.
--
-- Idempotent: safe to re-run against an environment where this has
-- already been applied.

alter table public.autonomous_pilot_zones enable row level security;
alter table public.autonomous_pilot_events enable row level security;
alter table public.autonomous_provider_reservations enable row level security;
alter table public.saved_places enable row level security;

-- rides.pilot_zone_id was a plain text column with a comment claiming
-- it "references" autonomous_pilot_zones.id, but nothing enforced
-- that — a typo'd or deleted zone ID could sit there indefinitely.
-- ON DELETE SET NULL rather than RESTRICT: a zone being deactivated
-- (active=false) is the normal way to retire it; if a zone row is ever
-- actually deleted, the historical ride shouldn't become undeletable
-- or throw — it just loses its zone reference, same as it would if
-- the FK didn't exist and the zone were manually cleared.
alter table public.rides
  add constraint rides_pilot_zone_id_fkey
  foreign key (pilot_zone_id)
  references public.autonomous_pilot_zones(id)
  on delete set null;

-- Malformed zone geometry (e.g. a lat typo'd into the lng column, or a
-- zero/negative radius) would previously insert without complaint and
-- silently make isWithinPilotZone() reject every point forever.
alter table public.autonomous_pilot_zones
  add constraint autonomous_pilot_zones_center_lat_check
  check (center_lat >= -90 and center_lat <= 90),
  add constraint autonomous_pilot_zones_center_lng_check
  check (center_lng >= -180 and center_lng <= 180),
  add constraint autonomous_pilot_zones_radius_miles_check
  check (radius_miles > 0);

-- Documents the decision the review asked for: the unique ride_id
-- constraint means this table holds exactly one MUTABLE reservation
-- record per ride, not a history of every attempt. Any future
-- provider-adapter retry logic must UPDATE the existing row for that
-- ride_id (matching on ride_id, not inserting) — the unique
-- constraint will reject a second insert outright, by design.
-- Historical retry attempts, if ever needed, belong in
-- autonomous_pilot_events (already append-only), not here.
comment on table public.autonomous_provider_reservations is
  'One MUTABLE row per ride ever reserved through a pilot provider adapter — the unique ride_id constraint enforces this is a current-state record, not a retry history. A reservation retry must UPDATE the existing row for that ride_id; historical attempts belong in autonomous_pilot_events instead. The unique ride_id constraint is what actually prevents duplicate reservations at the database level, not just application logic.';
