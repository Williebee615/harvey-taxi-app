# ETA Persistence — Implementation Plan & Migration Proposal

Status: **proposal — planning only, no code written yet**
Authorized scope: this document only. Per instruction, no live scoring,
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
Implementation does not begin until this plan is approved.
