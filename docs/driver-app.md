# Harvey Taxi Driver — app, backend changes and release plan

**Status: implemented and tested in code. Not built, not submitted.** Native
builds, store records and device testing need access this work could not
get from its environment; see [Blockers](#blockers-and-earliest-submission).

| App | Directory | Store identity | Changed here? |
|---|---|---|---|
| Harvey Taxi (rider) | `mobile/` | iOS `com.harveytaxi.app` (App Store: Harvey Taxi Mobile, `6761548295`), Android `com.harveytaxi.app`, EAS `ae7e5a71-…` | **No** |
| Harvey Taxi Driver | `driver-app/` | iOS `com.harveytaxiservice.driver`, Android `com.harveytaxi.driver`, scheme `harveytaxidriver`, its own EAS project | New |

Both apps use the same backend (Express on Render), Supabase database,
dispatch engine and payment logic. There is no second backend.

## 1. Audit summary (what existed, what was reused)

- **Rider app:** an Expo 54 WebView shell over the website. Left untouched.
  Its identifiers were checked against `mobile/app.json` and `eas.json` only.
  Live EAS, App Store Connect and Play Console records could not be checked
  from this environment (network policy). One inconsistency to confirm:
  `mobile/RELEASE.md` names App Store Connect app id `6761548295`, while
  `mobile/eas.json` submits to `6761441561`.
- **PR #58** (planning only) recommended Capacitor. It predates the Expo rider
  app. The driver app uses Expo/React Native, as requested, to share the
  stack, tooling and EAS account.
- **Reused as-is:** driver session tokens (`x-driver-token`),
  `requireDriverSelf`, offer accept (atomic `accept_driver_offer_atomic`) and
  decline, trip steps (`enroute`/`arrived`/`start`/`complete`), online
  readiness enforcement (`POST /api/driver/status`), account deletion
  (`POST /api/account/driver/delete-request`), App Review accounts (simulated
  payment, dispatch only to the review driver, kill switch).
- **Gaps found and fixed (server, additive):**
  1. No way to list a driver's pending offers → `GET /api/driver/state`.
  2. Sign-in required the driver's internal id → phone-number sign-in.
  3. **Online drivers' positions were never updated outside a trip**
     (`/api/driver/location` returned 409), so dispatch (`nearest_drivers`
     on `drivers.geog`, kept in sync by the production trigger
     `trg_drivers_sync_geog`) matched idle drivers from wherever their last
     trip ended. The route now stores the position while online. It still
     refuses updates while offline.
  4. Push was Web Push only (0 subscriptions in production) → Expo native push.
  5. History capped at 100 and earnings unpaginated → paged endpoints.
- **Pre-existing finding, now fixed:** `GET /api/rides/:id/stream` and
  `GET /api/rides/:id/status` had no authentication. Anyone who knew a ride
  id could read the driver's live location and phone number, the addresses
  and the delivery PIN. Both now require the ride's rider (an owning session,
  or the per-ride tracking token issued only to the request that created the
  ride, since production riders have no session yet), the assigned driver,
  or an admin; anyone else gets "not found". Drivers never receive the
  delivery PIN. See `lib/rideAccess.js`, `test/server.ride-tracking-access.test.js`
  and `test/rider-tracking-token.browser.test.js`.

## 2. Server changes (all additive)

| Route / change | Auth | Notes |
|---|---|---|
| `POST /api/driver/session/phone/start` | none, rate limited | Same answer whether or not the number is a driver's (no enumeration). Review accounts excluded. |
| `POST /api/driver/session/phone/verify` | none, rate limited | Twilio Verify; issues the existing driver session token. |
| `GET /api/driver/state` | `requireDriverSelf` | Readiness, online, live pending offers (no rider name or phone before acceptance), active ride, polling hints. |
| `GET /api/driver/stream` | `requireDriverSelf` | Per-driver SSE. Events only say "re-read your state". Nudged by every driver notification (new offer, cancellations, admin assignment) and by offer expiry. |
| `POST/DELETE /api/driver/push-token` | `requireDriverSelf` | Expo push tokens in `driver_push_tokens`. |
| Native push sending | — | Via Expo's push service, only while `driver_native_push_enabled` = `"true"`. Removes tokens Expo reports as unregistered. |
| `POST /api/driver/location` | unchanged | Also stores the position while online without a trip. |
| `GET /api/driver/trips`, `GET /api/driver/earnings-ledger` | `requireDriverSelf` | Keyset pages (`limit` ≤ 50, `before`). |

