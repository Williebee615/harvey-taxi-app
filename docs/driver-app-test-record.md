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

## Changes prepared from these results (not live)

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
