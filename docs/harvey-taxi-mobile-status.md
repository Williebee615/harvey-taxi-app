# Harvey Taxi Mobile (rider app): status

**Last updated: 2026-10-11 (UTC).** Shared record: [project-status.md](project-status.md). Driver app: [harvey-taxi-driver-status.md](harvey-taxi-driver-status.md).

Labels: **[Verified]** checked on the date shown · **[Owner decision]** · **[Recommendation]** · **[Unresolved]**.
"Built", "uploaded", "installed" and "publicly released" are separate states and are never merged.

## 1. Identity

| Item | Value | Basis |
|---|---|---|
| App | WebView shell of harveytaxiservice.com (`mobile/`, Expo SDK 54) | Repository |
| iOS public listing | **Harvey Taxi Mobile**, Apple ID **6761548295**, bundle ID **`com.harveytaxi.HarveyTaxi`** (exact capitalization), team `AYF633JM4W` | **[Verified 2026-10-10]** from the owner's App Store Connect screenshots; pinned in `mobile/app.json` and `mobile/eas.json` (#208, `e8d022e`) |
| Second iOS record (not used for rider updates) | **Harvey Taxi**, Apple ID 6761441561, bundle `com.harveytaxiservice.app`. Kept intact. | `mobile/RELEASE.md` |
| Android package | `com.harveytaxi.app` | `mobile/app.json`. Whether a Play Console app exists, and its signing and history, is **[Unresolved]**. |
| EAS project | `@williebee615/harvey-taxi`, ID `ae7e5a71-4f7c-45d8-8b7e-e0ef4de507b2` | `mobile/app.json` |
| Configured version | `1.0.2`. The build number is managed remotely by EAS; the next iOS build is **1.0.2 (11)**. | `mobile/RELEASE.md`; remote build number set to 10 on 2026-10-10 |

### Submissions on the "Harvey Taxi" record (2026-10-11) **[Verified 2026-10-11, owner screenshot at 4:24 PM local]**
- 11:37 AM, iOS 1.0.1: **Removed**.
- 11:45 AM, iOS 1.0.1: **Waiting for Review**. The owner described the 1.0.1 (9) submission as accidental and cancelled. The screenshot shows a second 1.0.1 submission still active, so the cancellation is **[Unresolved]** until a new screenshot shows it removed.
- The screenshot doesn't show the Apple ID; it is matched to 6761441561 by app name only **[Unresolved]**.
- **[Owner decision 2026-10-11]** Remove the 11:45 AM submission; removal not yet confirmed.
- A review-rider sign-in at 16:52 UTC was rejected with `account_not_found`: the email used doesn't match the review rider account **[Verified 2026-10-11, audit log]**. Check the rider record's App Review Information before any future submission.
- Rider AI: the review rider account currently gets Claude answers with no consent prompt (`agent_model_mode` = `test_accounts`, list = the review rider) **[Verified 2026-10-11]**. **[Owner decision 2026-10-11]** Consent comes before external AI answers; the owner decides whether to empty the list until #210 ships.
- **[Recommendation]** No rider submission until 1.0.2 (11) exists for Harvey Taxi Mobile (6761548295, `com.harveytaxi.HarveyTaxi`), built with the iOS 26 SDK (scheduled 2026-11-01). No such build exists today.

## 2. Versions (each state separately)

| State | iOS (Harvey Taxi Mobile, 6761548295) | Android (`com.harveytaxi.app`) |
|---|---|---|
| **Built** | No build exists yet with `com.harveytaxi.HarveyTaxi` and the iOS 26 SDK. Earlier builds 1.0.1 (10) and 1.0.2 (11–13) went to the wrong bundle ID. **[Verified 2026-10-10]** | Not recorded in this session **[Unresolved]** |
| **Uploaded** | 1.0.1 (10): **failed** processing with Apple errors **90054** (bundle identifier changed) and **90725** (iOS 17.5 SDK). **[Verified 2026-10-10, owner screenshot]** A stray rider 1.0.2 (13) upload to the *driver* record also failed. | **[Unresolved]** |
| **Installed** (device) | **[Unresolved]** for the store app | The owner ran a review ride on an Android phone on 2026-10-10. Whether it was the rider app or a browser is **[Unresolved]**. |
| **Publicly released** | The version currently live on the App Store is **[Unresolved]**; not read in this session. | **[Unresolved]** |

## 3. Signing, build allowance and scheduled checks

| Item | Status |
|---|---|
| iOS signing for `com.harveytaxi.HarveyTaxi` | **Done [Verified 2026-10-10].** Credentials are stored in **EAS** (Expo account `williebee615`):<br>• distribution certificate (serial ending …73466C, valid to 2027-08-26);<br>• App Store provisioning profile `2N4FG8RDSL`;<br>• App Store Connect API key `H9PTZ3FABS` assigned for submissions.<br>No key material is held in the repository. |
| IPA check before any upload | `mobile/scripts/verify-ipa.sh <ipa> 11` must print `ALL CHECKS PASSED` |
| Build allowance (EAS Free) | iOS: **15 of 15 used** for 1 Oct–1 Nov. It resets **2026-11-01 00:00 UTC**. **[Verified 2026-10-10]** Paid plan: **not approved**. The owner's Mac (MacBookAir7,2, macOS 12.7.6) can't build with Xcode 26. |
| Scheduled build check | `trig_01EQw4n15urNHMHP1dz5SrRz` at **2026-11-01 14:05 UTC**. It re-checks the allowance ($0), the profile, main and its tests, and the stored build number (10). Then it starts **one** rider iOS build and confirms "10 → 11". It **never uploads or submits**. **[Owner decision 2026-10-10]** |