The web dashboard's routes are unchanged. Which app sends a request is never
consulted: the server derives the driver from the signed session and checks
readiness, offer ownership and ride ownership itself.

**Migration:** `supabase/migrations/20261004120000_add_driver_push_tokens.sql`
(new table, RLS on, no client access). **Not applied.**
**Flag:** `driver_native_push_enabled` (absent = off).

## 3. The driver app

- **Screens:** sign-in (phone code, plus a "test account" email sign-in for
  App Review); Drive (status, onboarding checklist, online/offline, offers with
  countdown, accept/decline, active trip with navigation, call rider, next
  step, 911); Earnings; Trips; Account (support, policies, settings, sign out,
  delete account).
- **Onboarding** (application, Persona, Checkr) stays on the website; the app
  shows server-side status and links there.
- **Deliveries** (food/grocery) have extra steps (order pickup, PIN, photo).
  This release shows "continue in the web dashboard" for them. *Not
  implemented in the app.*
- **Session** stored in the iOS Keychain / Android Keystore (`expo-secure-store`).

### Location (matches the store disclosures)

| Platform | Permission requested | How it keeps working when locked | Indicator |
|---|---|---|---|
| iOS | While Using only ("Always" is never requested; a config plugin removes the Always keys from Info.plist) | `location` background mode; updates start while the app is open | Blue location indicator |
| Android | Fine/coarse while in use; **no** `ACCESS_BACKGROUND_LOCATION` (blocked in the manifest) | Foreground service of type `location`, started when the driver goes online | Ongoing "Harvey Taxi Driver is online" notification |

Tracking runs only while the server says the driver is online or has an
active trip, and stops when they go offline. Rates by state:

| State | Sample every | Send at most every / min move |
|---|---|---|
| Offline | — | none |
| Online, idle | 60 s / 150 m | 60 s / 100 m |
| To pickup, on trip | 10 s / 25 m | 10 s / 20 m |
| At pickup | 30 s / 50 m | 30 s / 40 m |

Fixes worse than 100 m are dropped. A keep-alive is sent at least every
2 minutes while tracking. The server separately keeps at most one update
per 5 s per driver.

### Real-time and recovery

- **While online or on a trip:** one authenticated stream; each event causes
  one state read; a reconcile every 60 s.
- **Stream down:** reconnect with backoff (1 s doubling to 60 s, with jitter)
  and poll at the server's hint (5 s with an offer pending, 15 s on a trip,
  30 s idle). Returning to the foreground or regaining the network reconnects
  at once.
- **While offline:** no stream and no polling.
- **App restart:** the saved session resumes and the active trip and its
  tracking come back (tested).
- **Streams are per server instance.** With more than one instance a missed
  event is caught by the 60 s reconcile or by push.

## 4. Load: before and after (measured, one driver)

`node scripts/driver-load-model.js` replays both clients' request rules over
the same 60-minute shift: 10 min offline, 20 min idle, offer, 20 min trip,
5 min idle, 5 min offline. It runs every request against the real routes
with the in-memory database and counts the queries each one makes.

| Client | HTTP requests | Location posts | DB operations |
|---|---|---|---|
| Web dashboard (current) | 1,652 | 100 | 4,019 |
| Harvey Taxi Driver | 198 | 134 | 832 |

Most of the reduction comes from replacing the dashboard's 7-second poll of
three endpoints. Location posts **increase**: idle positions are now sent,
which dispatch needs to be correct. These are per active driver, under the
assumption that the dashboard stays open all shift.

**Production context (read-only `pg_stat_statements`, 2026-04-04 to
2026-10-03):** 28 drivers, 1 online, 5 rides and **0 offers** in the last
30 days. The heaviest database callers are server background loops, not
driver clients: `system_flags` reads (375k calls), a `dispatches` status
poll (293k) and ride dispatch sweeps. At today's volume the app split will
not visibly change database load, and no saving is claimed for it.
Recommended separately: a short in-process cache for `getSystemFlag` (with
care for the kill switches) and a review of the `dispatches` poll.
CPU/memory baselines need Render metrics, which this environment cannot reach.

