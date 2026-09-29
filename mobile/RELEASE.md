# Harvey Taxi iOS app: build and release verification

App Store app: **Harvey Taxi**, bundle ID `com.harveytaxi.app`, built from
this `mobile/` directory. The root `app.json` (`com.harveytaxi.mobile`) is not
a buildable Expo project and is not used for App Store builds.

## Build

```sh
cd mobile
npm ci
npm test
npx eas-cli build --platform ios --profile production
```

- Marketing version: `expo.version` in `app.json` (currently `1.0.1`).
- Build number: managed by EAS (`cli.appVersionSource: "remote"` in
  `eas.json`); the `production` profile auto-increments it. Build 10
  (`bf85889d-7f63-4063-bace-685e2b8e9492`, commit `3e57b81`) is the first
  build with this fix. `expo.ios.buildNumber` in `app.json` is ignored.
- EAS project: `@williebee615/harvey-taxi`
  (`ae7e5a71-4f7c-45d8-8b7e-e0ef4de507b2`).

## TestFlight upload (private testing only)

```sh
npx eas-cli submit --platform ios --latest
```

`submit.production.ios.ascAppId` (`6761548295`) lets EAS upload with the saved
App Store Connect API key without an Apple ID lookup. This uploads the build
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
