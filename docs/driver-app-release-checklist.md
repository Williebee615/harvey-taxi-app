# Harvey Taxi Driver — owner checklist for everything outside the repository

Work through these in order. Each step says where to click or what to run.
Never paste tokens, keys or passwords into chat or commit them.

**Current state (2026-10-03).** Nothing below has been done yet.

| Item | State |
|---|---|
| EAS project | Not registered; only configured locally (`app.json` has no `projectId`) |
| Builds | None |
| Uploads (TestFlight, Play) | None |
| Device tests | None |
| Store submissions | None |

## A. Give this environment access (or run the EAS steps on your own computer)

1. **Network access.** In the Claude Code session, open the cloud environment
   menu in the title bar → **Edit** → **Network access**. Choose **Custom**,
   keep the default package-manager list, and add these allowed domains:
   `api.expo.dev`, `expo.dev`, `exp.host`, `storage.googleapis.com`,
   `api.appstoreconnect.apple.com`, `appstoreconnect.apple.com`,
   `itunes.apple.com`, `androidpublisher.googleapis.com`, `play.google.com`.
   Docs: https://code.claude.com/docs/en/cloud-environments#network-access
2. **Expo token.** At https://expo.dev → avatar → **Account settings** →
   **Access tokens** → **Create token**, name it "claude-driver-app". In the
   same environment **Edit** screen, add the environment variable
   `EXPO_TOKEN` with that value. Start a new session so it's picked up.
3. Tell me when that's done; I'll run steps B–D's EAS commands and report each one with evidence.

## B. Verify the identifiers are available, then register them

**Apple: `com.harveytaxiservice.driver`**
1. Sign in at https://developer.apple.com/account → **Certificates, IDs & Profiles** → **Identifiers** → **+** → **App IDs** → **App**.
2. Description "Harvey Taxi Driver", Bundle ID **Explicit** `com.harveytaxiservice.driver`. Enable **Push Notifications**.
3. If Apple says the ID is unavailable, stop and tell me; another team holds it.
4. https://appstoreconnect.apple.com → **Apps** → **+** → **New App**: iOS, name "Harvey Taxi Driver", language English (U.S.), bundle ID `com.harveytaxiservice.driver`, SKU `harvey-taxi-driver`.
5. Open the new app → **App Information** and copy the **Apple ID** number. That goes in `driver-app/eas.json` → `submit.production.ios.ascAppId`.

**Rider app ID discrepancy (don't change anything yet):** in App Store
Connect → **Apps** → **Harvey Taxi** → **App Information**, read its
**Apple ID** and **Bundle ID**. Send me both. `mobile/eas.json` uses
`6761441561` and `mobile/RELEASE.md` says `6761548295`. I'll correct whichever
is wrong in a separate change.

**Google Play: `com.harveytaxi.driver`**
1. https://play.google.com/console → **All apps**. Check that no app already uses `com.harveytaxi.driver` (the package appears under each app's name).
2. **Create app** → name "Harvey Taxi Driver", App, Free. Play only fixes the package name at the first upload; it's rejected if another developer already uses it.

**Your Google Play account type:** Play Console → **Settings** (gear) →
**Developer account** → **Account details**. "Account type" shows
**Personal** or **Organization**, plus the creation date. Personal accounts
created after 13 November 2023 must run a closed test with at least 12
testers for 14 days before releasing to production.

## C. EAS project, signing and push credentials

On your computer (or here once A is done):

```sh
cd driver-app
npm ci
npx eas-cli login
npx eas-cli init                     # registers the EAS project; commit only the projectId change in app.json
npx eas-cli credentials -p ios       # sign in with Apple: distribution certificate, provisioning profile,
                                     # and "Push Notifications: set up" (creates the APNs key)
npx eas-cli credentials -p android   # "Keystore: set up a new keystore" (new app, so EAS may generate it)
```

**Android push (Firebase):**
1. https://console.firebase.google.com → **Add project** "Harvey Taxi Driver" (Analytics off).
2. **Add app** → Android → package `com.harveytaxi.driver` → download `google-services.json`. Don't commit it.
3. Project settings → **Service accounts** → **Generate new private key**. Upload it with `npx eas-cli credentials -p android` → **Google Service Account** → **FCM V1**.
4. Store the `google-services.json` file in EAS:
   `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --visibility secret`

**Play upload service account (for `eas submit`, optional):** Play Console →
**Setup** → **API access**: create a service account with "Release manager"
access, download its JSON, and keep it outside the repository.

## D. Builds and uploads (after B and C)

```sh
cd driver-app
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform ios --latest        # to App Store Connect / TestFlight only
```

Upload the Android `.aab` manually the first time: Play Console →
**Testing** → **Internal testing** → **Create new release**.

Evidence to send me for each: the EAS build URL and status, the TestFlight
build number shown as "Ready to test", and the Play internal-testing release
version code.

## E. Physical-device testing and capture

Devices: one iPhone (iOS 17 or later) and one Android phone (Android 12 or
later) with the **driver** app, and a second phone or a computer for the
**rider** website or app. Use the test accounts (simulated payment).

Before starting, production must have the backend from PR #167 (see
`docs/driver-app-deploy.md`), or a staging server you point the app at.

Run the checklist D1–D14 in `docs/driver-app.md` §7. For each item, record
device model, OS version, app build number, pass or fail, and the time.
Required recordings:
- **Locked screen (D7):** the driver phone locked for 10 minutes during a trip,
  with the rider's screen showing the car moving. On iPhone, show the blue
  location indicator. On Android, show the "Harvey Taxi Driver is online"
  notification.
- **Reconnect (D8, D9)** and **push (D4 with the app closed, D11)**.
- **Play foreground-service video:** Go online → lock the screen → rider sees
  movement → Go offline → notification disappears. Upload it unlisted (for
  example YouTube) and paste the link into Play Console → **App content** →
  **Foreground service permissions**.

Screenshots: on the iPhone (6.9" or 6.5" display) and the Android phone,
signed in as the test driver, capture the six screens listed in
`docs/driver-app-store.md` → Screenshots.

## F. Decisions I need from you

1. **Privacy contact.** The updated privacy policy (in PR #167, not yet live) uses
   **support@harveytaxiservice.com**, the support address already on the
   home page. Confirm it, or give the address to use. A mailing address is
   optional.
2. **Store category:** Navigation, Business, or another.
3. Approval to run `docs/driver-app-deploy.md` in production (migration, then deploy).
4. Approval to submit for App Review and to send the Play release to review,
   once D and E are complete.