## 5. Configuration requirements (no secret values here)

| Item | Where | Who |
|---|---|---|
| EAS project for the driver app | `cd driver-app && npx eas-cli init` (writes `extra.eas.projectId`) | Owner |
| Apple: App ID `com.harveytaxiservice.driver`, App Store Connect app record, distribution certificate and profile | EAS can create these with the Apple account (`eas credentials`) | Owner |
| APNs key for push | EAS credentials (`eas credentials -p ios` → Push Notifications) | Owner |
| `eas.json` `submit.production.ios.ascAppId` | Replace `SET_AFTER_CREATING_THE_APP_IN_APP_STORE_CONNECT` | Owner/engineer |
| Google Play: new app `com.harveytaxi.driver`; Play App Signing; upload key | Play Console + `eas credentials -p android` | Owner |
| Play service account JSON for `eas submit` | EAS secret / local file, never committed | Owner |
| Firebase project with Android app `com.harveytaxi.driver`; FCM V1 service account uploaded to EAS; `google-services.json` as EAS file variable `GOOGLE_SERVICES_JSON` | Firebase console + EAS | Owner |
| `EXPO_ACCESS_TOKEN` (optional, enhanced push security) | Render environment | Owner |
| `driver_push_tokens` migration | Staging, then production with approval | Owner approves |
| `driver_native_push_enabled` = `"true"` | `system_flags`, after push is verified on devices | Owner approves |
| Server deploy of this branch | Render | Owner approves |

Existing settings the app relies on: `DRIVER_SESSION_SECRET`, Twilio Verify
(`TWILIO_VERIFY_SERVICE_SID`), `review_account_login_enabled` (currently
`"true"` in production).

## 6. Validation status

| Requirement | Status | Evidence |
|---|---|---|
| Rider requests → eligible driver receives → accepts → both track the same trip to completion | **Tested (server, simulated payment)** | `test/server.driver-app-lifecycle.test.js` |
| No double assignment; no busy driver assigned | **Tested** | `test/db/acceptDriverOfferAtomic.db.test.js` (real Postgres races), lifecycle test |
| Authentication, account isolation, admin can't act as driver | **Tested** | `test/server.driver-app.test.js` |
| Expired offers hidden, expiry nudges the app | **Tested** | same; sync-engine expiry timer test |
| Network loss / reconnect / backoff / reconcile | **Tested (unit)** | `driver-app/__tests__/syncEngine.test.js` |
| Restart mid-trip recovers the trip and tracking | **Tested (app flow, mocked native)** | `driver-app/__tests__/App.flow.test.js` |
| Full driver UI flow sign-in → complete → offline, tracking start/retune/stop | **Tested (app flow, mocked native)** | same |
| Account deletion in-app | **Tested (app flow + existing server tests)** | same; `test/server.account-deletion.test.js` |
| Native config matches disclosures (Info.plist, Android manifest) | **Verified by `expo prebuild`** | §3; `driver-app/__tests__/config.test.js` |
| Production JS bundles compile (iOS, Android) | **Verified** (`expo export`; also in CI) | CI job `driver-app` |
| Payment gates for ordinary rides | **Unchanged** (no payment code touched); existing suites pass | `npm test` |
| Existing rider flows | **Unchanged**; full suite passes | `npm test` (1,358 tests) |
| Ride status/stream only for the ride's rider, assigned driver or admin | **Tested** (server + Chromium on the real rider page) | `test/server.ride-tracking-access.test.js`, `test/rider-tracking-token.browser.test.js` |
| Push-token migration on staging | **Applied and validated on staging** (RLS, privileges, constraints, upsert, geog trigger) | `docs/driver-app-deploy.md` |
| Backend running against staging | **Not done**: no staging server or key available | `docs/driver-app-deploy.md` |
| Background / locked-screen location on devices | **Not verified. Blocked**: needs builds and devices. Do not claim it works until D7 passes on hardware | §7 |
| Push delivery to devices | **Blocked**: needs builds, Firebase/APNs | §7 |
| Both apps together on physical devices | **Blocked** | §7 |

