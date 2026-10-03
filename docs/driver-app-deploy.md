# Production deployment and rollback: PR #167 (backend)

Covers the server and database changes in PR #167: the driver-app routes,
the push-token table, ride tracking access, driver deletion and the
privacy-policy page. The driver app itself ships through the stores
(`driver-app/RELEASE.md`). **Every production step here needs your
approval first.**

## What changes in production

| Change | Risk | Reversible by |
|---|---|---|
| New table `driver_push_tokens` (migration `20261004120000`) | None to existing data | Dropping the table |
| New routes: `/api/driver/session/phone/*`, `/state`, `/stream`, `/push-token`, `/trips`, `/earnings-ledger` | Additive; no existing caller | Redeploying the previous version |
| `/api/driver/location` accepts updates while the driver is online with no trip | Dispatch starts matching idle drivers by their real position | Redeploy |
| **Ride status and live stream need the rider's tracking token, an owning rider session, the assigned driver, or an admin** | A rider whose page was loaded **before** the deploy has no token, so their in-progress ride shows a tracking error until they request again. Their ride itself is unaffected. | Redeploy |
| Driver deletion also clears location, photo, addresses, license/plate numbers and push tokens | Applies only to deletions approved after deploy | Not reversible for deleted accounts (intended) |
| Privacy policy page updated | Public legal text | Redeploy |
| Native driver push | Off until `driver_native_push_enabled` = `"true"` | Set the flag to `"false"` |

## Staging validation (done 2026-10-03)

The migration was applied to the staging project `harvey-taxi-staging-pr130`
(`yryfdobxhvklanmbotfu`) and checked in rolled-back transactions:

- RLS on, no policies; `anon` and `authenticated` get permission errors; `service_role` can write.
- The token-format and platform checks reject bad values; the upsert on token moves a token to the newly signed-in driver.
- The online-idle location write (`current_lat`, `current_lng`, `last_location_at`) moves `geog` through the staging `trg_drivers_sync_geog` trigger, the column dispatch reads.
- Staging already has `accept_driver_offer_atomic`, the geog trigger and the driver columns the new routes read.

**Not done on staging:** running the application server against staging.
There is no staging service-role key or staging Render service available to
this work. The server code is covered by the test suite instead (real routes,
in-memory database), and the SQL by the Postgres test suite.

## Deployment order (each step with approval)

1. **Pick a quiet window.** Check that no ride is in progress:
   ```sql
   select count(*) from public.rides
    where status in ('payment_authorized','awaiting_driver_acceptance','driver_assigned','driver_enroute','arrived','in_progress');
   ```
   Deploy when it is 0, so no rider loses live tracking mid-trip.
2. **Tracking secret.** Confirm `RIDE_QUOTE_SECRET` is set on the production
   service (ride quotes already need it). The tracking token is derived from
   it unless `RIDE_TRACKING_SECRET` is set. If you want a separate
   `RIDE_TRACKING_SECRET`, set it **before** this deploy. Changing it later
   cuts off tracking for rides already in progress.
3. **Migration** (production Supabase `orgahzncmzptljapqffj`): apply
   `supabase/migrations/20261004120000_add_driver_push_tokens.sql`. Verify:
   ```sql
   select relrowsecurity from pg_class where oid = 'public.driver_push_tokens'::regclass;  -- true
   select has_table_privilege('anon', 'public.driver_push_tokens', 'select');           -- false
   ```
4. **Deploy the server** (merge PR #167 to `main`, then the normal Render deploy).
5. **Smoke checks**, from any machine:
   - `curl -s -o /dev/null -w "%{http_code}" https://harveytaxiservice.com/api/rides/<a real ride id>/status` returns **404**.
   - `curl -s -o /dev/null -w "%{http_code}" https://harveytaxiservice.com/api/driver/state` returns **401**.
   - Test rider on the website: request a ride (test account, simulated payment), then confirm live tracking shows the ride.
   - Test driver: `POST /api/review/driver/login`, then `GET /api/driver/state` with the token returns **200**.
   - `https://harveytaxiservice.com/privacy-policy.html` shows the new sections and no template text.
6. **Leave `driver_native_push_enabled` off** until push is verified on
   devices (internal-testing builds), then set it with approval:
   ```sql
   insert into public.system_flags (key, value) values ('driver_native_push_enabled', 'true')
   on conflict (key) do update set value = excluded.value;
   ```

## Rollback

| Problem | Action |
|---|---|
| Push misbehaves | `update public.system_flags set value = 'false' where key = 'driver_native_push_enabled';` |
| Rider live tracking broken | Redeploy the previous Render deploy. Tracking opens up again; nothing to undo in the database. |
| Any new driver route misbehaves | Redeploy the previous version. The web dashboard doesn't use the new routes. |
| Remove the push-token table | `drop table if exists public.driver_push_tokens;` (tokens only; redeploy the previous version first) |

Driver deletions approved after the deploy can't be undone; that's the intended behaviour.
