# Harvey Taxi iOS app: build and release verification

App Store app: **Harvey Taxi Mobile**, the existing public listing: Apple ID
`6761548295`, iOS bundle ID `com.harveytaxi.HarveyTaxi` (capitalization is
exact; confirmed from App Store Connect on 10 October 2026). Android package
`com.harveytaxi.app` (unchanged). Both are built from this `mobile/`
directory. The root `app.json` (`com.harveytaxi.mobile`) is not a buildable
Expo project and is not used for App Store builds.

An App Store Connect record's bundle ID can't be changed, so a build reaches
Harvey Taxi Mobile only if it is built with `com.harveytaxi.HarveyTaxi`.
`mobile/__tests__/storeConfig.test.js` pins both identifiers, checks they
differ from Harvey Taxi Driver's, and checks the production image uses
Xcode 26.

Apple rejected the last upload to this record, 1.0.1 (10), for two reasons;
the next build must fix both:

- **90054** (bundle identifier changed): it was built as
  `com.harveytaxi.app`. Fixed by `ios.bundleIdentifier` above.
- **90725** (built with the iOS 17.5 SDK): it was built on Expo SDK 51 with
  Xcode 15.4. This directory is now on Expo SDK 54, and the `production`
  profile pins `macos-sequoia-15.6-xcode-26.0` (iOS 26 SDK).

The second record, **Harvey Taxi** (`6761441561`, bundle
`com.harveytaxiservice.app`), received builds from 30 September to 4 October
2026 (1.0.1 (10) from `03b00fe`, 1.0.2 (11-13)) after `mobile/app.json` was
switched to that bundle ID. It is kept, but rider updates no longer go
there. None of the existing EAS builds carries `com.harveytaxi.HarveyTaxi`,
so a new build is required.

## Signing for `com.harveytaxi.HarveyTaxi` (before the next build)

EAS has no credentials for this bundle ID yet. Before building, an Apple
Account Holder or Admin runs, on their own computer:

```sh
cd mobile
npx eas-cli credentials -p ios
```

Choose the `production` profile, sign in to Apple, reuse the existing team
distribution certificate, and let EAS create an App Store provisioning
profile for `com.harveytaxi.HarveyTaxi` (the App ID already exists, because
the record exists). Then assign the team App Store Connect API key to this
project for submissions. The app needs no extra capabilities or entitlements
(no push, associated domains or app groups), so the plain App ID is enough.
None of this uses a build credit.

## Build

```sh
cd mobile
npm ci
npm test
npx eas-cli build --platform ios --profile production
```

- Marketing version: `expo.version` in `app.json` (currently `1.0.2`, for the
  rider-navigation release below; 1.0.1 build 10 stays as submitted).
- Build number: managed by EAS (`cli.appVersionSource: "remote"` in
  `eas.json`); the `production` profile auto-increments it. EAS keeps build
  numbers per bundle ID and has none yet for `com.harveytaxi.HarveyTaxi`, so
  the first build starts from `expo.ios.buildNumber` (`10`) and increments
  to 11. Check the number in the build log before uploading.
- EAS project: `@williebee615/harvey-taxi`
  (`ae7e5a71-4f7c-45d8-8b7e-e0ef4de507b2`).

## TestFlight upload (private testing only)

```sh
npx eas-cli submit --platform ios --latest
```

`submit.production.ios.ascAppId` (`6761548295`) lets EAS upload with the App
Store Connect API key stored with EAS (team key, assigned to this project with
`npx eas-cli credentials -p ios`), with no key file or Mac path in this repo. This uploads the build
to App Store Connect for TestFlight; it does **not** submit it for App Review.
Submitting for review is a separate, manual step in App Store Connect.

- **Do not submit for App Review** until the clean-install matrix below passes on a release
  build.

## Clean-install verification on iPad (release build, not Expo Go)

Install the EAS build through TestFlight, or install the simulator build
(`npx eas-cli build --profile ipad-simulator --platform ios`; same release JavaScript bundle, simulator architecture)
on an **iPad Air 11-inch (M3)** simulator running the newest available iPadOS.
Delete the app before each run, so there are no cookies or stored session.

| # | Scenario | How | Expected |
|---|---|---|---|
| 1 | Normal network, cold launch | Launch after install | Splash, then branded "Connecting…", then the Harvey Taxi site. There is never a black or white blank screen. |
| 2 | Slow network | Network Link Conditioner "3G" or "Very Bad Network" | The "Still connecting…" hint appears after 8 s. Either the site loads or, at 30 s, "Connection is taking too long" appears with **Try Again**. |
| 3 | Offline at launch | Airplane mode, then launch | "You're offline" with **Try Again**. |
| 4 | Recovery | From #3, turn the network on and tap **Try Again** | The site loads. |
| 5 | Recovery on return | From #3, background the app, turn the network on, reopen | It retries on its own and the site loads. |
| 6 | Background and reopen | With the site loaded, background for more than 1 min, then reopen | The site is still showing, or reloads automatically. It is never blank. |
| 7 | Rotation and multitasking | Rotate the iPad, then use Split View or Stage Manager | Content fills the window with no black bars and respects safe areas. |
| 8 | Links | Tap a phone link or email link on the site | It opens Phone or Mail. The app is not left on a blank page. |

