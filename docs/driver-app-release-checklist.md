# Harvey Taxi Driver — owner checklist for everything outside the repository

Work through these in order. Each step says where to click or what to run.
Never paste tokens, keys or passwords into chat or commit them.

**Current state (2026-10-03, verified against EAS).**

| Item | State | Evidence |
|---|---|---|
| Expo authentication from this environment | Works (proxy-injected credential; the CLI needs a placeholder `EXPO_TOKEN=proxy-injected`, which the proxy replaces) | `eas whoami` → `williebee615` |
| Driver EAS project | **Registered**: `@williebee615/harvey-taxi-driver`, ID `0a1de77e-7850-4378-b46c-9c21ba80a094` | `eas init`; `eas project:info` |
| Apple team in EAS | `AYF633JM4W`, Harvey Taxi Service LLC (Mobile), organization | EAS account query |
| App Store Connect API key in EAS | None | EAS account query |
| Google service-account key in EAS | None | EAS account query |
| Android upload keystore (driver) | Created by EAS, stored on Expo servers | build `66c932ef-…` log |
| Android production build (AAB) | See `docs/driver-app.md` → Release evidence | EAS build page |
| iOS build | **Blocked**: "Credentials are not set up. Run this command again in interactive mode." | `eas build -p ios --non-interactive` |
| Uploads, device tests, submissions | None | — |

**Rider App Store Connect IDs (from EAS submission records, not changed):**
EAS uploads that Apple accepted show two App Store Connect apps under team
`AYF633JM4W`: `6761441561` for bundle `com.harveytaxiservice.app` (builds
2, 6, 9 and 10, latest from commit `03b00fe`) and `6761548295` for bundle
`com.harveytaxi.app` (build 10, commit `3e57b81`). `mobile/app.json` uses
`com.harveytaxiservice.app`, so `mobile/eas.json`'s `6761441561` matches it;
`mobile/RELEASE.md`'s `6761548295` is the other record. Confirm in App Store
Connect which record is the live/in-review Harvey Taxi app before anything
in `mobile/` is changed.

## A0. Apple: what's needed, and the quickest route (your Mac)

There are two separate kinds of Apple credentials:

| | **Signing** (needed to *build*) | **Submission** (needed to *upload* to App Store Connect) |
|---|---|---|
| What | Distribution certificate, App Store provisioning profile for `com.harveytaxiservice.driver`, APNs push key | App Store Connect API key (`.p8`, Key ID, Issuer ID), plus the driver app's App Store Connect **Apple ID** number in `eas.json` |
| Stored | On Expo's servers (EAS credentials) | On Expo's servers (EAS credentials) |
| Today | Missing for the driver app. Your team's distribution certificate (valid to 2027-08-26) already exists in EAS and can be reused | No API key stored in EAS |

**Quickest route: interactive Apple sign-in on your Mac (about 10 minutes).**

```sh
# 1. Get the branch
git clone https://github.com/Williebee615/harvey-taxi-app.git   # or: git fetch && git checkout claude/driver-app
cd harvey-taxi-app && git checkout claude/driver-app
cd driver-app && npm ci

# 2. Sign in to Expo (account williebee615)
npx eas-cli login

# 3. Signing credentials
npx eas-cli credentials -p ios
#   Which build profile?                       -> production
#   Do you want to log in to your Apple account? -> Yes (Apple ID + 2-factor code; entered on your Mac only)
#   Team                                        -> AYF633JM4W  Harvey Taxi Service LLC (Mobile)
#   Menu: "Build Credentials: Manage everything needed to build your project"
#         -> "Set up all the required credentials to build your project"
#            - registers the bundle ID com.harveytaxiservice.driver   <- availability check:
#              if Apple refuses it, stop and tell me
#            - "Reuse an existing Distribution Certificate?"  -> Yes (the one valid to 2027-08-26)
#            - creates the App Store provisioning profile
#   Menu: "Push Notifications: Manage your Apple Push Notifications Key"
#         -> "Set up your project to use Push Notifications" (reuse an existing key or create one)

# 4. Submission credentials (can be done now or later)
#   a) https://appstoreconnect.apple.com/access/integrations/api -> Team Keys -> "+"
#      Name "EAS Harvey Taxi Driver", Access "App Manager" -> Generate -> download the .p8 once.
#   b) npx eas-cli credentials -p ios
#      -> "App Store Connect: Manage your API Key" -> "Set up your project to use an API Key for EAS Submit"
#      -> add the .p8, Key ID and Issuer ID. Keep the .p8 file private; never commit it.
#   c) App Store Connect -> Apps -> "+" New App: iOS, "Harvey Taxi Driver",
#      bundle ID com.harveytaxiservice.driver, SKU harvey-taxi-driver, then App Information -> copy "Apple ID"
#      and tell me the number (it is not secret); I'll put it in driver-app/eas.json.
```

When steps 3 and 4 are done, tell me. I'll start the iOS production build
from here and upload it to TestFlight, then send you the build link and the
TestFlight build number.

## A1. Google Play: service account for uploads

Needed only for uploads from EAS (`eas submit`). **The first Android upload
must be manual in Play Console anyway.**

1. **Play Console → Create app**: "Harvey Taxi Driver", default language English (US), App, Free; accept the declarations.
2. **Google Cloud** (https://console.cloud.google.com): select or create a project (for example "harvey-taxi-play") → **IAM & Admin → Service Accounts → Create service account** "eas-play-upload". Grant no project role.
3. In that service account, open **Keys → Add key → Create new key → JSON**. Download it and keep it private.
4. Enable the **Google Play Android Developer API** for that project (APIs & Services → Library).
5. **Play Console → Users and permissions → Invite new user**: the service account's email. Under **App permissions**, add Harvey Taxi Driver with **Release apps to testing tracks** (add production later if wanted) → Invite.
6. Store the key in EAS, not in GitHub: `npx eas-cli credentials -p android` → production → **Google Service Account → Upload a Google Service Account Key** → choose the JSON.
7. **First upload (manual):** Play Console → Harvey Taxi Driver → **Testing → Internal testing → Create new release** → upload the `.aab` from the EAS build page → save and roll out to internal testers.

**Android push (separate from uploads):** Firebase project with Android app
`com.harveytaxi.driver`; upload its FCM V1 service-account key with
`npx eas-cli credentials -p android` → **Google Service Account → FCM V1**,
and add `google-services.json` as the EAS file variable `GOOGLE_SERVICES_JSON`
(see C). Until this is done, Android builds work but Android push doesn't.

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
2. **Store category:** recommended **Navigation** (App Store) / **Maps & Navigation** (Play); used in the listing drafts.
3. Approval to run `docs/driver-app-deploy.md` in production (migration, then deploy).
4. Approval to submit for App Review and to send the Play release to review,
   once D and E are complete.
