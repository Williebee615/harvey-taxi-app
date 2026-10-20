# Harvey Taxi Driver — store materials (drafts for owner approval)

Everything here describes what the app actually does in `driver-app/` and the
server on this branch. Change the app first, then this text, never the
reverse. Items marked **[owner]** need facts only you have.

## Listing

| Field | App Store | Google Play |
|---|---|---|
| Name | Harvey Taxi Driver | Harvey Taxi Driver |
| Subtitle / short description | Drive with Harvey Taxi | Accept and complete Harvey Taxi rides as an approved driver. |
| Category | **Navigation** (recommended; secondary: Business) | **Maps & Navigation** |
| Support URL | https://harveytaxiservice.com/support.html (contact section with support@harveytaxiservice.com added in the support-page PR) | same |
| Privacy policy URL | https://harveytaxiservice.com/privacy-policy.html (update first, see below) | same |
| Account deletion URL (Play) | — | https://harveytaxiservice.com/settings.html?account=driver#account-deletion |
| Marketing URL | https://harveytaxiservice.com | — |
| Age rating | 4+ (no objectionable content; no user-generated content shown) | Everyone; IARC questionnaire: no violence, no UGC, location shared with other users (riders) during a trip |
| Price | Free | Free |

**Description (both stores):**

> Harvey Taxi Driver is the app for approved Harvey Taxi drivers in the
> Nashville area.
>
> • Go online and offline with one tap
> • Get ride requests with pickup, drop-off and estimated fare, and accept or decline before the timer runs out
> • Navigate to pickup and drop-off in your maps app
> • Mark arrival, start and complete each trip
> • See your earnings and trip history
> • Reach support or call 911 from the app
> • Ask Harvey Assistant about going online, ride offers, your next trip step, earnings and support
>
> While you're online or on a trip, the app shares your location with Harvey
> Taxi, including when the app is closed or the screen is locked. That's how
> nearby riders are matched with you and how riders see you arrive. Location
> sharing stops when you go offline.
>
> You need an approved Harvey Taxi driver account. Apply at harveytaxiservice.com.

**Keywords (App Store, 100-character limit, commas without spaces):** `taxi driver,rideshare,driver app,Nashville,ride requests,driver earnings,trip history` (85 characters; the app name is indexed already, so it is not repeated)

## App icon

**Approved by the owner (2026-10-03):** `driver-app/assets/icon.png`
(1024×1024, no transparency), also used as the Android adaptive-icon
foreground. It is the Harvey Taxi artwork with a "DRIVER" band, so it is
distinct from the rider app's icon on a home screen.

## App Review notes (App Store) / app access instructions (Play)

Rewritten 2026-10-11 for build 1.0.0 (13). Paste the quoted text into **App Review Information → Notes**. Enter the two test accounts' emails and passwords only in App Store Connect's sign-in fields and in the bracketed places below. They are never written in this repository.

> **Harvey Taxi Driver — App Review notes (version 1.0, build 13)**
>
> Harvey Taxi Driver is for approved drivers. The test driver account below is already approved, so you can try every driver feature. **Everything in this demonstration is simulated: test rides involve no real rider or driver, no card is ever needed or charged, and earnings shown to the test account are simulated amounts.** No staff action is needed at any point.
>
> **Accounts (both are App Review test accounts)**
> - Driver (this app): Email [driver review email] · Password [driver review password]
> - Rider (website, to create a ride): Email [rider review email] · Password [rider review password]
>
> **1. Sign in and onboarding**
> On the sign-in screen tap **Test account sign-in** and use the driver account. To see how new drivers apply, tap **Apply to drive** on the sign-in screen: it opens our application form on harveytaxiservice.com. Please only view it. Submitting it starts identity and background checks for a real applicant, and the test account is already approved.
>
> **2. Go online**
> Tap **Go online**. The app explains location use, then asks for "While Using" access; please allow it. A gold "App Review demonstration" card shows each next step. Keep the app open on screen while you wait for the ride.
>
> **3. Create a test ride (second device or a computer browser)**
> Open https://harveytaxiservice.com/rider-dashboard.html, tap **App Review Sign-In** and sign in with the rider account. Tap **Request a Ride → Driver Ride → Confirm Service**, enter any Nashville pickup and destination, review the fare estimate, continue with **simulated payment (no card)**, and tap **Request Dispatch**. Test rides are offered only to the test driver, and only while it is online.
>
> **4. Offer, navigation and trip**
> Within a few seconds the offer appears on the **Drive** tab. Tap **Accept within 45 seconds**; if it expires, request again from the website. Then tap, in order:
> - **Start driving to pickup**
> - **I've arrived at pickup**
> - **Start trip (rider is in the car)**
> - **Complete trip**
>
> **Navigate to pickup** and **Navigate to drop-off** open directions in your maps app; they're optional. The rider page follows each step.
>
> **5. Earnings and history**
> Open the **Earnings** and **Trips** tabs to see the completed test ride, marked "Test ride: Simulated". Earnings for the test account carry the note "Test account: amounts are simulated."
>
> **6. Support and Harvey Assistant**
> The **Account** tab has the support contact and an **Emergency · call 911** button. It asks "Call 911?" before dialling; please choose Cancel. The **Harvey Assistant** bar on the **Drive** tab answers questions about going online, offers, trip steps, earnings and support. In this build every answer comes from Harvey Taxi's own rules and published pages. **No question is sent to any third-party AI service.**
>
> **7. Account deletion**
> **Account tab → Delete account** shows the full deletion flow. For the test account it is simulated, so the account stays available.
>
> **Location:** the app asks only for "While Using" access. While the driver is online or on a trip, location updates continue in the background (iOS shows the location indicator), so riders can follow the car and nearby rides can be offered. Tracking stops when the driver goes offline.
>
> If anything doesn't work as described, the website's test ride page shows what to do next. Questions: support@harveytaxiservice.com.

