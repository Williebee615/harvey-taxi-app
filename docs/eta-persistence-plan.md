# ETA Persistence — Implementation Plan & Migration Proposal

Status: **implemented, not yet enabled** — code and migration are merged;
`dispatch_eta_persistence_enabled` and `dispatch_route_api_enabled` are both
still `false` in production (no `system_flags` row exists for either, so
`getSystemFlag()`'s fallback applies). See §8 for what shipped and §9 for
the deployment/rollout checklist. Per instruction, no live scoring,
repositioning, surge, forecasting, fraud models, autonomous dispatch, or
cancellation endpoint work is included or implied here.

This is the next item in the approved sequence: ignored-offer timeout
and redispatch (PRs #65, #66) → rider cancellation (separately scoped,
not yet built) → **ETA persistence (this document)** → driver scoring in
shadow mode → live scoring.

---

## 1. What's actually missing (verified against the live schema)

The audit found `rides.driver_eta_to_pickup_minutes` and
`rides.driver_distance_to_pickup_miles` are read in three routes but
never written anywhere. Confirmed directly against the live database
(not just inferred from code):

```
column_name                      | data_type | is_nullable | column_default
driver_eta_to_pickup_minutes     | numeric   | YES         | null
driver_distance_to_pickup_miles  | numeric   | YES         | null
```

**Both columns already exist in production.** This is a code-only gap —
no missing schema for the basic persistence work itself.

Today, `GET /api/rides/:id/status` computes an ETA transiently on every
poll, from `haversineMiles()` (straight-line distance) and a flat
`ASSUMED_DELIVERY_SPEED_MPH` (default 22 mph) — never persisted, never
based on an actual road route.

---

## 2. What "done" means

Two distinct, sequenced improvements, **independently controllable —
revised per explicit instruction not to share one switch:**

1. **Persistence** (`dispatch_eta_persistence_enabled`): write ETA/
   distance values to the existing columns, at the moments they're
   actually known, using the existing free Haversine + assumed-speed
   calculation. This is a pure correctness improvement with no external
   dependency and no cost — it can ship and be validated in production
   entirely on its own.
2. **Accuracy** (`dispatch_route_api_enabled`): once persistence is
   validated, separately enable a real routing API as the *source* of
   those same values instead of Haversine, for closer-to-real
   distance/time in a city with a river, highways, or a one-way grid.

**Why two flags, not one:** ETA persistence is a low-risk, no-dependency
correctness fix — it should be shippable and provable on its own,
without taking on Google API cost or availability risk just to prove
the write-path works. Enabling `dispatch_route_api_enabled` requires
`dispatch_eta_persistence_enabled` to already be on (the routing API
only ever supplies a *value* for the same write path; it never runs
independently) but the reverse is not true — persistence works
correctly, permanently, with the routing flag left off. Quotas,
billing limits, caching, and fallback behavior (§4) are verified before
`dispatch_route_api_enabled` is ever turned on, entirely separately
from the persistence rollout.

---

## 3. Where these values get written

Two write points, matching the two moments a rider or dispatcher would
actually want a fresh ETA:

- **At offer creation** (`dispatchRide()` / `createDriverOffer()`,
  `server.js`) — the driver's location is already known at this moment
  (`drivers.current_lat/lng`); compute and persist the initial
  ETA/distance to pickup right when the offer is made.
- **At each driver location ping** (`POST /api/driver/location`,
  `server.js:12386-12534`) — this route already runs on every GPS
  update while a ride is active, already rate-limited to one update per
  5 seconds per driver. Recompute and persist ETA/distance on the
  *same* update, no new route, no new client change required — the
  existing `driver-dashboard.html` GPS reporting already calls this
  endpoint continuously during an active mission.

No new API surface for either write point. Both are extensions of code
that already runs on exactly the cadence needed.

---

## 4. Routing API integration (approved with cost controls)

**Provider**: Google Directions/Routes API — already the app's Maps
provider elsewhere (client-side distance/duration on the rider request
flow), so no new vendor relationship, just a new server-side call.

**Cost controls, all required per your approval:**

- **Independent feature flags** (revised): `dispatch_eta_persistence_enabled`
  gates whether ETA/distance get written at all (default `false` until
  validated, then intended to stay on permanently using Haversine).
  `dispatch_route_api_enabled` separately gates whether the routing API
  supplies the value instead of Haversine (default `false`, only ever
  meaningful once persistence is already on). Turning the routing flag
  off — independent of persistence — reverts every future write to the
  free Haversine calculation immediately, with zero effect on whether
  ETAs get persisted at all.
- **Caching**: the 5-second location-update throttle already in
  `POST /api/driver/location` means a routing call can never happen more
  than once per 5 seconds per driver, for free. On top of that, skip the
  routing call entirely if the driver's position has moved less than a
  small threshold (e.g. ~50m) since the last routed calculation for this
  ride — a driver sitting still or crawling in traffic doesn't need a
  fresh route call every 5 seconds; reuse the last computed route and
  just re-derive ETA from elapsed time and remaining distance until the
  position changes meaningfully.
- **Usage limits — two independent layers, not one:**
  1. *Provider-side hard cap*: a billing budget/quota configured
     directly in the Google Cloud console for this API — the source of
     truth, outside this app's control, so a bug in our own counting
     logic can never cause unbounded spend.
  2. *App-side circuit breaker*: a concurrency-safe call counter (design
     in §5.1 — **not** a plain `system_flags` read-then-write, which is
     not atomic and would undercount under concurrent requests) checked
     after each routing call. Once a configured threshold is hit, the
     app proactively falls back to Haversine for the rest of the period
     — this is what turns "the provider rejects the call" (an error,
     mid-dispatch, at the worst possible moment) into "the app quietly
     degrades to the free approximation" (no user-facing failure at all).
- **Fallback, always**: any routing-API error (timeout, quota
  exhausted, malformed response) falls back to the existing Haversine +
  assumed-speed calculation for that single write — an ETA is always
  persisted, it just may be the less-accurate one. Nothing ever blocks
  or fails an offer/location-update because the routing call failed.
- **Monitoring**: log routing-API call count, error rate, and fallback
  rate as their own `auditLog()` entries (or a lightweight counter
  surfaced on the existing admin operations-overview dashboard) so a
  cost or reliability problem is visible before it becomes a bill
  surprise or a silent accuracy regression.

---

## 5. Migration proposal

**No new columns or tables required for basic persistence** — both
target columns already exist in production, confirmed above.

**Two small, additive schema items:**

1. Two `system_flags` rows: `dispatch_eta_persistence_enabled` and
   `dispatch_route_api_enabled` (both `value: 'false'` by default) — no
   schema change, just two new rows in an existing table, same as every
   other flag in this codebase.
2. A dedicated `usage_counters` table for the routing-API circuit
   breaker — **not** a `system_flags` row, per §5.1 below.

### 5.1 Concurrency-safe usage counter (revised — plain `system_flags` reuse rejected)

The original draft of this plan proposed reusing a `system_flags` row
as a call counter, read-then-incremented from the app. **That's wrong
and has been dropped**: a plain read-then-write from application code
is not atomic. Two concurrent routing-API calls can both read the same
count, both compute `count + 1` in the app, and both write the same
incremented value back — one increment is silently lost. For a
cost-control mechanism specifically, undercounting is the one failure
mode that defeats the entire point: usage could exceed the intended cap
while the counter still shows it under.

**Recommended design**: a small dedicated table, incremented via a
single atomic SQL statement (Postgres's row-level locking makes
`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` safe under
concurrency in a way a client-side read-then-write can never be — this
is the same class of guarantee `dispatch_ride_atomic` already relies on
elsewhere in this codebase):

```sql
create table if not exists usage_counters (
  key text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function increment_usage_counter(p_key text)
returns bigint
language sql
as $$
  insert into usage_counters (key, count, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = usage_counters.count + 1,
        updated_at = now()
  returning count;
$$;
```

Called from the app as `supabase.rpc('increment_usage_counter', { p_key })`
— one round trip, atomic, no read-then-write race possible. Keying by a
year-month string (e.g. `route_api_calls_2026-07`) gives monthly
rollover for free: a new month is simply a new key, no separate reset
job or cron needed.

**Check-after-increment, not check-then-increment**: the app increments
first, then compares the returned count to the configured cap. This
means the single call that crosses the cap still goes through once (a
1-call overshoot, not a hard stop mid-request), and every call after
that correctly sees "over cap" and falls back to Haversine. This
tolerance is intentional — the provider-side billing budget (§4) is the
real hard backstop, so the app-side breaker only needs to be a reliable
*soft* limit, not a perfectly race-free hard gate. **Fail-closed on
counter error**: if the `increment_usage_counter` call itself fails for
any reason (network blip, etc.), treat that as "assume over cap" and
fall back to Haversine for that request — a missed accurate ETA is
always preferable to an uncontrolled-cost failure mode.

**No index proposed** beyond the table's own primary key (`key`) —
lookups are always by exact key, no range scans or aggregation across
rows.

Separately, both target columns from §1 are only ever written
per-row (by `id`, already the primary key) and read as part of a
`SELECT *`/specific-row fetch, not filtered or aggregated on at scale
today. If a future need arises to query/aggregate across many rows by
ETA (e.g. a real-time "average pickup wait" dashboard metric, which
`/api/admin/operations-overview` already attempts and currently gets
nothing from since these columns are always null), that's a
straightforward follow-up index proposal once the columns are actually
populated and that use case is real — proposing it speculatively now
would be premature.

**Rollback plan**: the two flags roll back independently. Turning
`dispatch_route_api_enabled` off alone reverts every future write to
the free Haversine calculation immediately, with persistence itself
uninterrupted. Turning `dispatch_eta_persistence_enabled` off stops
writing to the two columns entirely — they're nullable with no default,
so leaving them unwritten again is a fully safe, zero-migration
rollback for the whole feature. No destructive schema change is
proposed at any point in this plan (the `usage_counters` table and its
one RPC function are additive and can simply go unused if rolled back),
so there is nothing to reverse at the database level either way.

**RLS impact**: none. This plan writes to existing columns and one new
table via the existing service-role Supabase client already used for
every other write in `server.js` — `usage_counters` is written only by
the `increment_usage_counter` RPC, called server-side with the same
service-role credentials as everything else, no new row-level security
policy surface, no client-facing access to it at all.

**Storage/query impact**: negligible. Two `numeric` columns per ride
row, already provisioned; write frequency matches the existing
location-ping cadence (already happening, already rate-limited) — this
adds two field writes to an update that's already occurring, not a new
write pattern. `usage_counters` stays at one row per month for the
lifetime of this feature — trivial storage, and lookups are always a
single primary-key hit.

---

## 6. Effort estimate

| Item | Work | Estimate |
|---|---|---|
| Persistence (`dispatch_eta_persistence_enabled`, Haversine-based) | Write ETA/distance at offer creation and on each location ping | 1–2 days |
| `usage_counters` table + `increment_usage_counter` RPC | Migration + one small SQL function (§5.1) | <1 day |
| Routing API integration (`dispatch_route_api_enabled`) | Provider call, movement-threshold caching, fallback-on-error | 3–4 days |
| Cost controls | Wire the atomic counter into the routing-call path + provider-side budget setup (the latter is a console configuration step, not code) | 1 day |
| Monitoring | Audit-log entries + a small addition to the admin overview dashboard | 1 day |
| **Total** | | **~1–1.5 weeks** (persistence alone: ~2–3 days and independently shippable) |

---

## 7. What this does not include

No driver scoring, no repositioning recommendations, no surge, no
forecasting, no fraud detection, no autonomous dispatch, no
cancellation endpoint. This plan is scoped exclusively to making the two
existing ETA/distance columns real, with the routing-API accuracy
improvement approved separately with the cost-control conditions above.

---

## 8. What actually shipped

Implementation follows the design above exactly, with one scope
clarification made explicit during implementation (see 8.3).

### 8.1 New files

- **`lib/etaEstimation.js`** — the pure, dependency-injected orchestrator.
  Same shape as `lib/rideDispatch.js`/`lib/offerExpiry.js`: no Supabase, no
  env vars, no network calls, so the decision logic is unit-testable
  without a database.
  - `haversineEta()` — the free fallback (distance ÷ assumed speed).
  - `resolveEtaEstimate()` — the full decision: if `routeApiEnabled` is
    false, returns the Haversine estimate immediately (no cache read, no
    counter increment, no network call). If true: checks the
    movement-threshold cache first; on a cache miss, atomically increments
    the usage counter, compares the returned count to `quotaLimit`
    (check-after-increment, per §5.1), and only then calls the routing API
    under a timeout — falling back to Haversine on *any* failure at *any*
    step (counter error, quota exceeded, timeout, HTTP error, malformed
    response).
  - `computeAndPersistEta()` — wraps `resolveEtaEstimate()` with the actual
    persistence write, and guarantees it never throws: a failed estimate or
    a failed write is logged and swallowed, never propagated.
  - `pruneStaleCacheEntries()` — bounds the in-memory route cache described
    below.
- **`lib/etaEstimation.test.js`** — 14 tests covering all nine required
  scenarios (flag off; initial persistence; location-update refresh;
  movement-threshold cache; routing API success; routing API timeout;
  routing API error; routing API malformed response; quota reached, both
  the reject-over-cap and allow-the-crossing-call cases; counter-error
  fail-closed; database write failure; concurrent usage-counter increments
  with no lost updates).
- **`supabase/migrations/20260729004834_add_usage_counters.sql`** — the
  `usage_counters` table and `increment_usage_counter()` RPC from §5.1,
  applied to production. Purely additive; verified live with a manual
  two-call round trip (`1`, then `2`) before this PR, then the test row was
  deleted. Confirmed no `system_flags` row exists yet for either
  `dispatch_eta_persistence_enabled`, `dispatch_route_api_enabled`, or
  `offer_expiry_sweep_enabled` — all three still resolve to `"false"` via
  `getSystemFlag()`'s fallback.

### 8.2 `server.js` wiring

- A new "ETA / DISTANCE-TO-PICKUP PERSISTENCE" section (near the
  `lib/offerExpiry.js` require) holds the Supabase/provider adapters:
  `callGoogleRoutesApi()` (Google Routes API `computeRoutes`, server-side —
  distinct from the existing client-side `GOOGLE_MAPS_BROWSER_KEY`; reads a
  new `GOOGLE_ROUTES_API_KEY` env var that is **not required** for
  persistence and is not currently set), `incrementRouteApiUsageCounter()`
  (calls the new RPC, keyed by `route_api_calls_YYYY-MM` for free monthly
  rollover), `persistRideEtaToPickup()` (the actual `UPDATE rides SET
  driver_eta_to_pickup_minutes = …, driver_distance_to_pickup_miles = …`),
  and `persistPickupEtaBestEffort()` (reads both flags via `getSystemFlag`,
  wires all of the above into `computeAndPersistEta()`, and adds one more
  layer of try/catch on top so a bug in the flag lookups themselves still
  can't escape into a caller).
- **Write point 1 (offer creation)**: `persistPickupEtaBestEffort()` is
  called, fire-and-forget (`.catch(() => {})`, never awaited), from both
  branches of `dispatchRide()` — the `dispatch_ride_atomic` RPC success path
  and the two-step fallback path — right after the existing
  `sendPushNotification()` call, using `firstDriver.current_lat/current_lng`
  and `ride.pickup_lat/pickup_lng`.
- **Write point 2 (location ping)**: `POST /api/driver/location`'s
  `activeRide` query now also selects `status, pickup_lat, pickup_lng`.
  When (and only when) `activeRide.status` is `driver_assigned`,
  `driver_enroute`, or `arrived`, `persistPickupEtaBestEffort()` is called
  the same fire-and-forget way, using the just-reported `lat`/`lng`. No new
  route, no new client change, no change to the existing 5-second
  per-driver throttle.
- **In-memory route cache**: `etaRouteCache` (a plain `Map`, keyed by ride
  id) backs the movement-threshold cache. It is per-server-instance, not
  shared across Render instances or restarts — a soft cost optimization,
  not a correctness mechanism, and explicitly documented as such in the
  code. It stays empty for as long as `dispatch_route_api_enabled` is
  false. A `setInterval` every 10 minutes calls `pruneStaleCacheEntries()`
  (1-hour max age) so it can't grow unbounded once the routing flag is
  eventually turned on.
- **Nothing else changed.** `GET /api/rides/:id/status`'s existing
  transient, non-persisted `tracking` estimate (used once a ride is
  `in_progress`, i.e. already picked up, tracking toward the *dropoff*) is
  untouched — see 8.3 for why.

### 8.3 Scope clarification made during implementation: "to pickup" only

The two target columns are named `driver_eta_to_pickup_minutes` and
`driver_distance_to_pickup_miles` — their meaning is specifically
*eta/distance to pickup*, not a general-purpose live-tracking value. This
implementation therefore only ever writes them during a ride's pre-pickup
phase: at offer creation, and on location pings while the ride's status is
`driver_assigned`, `driver_enroute`, or `arrived`. Once a ride reaches
`in_progress` (the driver has already picked up and is now headed to
drop-off), no further writes to these columns occur — continuing to write
them would silently redefine what the column means without a schema
change, the same category of correctness issue already avoided elsewhere
in this codebase (e.g. the `system_flags`-as-counter rejection in §5.1).
This matches your "**on eligible driver location updates**" phrasing
directly: eligibility is exactly this pre-pickup status check. The existing
`in_progress` transient tracking estimate in `GET /api/rides/:id/status`
already serves the dropoff-bound phase and needed no changes. A future
"ETA to dropoff" persistence feature, using its own columns, would be a
natural, separately-scoped follow-up — not implied or started here.

### 8.4 Verification performed

- `npx jest` — 122/122 tests passing repo-wide (108 pre-existing + 14 new).
- `node -c server.js` — syntax check passes.
- Migration applied live via Supabase MCP; `increment_usage_counter()`
  round-tripped correctly (`1`, then `2` on a second call against the same
  key) before the test key was deleted.
- Confirmed via live query that no `system_flags` row exists for either new
  flag or for `offer_expiry_sweep_enabled` — all three remain off.

---

## 9. Deployment & rollout checklist

**Both flags stay `false` after this PR merges.** Nothing below is
executed as part of this change — it's the procedure for when a future,
separate instruction authorizes enabling either flag.

### 9.1 Enabling persistence (`dispatch_eta_persistence_enabled`)

This is the low-risk step: pure Haversine math, no external dependency, no
cost. Enable SQL (upsert, matching the existing flag-toggle convention):

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

Disable / rollback (instant, no deploy):

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

**Pre-enable checks:**
- Confirm the deploy carrying this PR is healthy (clean boot log, schema
  checks `ok`, no elevated error rate) — same bar as every prior rollout in
  this sequence.
- Confirm `driver_eta_to_pickup_minutes`/`driver_distance_to_pickup_miles`
  are still nullable with no default (they are — §1) so there is nothing
  to migrate before flipping the flag.

**Observation queries** (run periodically during the observation window):

```sql
-- Are writes happening at all?
select count(*) filter (where driver_eta_to_pickup_minutes is not null) as with_eta,
       count(*) as total
from rides
where status in ('driver_assigned','driver_enroute','arrived')
  and updated_at > now() - interval '1 hour';

-- Sanity range check — minutes should be small positive numbers, not
-- nulls, zeros, or absurd outliers.
select min(driver_eta_to_pickup_minutes), max(driver_eta_to_pickup_minutes),
       avg(driver_eta_to_pickup_minutes)
from rides
where driver_eta_to_pickup_minutes is not null
  and updated_at > now() - interval '1 hour';
```

- Application logs: watch for `⚠️ computeAndPersistEta` or
  `⚠️ persistPickupEtaBestEffort` warnings — expected to be silent/rare;
  a sustained stream indicates a Supabase write problem, not a routing
  problem (the routing flag is still off).

**Success threshold:** after a low-traffic observation window (recommend
starting with off-peak hours, same pattern as the offer-expiry sweep
rollout), `with_eta` should climb toward `total` for active pre-pickup
rides, values should be in a sane range (roughly 0–60 minutes for
in-city trips), and there should be no increase in dispatch or
location-update error rates or latency.

**Rollback trigger:** any sustained `⚠️ computeAndPersistEta`/
`⚠️ persistPickupEtaBestEffort` error stream, any measurable latency
increase on `POST /api/driver/location` or dispatch, or nulls/garbage
values in the observation queries above → run the disable SQL. Because the
columns are nullable with no default and every write is fire-and-forget
and independently wrapped, disabling the flag fully reverts behavior with
no data cleanup required.

### 9.2 Enabling the routing API (`dispatch_route_api_enabled`) — separate, later decision

**Requires `dispatch_eta_persistence_enabled` already on and observed
healthy.** Also requires, before this is ever considered:
- `GOOGLE_ROUTES_API_KEY` configured in the environment (currently unset —
  `callGoogleRoutesApi()` throws immediately if it's missing, so turning
  this flag on without a key fails closed to Haversine, not to an error).
- A provider-side billing budget/quota configured directly in the Google
  Cloud console (§4) — the real hard cost backstop, independent of this
  app's own counting.
- Agreement on `ROUTE_API_MONTHLY_QUOTA` (defaults to `20000`/month if
  unset) as the app-side soft cap.

Enable / disable SQL (same upsert pattern as 9.1, key
`dispatch_route_api_enabled`). Observation should additionally track:

```sql
select key, count, updated_at
from usage_counters
where key = 'route_api_calls_' || to_char(now(), 'YYYY-MM');
```

against `ROUTE_API_MONTHLY_QUOTA`, plus the routing-specific log lines
(`routing API call failed`, `quota reached`) to gauge fallback rate. This
is explicitly out of scope to enable as part of this change — it's
recorded here only so the procedure exists when it's separately
authorized.

### 9.3 Not part of this rollout

`offer_expiry_sweep_enabled` remains a separate, independent flag with its
own separate enable/disable procedure — see
`docs/offer-expiry-sweep-rollout.md`. Enabling one does not require or
imply enabling the other; they protect different parts of the dispatch
pipeline and were deliberately kept on independent switches.
Implementation does not begin until this plan is approved.
