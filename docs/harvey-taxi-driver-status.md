# Harvey Taxi Driver: status

**Last updated: 2026-10-11 14:30 (UTC).** Shared record: [project-status.md](project-status.md). Rider app: [harvey-taxi-mobile-status.md](harvey-taxi-mobile-status.md). Detailed device log: [driver-app-test-record.md](driver-app-test-record.md).

Labels: **[Verified]** checked on the date shown · **[Owner decision]** · **[Recommendation]** · **[Unresolved]**.
"Built", "uploaded", "installed", "internal testing" and "publicly released" are separate states.

## 1. Identity

| Item | Value | Basis |
|---|---|---|
| App | Native Expo app (`driver-app/`), separate from the rider app | Repository |
| iOS | Bundle `com.harveytaxiservice.driver`, App Store Connect Apple ID **6818705885** | `driver-app/app.json`, `eas.json` |
| Android | Package `com.harveytaxi.driver`; existing **Harvey Taxi Driver** app in Google Play | `driver-app/app.json`. The Play app was confirmed by the owner on 2026-10-04 and 2026-10-08. |
| EAS project | `@williebee615/harvey-taxi-driver`, ID `0a1de77e-7850-4378-b46c-9c21ba80a094` | `driver-app/app.json` |
| Version | 1.0.0. Build numbers are managed remotely by EAS. | `driver-app/eas.json` |

## 2. Versions (each state separately)

| State | iOS | Android |
|---|---|---|
| **Built** | **1.0.0 (13)** from `main` at `ac45c9a` on 2026-10-08. Earlier builds: 5, 6, 12. | **versionCode 11** (1.0.0) AAB from the same commit on 2026-10-08. Earlier: 6, 10. |
| **Uploaded** | 1.0.0 (13) uploaded to App Store Connect. Shown as **Complete**, with the approved Driver icon. **[Verified 2026-10-10, owner screenshot]** | AAB uploaded to Play Console |
| **Attached / internal testing** | 1.0.0 (13) attached to version 1.0, **Manual release** selected and saved, **not submitted for review**. **[Verified 2026-10-10, owner]** | **Released to internal testing** 2026-10-08 at 9:16 AM CDT, list "Harvey Taxi Testers" (3 users). **[Verified 2026-10-08, owner]** |
| **Installed** | **[Unresolved]** for build 13 | Installed on the owner's Android phone, signed in as the review driver; push registrations arrived 2026-10-08 14:22 UTC. **[Verified]** |
| **Publicly released** | **No** | **No** |

**[Owner decision 2026-10-11, supersedes 2026-10-10]** The owner authorized **submitting version 1.0 with existing build 1.0.0 (13) for Apple review**, with these conditions:
- **Manual release** stays selected.
- Build 13 stays rules-based, with no third-party AI calls.
- No new build, paid upgrade, public release or African-market activation.

