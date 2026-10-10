# Harvey Assistant across the four mobile targets

Scope: the full assistant on all four apps. The website alone does not count for the rider apps, and a test run or screenshot does not count as device verification.

| # | Target | App | Store ID | How the assistant reaches it |
|---|---|---|---|---|
| 1 | Harvey Taxi (rider), iOS | `mobile/`, `com.harveytaxi.app` | App Store Connect app in `mobile/eas.json` | Native WebView shell. It loads the rider dashboard, and the assistant panel runs inside it. |
| 2 | Harvey Taxi (rider), Android | `mobile/`, `com.harveytaxi.app` | Google Play | Same shell as #1. |
| 3 | Harvey Taxi Driver, iOS | `driver-app/`, `com.harveytaxiservice.driver` | ASC 6818705885 | Native assistant screen (`AssistantScreen.js`). |
| 4 | Harvey Taxi Driver, Android | `driver-app/`, `com.harveytaxi.driver` | Google Play | Same native screen as #3. |

All four use one backend (`/api/agent/rider/assist`, `/api/agent/driver/assist`). Rider and driver have separate permissions, tools and actions.

## How each app works today (audit, 2026-10-04)

- **Rider apps (#1, #2):**
  - `mobile/App.js` is a native shell around a WebView. It opens `https://harveytaxiservice.com` and sends signed-in riders to `/rider-dashboard.html`.
  - Native code handles startup and offline screens, deep links, the Android back button, and the hand-off to the driver app.
  - Booking, maps, payments and the assistant are web pages served live, so **server and page changes reach installed rider apps without a new build**.
  - Links to the site's own HTTPS pages (including the assistant's source pages) stay inside the app; phone and email links open the phone's own apps.
  - **A new build is needed only for changes to the shell itself.** This release adds one: the shell tags its user agent (`HarveyTaxiRider/<version> (ios|android)`) so assistant usage can be counted per app.
