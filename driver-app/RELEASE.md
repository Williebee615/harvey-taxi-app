# Harvey Taxi Driver: build and release

Separate app from Harvey Taxi (rider, `mobile/`). Never build or submit the
rider app from here. Design, status and blockers: `docs/driver-app.md`. Store
text and declarations: `docs/driver-app-store.md`.

## One-time setup (owner)

```sh
cd driver-app
npm ci
npx eas-cli login
npx eas-cli init                 # creates the EAS project; writes extra.eas.projectId to app.json
npx eas-cli credentials -p ios   # distribution cert, provisioning profile, APNs key for com.harveytaxiservice.driver
npx eas-cli credentials -p android   # upload keystore (EAS-generated, new app) and FCM V1 service account
npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production
```

Commit only the `projectId` change. Then create the App Store Connect app
(bundle id `com.harveytaxiservice.driver`) and put its Apple ID number in
`eas.json` → `submit.production.ios.ascAppId`. Create the Play Console app
`com.harveytaxi.driver`; the first AAB is uploaded manually (Play requires
that) and enables Play App Signing.

## Every release

```sh
cd driver-app
npm test
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform ios --latest       # uploads to App Store Connect (TestFlight); does NOT submit for review
npx eas-cli submit --platform android --latest   # internal track, draft (see eas.json)
```

Submitting for App Review, and promoting on Play past internal testing, are
manual steps in the store consoles, and only with the owner's approval.

## Device builds for testing

```sh
npx eas-cli build --platform android --profile device-test   # installable APK
npx eas-cli build --platform ios --profile ios-simulator     # simulator build
```

Run the device checklist in `docs/driver-app.md` §7 on the TestFlight /
internal-testing builds before any store submission.
