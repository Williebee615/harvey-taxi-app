# Live map tracking

Riders see their driver on a map. Drivers see a trip map with pickup and
drop-off. A rider may also choose to share their own live location with
the assigned driver, but only until pickup.

## What each side sees

| Who | Sees | When |
|---|---|---|
| Rider (website and rider app) | Driver's last reported position, pickup, destination | From driver assignment through the trip. The driver's position is hidden once it is over 3 minutes old. |
| Rider | Their own position | Only while they are sharing it |
| Driver (Harvey Taxi Driver app) | Their own position, pickup (until the trip starts), drop-off | While a trip is active |
| Driver | The rider's shared position | Only while the rider shares it, the ride is `driver_assigned`, `driver_enroute` or `arrived`, and the position is under 2 minutes old |

Positions are straight points, not routed paths.

## Rider location sharing

- **Off by default.** The rider turns it on for each ride with "Share my location with my driver" on the ride screen. They can stop at any time.
- **Who can share:** only that ride's rider, using a rider session or the ride's tracking token. Anyone else gets the same 404 as a missing ride. Drivers and admins cannot write it.
- **When:** only while the ride is `driver_assigned`, `driver_enroute` or `arrived`. After that the server refuses new positions (409) and the page stops sending.
- **What is kept:** one current position per ride: `rides.rider_live_lat`, `rider_live_lng`, `rider_live_accuracy_m` and `rider_live_at`. No history.
- **Deletion:** a sweep runs every 60 s and clears the position once the ride leaves the sharing window or after 10 minutes without an update. "Stop sharing" clears it immediately.
- **Rate:** the page sends at most every 10 s. The server stores at most one position every 4 s, and further posts are rate-limited.
- **Driver updates:** every stored position nudges the driver app's live stream to re-read its state. It is never a push notification.

Rules: `lib/liveLocation.js`.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `GET /api/maps/config` | Public | `{ enabled, token }`: the website's Mapbox public token |
| `POST /api/rides/:id/rider-location` | The ride's rider | Share a position: `{ latitude, longitude, accuracy }` |
| `DELETE /api/rides/:id/rider-location` | The ride's rider | Stop sharing; deletes the position |
| `GET /api/rides/:id/status` | Existing | Adds `rider_location_sharing: { allowed, active }` for the rider and admins |
| `GET /api/driver/state` | Existing | Adds `active_ride.rider_location` and `map.token` |

## Mapbox tokens

Two **public** tokens, created in the Mapbox account. Neither is the
server's existing secret `MAPBOX_ACCESS_TOKEN`, which stays server-side for
address search and routing.

| Render variable | Used by | Mapbox settings |
|---|---|---|
| `MAPBOX_PUBLIC_TOKEN` | Website and rider app (WebView) | Public scopes only. URL restrictions: `https://harveytaxiservice.com`, `https://www.harveytaxiservice.com` |
| `MAPBOX_APP_TOKEN` | Harvey Taxi Driver app, sent only to signed-in drivers | Public scopes only, no URL restriction (native map requests carry no web origin) |

- The server only ever returns tokens that start with `pk.`, so a secret token set by mistake is never exposed.
- With a variable unset, that map doesn't appear and everything else works as before.
- No Mapbox download token is needed to build the driver app.

## Apps

- **Driver app:**
  - uses `@rnmapbox/maps` (native module, config plugin in `app.json`), so it needs a new build;
  - the map is in the trip card (`src/TripMapView.js`); rules are in `src/tripMap.js`.
- **Rider app:**
  - the WebView now has `geolocationEnabled`;
  - adds the iOS location-use text and the Android location permissions;
  - needs a new build for sharing to work in the app;
  - on the website, sharing works without an app update.

## Deploy order

1. Apply `supabase/migrations/20261004140000_add_rider_live_location.sql`. It must be applied **before** the server deploy: the ride-status route reads the new columns.
2. Set `MAPBOX_PUBLIC_TOKEN` and `MAPBOX_APP_TOKEN` on Render.
3. Merge to deploy the server.
4. Check `GET /api/maps/config` returns `enabled: true`.
5. Build the driver app and the rider app.

**Rollback:**
- To remove the maps, unset the Mapbox variables. No deploy is needed.
- The columns are additive and can stay.

## Tests

- `test/server.live-map-tracking.test.js`: who can share, the status window, validation, throttling, stopping, the driver state and the purge.
- `test/rider-live-map.browser.test.js`: the rider page map and sharing switch, in Chromium with a stand-in map library.
- `test/db/riderLiveLocation.db.test.js`: the migration.
- `driver-app/__tests__/tripMap.test.js` and the trip map case in `App.flow.test.js`.

## Not yet verified on devices

- The map rendering with real Mapbox tiles: website, rider app, driver app on iOS and Android.
- Location permission prompts in the rider app (iOS and Android).
- Sharing from a real phone reaching the driver app.