Checked against production on 2026-10-11:
- The rider review sign-in panel and the reviewer guide are live on `rider-dashboard.html`.
- Test rides are created with payment "not required". The latest review ride (`RIDE-1D07F81495`, 2026-10-10) completed on build 13 with no payment.
- The driver review account has 0 AI model calls since 2026-10-10.

### What reviewers can and can't see in build 13

| Feature | In build 1.0.0 (13) | Planned for a future build |
|---|---|---|
| Test-account sign-in, approved driver status, "Apply to drive" link | Yes | — |
| Go online / offline, location disclosure | Yes | — |
| Ride offers (45-second window), accept/decline | Yes, while the app is open | Offer push notification with the app in the background or locked: built, **not verified on an iPhone** |
| Navigation hand-off, arrived/start/complete | Yes | — |
| Earnings and trip history (test amounts marked simulated) | Yes | — |
| Support contact, 911 button, account deletion (simulated for test accounts) | Yes | — |
| Harvey Assistant | Yes, rules-based only. No third-party AI. "Answered by…" attribution. | AI-written answers with the "AI-generated by Harvey Assistant" label and an in-app permission step (#210). They need a new build and owner approval. |
| Reviewer demo without the website ride (simulated rider, automatic offer) | No. The feature exists on the server (#199) but is switched off. | Owner decision |
| Africa markets, cash commission | No | Sandbox only (#213, #216, #217) |

## Apple App Privacy (nutrition label)

Data collected by the app, all **linked to the user**, **not used for
tracking**:

| Data type | Purpose | Notes |
|---|---|---|
| Precise location | App functionality | Only while online or on a trip |
| Name | App functionality | Account (first name shown) |
| Phone number | App functionality | Sign-in |
| Email address | App functionality | Test-account sign-in; account record |
| User ID | App functionality | Driver id |
| Device ID | App functionality | Push token |
| Other financial info | App functionality | Earnings history shown to the driver |
| Customer support | App functionality | Harvey Assistant questions are answered and not stored. If one triggers a safety, payment or account escalation, a redacted excerpt (160 characters, with phone, email, card and token patterns removed) is kept in the human-review case. Only applies once the assistant is switched on. |

Not collected by this app: contacts, photos, health, browsing history, search
history, diagnostics or crash data (no analytics or crash SDK), advertising
data. Identity and background-check data are collected on the website by
Persona and Checkr, not in this app.

## Google Play Data safety

- **Collected:** approximate and precise location; name; email address; phone
  number; user IDs; device or other IDs (push token); other financial info
  (earnings).
- **Shared with third parties:** none in the Play sense. Service providers
  (hosting, Twilio for SMS codes, Expo/Google/Apple push, Mapbox for arrival
  times) process data on Harvey Taxi's behalf. Riders see the driver's location
  and first name during a trip.
- **Purposes:** app functionality, fraud prevention/security (sign-in), account
  management.
- **Location collected in the background:** yes, while online or on a trip.
- **Encrypted in transit:** yes (HTTPS only).
- **Deletion:** users can request deletion in the app and at the deletion URL.
- **Required or optional:** location is required to go online; push
  notifications are optional.

### Play Console declarations

**Foreground service (type: location)**
> Harvey Taxi Driver runs a location foreground service only after the
> driver taps "Go online", and while they have an active trip. It keeps
> sending the driver's position so the rider can see the car approach and so
> dispatch can offer nearby rides, including when the screen is locked. An
> ongoing notification ("Harvey Taxi Driver is online") is shown the whole
> time. The service stops when the driver goes offline.
> Video: **[owner: record go online → lock screen → rider sees movement → go offline]**

**Background location permission:** not requested
(`ACCESS_BACKGROUND_LOCATION` is removed from the manifest).

**Prominent disclosure (shown in the app before the location prompt):**
> Harvey Taxi Driver uses your location only while you are online or on a
> trip, including when the app is closed or the screen is locked. It is used
> to send you nearby ride requests, show riders where you are, and calculate
> arrival times. Tracking stops when you go offline.

## Screenshots

Use real builds where possible (iOS simulator build or
TestFlight; Android internal-testing build), signed in as the test driver:

1. Drive screen, online
2. Ride request with timer
3. Active trip: navigate, next step
4. Earnings
5. Trip history
6. Account (support, delete account)

Sizes: iPhone 6.5" (1242×2688), iPad 13" (2048×2732); Android phone
1080×1920 or larger. The app is portrait-only. iPad is supported
(`supportsTablet` on, `requireFullScreen` on, so portrait-only is allowed on
iPad); screens keep a 680-point centred column there instead of stretching.

Prepared (rendered from the app's real screens with test data, no personal
information): `store-screenshots/ios-6.5/` and `store-screenshots/ipad-13/`.

**Checked against build 1.0.0 (13) on 2026-10-10** by re-rendering every
screen from that build's source (commit `ac45c9a`) with the same test data:

| Screenshot | Result |
|---|---|
| 01 sign-in, 05 trips, 06 earnings | Pixel-identical to build 13. Keep the uploaded images. |
| 02 online, 03 ride offer, 04 active trip | Changed since 3 October. Build 13 adds the Harvey Assistant bar and the "Online this shift" hours line, and the trip card adds "I can't make this pickup". Replaced with build 13 renders (both sizes); replace these three in App Store Connect. |

The live trip map (Mapbox) appears in the trip card only when the server
supplies a map token. It is native-only and can't be rendered here, so
04 shows the card without the map. Optionally replace 04 with a screenshot
from an iPhone running TestFlight build 13 during device testing (6.5"
slot: 1242×2688 or 1284×2778).

Guideline 2.3.3 says screenshots should show the app in use, "not merely
the title art, login page, or splash screen". Upload order: 02, 03, 04,
05, 06, then 01 last (or omit 01).

## Privacy policy

Updated on this branch in `public/privacy-policy.html` (live only after the
production deploy). It now covers:
- driver location while online or on a trip, including in the background;
  only the latest position is stored;
- notification tokens and support messages;
- what riders and drivers see about each other, and before acceptance;
- named service providers: Persona, Checkr, Stripe, Twilio, SendGrid, Mapbox,
  Expo/Apple/Google push, OpenAI (support assistant), plus hosting and
  database providers; and that we don't sell personal information;
- retention: trip, payment and earnings records kept without name and phone
  after deletion; location removed on deletion;
- how to delete an account (in the app, on the website, by email) and
  exactly what deletion removes.

The public template instructions ("If you later add…", "Important Note") are
removed. **Pending:** owner confirmation of the privacy contact
`support@harveytaxiservice.com` (already published on the home page).

The deletion text matches the code. This branch extends driver deletion to
remove location, photo, addresses, license and plate numbers and push tokens
(`anonymizeAccount` in `server.js`, covered by
`test/server.account-deletion.test.js`).

## App Store Connect: other answers

| Question | Answer | Why |
|---|---|---|
| Export compliance (uses encryption) | No non-exempt encryption | HTTPS only; `ITSAppUsesNonExemptEncryption` = false |
| Sign-in required | Yes; provide the test driver account | — |
| Content rights | No third-party content | — |
| Age rating | 4+: every content question "None"; Unrestricted Web Access "No" | Policy pages open in an in-app browser, limited to our site |
| Kids category | No | — |
| Advertising identifier (IDFA) | Not used | No ad SDK |

## Play Console: App content answers

| Section | Answer |
|---|---|
| Ads | No ads |
| Target audience | 18 and over |
| News app | No |
| Government app | No |
| Financial features | None |
| Health | No |
| Data safety | As above |
| App access | Restricted: provide the test driver account and the steps above |
| Foreground service permissions | Location, with the text above and the video link |
| Content rating (IARC) | Category "Utility/Productivity/Communication/Other"; no violence, sexuality, language, drugs or gambling; users interact (rider and driver see each other's details during a trip); shares location with other users: yes |

## App Store Connect: prepared values for app 6818705885

These are the values prepared on 2026-10-03 for the owner to enter. They
are **not proof that anything is saved in App Store Connect**: on
2026-10-10 the owner's screenshots showed these listing fields blank.
Enter and save them from this table, and check each one after saving.

| Where | Field | Value |
|---|---|---|
| App Information | Subtitle | Drive with Harvey Taxi |
| App Information | Primary category | Navigation |
| App Information | Secondary category (optional) | Business |
| App Information | Content Rights | **Owner to confirm.** Draft answer: "No, it does not contain, show, or access third-party content". The app shows only Harvey Taxi's own data and the driver's own trips; directions open in the phone's maps app. |
| App Privacy | Privacy Policy URL | https://harveytaxiservice.com/privacy-policy.html |
| Version 1.0 (English US) | Description | The description above |
| Version 1.0 | Keywords | As above |
| Version 1.0 | Support URL | https://harveytaxiservice.com/support.html |
| Version 1.0 | Marketing URL (optional) | https://harveytaxiservice.com |
| Version 1.0 | Copyright | **Owner to confirm** the legal name: "2026 Harvey Taxi Service LLC" |
| Version 1.0 | Build | 1.0.0 (13), EAS build be70953b, commit `ac45c9a` (attached and saved by the owner on 2026-10-10) |
| App Review | Contact first and last name, phone, email | **Owner to provide.** Not published anywhere we can verify. |
| App Review | Sign-in required | Yes: the review driver's email and password (owner enters them in App Store Connect only) |
| App Review | Notes | The App Review notes above |

## Version 1.0.0 (13): readiness review (2026-10-10)

All listing materials in this file and in `store-screenshots/` were prepared
for **Harvey Taxi Driver (6818705885)**; none belong to Harvey Taxi Mobile
(6761548295). The owner reports the listing fields are blank in App Store
Connect, so this is what to enter, not a record of what is saved.

| Item | Status |
|---|---|
| Build | 1.0.0 (13) attached and saved; HTS DRIVER icon shown under Included Assets |
| Export compliance | Answered by the build: `usesNonExemptEncryption: false` |
| Screenshots | Replace 02, 03, 04 (see Screenshots) and put 01 last |
| Description | One added line for Harvey Assistant, which is on for all drivers (`agent_assist_enabled`) and shown in the screenshots |
| Review account hours | Review accounts get no hours data, so App Review can't hit the 12-hour limit |
| Version release | Manual release selected and saved by the owner (2026-10-10) |
| Third-party AI (guideline 5.1.2(i)) | Resolved for build 13 on 2026-10-10: the review driver now gets rules-based answers. See below. |

### Third-party AI and the review account

Verified on 2026-10-10:
- Production `agent_model_mode` is `test_accounts`, and
  `agent_model_test_accounts` includes `driver:DRIVER_GPLAY_REVIEWER`, the
  account App Review would sign in with. Its assistant questions are
  answered by Claude Haiku (Anthropic).
- Build 13 (commit `ac45c9a`) predates the "AI-generated by Harvey
  Assistant" label (#206), so the app doesn't show that an answer came from
  an AI model.
- The live privacy policy doesn't name Anthropic. The disclosure is in
  draft PR #207, which is not approved or published.
- The app has no screen that asks permission before sending a question to
  a third-party AI.

Guideline 5.1.2(i): "You must clearly disclose where personal data will be
shared with third parties, including with third-party AI, and obtain
explicit permission before doing so."

Recommended before submitting build 13 (needs owner approval; it changes a
production flag): remove `driver:DRIVER_GPLAY_REVIEWER` from
`agent_model_test_accounts`, so the review driver gets the same rules-based
answers as every other driver and no question goes to a third-party AI.
Model answers in the driver app then wait for a build with the label, an
in-app permission step and the published privacy disclosure.

**Done on 2026-10-10 (owner-approved; audit record 1283):**
`agent_model_test_accounts` changed from
`["rider:RIDER_GPLAY_REVIEWER","driver:DRIVER_GPLAY_REVIEWER"]` to
`["rider:RIDER_GPLAY_REVIEWER"]`. `agent_model_mode` (`test_accounts`) and
the rider entry are unchanged. Verified:
- the server's own `modelEligibility` on the live values returns
  `not_a_test_account` for the review driver in the driver app (with or
  without the AI label) and on the web dashboard, and for every other
  driver; the review rider is still eligible;
- `runModelTurn` returns before any Anthropic call, budget hold or usage
  row when an account isn't eligible;
- `agent_model_usage`: last driver model call 2026-10-08 15:07 UTC; none
  since the change.

Side effect: specialists use the same test list
(`agent_specialist_scope = test_accounts`), so the review driver also gets
the standard driver answers instead of the rules-based specialists. Neither
calls a model.
