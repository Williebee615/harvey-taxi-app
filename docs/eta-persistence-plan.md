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

Two distinct, sequenced improvements — not one:

1. **Persistence** (must ship first): write real ETA/distance values to
   the existing columns, at the moments they're actually known, instead
   of computing them fresh on every poll and throwing the result away.
2. **Accuracy** (approved with conditions): replace the straight-line
   Haversine approximation with a real routing API for the persisted
   values, since a straight line under-estimates real driving distance/
   time, sometimes substantially in a city with a river, highways, or a
   one-way grid.

Both ship behind one flag; accuracy is not gated separately, since a
Haversine-only "persistence" step alone would just be persisting a
number that's already known to be wrong.

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

- **Feature flag**: `dispatch_route_api_enabled` (`system_flags`,
  default `false`). Off means every ETA/distance write uses the existing
  free Haversine + assumed-speed calculation — the persistence work in
  §3 does not depend on this flag being on.
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
  2. *App-side circuit breaker*: a lightweight daily/monthly call
     counter (a single row in `system_flags` or a tiny dedicated table,
     incremented per successful call) checked before each routing call.
     Once a configured threshold is hit, the app proactively falls back
     to Haversine for the rest of the period — this is what turns "the
     provider rejects the call" (an error, mid-dispatch, at the worst
     possible moment) into "the app quietly degrades to the free
     approximation" (no user-facing failure at all).
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

**Two small, optional additions, both purely additive:**

1. `system_flags` row: `dispatch_route_api_enabled` (`value: 'false'`
   by default) — no schema change, just a new row in an existing table,
   same as every other flag in this codebase.
2. A small usage-counter mechanism for the app-side circuit breaker in
   §4. Simplest option: reuse `system_flags` itself — a row like
   `route_api_calls_this_month` with `value` as a numeric string,
   reset by a scheduled job or checked-and-rolled-over on read. This
   avoids a new table entirely. If finer-grained data (per-day
   breakdown, error rate over time) turns out to be wanted later, a
   dedicated small table is a natural follow-up — not proposed here
   since it isn't needed for the basic circuit-breaker behavior.

**No index proposed.** Both target columns are only ever written
per-row (by `id`, already the primary key) and read as part of a
`SELECT *`/specific-row fetch, not filtered or aggregated on at scale
today. If a future need arises to query/aggregate across many rows by
ETA (e.g. a real-time "average pickup wait" dashboard metric, which
`/api/admin/operations-overview` already attempts and currently gets
nothing from since these columns are always null), that's a
straightforward follow-up index proposal once the columns are actually
populated and that use case is real — proposing it speculatively now
would be premature.

**Rollback plan**: turning `dispatch_route_api_enabled` off reverts
every future write to the free Haversine calculation immediately, no
deploy needed. If the persistence work itself needs to be rolled back
entirely (not just the routing-API accuracy piece), the columns simply
stop being written — they're nullable with no default, so leaving them
unwritten again is a fully safe, zero-migration rollback. No destructive
schema change is proposed at any point in this plan, so there is
nothing to reverse at the database level either way.

**RLS impact**: none. This plan writes to existing columns via the
existing service-role Supabase client already used for every other
write in `server.js` — no new table, no new row-level security policy
surface.

**Storage/query impact**: negligible. Two `numeric` columns per ride
row, already provisioned; write frequency matches the existing
location-ping cadence (already happening, already rate-limited) — this
adds two field writes to an update that's already occurring, not a new
write pattern.

---

## 6. Effort estimate

| Item | Work | Estimate |
|---|---|---|
| Persistence (Haversine-based, flag off) | Write ETA/distance at offer creation and on each location ping | 1–2 days |
| Routing API integration | Provider call, movement-threshold caching, fallback-on-error | 3–4 days |
| Cost controls | App-side circuit breaker counter + provider-side budget setup (the latter is a console configuration step, not code) | 1–2 days |
| Monitoring | Audit-log entries + a small addition to the admin overview dashboard | 1 day |
| **Total** | | **~1–1.5 weeks** |

---

## 7. What this does not include

No driver scoring, no repositioning recommendations, no surge, no
forecasting, no fraud detection, no autonomous dispatch, no
cancellation endpoint. This plan is scoped exclusively to making the two
existing ETA/distance columns real, with the routing-API accuracy
improvement approved separately with the cost-control conditions above.
Implementation does not begin until this plan is approved.