## 4. Changes: website-only vs needing an app build

The rider app shows the website, so **website changes ship with a deploy and need no app build**.

| Change | Type | Status |
|---|---|---|
| #211 small-phone layout (booking, dashboard, tracking, pinned bar, status-bar clearance, assistant fit) | Website | **Live** on `47f63b4` **[Verified 2026-10-10]** |
| #212 assistant panel styling | Website | Draft, CI green |
| #210 AI consent notice for riders | Website (plus a DB migration) | Draft, CI green |
| #214 index page: Harvey Assistant replaces the OpenAI widget; Assistant nav tab on phones | Website | Draft, CI green |
| #215 sign-up and Settings: Harvey Assistant; Settings width fix | Website | Draft, CI green |
| 1.0.2 shell: `harveytaxi://` links, launch to dashboard, Android Back, iOS swipe; correct bundle ID | **Needs a new app build** (both platforms) | Code merged (#208 and earlier). iOS build scheduled for 1 November. Android build not scheduled. |
| Push notifications in the app; Universal Links / App Links | Would need a build | Not built |

## 5. Booking, tracking, dashboard and Harvey Assistant

- **Booking, tracking, dashboard:** the #211 layout fix is live. The owner's Android re-test of the review ride after #211 is **[Unresolved]**: not yet reported.
- **Harvey Assistant:**
  - The rider dashboard uses the shared assistant (rules plus approved pages; Claude only for test/review accounts, $10 cap).
  - The index page, sign-up and Settings still load the **old OpenAI widget** on production until #214/#215 deploy. **[Verified 2026-10-10, live page scan]**
  - `mobility-os-prototype.html` (unlinked) and the admin dashboard test box also use it.
- **Chat memory:** device-only, per account, cleared on sign-out (**[Owner decision 2026-10-04]**).

## 6. Real-device tests, screenshots, listing, known bugs

| Item | Status |
|---|---|
| iPad clean-install matrix (`mobile/RELEASE.md`) | Not run. Requires the new build. |
| 1.0.2 navigation checklist N1–N12 | Not run. Requires the new build. |
| Android review ride, 2026-10-10 | Found a narrow column, banner overlap, the assistant covering controls, and bottom clearance problems. These are fixed in #211 (live). **Re-test pending.** |
| Screenshots | Simulated phone screenshots only, under `docs/screenshots/rider-mobile-layout/`, `rider-navigation/` and the PR branches. These are **not device screenshots**. |
| Listing materials | The rider App Store listing exists (public). The listing text and screenshots were not reviewed in this session **[Unresolved]**. |
| Known bugs and limits | • Old OpenAI widget still on 4 public pages until #214/#215 deploy.<br>• Ride notifications are web push only (not delivered inside the app).<br>• `https://` links open the browser, not the app. |

## 7. Next actions

1. **[Owner]** Re-run the Android review ride on #211 (live) and report.
2. **[Owner decision needed]** Approve Stack A (#212 → #210 → #214 → #215), which ships as a website deploy with no rider build.
3. **Scheduled, 2026-11-01:** one rider iOS build. Then the owner downloads the IPA and runs `verify-ipa.sh`. Upload to TestFlight only with approval, then the iPad matrix and N1–N12 on the device.
4. **[Unresolved]** Android: confirm the Play Console app, package, signing and highest versionCode before any Android rider build.

## 7a. Updates 2026-10-13

These supersede the older lines above about the old OpenAI widget. #223 (merged 2026-10-12, `252d8d4`) replaced it with Harvey Assistant on every public page, and the widget files return 404 **[Verified 2026-10-12]**.

- **#224** **[Verified 2026-10-13, merged `5ece5a5`, live file byte-identical]**: rider dashboard "Home" goes to the site home page on the website; inside the rider app (user agent `HarveyTaxiRider/…`), the dashboard stays home. This is website only, with no rider build. **[Unresolved]** The owner's phone check.
- **#225** **[Verified 2026-10-13, merged `10c3ec3`, live]**: one language preference, set in Settings, followed by the home page, Settings and both sign-up pages. The rider app loads the same domain, so the preference should carry inside the app; **[Unresolved]** not tested on a device. "Open AI Support" is renamed "Open Harvey Assistant".
- **#227** **[Verified 2026-10-13, merged `3db813a`, live]**:
  - no Driver tab or driver-dashboard link on the home page, Settings or rider dashboard (the rider app already hands driver pages to Harvey Taxi Driver, so no build is needed);
  - Settings labels say Harvey Assistant;
  - bottom-bar labels fit at 360 px in 10 languages;
  - Settings deletion steps translated (es/fr/ar).
- **#229** **[Verified 2026-10-13, merged `6fb8494`, live files byte-identical]**: the language list grows to 15 (adds Hausa, Igbo, chiShona, isiNdebele, Twi; Chinese labelled Simplified, Portuguese labelled Brazil). Home and Settings selectors fit at 360 px in all 15; website only, no rider build. **[Unresolved]** not tested on a device; translations not reviewed by fluent speakers.
- **Harvey Assistant:** rules-only **[Owner decision 2026-10-13]**.

## 8. Session handoff (2026-10-13)

**Completed:**
- #222–#227 merged and verified live (website only, no rider build).

**Remaining:**
- The owner's device checks: Home button, language carry-over in the app, Android review ride.
- The 1 November build.
- iPad matrix and N1–N12.

**Next authorized action:** the 1 November rider iOS build check (build only; no upload or submission).
