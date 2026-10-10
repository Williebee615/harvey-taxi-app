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

> Harvey Taxi Driver is for approved drivers. Please use the test account:
>
> 1. On the sign-in screen, tap **Test account sign-in**.
>    Email: **[owner: review driver email]** Password: **[owner: password]**
> 2. Tap **Go online** and allow location access ("While Using").
> 3. To create a ride request, open https://harveytaxiservice.com on another
>    device (or the Harvey Taxi app), sign in with the test rider account
>    (Email: **[owner]** Password: **[owner]**), and request a ride. Test rides
>    use simulated payment; no card is charged.
> 4. The request appears in the driver app within a few seconds. Accept it,
>    then use the buttons to mark arrival, start and complete the trip.
> 5. Account → Delete account shows the deletion flow (for the test account
>    it is simulated, so the account stays available for review).
>
> Location: the app asks only for "While Using" access. While the driver is
> online or on a trip, updates continue in the background (location
> background mode; iOS shows the location indicator) so riders can follow the
> car and dispatch can match nearby requests. Tracking stops when the driver
> goes offline.

The test accounts exist in production (`DRIVER_GPLAY_REVIEWER`,
`RIDER_GPLAY_REVIEWER`) and `review_account_login_enabled` is on. Keep it on
until review finishes. The review driver must be **online** to receive the
reviewer's ride.

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

## App Store Connect: values entered for app 6818705885

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

The owner entered this listing in App Store Connect for **Harvey Taxi Driver
(6818705885)** on 2026-10-03; none of it belongs to Harvey Taxi Mobile
(6761548295). It stays as entered except for the items below.

| Item | Status |
|---|---|
| Build | 1.0.0 (13) attached and saved; HTS DRIVER icon shown under Included Assets |
| Export compliance | Answered by the build: `usesNonExemptEncryption: false` |
| Screenshots | Replace 02, 03, 04 (see Screenshots) and put 01 last |
| Description | One added line for Harvey Assistant, which is on for all drivers (`agent_assist_enabled`) and shown in the screenshots |
| Review account hours | Review accounts get no hours data, so App Review can't hit the 12-hour limit |
| Version release | **Manually release this version** (owner to select and save) |
| Third-party AI (guideline 5.1.2(i)) | **Blocking. Resolve before submitting.** See below. |

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
