-- Ride-creation idempotency. POST /api/rides/request had no protection
-- against a replayed signed quote token: the token is valid for its
-- whole TTL (default 15 minutes), and nothing stopped the same token
-- (from a network retry, a double-tapped "Request Ride" button, or a
-- deliberate replay) from creating a second, duplicate rides row.
--
-- lib/rideQuote.js now embeds a cryptographically random `jti` in the
-- signed quote payload at issuance. This index is the database-level
-- backstop that turns a second ride-creation attempt presenting the same
-- still-valid token into a unique-violation server.js can catch and
-- resolve as an idempotent replay (returning the original ride) rather
-- than creating a duplicate. See resolveRideQuote()'s consumption
-- contract in lib/rideQuote.js and the corresponding server.js route
-- change for the ownership check performed before an existing ride is
-- ever returned to a replay.
--
-- Partial (WHERE quote_jti IS NOT NULL): rides created outside the
-- normal quoted-rider flow -- the HTAF admin ride-creation path
-- (create_htaf_ride_atomic) chief among them -- have no quote_jti at all
-- and must not collide with each other or with quoted rides.
--
-- Pre-migration production check (2026-09-27, read-only): rides table is
-- currently empty (see the driver_earnings migration in this same
-- batch), so there is nothing for this index to conflict with today.

create unique index if not exists rides_quote_jti_unique
  on public.rides (quote_jti)
  where quote_jti is not null;
