# Delivery Center and delivery dispatch

Covers the rider Delivery Center (`public/rider-dashboard.html`, which Harvey Taxi Mobile shows on iOS and Android), delivery offers in Harvey Taxi Driver, and who may receive a delivery.

## Rider: Ride Center and Delivery Center
- **Ride Center:** passenger booking, the active ride and ride history.
- **Delivery Center:**
  - Request a Delivery (food, groceries);
  - the active delivery;
  - delivery history;
  - delivery support.
- **Both active at once:** a rider can have an active ride and an active delivery, each shown in its own center.
- **Shared flows:** booking, tracking and cancellation use the existing flows and the same server rules: no fee changes and no policy changes.
- **Delivery PIN:**
  - It is shown only to the rider, labelled "give it to the driver only at handoff".
  - Driver responses never contain it: missions, history and ride status.
  - The handoff check compares it on the server.

## Who receives a delivery
Food and grocery deliveries go only to drivers set up for that delivery type:

| Ride type | Driver column checked | Eligible when |
|---|---|---|
| `food` | `drivers.supports_food_delivery` | not `false` (true or unset) |
| `grocery` | `drivers.supports_grocery_delivery` | not `false` (true or unset) |
| passenger rides | none | unchanged |

This applies to:
- **Automatic dispatch** (`findAvailableDrivers` in `server.js`).
- **Admin assignment** (`POST /api/admin/rides/:id/assign-driver`). An ineligible driver is refused with 409, for example "This driver is not set up for food deliveries.", and the order is left unchanged.

App Review rides keep their own isolation: the paired review driver only.

### Eligibility is checked before the nearest-driver limit
Dispatch offers a ride to the nearest `MAX_DISPATCH_ATTEMPTS` drivers (default 5) within `DRIVER_SEARCH_RADIUS_MILES` (default 25). For a delivery, ineligible drivers are removed **before** that cut. Otherwise nearer ineligible drivers could crowd out a farther eligible one.

- **Database search (`nearest_drivers`):**
  - For a delivery it reads up to `DELIVERY_CANDIDATE_POOL` nearest drivers (default **200**), still only within the search radius.
  - Ineligible drivers are then removed, and the nearest 5 eligible drivers are used.
  - Passenger rides keep the original pool (5 plus excluded drivers plus 5).
- **Fallback (if the database search is unavailable):** ineligible drivers are filtered in the query itself, before its 50-row limit.
- **If the delivery settings can't be read** during the database search, the fallback search is used. It reads the settings together with the drivers.

### Is 200 suitable?
Checked against production on 2026-10-08:
- 28 drivers in total;
- 28 active and approved;
- none marked as not doing food or grocery.

A pool of 200 is therefore larger than the whole fleet. In practice it means "every driver within 25 miles", which is a small database read at this size.

**When to revisit:** if more than 200 drivers are ever within 25 miles of a pickup, a delivery could miss an eligible driver only when the 200 nearest are all ineligible. At that point, either:
- raise `DELIVERY_CANDIDATE_POOL` on the server (no code change), or
- move the eligibility check into `nearest_drivers()` with a migration.

## Harvey Taxi Driver
- **Delivery offers:** labelled "New delivery request" with "Food delivery" or "Grocery delivery", "Pick up order at" and "Deliver to".
- **Where delivery steps happen:** in the web driver dashboard, as before.
- **Push titles:** "New Delivery Request · Food/Grocery".
- **Build:** the labels in the app need a new driver build. Push titles and the server changes apply on deploy.

## Tests
- `test/server.delivery-center.test.js`:
  - eligibility, including nearest drivers ineligible while a farther eligible driver gets the offer (database search and fallback);
  - admin assignment;
  - push titles;
  - the PIN never reaching drivers;
  - rider access.
- `test/rider-delivery-center.browser.test.js`: both centers, separate histories, request buttons, delivery cancellation.
- `driver-app/__tests__/offerDisplay.regression.test.js` and `logic.test.js`: delivery offer labels.
