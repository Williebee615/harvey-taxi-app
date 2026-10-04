# Harvey Assistant across the four mobile targets

Scope: the full assistant on all four apps. The website alone does not count for the rider apps, and a test run or screenshot does not count as device verification.

| # | Target | App | Store ID | How the assistant reaches it |
|---|---|---|---|---|
| 1 | Harvey Taxi (rider), iOS | `mobile/`, `com.harveytaxiservice.app` | App Store Connect app in `mobile/eas.json` | Native WebView shell. It loads the rider dashboard, and the assistant panel runs inside it. |
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
| Follow-up context, memory per account, Clear chat, cleared on sign-out (phase 3) | This release; no build needed | Same as #1 | Merged (#180); **needs a new build** (not in build 9) | **Needs a new build** (not in versionCode 7) |
| Support handoff with a summary the user approves (phase 4) | Built (assistant panel); no build needed | Same as #1 | Built (native editor; not while on a trip); **needs a new build** | Same as #3 |
| Confirmed actions | Live: cancel ride (confirm), safety alert (confirm), open booking or tracking | Same as #1 | In build 9: respond to offer, trip step and navigate, each confirmed in the app | In versionCode 7 |
| Usage limits and accounting | Live (server) | Live | Live | Live |
| Usage counted per app | **Needs a new rider build** (user-agent tag); until then counted as rider website | Same as #1 | **Needs a new driver build** (sends platform); until then counted as driver website | Same as #3 |
| 911 banner and emergency escalation | Live | Live | In build 9 | In versionCode 7 |
| **Tested on a device** | **No** | **No** | **No** | **No** |

**Builds on record** (EAS):
- Rider iOS build 12 and Android versionCode 10: commit `8e8dac3`, from before the assistant work. Nothing assistant-related depends on them except the user-agent tag.
- Driver iOS build 9 and Android versionCode 7: commit `b5163a6`, phase 1 only.

**Store uploads:** not confirmed from this environment for any of these builds.

## Memory, per target

- **Where it's kept:** on the device only, for the current app session, per signed-in account, up to 12 turns. Clear chat removes it, and signing out deletes it for every account.
  - Rider apps keep it in the WebView's session storage.
  - Driver apps keep it in app memory.
- **Never on the server.** Only the last 6 turns are sent with a question, to resolve short follow-ups, and they are not stored or logged.
- **Signed-out riders:** the conversation stays on that page only.
- **Restored conversations** show as plain text. Earlier action buttons (for example, cancel) are not restored, so a stale action can't be used.

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
4. Ask a follow-up ("and what about my location?"). It is understood. Background and reopen the app; the conversation is still there. Tap Clear chat; it is gone.
5. Sign out and sign in as a different account. The previous conversation is not shown.
6. Ask "What's the cancellation fee?", then tap **Send a request to support**. Edit the summary and send. A reference appears only after sending, and the request shows in the admin human-review queue with the right app. Tap Cancel on a second try: nothing is sent.
7. Ask "My driver is threatening me". Expect the 911 guidance with nothing else done automatically.
8. With the admin kill switch on, the assistant says it is unavailable, and booking (rider) or going online (driver) still works.
9. Admin dashboard: the request shows under the right app (after the new builds).
