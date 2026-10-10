# Markets: Nashville plus pilot cities in Zimbabwe, Nigeria and Ghana

Status: design and test mode only (2026-10-10). Nashville is the only live
market and is unchanged. Harare, Lagos and Accra run as a simulated preview
for admins. No live dispatch, payments, SMS, paid services, merges,
deployments or app builds for the pilot markets.

## Principles

- **One rider app, one driver app.** Markets are server-side settings, not
  separate apps. The rider apps show the website, so most rider changes ship
  with a site deploy. The driver app is native, so some changes need a
  driver build (see "Website or app build").
- **Nashville stays as it is.** Its prices still come from `lib/pricing.js`
  (the same environment variables). A request that names no market is
  Nashville's, on exactly the old code path. Every existing row defaults to
  `us-nashville` (migration `20261010150000_market_id.sql`).
- **One pilot city per country:** Harare (ZW), Lagos (NG), Accra (GH).
- **Two locks per market.** Live service in a market needs both
  `approved_for_live: true` in `lib/markets.js` (a code change, approved by
  the owner for that market only) **and** the system flag
  `market_live_<id>` = `true`. Both are off for all three pilots.
- **Unconfirmed is visible.** Every setting that needs local confirmation is
  marked `confirmed: false` and shown as "Unconfirmed" in the admin preview.
  Prices are illustrative test values, not market research.

## What is in this change

| Piece | Where | Effect today |
|---|---|---|
| Market settings: city, time zone, km/mi, currency, pricing, payments, phone rules, emergency numbers, driver documents, privacy, AI | `lib/markets.js` | Read by the preview and the market guard only |
| Market guard on `/api/rides/estimate` and `/api/rides/request` | `server.js` (`requireLiveMarket`) | Requests naming a pilot market get 403 `market_not_open`; requests naming no market (all current clients) are unchanged |
| Admin preview and simulated rides | `GET /api/admin/markets`, `POST /api/admin/markets/:id/simulate`, `/admin-markets.html` | Admin-only; simulation writes nothing, dispatches nothing, charges nothing, texts nothing, calls no AI |
| `market_id` on riders, drivers, rides, offers, earnings, payments, payouts, driver payouts, tips | `supabase/migrations/20261010150000_market_id.sql` | Not applied. When applied: every row `us-nashville` |
| Tests | `lib/markets.test.js`, `test/server.markets.test.js`, `test/db/marketId.db.test.js`, `test/admin-markets.browser.test.js` | Nashville fare identical to today's; pilots can't go live; no 911 outside the US |

Screenshots of the preview: `docs/screenshots/markets/`.

## Isolation by market

| Data | How it is isolated | Status |
|---|---|---|
| Riders, drivers, rides, offers, earnings, payments, payouts, tips | `market_id` column, default `us-nashville`, format-checked, indexed | Migration written, not applied |
| Dispatch and offer acceptance | Must match `drivers.market_id = rides.market_id` | **Blocker before any second market goes live.** Safe today because no other market can create a ride |
| Pricing | Per-market `pricing` (currency, base, per km, per minute, booking fee, minimum, airport surcharge, driver share) | Done in `lib/markets.js`; Nashville delegates to `lib/pricing.js` |
| Payments | Per-market methods, all disabled outside Nashville; Stripe stays Nashville-only | Provider integrations not built |
| Driver documents | Per-market list with expiry checks | Configured; upload, review and expiry enforcement not built |
| Admin views and reports | Filter by `market_id` | Not built |
| AI assistant | `ai_model_allowed: false` outside Nashville | Done (rules-based answers only) |

## Website or app build

| Change | Website deploy (no build) | Rider app build | Driver app build |
|---|---|---|---|
| Market settings, guard, preview, simulation | Yes | No | No |
| Rider screens: phone entry with country code, km, local currency and time, local emergency line, local payment choices | Yes (rider apps show the website) | No | No |
| Address search beyond the US (`lib/mapboxClient.js` limits to `country: "us"`) | Yes (server) | No | No |
| Driver app: emergency number (`driver-app/src/config.js` hard-codes `911`), money format (`ui.js` hard-codes `$`), km, local time, market documents | Server can send the market, but the app must read it | No | **Yes** |
| Store availability in Zimbabwe, Nigeria, Ghana | App Store Connect / Play Console settings | No build | No build |
| Push notifications, background location | Unchanged | No | No |

## Costs

Nothing here costs money today, and nothing paid has been started. Known
cost areas before a pilot can go live (amounts to be quoted; none verified):

- **Legal and regulatory:** local counsel in each country; operator
  permits, licences and registrations (Lagos e-hailing permit, POTRAZ data
  controller licence, NDPC registration, Ghana Data Protection Commission
  registration, ZIMRA tax registration). Fees not confirmed.
- **Company setup:** local entity or registered presence where required;
  local bank account for settlement.
- **SMS verification:** Twilio Verify per-message rates differ by country;
  sender ID registration required for Nigeria and Ghana.
- **Payments:** EcoCash merchant account (Zimbabwe), a local payment provider
  (Nigeria), mobile money (Ghana): transaction fees and any setup fees.
- **Identity and background checks:** Persona and Checkr coverage in these
  countries not confirmed; a local provider may be needed.
- **Maps and routing:** Mapbox usage outside the US; address quality in
  Harare, Lagos and Accra not tested.
- **Insurance:** passenger and commercial cover per market.
- **Builds:** one driver app build per platform (free EAS allowance resets
  monthly; iOS allowance shared with the rider build planned for 1 November).
- **Data hosting:** if any market requires local hosting or a separate
  region, that is a new infrastructure cost (not confirmed for any market).

## Readiness checklists

- [Zimbabwe (Harare)](zimbabwe.md)
- [Nigeria (Lagos)](nigeria.md)
- [Ghana (Accra)](ghana.md)

Each separates **verified** (with sources and dates) from **unresolved**
questions. None of them approves operating. The Zimbabwe e-hailing
moratorium is not permission to operate.