The earlier "never submit build 13" rule (2026-10-10) is replaced. The consent build (#210) remains the next driver build, subject to separate approval.

### Pre-submission verification (2026-10-11) **[Verified]**

| Check | Result |
|---|---|
| Build in EAS | `be70953b-5316-44b7-b89c-efbaf2f63c8f`: 1.0.0 (13), FINISHED, production profile, commit `ac45c9a` |
| Build 13 source tests | Driver app at `ac45c9a`: 82/82 passed |
| No third-party AI for build 13 | Build 13 sends no `ai_label` capability, so the server returns `app_lacks_ai_label` before any model call. The review driver is also not on `agent_model_test_accounts` (now `["rider:RIDER_GPLAY_REVIEWER"]`). `agent_model_usage` shows **0 driver model calls since 2026-10-10 11:47 UTC**; the last was 2026-10-08. |
| Review accounts | `DRIVER_GPLAY_REVIEWER`: active, approved (offline). `RIDER_GPLAY_REVIEWER`: active, approved. `review_account_login_enabled` = true. No ride left active. |
| Review ride flow | iPhone running **1.0.0 (13)** was signed in as the review driver (push token updated 2026-10-10 12:39 UTC). Review ride `RIDE-1D07F81495` completed with that driver at 12:52–12:55 UTC, with no payment taken. Server review-flow and model-eligibility tests on main: 91/91 passed. |
| Public URLs | Privacy policy, support, driver deletion, home and terms all return 200. The privacy policy covers driver location (including background), deletion and the support contact. |
| Screenshots | 6 iPhone (1242×2688) and 6 iPad (2048×2732), RGB, no transparency, from #209 |
| App Store Connect | **Not reachable from this environment** (network policy), and no App Store Connect API private key is available here. Listing entry and the final Submit are done by the owner. |

## 3. Signing, push, allowance and scheduled checks

| Item | Status (names and locations only) |
|---|---|
| iOS signing and upload | Stored in **EAS**. App Store Connect team key "EAS Submit Harvey Driver" (App Manager) assigned on 2026-10-08. **[Verified 2026-10-08]** |
| Android push | FCM V1 service-account key assigned to `com.harveytaxi.driver` in EAS. `GOOGLE_SERVICES_JSON` is an EAS **file** variable in the `production` environment. Firebase project `harvey-taxi-driver`. **[Verified 2026-10-08]** |
| Android signing | EAS-managed upload key; Play App Signing |
| Build allowance (EAS Free) | iOS **15/15 used** until 2026-11-01 00:00 UTC. Android **12/15 used** (3 left) as of 2026-10-10. **[Verified 2026-10-10]** |
| Scheduled | No driver build is scheduled. The 1 November rider routine starts a driver build **only** if the owner has explicitly approved it (and #210 is merged). |

## 4. Driver features

| Area | Status |
|---|---|
| Onboarding / sign-in | Phone sign-in and review-account email sign-in. Sign-up opens the website. Account deletion is in the app and on the web. |
| Online / offline | Android build 11: online, "Sharing location", ongoing notification, then offline. **Pass [Verified 2026-10-08, D3]** |
| Offers | 45-second offer window (verified 2026-10-04). In-app offer sound pass on Android (2026-10-04). Vibration **[Unresolved]**. |
| Notifications | Push for offers with the app backgrounded, locked or force-quit: **[Unresolved]** on iOS and Android |
| Navigation | Trip map with Mapbox (Android pass, 2026-10-04). Hand-off to external navigation **[Unresolved]**. |
| Trip completion | Accept → arrived → start → complete: pass (iOS build 5, 2026-10-03; Android, 2026-10-04) |
| Earnings | Trips and earnings screens are in the app. A device check on build 13/11 is **[Unresolved]**. |
| Delivery labels, driver guide, "Answered by…" attribution, approved icon and splash | Included in build 13/11 (from `ac45c9a`) |

## 5. AI consent and labeling by build

| Build | AI label | Consent notice | Model answers |
|---|---|---|---|
| iOS 1.0.0 (13), Android 11 | Shows "Answered by…" attribution; **no AI label** | No | **Never.** The server gives model answers only to builds that display the AI label. The review driver is also removed from the model list (2026-10-10). Answers are rules-based. |
| Next build (after #210 merges) | "AI-generated by Harvey Assistant" | Yes, never shown while driving | Only with consent, and only within the test-account scope and the $10 cap |

## 6. Driver documents, markets and commission

- **Documents:** US onboarding is unchanged. Per-market document lists for Zimbabwe, Nigeria and Ghana are drafted in #213. They are **[Unresolved]** until confirmed locally.
- **Market restrictions:** all African markets are in test mode (#213, unmerged). **Dispatch does not yet match drivers by market (blocker).**
- **Commission settlement (Africa, sandbox only):**
  - #216: in-app EcoCash marketplace design. The provider model is unconfirmed.
  - #217: cash trips with a driver commission ledger. Commission is settled before the **next shift** and never during an accepted or active trip.
  - #217 safeguards: dispute safeguards and an audited admin override.
  - In-app trips are excluded from the ledger only when their commission collection is verified.
  - **The 15% in the preview is a demonstration rate, not approved.**
  - Driver app screens for this are **not built** and would need a driver build.
- Merge order: #213 → #216 → #217. All are drafts. **[Verified 2026-10-11]**

## 7. Real-device tests, icon and submission blockers

| Item | Status |
|---|---|
| iOS build 5 (2026-10-03) | D2 sign-in, D3 online, D4 offer, D6 trip steps: **pass** |
| Android (2026-10-04, 2026-10-08) | Drive screen, offer sound, map, rider location, trip completion, D3: **pass**. Final permissions **verified 2026-10-08**. |
| iOS build 13 on a device | **[Unresolved]**: no results recorded |
| Locked-screen location; push (both platforms); offline; deletion; iPad | **[Unresolved]** |
| Icon | The approved HTS DRIVER icon is in build 13. The App Store Connect header shows it after the build was attached. **[Verified 2026-10-10, owner]** The Android adaptive icon and splash were approved from previews on 2026-10-08. |
| Listing | Materials in `store-screenshots/ios-6.5`, `store-screenshots/ipad-13` and `docs/driver-app-store.md`. #209 refreshes the changed screenshots for build 13. The owner reported blank fields in App Store Connect, so the repository notes are **not proof** the values are saved in Apple. |

**Submission of 1.0 (13): authorized 2026-10-11.** Remaining steps, all done by the owner in App Store Connect:
1. Enter and save the listing fields.
2. Upload the replacement screenshots.
3. Complete App Privacy.
4. Fill in App Review contact and sign-in details.
5. Add for Review → Submit.

Still unverified on devices: push notifications and locked-screen tracking. These are not Apple submission requirements, but they affect the review experience.

## 8. Next actions

1. **[Owner decision needed]** Approve #212 → #210 (merge, migration, deploy).
2. **[Owner decision needed]** Approve a driver iOS build with consent in the 1 November allowance. An Android build could use one of the 3 remaining builds before then, after #210.
3. **[Owner]** Run the push and locked-screen tests (D4a–D4d, D11, D13) on Android build 11.
4. **[Owner]** Re-enter the listing fields from #209 and confirm they saved.

## 9. Session handoff (2026-10-11)

**Completed:**
- #217 safeguards.
- #216 unconfirmed-claims labelling.
- This record created.

**Remaining:**
- The approvals above.
- The consent build.
- Device tests.
- Listing fields.

**Next authorized action:** none for the driver app. Builds, merges and submissions all need new approval.
