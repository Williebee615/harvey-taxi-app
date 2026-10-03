# Rider and driver apps

Harvey Taxi has two store apps on the same backend and accounts. They don't
share an app, but they share every account and record.

| | Harvey Taxi (rider, `mobile/`) | Harvey Taxi Driver (`driver-app/`) |
|---|---|---|
| What it is | The website in an app shell (WebView) | Native app |
| Riding: booking, tracking, payments | Yes | No |
| Driving: online/offline, ride offers, trips, earnings, Harvey Assistant | **No.** Shows a hand-off to Harvey Taxi Driver | Yes |
| Driver sign-up | Yes (`/driver-signup.html`) | Yes ("Apply to drive" opens the same page) |
| Driver account deletion | Yes (`/settings.html?account=driver`, phone code) | Yes (Account → Delete account; also the web page) |
| Rider account deletion | Yes | n/a |

## How the rider app keeps driving out

`mobile/src/navigation.js` → `isDriverOperationsUrl()` matches the website's
driving pages:
- `/driver-dashboard(.html)`
- `/driver(.html)`
- `/driver-wallet(.html)`

The shell never loads them, whether reached from a link on a page, a redirect
(for example after driver sign-up) or a link that opens the app. It shows
**Drive with Harvey Taxi Driver** instead, with three choices:
- **Open Harvey Taxi Driver:** opens `harveytaxidriver://`, or the store page
  if the app isn't installed.
- **Delete a driver account:** opens the deletion page in the rider app.
- **Back.**

The website itself is unchanged in a browser.

**Store links.** Until Harvey Taxi Driver is public, the store pages it falls
back to won't exist yet:
- `apps.apple.com/app/id6818705885`
- `play.google.com/store/apps/details?id=com.harveytaxi.driver`

## Driver deletion without a driver session

Before this change, deleting a driver account on the website needed a driver
session from the web driver dashboard. That isn't reachable in the rider app.
The settings page now handles this case:
- **No driver session in the browser:** it texts a code to the account's
  phone number through the driver app's phone sign-in
  (`/api/driver/session/phone/start` and `/verify`).
- **Unknown numbers:** they get the same answer and no text.
- **The resulting session:** kept in memory for the one request
  (`/api/account/driver/delete-request`) and never stored.

## Accounts and data

Nothing about accounts or records changes:
- no migration;
- no deleted rows;
- no new identifiers.

A driver signs in to Harvey Taxi Driver with the phone number on their driver
account, and a rider keeps using Harvey Taxi as before.

## Verification

**Rider app (`mobile/`, jest), 111 tests.** Driving pages never load and show
the hand-off:
- page links;
- `www` host;
- deep link;
- clean paths.

Sign-up and driver deletion still load. The hand-off covers:
- **Open Harvey Taxi Driver:** opens the app, or falls back to the store
  page;
- **Delete a driver account:** opens the deletion page;
- **Back:** closes the hand-off.

**Website (Chromium), `test/driver-deletion.browser.test.js`:**
- the code proves the phone number and the request is filed;
- no session is stored;
- a wrong code files nothing;
- an unknown number gets the same answer and no text.

**Driver app (`driver-app/`, jest):**
- "Apply to drive" opens sign-up;
- the in-app account deletion flow (existing test).

**Not verified here:** a real SMS, and the store pages, which aren't live yet.