- **Driver apps (#3, #4):**
  - Native Expo app with its own assistant screen, a "My hours" quick prompt, a sources row, Clear chat and per-account memory.
  - **Every assistant UI change needs a new driver build.**

## Four-target matrix

Key:
- **Live**: deployed on the server, so installed apps get it without an update.
- **Build**: the target needs a new app build.
- **Device**: tested on a real phone or tablet. As of 2026-10-04, **none** of the four targets has been tested on a device.

| Capability | #1 Rider iOS | #2 Rider Android | #3 Driver iOS | #4 Driver Android |
|---|---|---|---|---|
| Approved knowledge with sources (phase 1) | Live (website panel inside the app); no build needed | Same as #1 | Built; in driver iOS build 9 | Built; in driver Android versionCode 7 |
| Admin-approved articles, `/policies.html` (phase 2) | Server only; PR #182; no build needed | Same as #1 | Server only; no build needed | Same as #3 |
| Signed-in live account and trip help (read-only) | Live: ride status, fare, cancel help | Same as #1 | In build 9: offers, trip step, earnings, hours | In versionCode 7 |
| Follow-up context and **session memory** per account; Clear chat; cleared on sign-out (phase 3) | Live (#183); no build needed | Same as #1 | Merged (#180); **needs the release build** | Same as #3 |
| Support handoff: review, edit and approve; reference only after the case is saved; duplicate protection; case and email reported separately (phase 4) | Live (#184 and the handoff follow-up PR); no build needed | Same as #1 | Built (native editor; not while on a trip); **needs the release build** | Same as #3 |
| Lost-item reports (rider) and found-item reports (driver), through the handoff, optionally linked to the account's own trip | Live with the follow-up PR; no build needed | Same as #1 | Built; **needs the release build** | Same as #3 |
| Pickup or destination changes, other new ride-changing actions | **Not in this release** | Not in this release | Not in this release | Not in this release |
| Confirmed actions | Live: cancel ride (confirm), safety alert (confirm), open booking or tracking | Same as #1 | In build 9: respond to offer, trip step and navigate, each confirmed in the app | In versionCode 7 |
| Usage limits and accounting | Live (server) | Live | Live | Live |
| Usage counted per app | **Needs a new rider build** (user-agent tag); until then counted as rider website | Same as #1 | **Needs a new driver build** (sends platform); until then counted as driver website | Same as #3 |
| 911 banner and emergency escalation | Live | Live | In build 9 | In versionCode 7 |
| **Tested on a device** | **No** | **No** | **No** | **No** |

**Builds on record** (EAS):
- **Rider release builds:** iOS build 13 (`2254a1d3-4c14-4ee2-b1b4-0b201fa7e292`) and Android versionCode 11 (`79cdbcc3-4f94-4d48-95c9-171424a92b2f`), commit `fcf3fa0`. These contain the final rider shell, including the user-agent tag. Everything else reaches the rider apps from the server.
- **Driver release builds:** made after the handoff follow-up PR merges, so they contain knowledge, memory, the handoff, lost items and per-app tracking.
- **Superseded, do not upload:**
  - Driver iOS build 9 and Android versionCode 7 (phase 1 only).
  - Driver iOS build 10 and Android versionCode 8 (cancelled before finishing).

**Store uploads:** none confirmed from this environment.

## Memory, per target: session memory, not saved across app restarts

| | Rider iOS and Android (WebView) | Driver iOS and Android |
|---|---|---|
| Where | WebView session storage, per signed-in account | App memory, per signed-in account |
| Survives leaving the assistant, moving around the app, backgrounding | Yes, while the app stays running | Yes, while the app stays running |
| Survives **closing and reopening the app** | **No.** A new session starts empty. | **No.** Nothing is written to disk. |
| May be lost if the phone's OS ends the app in the background | Yes | Yes |
| Clear chat | Deletes it | Deletes it |
| Sign-out | Deletes every saved conversation on the device | Deletes every saved conversation |
| Another account on the same phone | Sees none of it | Sees none of it |
| Server | Never stored; the last 6 turns are sent only to resolve a short follow-up, and are not stored or logged | Same |

- **Signed-out riders:** the conversation stays on that page only.
- **Restored conversations** (while the app stays running) show as plain text. Earlier action buttons (for example, cancel) are not restored, so a stale action can't be used.

Keeping conversations after the app is closed would mean writing them to the phone's storage. That is a separate decision and not part of this release.

## Release plan (phased, all four targets)

1. **Server and web, no app update needed:** phase 2 (#182), rider memory, per-target accounting.
2. **Support handoff:** server and rider panel first, then the driver screen.
3. **New builds for all four targets**, so each app ships everything above:
   - Rider iOS and Android, for the user-agent tag.
   - Driver iOS and Android, for memory, support handoff and platform reporting.
4. **Owner uploads:**
   - iOS: TestFlight.
   - Android: Play internal testing.
5. **Device verification** on each of the four targets, using the checklist below. Record the device, OS version and build number for each.

## Device checklist (each target)

1. Open the assistant and ask "How long do you keep my data?". Expect a quote, a source and a date. Tap the source and confirm the page opens.
2. Ask "What's the cancellation fee?". Expect the "I don't have approved Harvey Taxi information…" reply.
3. Signed in, ask about your ride (rider) or your offers or hours (driver). Expect only your own data.
4. Ask a follow-up ("and what about my location?"). It is understood. Switch to another app and back; the conversation is still there. Then **close the app completely and reopen it**; the conversation is gone (session memory). Ask again and tap Clear chat; it is gone.
5. Sign out and sign in as a different account. The previous conversation is not shown.
6. Ask "What's the cancellation fee?", then tap **Send a request to support**. Edit the summary and tap Send twice quickly. One case reference appears, only after sending. The admin human-review queue shows one case with the right app and an email status. Tap Cancel on a second try: nothing is sent.
7. Ask "I left my phone in the car" (rider) or "A rider left a bag in my car" (driver). Tap **Report a lost item** or **Report a found item**. The draft shows your own most recent trip. Fill in the item and send. The queue shows a lost-item case linked to that trip.
8. Ask "My driver is threatening me". Expect the 911 guidance with nothing else done automatically.
9. With the admin kill switch on, the assistant says it is unavailable, and booking (rider) or going online (driver) still works.
10. Admin dashboard: the request shows under the right app (after the new builds).
