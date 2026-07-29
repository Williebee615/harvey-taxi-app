# Production Verification Package — ETA Persistence & Offer-Expiry Sweep

Status as of this document: **all three flags below are OFF in production**
and none are enabled by this document. This is a reference package for
when enabling each flag is separately authorized — one flag at a time, in
the order recommended in §0, each observed and verified before the next.

Covers:
1. `dispatch_eta_persistence_enabled` (PR #68)
2. `dispatch_route_api_enabled` (PR #68)
3. `offer_expiry_sweep_enabled` (PR #65/#66)

Confirmed live (via Supabase query) immediately after PR #68 merged: no
`system_flags` row exists for any of the three keys, so all three resolve
to `"false"` through `getSystemFlag()`'s fail-safe fallback.

---

## 0. Recommended rollout order, and why

**Enable exactly one flag at a time.** These three flags were deliberately
kept independent (not combined into one switch, not enabled together) so
each behavior change is separately measurable — enabling two at once would
make it impossible to attribute a problem to the right cause.

Recommended order:

1. **`dispatch_eta_persistence_enabled`** first — lowest risk, zero cost,
   zero external dependency (pure Haversine math against columns that
   already exist and are already nullable). This is the flag referred to
   as "the first feature flag" — no further implementation work begins
   until this one is enabled, observed, and verified successfully.
2. **`offer_expiry_sweep_enabled`** next, once (1) is stable — an
   independent dispatch-reliability fix, already covered by 14 tests, with
   its own unrelated failure modes.
3. **`dispatch_route_api_enabled`** last, and only once (1) is already on
   and stable — it requires persistence already enabled, requires
   `GOOGLE_ROUTES_API_KEY` to be configured (currently unset), and requires
   a provider-side billing budget configured in the Google Cloud console
   first. Not close to ready; included here only for completeness.

Nothing in this document authorizes skipping straight to step 2 or 3.

---

## 1. `dispatch_eta_persistence_enabled`

### Enable SQL

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'dispatch_eta_persistence_enabled',
  'true',
  'Enable free Haversine ETA/distance-to-pickup persistence',
  now()
)
on conflict (key) do update
  set value = 'true',
      reason = excluded.reason,
      updated_at = now();
```

### Disable / rollback SQL (instant, no deploy)

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'dispatch_eta_persistence_enabled',
  'false',
  'Rollback: disable ETA persistence',
  now()
)
on conflict (key) do update
  set value = 'false',
      reason = excluded.reason,
      updated_at = now();
```

### Step-by-step rollout checklist

1. Confirm the deploy carrying PR #68 is live and healthy (clean boot log:
   schema checks `ok`, server online, no elevated error rate).
2. Confirm current state — should return zero rows:
   ```sql
   select * from system_flags where key = 'dispatch_eta_persistence_enabled';
   ```
3. Pick a low-traffic window (same pattern as every prior rollout in this
   sequence).
4. Run the enable SQL above.
5. Watch application logs and the verification queries (§1.4/§1.5) for at
   least one full ride lifecycle (offer → assigned → enroute → arrived) —
   don't just check once and walk away.
6. If success metrics (§1.3) hold through the observation window, leave it
   enabled and update `docs/eta-persistence-plan.md` status. If any
   rollback trigger (§1.4) fires, run the disable SQL immediately.

### Success metrics

- `driver_eta_to_pickup_minutes`/`driver_distance_to_pickup_miles` become
  non-null for rides in `driver_assigned`/`driver_enroute`/`arrived`
  shortly after each offer creation or location ping (see §1.5 queries).
- Values are in a sane range for in-city trips (roughly 0–60 minutes,
  0–25 miles given the existing `DRIVER_SEARCH_RADIUS_MILES` default).
- No increase in error rate or p95 latency on `POST /api/driver/location`
  or on ride dispatch, compared to the pre-enable baseline.
- `GET /api/public/mission-control`'s `avg_wait_minutes` stops returning
  `null` and starts reflecting real values (it was silently starved of
  data before this feature — a visible, expected side effect, not a bug).

### Rollback criteria (any one triggers immediate disable)

- A sustained stream (not an isolated one-off) of `⚠️ computeAndPersistEta`
  or `⚠️ persistPickupEtaBestEffort` log lines.
- Any measurable latency increase on `POST /api/driver/location` or
  dispatch after enabling.
- Verification queries (§1.5) show nulls persisting where they shouldn't,
  or clearly garbage values (negative, zero, or absurdly large ETAs).
- Any regression in the accept/decline/dispatch flow unrelated to ETA
  itself (would indicate an unexpected interaction, not covered by tests).

Because the two target columns are nullable with no default and every
write is fire-and-forget with its own independent error handling,
disabling this flag fully reverts behavior instantly with no data cleanup
required.

### Expected log messages

Normal operation is **silent** — no new log lines appear on the happy
path. Only failures log, and only as warnings (never crashes):

| Log line prefix | Meaning | Expected frequency once enabled |
|---|---|---|
| `⚠️ resolveEtaEstimate: usage counter increment failed, falling back to Haversine:` | Only reachable if `dispatch_route_api_enabled` is also on (it isn't here) | Should never appear |
| `⚠️ resolveEtaEstimate: routing API quota reached (...)` | Same — routing-only | Should never appear |
| `⚠️ resolveEtaEstimate: routing API call failed, falling back to Haversine:` | Same — routing-only | Should never appear |
| `⚠️ computeAndPersistEta: estimate failed, nothing persisted:` | The Haversine calculation itself threw (should be effectively impossible — pure math on validated numeric inputs) | Should never appear |
| `⚠️ computeAndPersistEta: persistence write failed:` | The Supabase `UPDATE rides ...` failed | Rare; a sustained stream means a real DB/connectivity problem |
| `⚠️ persistPickupEtaBestEffort unexpected failure:` | A bug in the flag-lookup/wiring layer itself, outside `computeAndPersistEta`'s own guarantees | Should never appear — treat any occurrence as a bug report |

### Sample verification queries — confirming ETA values are being written correctly

```sql
-- 1. Coverage: are active pre-pickup rides actually getting a value?
select
  count(*) filter (where driver_eta_to_pickup_minutes is not null) as with_eta,
  count(*) as total_active_pre_pickup
from rides
where status in ('driver_assigned', 'driver_enroute', 'arrived')
  and updated_at > now() - interval '1 hour';

-- 2. Range sanity check — should be small positive numbers, not nulls,
--    zeros, negatives, or absurd outliers.
select
  min(driver_eta_to_pickup_minutes) as min_eta,
  max(driver_eta_to_pickup_minutes) as max_eta,
  avg(driver_eta_to_pickup_minutes) as avg_eta,
  min(driver_distance_to_pickup_miles) as min_distance,
  max(driver_distance_to_pickup_miles) as max_distance
from rides
where driver_eta_to_pickup_minutes is not null
  and updated_at > now() - interval '1 hour';

-- 3. Spot-check a specific ride end-to-end (replace :ride_id) — confirm
--    the value looks consistent with the driver's actual current
--    location and the ride's pickup coordinates.
select
  r.id, r.status, r.pickup_lat, r.pickup_lng,
  r.driver_eta_to_pickup_minutes, r.driver_distance_to_pickup_miles,
  d.current_lat, d.current_lng, d.last_seen_at
from rides r
join drivers d on d.id = r.driver_id
where r.id = :ride_id;

-- 4. Freshness — values should update on each location ping, not go
--    stale while a ride is actively pre-pickup. Compare a ride's
--    driver_offers/updated_at cadence against how recently the driver
--    has been seen.
select r.id, r.driver_eta_to_pickup_minutes, r.updated_at as ride_row_updated_at,
       d.last_seen_at as driver_last_seen_at
from rides r
join drivers d on d.id = r.driver_id
where r.status in ('driver_assigned', 'driver_enroute', 'arrived')
order by d.last_seen_at desc
limit 20;

-- 5. Confirm the mission-control aggregate is now populated (was always
--    null before this feature — expected to start returning a number).
select
  count(*) as active_rides_with_eta
from rides
where status in ('awaiting_driver_acceptance','driver_assigned','driver_enroute','arrived','in_progress')
  and driver_eta_to_pickup_minutes is not null;
```

---

## 2. `offer_expiry_sweep_enabled`

Full detail already lives in `docs/offer-expiry-sweep-rollout.md` (kept as
its own document since it predates this package and is independent of the
ETA flags). Summarized here for a single reference point.

### Enable SQL

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'offer_expiry_sweep_enabled',
  'true',
  'Enable automatic redispatch of unanswered/expired driver offers',
  now()
)
on conflict (key) do update
  set value = 'true',
      reason = excluded.reason,
      updated_at = now();
```

### Disable / rollback SQL

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'offer_expiry_sweep_enabled',
  'false',
  'Rollback: disable offer-expiry sweep',
  now()
)
on conflict (key) do update
  set value = 'false',
      reason = excluded.reason,
      updated_at = now();
```

### Step-by-step rollout checklist

1. Confirm `dispatch_eta_persistence_enabled` (§1) has already completed
   its own observation window successfully — don't stack this on top of
   an unverified change.
2. Confirm both sweeps are already running unconditionally in logs (the
   15-second offer-expiry check and the 30-second stuck-redispatch check
   execute on schedule even while this flag is off).
3. Check for a pre-existing backlog of stuck rides before enabling, so it
   isn't mistaken for sweep-caused churn afterward:
   ```sql
   select id, status, dispatch_status, dispatch_attempts, updated_at
   from rides
   where dispatch_status in ('offer_sent', 'redispatching')
     and updated_at < now() - interval '10 minutes';
   ```
4. Run `npx jest lib/offerExpiry.test.js` and confirm all 14 tests pass
   immediately before enabling.
5. Pick a low-traffic window, run the enable SQL, observe.

### Success metrics

- Expired offers result in redispatch (or `max_attempts_reached` once
  attempts are exhausted) with no ride left stuck in `offer_sent` past
  `expires_at` plus one sweep interval (15s).
- Zero rows from the stuck-`redispatching` query in §2.5 on every check.
- No increase in `max_attempts_reached` rate vs. the pre-flag baseline.
- No error-rate or latency regression on the accept/decline routes.

### Rollback criteria

- A ride observed stuck in `redispatching` past the 90-second
  stuck-recovery lease despite the recovery sweep running.
- A ride redispatched to a driver who already declined/received it.
- A sustained stream of `⚠️` warnings from either sweep function.
- Any measurable increase in accept/decline route error rate or latency.

### Expected log messages

| Log line prefix | Meaning | Expected frequency |
|---|---|---|
| `⏱️ sweepExpiredOffers: offer ... expired unanswered.` | Normal operation — an offer timed out and is being redispatched | Expected, proportional to how often drivers miss offers |
| `♻️ sweepStuckRedispatches: ride ... was stuck in "redispatching" past its lease — retrying dispatch.` | Normal recovery-path operation (runs regardless of this flag) | Rare — only fires when a `dispatchRide()` call previously failed |
| `⚠️ sweepExpiredOffers query failed:` | The due-offers query itself failed | Rare; sustained = DB connectivity problem |
| `⚠️ sweepExpiredOffers claim failed for offer ...` | The atomic claim update failed | Rare |
| `⚠️ sweepExpiredOffers redispatch failed for ride tied to offer ...` | `dispatchRide()` threw after a successful claim — the stuck-recovery sweep will pick this ride up next | Rare; should self-heal within one lease window (90s) |
| `⚠️ sweepStuckRedispatches query failed:` | The stuck-rides query itself failed | Rare |
| `⚠️ sweepStuckRedispatches claim failed for ride ...` | The atomic reclaim update failed | Rare |
| `⚠️ sweepStuckRedispatches: dispatchRide failed again for ..., will retry after the next lease window:` | A ride failed recovery twice in a row | Should be very rare; recurring for the same ride id is a real problem |

### Sample verification queries

```sql
-- Sweep activity by dispatch_status.
select dispatch_status, count(*)
from rides
where updated_at > now() - interval '1 hour'
group by dispatch_status;

-- Expired-offer volume.
select count(*) from driver_offers
where status = 'expired' and updated_at > now() - interval '1 hour';

-- Rides that exhausted MAX_DISPATCH_ATTEMPTS.
select id, dispatch_attempts, updated_at from rides
where dispatch_status = 'max_attempts_reached'
  and updated_at > now() - interval '1 hour';

-- Anything still stuck despite both sweeps running (should return zero rows).
select id, status, dispatch_status, dispatch_claimed_at, updated_at
from rides
where dispatch_status = 'redispatching'
  and dispatch_claimed_at < now() - interval '5 minutes';
```

---

## 3. `dispatch_route_api_enabled`

Not recommended for the current rollout — included only for completeness,
per §0's ordering. **Prerequisites not yet met**: `GOOGLE_ROUTES_API_KEY`
is unset (the code fails closed to Haversine if it's missing, but the
flag should not be turned on without it), and no provider-side billing
budget has been configured in the Google Cloud console.

### Enable SQL (do not run until the prerequisites above are met)

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'dispatch_route_api_enabled',
  'true',
  'Enable Google Routes API as the ETA/distance source, replacing Haversine',
  now()
)
on conflict (key) do update
  set value = 'true',
      reason = excluded.reason,
      updated_at = now();
