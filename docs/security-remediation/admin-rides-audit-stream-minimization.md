# Admin rides/audit-logs/SSE-stream data minimization

## Background

This is the queued follow-up to `admin-drivers-riders-list-minimization.md`
and `admin-drivers-riders-exposure-review.md` (PR #109/#110, merged). Per
plan, this pass covers the three remaining routes flagged when that work
was scoped: `GET /api/admin/rides`, `GET /api/admin/audit-logs`, and the
admin SSE firehose (`GET /api/admin/stream`), with special attention to
the stream -- an unscoped real-time event feed would undermine RBAC even
if every normal REST endpoint is correctly permissioned once RBAC exists.

Unlike the drivers/riders fix, `rides` and `audit_logs` have no
credential, verification-secret, or raw-provider-payload columns to
strip -- there is no `password_hash` equivalent on either table. What
this pass found instead was more severe in a different way: **the SSE
stream was broadcasting complete, unfiltered driver and rider rows --
including `password_hash` and every other forbidden field from the
drivers/riders fix -- to every connected admin socket in real time**,
on top of returning the same full rows directly in several PATCH/POST
HTTP responses. This is arguably worse than the original `select("*")`
list-route bug, since it's push-based and fires automatically on every
approval/rejection/assignment rather than requiring a pull request.

## Scope

- `GET /api/admin/rides`
- `GET /api/admin/audit-logs`
- The SSE broadcasts fired by `PATCH /api/admin/rides/:id/status`,
  `POST /api/admin/rides/:id/assign-driver`, `PATCH
  /api/admin/drivers/:id/approve`, `PATCH /api/admin/drivers/:id/reject`,
  `PATCH /api/admin/riders/:id/approve`, and the `htaf_ride_created`
  event fired by `POST
  /api/admin/foundation/applications/:id/create-ride`
- The HTTP responses of the driver/rider/ride mutation routes above,
  since they shared the exact same over-broad `.select()` result as
  the broadcasts they fed

No other admin route changes. Admin RBAC, driver readiness rules, rider
auth, verification provider behavior, and Stripe behavior are untouched.

## Finding: the admin SSE stream has no live frontend consumer at all

Before touching anything, every page under `public/` was searched for
`EventSource` and for `/api/admin/stream` specifically. **No page in
this codebase opens a connection to the admin SSE stream.** The one
`EventSource` call found (`public/rider-dashboard.html`) connects to
the unrelated ride-scoped stream (`/api/rides/:id/stream`), which is a
separate mechanism with its own client list (`rideSseClients`) and was
not touched by this pass.

This means every event this pass discusses -- `ride_updated`,
`ride_assigned`, `driver_approved`, `driver_rejected`, `rider_approved`,
`htaf_ride_created`, `dispatch_paused`, `dispatch_resumed`,
`emergency_alert`, `safety_report`, `stripe_event` -- is currently
broadcast to nothing in this codebase's own UI. The endpoint is still
live and reachable by anyone holding the flat admin credential (a
script, a removed page, a future integration), so the exposure is real,
but there is no existing admin workflow this fix could break by
changing what these events carry.

## What every live admin page actually reads

Read in full before writing any allow-list, per the same methodology as
the prior fix:

| Page | Consumes | Fields actually read |
|---|---|---|
| `public/admin-dashboard.html` | `GET /api/admin/rides` | `id`, `status`, `rider_name`, `rider_id`, `driver_id`, `current_driver_id`, `dispatch_status` (also `pickup`, `destination`, `estimate_total`, `total` -- **not real columns**, see below) |
| `public/admin-live-dispatch-map.html` | `GET /api/admin/rides`, `GET /api/admin/audit-logs` | rides: `id`, `mission_id`, `rider_name`, `driver_name`, `ride_status`, `status`, `requested_mode`, `pickup_address`, `dropoff_address`, `created_at`, `requested_at`, `updated_at`, `estimated_fare`, `payment_status`. audit-logs: none functionally -- see below |
| `public/autonomous-analytics.html` | `GET /api/admin/rides` | `ride_status`, `driver_id`, `created_at`, `final_fare`, `estimated_fare`, `final_driver_payout`, `estimated_driver_payout`, `tip_amount`, `pickup_address`, `dropoff_address`, `dispatch_attempts` (referenced as `dispatch_attempt_count`, not a real column) |

No page consumes `/api/admin/stream` (see above), so no page's field
usage constrains the SSE payload shapes -- those are minimized on
first-principles least-privilege grounds instead (see below).

**Pre-existing dead-field/dead-integration findings (noted, not fixed
here, consistent with how the prior PR handled the same category of
issue):**
- `admin-dashboard.html`'s `renderRides()` reads `r.pickup`,
  `r.destination`, `r.estimate_total`, and `r.total` -- none of these
  are real `rides` columns (the real columns are `pickup_address`,
  `dropoff_address`, `estimated_fare`/`final_fare`/`fare_total`). These
  have always rendered blank/`$0.00`, independent of this change.
- `admin-live-dispatch-map.html`'s `loadAlerts()` fetches
  `/api/admin/audit-logs` and expects `alertData.events` /
  `alertData.alerts` / `alertData.data.alerts`, but the route has always
  returned `{ logs: [...], page: {...} }`. The property name never
  matches, so `state.alerts` is always `[]` and the alerts panel has
  never displayed a row, independent of this change. Its render
  function also reads `alert.title`/`message`/`notes`/`description`,
  none of which are top-level `audit_logs` columns -- everything of that
  shape would live inside the `metadata` jsonb column per-action, not
  flattened at the row level.
- `autonomous-analytics.html` reads `ride.ride_id` (real column is
  `id`) and `r.dispatch_attempt_count` (real column is
  `dispatch_attempts`) -- both always blank/zero.

These are the same class of finding as `renderHTAF()`'s dead fields
noted in the prior PR: real bugs, but UI bugs, not data-exposure bugs,
and fixing them is out of scope here.

## The fix

### `GET /api/admin/rides`

`lib/adminDirectory.js` adds `ADMIN_RIDES_LIST_FIELDS`: the union of
every real column the three consumer pages above actually read, plus
`id`/`created_at` for the route's own keyset pagination. Excluded, because
no live page reads them (not because they're forbidden the way
`password_hash` was): `rider_phone`, `driver_phone`, `driver_vehicle`,
exact pickup/dropoff lat/lng, the raw jsonb snapshots
(`pricing_snapshot`, `fare_config`, `fare_snapshot`, `route_snapshot`),
`payment_id`, `delivery_pin`, `admin_note`/`notes`, cancellation
reason/actor columns, and the `pilot_*` columns (not read even by
`autonomous-analytics.html`, which only reads `ride_status`,
fare/payout, and address fields). `server.js`'s route now calls
`.select(ADMIN_RIDES_LIST_FIELDS.join(","))` instead of `select("*")`.

### `GET /api/admin/audit-logs`

`audit_logs` has exactly 10 columns (`id`, `actor_type`, `actor_id`,
`action`, `entity_type`, `entity_id`, `metadata`, `ip_address`,
`user_agent`, `created_at`), and every one of them is legitimate,
necessary content for an audit trail's own purpose -- there is nothing
to cut. `ADMIN_AUDIT_LOGS_LIST_FIELDS` lists all 10 explicitly anyway,
for the same defense-in-depth reason as the rest of this codebase's
allow-lists: a future column addition to this table can't silently
start appearing in the response without a deliberate decision to add it
here.

### The SSE stream and its feeder routes

The real finding. Several mutation routes did `.update({...}).select()`
(Supabase's `select()` with no arguments returns every column, same as
`select("*")`) and then both **returned that full row in the HTTP
response** and **broadcast it to every connected admin SSE client**:

| Route | Broadcast event | What it sent |
|---|---|---|
| `PATCH /api/admin/rides/:id/status` | `ride_updated` | full `rides` row |
| `POST /api/admin/rides/:id/assign-driver` | `ride_assigned` | full `rides` row **and** the full raw `drivers` row (`password_hash`, `sms_verification_code`, `persona_last_payload`, `checkr_last_payload`, `stripe_account_id`, everything) |
| `PATCH /api/admin/drivers/:id/approve` | `driver_approved` | full `drivers` row (same forbidden fields) |
| `PATCH /api/admin/drivers/:id/reject` | `driver_rejected` | full `drivers` row (same forbidden fields) |
| `PATCH /api/admin/riders/:id/approve` | `rider_approved` | full `riders` row |
| `POST .../applications/:id/create-ride` | `htaf_ride_created` | the created ride, including `rider_name`/`rider_phone` |

None of these HTTP responses are read beyond a success/failure signal
by any live page -- every caller (`admin-dashboard.html`'s
`approveRider`/`approveDriver`/`setRideStatus`,
`admin-live-dispatch-map.html`'s `performRideAction`) shows a toast and
then re-fetches everything from scratch. So the fix for the first five
routes is the same shape for both output paths at once: change the
`.select()` call itself to an explicit, minimal set
(`ADMIN_RIDE_MUTATION_FIELDS`, `ADMIN_DRIVER_MUTATION_FIELDS`,
`ADMIN_RIDER_MUTATION_FIELDS` in `lib/adminDirectory.js` -- just
`id`/`status`/the specific fields that route's own update actually
changes/`updated_at`), and both the HTTP response and the
`broadcastSse()` call now use that same minimized row. Full detail
remains available through `GET /api/admin/rides`'s own allow-list above.

`POST /api/admin/rides/:id/assign-driver` needed one more step, because
its underlying update result is also used internally:
`notifyRideStage()` needs `rider_id`/`rider_phone`/`ride_type` to
actually text/email/push-notify the rider, and the push-notification
body reads `pickup_address` directly. Narrowing the `.select()` to
`ADMIN_RIDE_MUTATION_FIELDS` alone would have silently broken that real
notification path. The fix: the query selects
`ADMIN_RIDE_MUTATION_FIELDS` **plus** those four internal-use-only
fields, `notifyRideStage()`/the push notification still read the full
query result (`data`) as before, and a separate `rideSummary` object
built from exactly `ADMIN_RIDE_MUTATION_FIELDS` is what actually goes
into the HTTP response and the SSE broadcast -- `rider_phone` and the
rest never reach either output. The route's raw `driver` variable (from
`getDriverOrFail()`, an existing internal helper that legitimately needs
`select("*")` for other business logic and is not itself a route
response) is replaced the same way: `driverSummary = { id: driver.id,
...driverRideFields }`, reusing the already-existing, already-minimal
`buildDriverRideFields()` helper instead of ever forwarding the raw row.

`htaf_ride_created`'s broadcast is thinned from the full created-ride
object to `{ id, status }` only -- the HTTP response to the one admin
who performed that specific action is left as-is (a purpose-bound,
single-record response, not a broadcast to every connected admin), but
nothing beyond an id/status pair needs to go out over the firehose.

### What was deliberately left unchanged

`dispatch_paused`/`dispatch_resumed` already only carry a `reason`
string an admin typed and a timestamp -- already minimal, no DB row
involved. `stripe_event` already carries only `{ type, object_id, at }`
-- no card data. Both are unchanged.

`emergency_alert` (`POST /api/safety/911`) and `safety_report` broadcast
their full inserted row (rider/ride id, location, free-text
message/category/description). These were deliberately **not**
minimized: they carry no credential, verification-secret, or
raw-provider-payload field the way drivers/riders did -- their content
(an opaque rider/ride id, coordinates, and a free-text safety
message) is exactly what a dispatcher needs in real time to actually
respond to a safety event. Cutting it would trade a data-minimization
improvement for a real safety-response regression, for an event class
that already has no live consumer to justify the risk either way. If
these ever need scoping, that belongs in the RBAC work (a genuine
"dispatcher/safety" role seeing full detail, others not), not a blanket
field cut here.

## Testing

- `lib/adminDirectory.test.js`: new test suites for
  `ADMIN_RIDES_LIST_FIELDS`, `ADMIN_RIDE_MUTATION_FIELDS`,
  `ADMIN_DRIVER_MUTATION_FIELDS`, `ADMIN_RIDER_MUTATION_FIELDS`, and
  `ADMIN_AUDIT_LOGS_LIST_FIELDS`, following the same pattern as the
  drivers/riders tests: proving the driver/rider mutation field sets can
  never contain the same forbidden credential/verification/payload/
  payment columns as the list fix, proving the rides field sets never
  contain a field no live page reads, proving `id` is always present,
  proving no duplicates, and proving the literal `.join(",")`
  select-strings built from each list never contain a forbidden column.
- Full suite: `npx jest` -- 15 suites, 416 tests, all passing.
- `node -c server.js` -- syntax check passes.

## Follow-up (queued, not part of this PR)

RBAC implementation in phases, per the six-phase rollout strategy in
`admin-rbac-architecture-audit.md`. This pass was the last of the
data-minimization work queued ahead of it -- the admin data surface
(bulk lists, mutation responses, and the real-time stream) no longer
pushes credentials, verification secrets, or full unfiltered rows to
every holder of the flat admin credential, which is the "clean data
boundary" RBAC was waiting on.
