# Driver hours limit

Each driver may be online for **up to 12 hours** in a shift. After that they must rest, offline, for **6 hours in a row** before going online again.

## Rules (`lib/driverHours.js`)

- **What counts as worked time:** time online, whether waiting for requests or on a trip.
- **Short breaks:** an offline stretch shorter than 6 hours pauses the count but doesn't reset it.
- **Reset:** any offline stretch of 6 hours or more ends the shift, and the count starts again at zero.
- **At 12 hours:**
  - the driver can't go online, and the server answers `409 rest_required` with the time they may go online again;
  - dispatch stops offering them rides;
  - a sweep running every 60 s takes them offline.
- **A trip in progress is never cut short.** The driver is taken offline on the first sweep after the trip ends, and the 6-hour rest counts from then.
- **Review accounts** (App Store and Google Play reviewers) are exempt.
- **Adjusting the limits:** Render `DRIVER_MAX_ONLINE_HOURS` (default 12) and `DRIVER_MIN_REST_HOURS` (default 6).

## Data

`public.driver_online_sessions` holds one row per stretch online: `driver_id`, `started_at` and `ended_at` (null while online).

- A trigger on `drivers.online` opens and closes the rows, whichever code path changes the flag.
- It's server-only: RLS is on, there are no policies, and anon and authenticated have no access.
- Migration: `supabase/migrations/20261004160000_add_driver_online_sessions.sql`.
- Drivers already online when the migration is applied are counted from that moment.

## Where it's enforced (`server.js`)

| Place | Behavior |
|---|---|
| `POST /api/driver/status` (`online: true`) | Refused during rest. If the hours can't be read, it fails closed with a 503. |
| `findAvailableDrivers` (both the RPC and fallback paths) | Skips drivers at the limit. Fails open, so a lookup error never stops dispatch. |
| `runDriverHoursSweep` (every 60 s) | Takes drivers at the limit offline, unless they're on a trip. Writes an audit log entry (`driver_hours_limit_offline`) and notifies the driver. |
| `GET /api/driver/state` | Returns `hours`: worked, remaining, rest-until, and whether the driver can go online. |

- **Driver app:** the Drive screen shows "Online this shift: X of 12h", warns in the last hour, and disables Go online during rest, showing the time the driver can go online again.
- **Web dashboard:** shows the server's message when going online is refused.

## Deploy order

1. Apply the migration. It must go in **before** the server deploy: going online fails closed if the table is missing.
2. Merge to deploy.
3. New driver app build, for the hours display. Older builds still get the server's refusal message.

**Rollback:** set `DRIVER_MAX_ONLINE_HOURS` very high, for example 1000. The table and trigger can stay.
