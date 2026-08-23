-- Google Play reviewer-account support. Adds the minimum schema needed
-- for two dedicated, non-production-identity review accounts (one
-- rider, one driver) that Google's reviewers can sign into repeatedly
-- without OTP access to a real phone/email and without ever touching
-- live Stripe, real dispatch, or real riders/drivers.
--
-- Design constraints this migration exists to support (see
-- docs/security-remediation/ for the equivalent pattern applied to
-- rider auth and driver compliance):
--   * is_review_account is a plain boolean column, NOT NULL DEFAULT
--     false, on both riders and drivers -- server.js resolves review
--     status ONLY from this column on a freshly loaded row, never from
--     anything client-supplied (see lib/reviewAccounts.js).
--   * review_password_hash/review_password_salt store a per-account
--     scrypt hash, never a plaintext password -- these columns are
--     null for every ordinary rider/driver and are only ever populated
--     by a manual, out-of-band admin seeding step (not by this
--     migration, and not through the normal signup routes).
--   * is_review_ride on rides is set once, at ride-creation time, from
--     the resolved rider row's is_review_account column, so every
--     downstream consumer (dispatch isolation, message suppression,
--     analytics exclusion) can filter on a single indexed boolean
--     instead of re-joining back to riders on every read.
--   * review_account_login_enabled is the kill switch. It intentionally
--     defaults to 'false' here (per explicit approval requirement) --
--     the reviewer login routes, and the re-check inside
--     requireRider/requireDriver for already-issued reviewer sessions,
--     both stay closed until an admin deliberately flips it on via the
--     same upsert pattern as rider_auth_enforced
--     (POST /api/admin/system/enable-review-account-login).

alter table public.riders
  add column if not exists is_review_account boolean not null default false;

alter table public.riders
  add column if not exists review_password_hash text;

alter table public.riders
  add column if not exists review_password_salt text;

alter table public.drivers
  add column if not exists is_review_account boolean not null default false;

alter table public.drivers
  add column if not exists review_password_hash text;

alter table public.drivers
  add column if not exists review_password_salt text;

alter table public.rides
  add column if not exists is_review_ride boolean not null default false;

-- Partial indexes: at most one row per table will ever have
-- is_review_account = true, so these are effectively O(1) lookups for
-- the review-login routes and the dispatch-isolation query in
-- dispatchRide(), without adding any cost to the far more common
-- is_review_account = false case.
create index if not exists riders_is_review_account_idx
  on public.riders (is_review_account)
  where is_review_account = true;

create index if not exists drivers_is_review_account_idx
  on public.drivers (is_review_account)
  where is_review_account = true;

create index if not exists rides_is_review_ride_idx
  on public.rides (is_review_ride)
  where is_review_ride = true;

-- Explicit, auditable default-off row for the kill switch (belt and
-- suspenders alongside getSystemFlag()'s own "missing key defaults to
-- false" fallback -- see server.js). Written as an insert-if-absent
-- rather than an ON CONFLICT upsert since no migration in this repo
-- defines system_flags' unique constraint (the table predates the
-- migrations folder) -- this form makes no assumption about one, and
-- is still safe to run even if an admin has already toggled the flag
-- by the time it's applied.
insert into public.system_flags (key, value, updated_at)
select 'review_account_login_enabled', 'false', now()
where not exists (
  select 1 from public.system_flags where key = 'review_account_login_enabled'
);
