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
- Build number: `expo.ios.buildNumber` (currently `10`). The `production`
  profile has `autoIncrement: true`:
  - if the EAS project manages versions remotely (`appVersionSource: remote`),
    EAS assigns the next number after the last build (build 9);
  - if it manages them locally, EAS bumps `buildNumber` in `app.json`; commit
    that change.
  Either way the new build number is higher than 9.
- **Do not submit** until the clean-install matrix below passes on a release
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