```

### Disable / rollback SQL

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'dispatch_route_api_enabled',
  'false',
  'Rollback: disable routing API, revert to Haversine',
  now()
)
on conflict (key) do update
  set value = 'false',
      reason = excluded.reason,
      updated_at = now();
```

### Step-by-step rollout checklist

1. `dispatch_eta_persistence_enabled` must already be enabled and stable.
2. Configure `GOOGLE_ROUTES_API_KEY` in the deployment environment.
3. Configure a billing budget/quota in the Google Cloud console for this
   API (the real hard cost backstop, independent of the app's own
   counter).
4. Agree on `ROUTE_API_MONTHLY_QUOTA` (defaults to `20000`/month if the
   env var is unset).
5. Run the enable SQL, in a low-traffic window, and monitor closely.

### Success metrics

- `resolveEtaEstimate` results show `source: "route_api"` for the
  majority of fresh (non-cached) calls, with `source: "cache"` for
  closely-spaced pings and `source: "haversine"` only as an occasional,
  not sustained, fallback.
- `usage_counters` growth stays well under `ROUTE_API_MONTHLY_QUOTA`.
- No cost surprise relative to the Google Cloud console budget.

### Rollback criteria

- Any sustained `⚠️ resolveEtaEstimate: routing API call failed` stream.
- `usage_counters` approaching `ROUTE_API_MONTHLY_QUOTA` faster than
  expected.
- Any billing alert from the Google Cloud console.

### Expected log messages

| Log line prefix | Meaning |
|---|---|
| `⚠️ resolveEtaEstimate: usage counter increment failed, falling back to Haversine:` | The `increment_usage_counter` RPC call failed — fails closed |
| `⚠️ resolveEtaEstimate: routing API quota reached (X/Y), falling back to Haversine.` | The monthly cap was hit — expected near month-end if traffic is high, not otherwise |
| `⚠️ resolveEtaEstimate: routing API call failed, falling back to Haversine:` | Timeout, HTTP error, or malformed response from Google Routes API |

### Sample verification queries

```sql
-- Current month's routing-API usage vs. quota.
select key, count, updated_at
from usage_counters
where key = 'route_api_calls_' || to_char(now(), 'YYYY-MM');
```

---

## 4. What this document does not authorize

This package documents procedure only. It does not enable any flag, and
no flag has been changed by preparing it. Per instruction, no further
implementation work (scoring, repositioning, surge, forecasting, fraud
detection, autonomous dispatch, cancellation endpoint, or anything else)
begins until `dispatch_eta_persistence_enabled` — the first flag in the
recommended order — has been separately authorized, enabled, observed, and
verified successful in production.