Record the device, OS version, build number and a screen recording of #1, #3
and #4 in the pull request before submitting.

## Android: verify before any Play build

The repository cannot show whether an Android app already exists on Google
Play. It contains Google Play reviewer-account support (server and
`scripts/seed-review-accounts.js`), which suggests an earlier Play listing
or review, but no Android signing setup, Play track, `versionCode` history
or submit config. Before building for Play, the owner checks:

1. **Play Console:** is there an existing app, and what is its package name?
   If it is not `com.harveytaxi.app` (the Android package), do **not** create another Play Console
   app. Bring `android.package` in line with the existing app instead.
   A package name can never be changed after the first upload.
2. **Signing:** Play App Signing status and the upload key. If an upload
   key already exists, EAS must use it (`npx eas-cli credentials`, Android,
   upload the existing keystore). Letting EAS generate a new key would make
   the upload fail.
3. **Release history:** the highest `versionCode` already uploaded. EAS
   manages version codes remotely (`appVersionSource: remote`), so set it
   above that number first (`npx eas-cli build:version:set --platform android`).
4. Only then build `android-play-internal` and upload to internal testing.

None of this changes iOS. The iOS profile, its build number and the
1.0.1 (10) review are not touched.

## Rider navigation release (1.0.2)

This release changes the app shell only. It needs a **new native build on
both platforms** because it adds the `harveytaxi://` URL scheme (`expo.scheme`).
It does not change, rebuild or replace iOS 1.0.1 (10).

| Platform | Build | Notes |
|---|---|---|
| iOS | 1.0.2, next EAS build number (11 or higher, assigned by EAS) | `npx eas-cli build --platform ios --profile production`, then TestFlight. Do not attach it to the 1.0.1 (10) review. |
| Android (device testing) | 1.0.2 test APK | `npx eas-cli build --platform android --profile android-test`. Installs directly on test devices; nothing goes to Google Play. Verify the items below first only if the APK will later be replaced by a Play build on the same devices. |
| Android (Play internal testing) | 1.0.2 `.aab` | `npx eas-cli build --platform android --profile android-play-internal`. **Only after the Android verification below.** Upload manually to the **internal testing** track; there is no automatic submit config for Android. |

Behaviour:
- **Launch:** a signed-in rider lands on the rider dashboard. The site's own
  `GET /api/rider/session` check decides this, using the WebView's session
  cookie; the app never reads the cookie. A signed-out visitor sees the home page.
- **Links:** `harveytaxi://book[?mode=]`, `harveytaxi://ride/<id>`,
  `harveytaxi://dashboard` and `https://harveytaxiservice.com/...` links open
  that exact screen. They are never replaced by the launch redirect.
- **Android Back:**
  - booking or tracking → dashboard (the page's own "Back to Dashboard");
  - other site pages → previous page;
  - dashboard or home → leaves the app, the standard top-level behaviour.
- **iOS:** the edge swipe walks the WebView history (`allowsBackForwardNavigationGestures`).
  Booking and tracking are history entries over the dashboard, so swiping back
  from them returns to the dashboard.

Not covered by this release:
- **Push notifications:** ride notifications are Web Push and are not delivered
  inside the app. Tapping one opens the browser.
- **Universal Links / Android App Links:** `https://` links from SMS or email open
  the browser, not the app. That needs `associatedDomains` / `intentFilters`, plus
  `apple-app-site-association` and `assetlinks.json` served by the site. Only
  `harveytaxi://` links open the app today.

### Device checklist (release build, both platforms unless marked)

| # | Scenario | Expected |
|---|---|---|
| N1 | Fresh install, launch | The home page appears, with no flash of the dashboard. |
| N2 | Sign in, force-quit, relaunch | The dashboard opens directly, with no home-page flash. |
| N3 | Dashboard → Request a Ride → Android Back / iOS edge swipe | Returns to the dashboard; no ride is created. |
| N4 | From the payment step (card authorized), Back | Dashboard with the "no ride was requested" notice; no ride is created. |
| N5 | Active ride → Open Live Tracking → Back / swipe | Dashboard with the active ride. |
| N6 | Android: Back on the dashboard | The app goes to the background; reopening shows the dashboard. |
| N7 | Android: Support page → Back | Previous page. |
| N8 | Open `harveytaxi://ride/<real ride id>` (Notes app or `adb shell am start -d`) with the app closed, then again with it open | The tracking screen for that ride opens, not the dashboard and not a new booking. |
| N9 | Open `harveytaxi://book?mode=airport` | The booking screen in Airport mode. |
| N10 | Session expired or revoked (sign out on another device, or wait out the session TTL), relaunch | The home page or sign-in screen; no rider data is shown. After sign-in the dashboard shows. |
| N11 | Airplane mode at launch, then network on and Try Again | Offline screen, then the home page or dashboard per the session. |
| N12 | Android: background the app for 30+ minutes, reopen | Still signed in, with no blank screen. |