## 7. Physical-device test plan (must pass before submission)

Use the production-profile builds (TestFlight; Play internal testing). Use
one iPhone and one Android phone for the driver app and a second phone for
the rider. Record the device, OS, build number, result and a screen recording
for each item.

| # | Scenario | Expected |
|---|---|---|
| D1 | Install, sign in by phone code | Drive screen; onboarding status correct |
| D2 | Test-account sign-in | Works only for review accounts |
| D3 | Go online; first time | Disclosure, then the OS prompt (While Using); Android shows the ongoing notification; iOS shows the location indicator once backgrounded |
| D4 | Rider app/site requests a ride | Driver gets the offer within seconds (app open), and a push when the app is closed (flag on) |
| D5 | Offer left to expire | Disappears; ride re-dispatched |
| D6 | Accept → navigate → arrived → start → complete | Rider sees each stage and the moving car |
| D7 | Lock the screen for 10 minutes during a trip | Rider's map keeps updating; server shows fresh `last_location_at` |
| D8 | Airplane mode for 2 minutes mid-trip, then off | App shows "Reconnecting…", recovers, state correct |
| D9 | Force-quit mid-trip, reopen | Trip and tracking resume |
| D10 | Go offline | Notification and indicator disappear; server refuses location |
| D11 | Push: ride cancelled by rider while driving | Push and in-app update |
| D12 | Account → Delete account | Request recorded; signed out; can't sign back in |
| D13 | Android battery saver on, screen locked 10 min | Tracking continues (foreground service) |
| D14 | Rider app (`mobile/`) regression: book and track a ride | Unchanged behaviour |

## 8. Staged rollout and rollback

1. **Staging:** apply `driver_push_tokens` to the staging Supabase project;
   deploy this branch to a staging service; run D1–D14 with test accounts.
2. **Production backend** (with approval): apply the migration and deploy.
   Every route is additive and the location change only adds the online-idle
   case. `driver_native_push_enabled` stays off.
3. **Internal testing:** TestFlight internal and Play internal testing builds
   for Harvey Taxi staff and drivers. Turn push on, then verify D4 and D11.
4. **Store submission:** only with your approval (§9).
5. **Release:** phased release on iOS; staged rollout percentage on Play.
   Drivers can keep using the web dashboard throughout.

**Rollback:**
- Push: set `driver_native_push_enabled` to `"false"`.
- App: pause the phased or staged rollout; drivers use the web dashboard.
- Server: redeploy the previous commit. The new routes have no other
  callers, and the location change only widens acceptance.
- Table: `drop table public.driver_push_tokens;` (tokens only).

## Blockers and earliest submission

**Status: not ready to submit.** Nothing has been built, uploaded or submitted.
The step-by-step owner checklist is `docs/driver-app-release-checklist.md`;
production deployment is `docs/driver-app-deploy.md`.

| Blocker | Needed from |
|---|---|
| This environment can't reach Expo/EAS, App Store Connect or Google Play (network policy), and there is no `EXPO_TOKEN` | Owner: environment settings, or run the EAS commands locally |
| EAS project, Apple app record, Play app, signing, APNs, Firebase/FCM | Owner (Apple and Google accounts) |
| Physical-device testing D1–D14 | Owner or tester with devices |
| Privacy policy: updated on this branch; needs your confirmation of the contact address (`support@harveytaxiservice.com`) and the production deploy | Owner |
| Real screenshots | Need builds on devices or simulators |
| Google Play testing requirement: personal developer accounts created after November 2023 must run a closed test with 12+ testers for 14 days before production | Owner to confirm the account type |
| Background-location and foreground-service declarations in Play Console (with a short video) | Owner, using the text in `docs/driver-app-store.md` |
| Approvals: server deploy, production migration, push flag | Owner |

**Earliest realistic submission**, assuming the access above is granted on
Monday 2026-10-05 and the device tests pass first time:

- **App Store:** builds and TestFlight about 2026-10-06; device testing
  2026-10-06 to 07; submit for review about **2026-10-08**.
- **Google Play:** internal testing the same week. Production submission
  about **2026-10-08** for an organization account; at least 14 days later
  (about **2026-10-22**) if the 12-tester closed-test rule applies.

Store review time is outside our control.
