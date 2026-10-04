# Harvey Taxi Driver: device test record

Results for the device test plan in `docs/driver-app.md` §7 (D1–D14). Only
results the owner reported, backed by production records where available.
Anything not yet run says so.

## Build 5 (iOS 1.0.0 (5), EAS build c618fa32), 2026-10-03

- **Device:** the owner's iPhone. Model and iOS version not recorded yet.
- **Rider side:** the website on the owner's Mac, review rider account.
- **Screenshots:** taken by the owner and kept by the owner. They were not
  attached to this record.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| D1 | Sign in by phone code | **Not run** (test-account sign-in used) | — |
| D2 | Test-account sign-in | **Pass** | Review driver signed in at 12:15:36 PM CDT; one install registered, build `1.0.0 (5)` |
| D3 | Go online | **Pass** (online, "Sharing location", "Live updates on") | Driver row online; location written 12:18 PM |
| D4 | Ride request reaches the open app | **Pass on retest** | `RIDE-47596606A5`: offered 12:37:00, accepted 12:37:09. `RIDE-7CAEC23142`: offered 12:41:14, accepted 12:41:29. |
| D4 (first try) | Same | **Not seen** by the owner | `RIDE-06D4C93EF9`: offered 12:23:25; the 30 s offer expired at 12:23:55 unanswered. Server logs show the phone fetched the offer; display was not confirmed. App code renders this exact offer (regression test, PR #173). |
| D5 | Offer left to expire | **Fail: no re-dispatch** | `RIDE-06D4C93EF9` still "Awaiting driver acceptance"; the expired-offer clean-up is switched off in production. Fix prepared (see below). |
| D6 | Accept → steps → complete | **Pass** (accept, en route, arrived, complete) | `RIDE-47596606A5` completed 12:38:31; `RIDE-7CAEC23142` completed 12:43:26 |
| D6 (navigation) | Navigate opens Maps | **Not confirmed** | — |
| D7 | Locked screen 10 min during a trip | **Not confirmed** | — |
| D8, D9 | Reconnect; force-quit and reopen | **Not run** | — |
| D10 | Go offline | **Not confirmed** | — |
| D11 | Push | **On hold** (driver push switched off) | — |
| D12 | Account deletion | **Not confirmed** | — |
| D13 | Android battery saver | **Not run** (no Android device test yet) | — |
| D14 | Rider app regression | **Not run** | — |
| iPad | Layout and the same flows on iPad | **Not confirmed** | — |

## Changes made from these results

Live since PR #174 (merge `caaeabe`, deployed to Render 2026-10-04): items 2, 4 and 5 below. Item 1 is in build 6. Item 3 was switched on 2026-10-04, after the stale ride was cancelled.

**1. In-app alert for new offers.** While the app is open, a vibration and the
standard notification sound play once per new offer. The sound has no banner
and respects the silent switch. It needs a new build.

**2. 45-second offer window,** up from 30 seconds. It is the server's default,
and Render's `DISPATCH_TIMEOUT_SECONDS` still overrides it. It takes effect
with the next server deploy.

**3. Expired-offer clean-up:** the existing sweep, controlled by the
`offer_expiry_sweep_enabled` production switch. Tested with the switch on and
off. It changes nothing until the switch is set. When an offer expires:
- normal rides go to the next eligible driver;
- review rides are re-offered to the review driver;
- after `MAX_DISPATCH_ATTEMPTS` (default 5) the ride closes as failed instead
  of waiting forever.

**4. Failed rides release the rider's card authorization** (`releaseFailedRidePayment`). It runs whenever a ride ends as failed:
- no driver available;
- out of dispatch attempts, through the clean-up or a decline;
- an admin marks it failed.

It reuses the existing cancellation release:
- it is idempotent and resumable;
- it is skipped for review rides and rides without a payment;
- an already captured payment is flagged for a refund, never reversed.

An admin can no longer revive a failed ride whose hold was released. The rider books again instead.

**5. What the rider is told:**
- the rider page shows "No driver available" with: *"No driver was available for this ride, so it was cancelled. You have not been charged. Please book again."*
- the text/email message now also says "You have not been charged";
- it is sent on every failure path; before, the max-attempt paths sent nothing.

### Before switching on the clean-up

1. **Clear the only stale pending offer first.** On 2026-10-04 it is the one
   for `RIDE-06D4C93EF9`. Cancel that ride from the rider screen; otherwise
   the first sweep re-offers it to the review driver.
2. **Confirm Render does not set `DISPATCH_TIMEOUT_SECONDS=30`.** If it does,
   the new 45-second default never applies.
3. **Then set the switch:**
   ```sql
   insert into public.system_flags (key, value) values ('offer_expiry_sweep_enabled', 'true')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```
   **Rollback:** set the value back to `'false'`.

## Status on 2026-10-04

### Done and confirmed
- **Server deploy (PR #174, `caaeabe`):** live on Render. The rider page serves the new failure message. Health check: database connected.
- **Driver builds from `caaeabe`:**
  - iOS 1.0.0 (6), EAS build `4d612aa0`. Uploaded to App Store Connect by the owner. EAS submission `daa4a659` finished with no error.
  - Android versionCode 4, EAS build `d039bb28`. Built; not uploaded.
- **Stale offer:** `OFFER-9E1375D173` set to `expired`. No pending offers remain.
- **iOS push credentials:** an APNs key is stored in EAS.
- **`driver_native_push_enabled` is on.** One device token is registered: the review driver's iPhone.
  - **Rollback:** set the flag's value to `'false'`.

- **`RIDE-06D4C93EF9` cancelled.** Two earlier attempts timed out; the third applied. Audit entry: `stale_review_ride_cancelled`.
- **`offer_expiry_sweep_enabled` is on.** No pending offers remained when it was switched on.
  - **Rollback:** set the flag's value to `'false'`.

### Not done
- **45-second offer window: unverified.** No offer has been created since the deploy.
- **Apple processing of build 6, and adding it to the internal testing group: unverified.** This session has no App Store Connect access.
- **Android push is blocked.** There is no `google-services.json` and no FCM V1 key in EAS.

### Device checks for build 6 (all unverified)
| Check | Result |
|---|---|
| Offer vibration and sound while the app is open | Unverified |
| Push notification for an offer with the app backgrounded or locked (D11) | Unverified |
| D1, D6 navigation, D7, D8, D9, D10, D12, D13, D14, iPad | Unverified |

## Live map tracking (PR #176, merged `8e8dac3`, deployed 2026-10-04)

Design: `docs/live-map-tracking.md`.

### Done
- **Database:** `rides.rider_live_*` columns added in production before the deploy.
- **Deploy:** live. `GET /api/maps/config` answers, and the share route refuses requests without credentials.

### Builds from `8e8dac3`
| App | Platform | Build number | EAS build |
|---|---|---|---|
| Driver | iOS | 7 | `703e9272` |
| Driver | Android | versionCode 5 | `716f6fe5` |
| Rider | iOS | 12 | `c2a3d264` |
| Rider | Android | versionCode 10 | `bf27bbde` |

### Maps are off until both Mapbox public tokens are set on Render
- `MAPBOX_PUBLIC_TOKEN` (website and rider app)
- `MAPBOX_APP_TOKEN` (driver app)

### Device checks (all unverified)
| Check | Result |
|---|---|
| Rider map on the website: driver, pickup, destination | Unverified |
| Rider app (WebView): map and location permission prompt, iOS and Android | Unverified |
| Rider "Share my location", then the driver app shows the rider marker until pickup | Unverified |
| Driver trip map with real Mapbox tiles, iOS and Android | Unverified |

## Production outage and recovery, 2026-10-04

- **Outage:** from about 07:15 UTC every database request failed with 504/522. Supabase still reported the project healthy. The cause was the Free-plan database instance running out of resources, not app traffic: about 15 requests a minute and a 24 MB database.
- **Recovery:** the owner restarted the project at about 12:48 UTC.
  - The API layer could not load its schema cache until about 12:51.
  - Requests were slow until about 12:55.
  - From 12:55 UTC: no errors; typical requests 107–253 ms; the slowest 5% under 750 ms in every 5-minute window since 13:00, apart from one 3.4 s request at about 13:00.
- **Seen in the driver app (Android):** while the database was down, the Drive screen stayed on "Loading your driver status…" forever. The fix is merged (PR #177) but is not in any installed build yet.

## Android retest, 2026-10-04 08:08–08:10 CDT (owner's Android phone, review accounts)

Ride `RIDE-D45C58537C`, review ride, matched against production:

| Step | Time (UTC) | Source |
|---|---|---|
| Requested | 13:07:38 | `rides.created_at`, audit `ride_requested` |
| Offer `OFFER-A2C52319A1` | 13:07:38.8, expiring 13:08:23.8 | **window 45 s** (`expires_at - created_at`) |
| Accepted | 13:07:50 (12 s after the offer) | `accepted_at`, audit `ride_offer_accepted` |
| En route | 13:08:26 | `enroute_at`, audit |
| Arrived | 13:08:50 | `arrived_at`, audit |
| Started | 13:09:11 | `trip_started_at`, audit |
| Completed | 13:09:40 | `completed_at`, audit; the rider website showed "Trip completed" |

| Check | Result | Evidence |
|---|---|---|
| Drive screen loads (Android) | **Pass** | Owner's screenshots |
| Offer sound in the open app | **Pass** (owner heard it) | The phone has no push token (Android push is not set up), so this was the in-app alert, not a push |
| Offer vibration | **Unverified** | — |
| Driver trip map with Mapbox tiles (Android) | **Pass** | Screenshot: own location, pickup, drop-off, rider marker |
| Rider shares location; the driver sees it | **Pass** | Screenshot: "Rider is sharing their location (17s ago)". The position was deleted after the trip as designed (`rider_live_*` empty) |
| Full trip steps to completion | **Pass** | Table above |
| 45-second offer window | **Pass** | `OFFER-A2C52319A1`: 45.0 s |
| Locked-screen push | **Unverified** | No Android push (no FCM), iOS push not yet tested |

Still unverified: vibration, push (iOS and Android), locked screen, navigation hand-off, offline, deletion, iPad, the rider app's (WebView) map and location prompt.
