# Rider Request Migration Inventory

**Status:** Retroactive documentation. The migration described here already
shipped to production across PRs #47 (merge), #50 (revert), and #51
(re-merge + delete). This document exists to give the merge a durable,
reviewable record — every feature, endpoint, field, validation rule,
storage key, event handler, and integration that moved from the three
retired pages into `rider-dashboard.html` — plus the follow-up hardening
work (this branch) that adds regression tests and removes one piece of
duplicated logic.

**Source of truth used to build this doc:** `git show fde7019` (the
original PR #47 squash-merge commit) diffed against the current state of
`public/rider-dashboard.html`, plus a direct read of the current file.

## 1. What moved, and to where

| Old file | Old routes | New behavior |
|---|---|---|
| `public/request-ride.html` | `/request-ride`, `/request-ride.html` | Deleted. Full wizard body/CSS/JS now lives inside `public/rider-dashboard.html` under `#rideWizardOverlay`, opened via `window.HarveyRideWizard.open({mode, ride_id, ride_type, ai_destination})`. |
| `public/request-food.html` | `/request-food`, `/request-food.html` | Deleted. Same overlay, opened with `mode: "food"`. |
| `public/request-groceries.html` | `/request-groceries`, `/request-groceries.html` | Deleted. Same overlay, opened with `mode: "grocery"`. |

All six old routes now return **HTTP 301** from `server.js`, redirecting
to `/rider-dashboard.html` (preserving `mode`/`ride_id`/etc. as query
params where applicable — see §6). No stub HTML files exist on disk.

## 2. Request modes supported inside the wizard (`MODE_CONFIG`)

| Mode | `ride_type` sent to API | Delivery? | Notes |
|---|---|---|---|
| `driver` | `standard` (or `scheduled` if `ride_type=scheduled` is also passed) | No | Default mode. Also the entry point for **scheduled rides** — there is no separate "scheduled" mode object; it's `driver` mode plus a `ride_type` override, opened via the dashboard's `goScheduled()` → `HarveyRideWizard.open({mode:"driver", ride_type:"scheduled"})`. |
| `airport` | `airport` | No | Adds a flat airport surcharge, shown in the fare breakdown. |
| `autonomous` | `autonomous` | No | Autonomous Pilot requests. Clearly labeled in UI copy; eligibility/zone gating is enforced server-side (`lib/pilotLifecycle.js`), not duplicated here. |
| `food` | `food` | Yes | Adds a merchant search field (Places Autocomplete scoped to restaurants) and delivery-specific fields. |
| `grocery` | `grocery` | Yes | Same as `food`, scoped to grocery stores. |

**Explicitly out of scope / not part of this wizard:** HTAF/nonprofit
transportation requests. HTAF has its own independent application flow
(`public/htaf-application.html` → `/api/foundation/applications`), with
approval happening *before* a ride is ever scheduled. `rider-dashboard.html`
only surfaces HTAF **status** (via its own HTAF status card, backed by
`GET /api/foundation/applications/by-email`), and does not route HTAF
requests through `HarveyRideWizard`. This was a deliberate design decision
carried over unchanged from before the merge — see
`public/mobility-os-prototype.html`'s inline comment on this exact point.

## 3. Wizard stages (`goToStage()`)

`confirm` → `pickup` → `destination` → `details` → `review` → `payment` → `dispatch`

Each stage has its own validation gate (`validatePickupFields`,
`validateDestinationFields`, `validateDetailsFields`, `validateTripFields`)
before the wizard allows `goToStage()` to advance.

## 4. API endpoints called by the wizard

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Pre-flight connectivity check |
| `/api/riders/:id/readiness` | GET | Rider approval/verification gate |
| `/api/rides/estimate` | POST | Fare estimate (distance, duration, itemized breakdown) |
| `/api/stripe-key` | GET | Stripe publishable key |
| `/api/rider/payment-methods` | GET / DELETE `/:id` | Saved cards (added in PR #46) |
| `/api/rides/payment-intent` | POST | Stripe PaymentIntent creation |
| `/api/rides/request` | POST | Ride/delivery submission (`buildTripPayload()`) |
| `/api/rides/:id/authorize` | POST | Payment authorization after Stripe confirms |
| `/api/maps-key` | GET | Google Maps/Places browser key (fetched by the dashboard's `loadGoogleMaps()`, shared with the wizard via the `harvey-maps-ready` event) |
| `/api/push/vapid-public-key`, `/api/push/subscribe` | GET / POST | Browser push opt-in |

All endpoint paths are unchanged from what `request-ride.html` called
before the merge — confirmed against `git show fde7019` — no new routes,
no renamed fields, no new database columns were introduced by the merge
itself.

## 5. Storage keys

Both the wizard and the dashboard's own script read/write the same
underlying `localStorage` keys (this was true before the merge too, since
they always needed to hand off state to each other as separate pages):

| Key string | Written by | Read by |
|---|---|---|
| `harvey_rider_id` | Rider signup/login | Both |
| `harvey_rider_email` | Rider signup/login | Both |
| `harvey_rider_name` / `harvey_rider_phone` | Wizard | Wizard |
| `harvey_rider_profile` | Dashboard | Dashboard |
| `harvey_last_ride_id` / `harvey_last_payment_id` | Wizard | Wizard (status polling) |
| `harvey_request_mode` | Wizard | Wizard |
| `harvey_active_ride_id` | Wizard (on successful dispatch) | Dashboard (active-request card) |
| `harvey_active_request_mode` | Wizard (on successful dispatch) | Dashboard (active-request card) |

**Note:** the wizard's `CONFIG.STORAGE_KEYS` object names this last pair
`activeRequestId`/`activeRequestMode`; the dashboard's own `CONFIG.STORAGE_KEYS`
names the ride one `activeRideId`. Different property names, identical
underlying string values — this was already true immediately after the
original merge and is unchanged by this hardening pass. Flagged here as a
minor readability inconsistency, not a behavioral bug.

## 6. Server-side redirects (`server.js`)

```js
function redirectToDashboard(res, query) {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return res.redirect(301, `/rider-dashboard.html${qs ? `?${qs}` : ""}`);
}

app.get("/request-ride", (req, res) => redirectToDashboard(res, req.query));
app.get("/request-ride.html", (req, res) => redirectToDashboard(res, req.query));
app.get("/request-food", (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" }));
app.get("/request-food.html", (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" }));
app.get("/request-groceries", (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" }));
app.get("/request-groceries.html", (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" }));
```

`request-ride`/`.html` preserve whatever query string was already present
(e.g. `?mode=driver`, `?ride_id=...`). `request-food`/`request-groceries`
additionally force `mode` to the correct value, matching what the old
client-side redirect stubs did before this branch removed them.

## 7. External integrations

- **Google Maps / Places** — Autocomplete on pickup/destination/merchant
  fields, Distance Matrix for real distance/duration, a live tracking map
  during dispatch. Loaded once by the dashboard's `loadGoogleMaps()`
  (guarded against double-injection) and signaled to the wizard via a
  `harvey-maps-ready` custom event and `window.__HARVEY_MAPS_ENABLED__`.
- **Stripe** — Stripe.js loaded via `<script src="https://js.stripe.com/v3/">`
  in `<head>`; Elements card entry + PaymentIntent confirmation in the
  wizard's payment stage; saved-card list/selection (PR #46).
- **Browser Push** — VAPID subscribe flow, shared constant pattern between
  wizard and dashboard (see `urlBase64ToUint8Array`, independently
  duplicated in both scopes — see §9).

## 8. Isolation mechanism (why there's no naming collision)

The wizard's entire script is wrapped in `(function () { "use strict"; ... })();`
so its top-level `const CONFIG`, `const state`, `function boot()`, etc.
never enter the page's shared global script scope, where the dashboard's
own (non-IIFE) top-level script also declares a `const CONFIG` and
`const state`. The wizard's CSS is scoped under `#rideWizardOverlay` via
`postcss-prefix-selector` (a real CSS AST tool, not regex), so nothing
leaks onto or collides with the dashboard's own styles.

## 9. Findings from this hardening pass

- **Consolidated:** both scripts computed the API base URL with separate,
  not-quite-equivalent logic. The dashboard's own version had a hardcoded
  `https://harveytaxiservice.com` fallback for any hostname other than
  `*.onrender.com` / `*harveytaxiservice*` — including `localhost` during
  local development/testing — which would have sent API calls
  cross-origin instead of same-origin in that case. The wizard's own
  version used `window.location.origin`, which is same-origin everywhere.
  Both produced identical results on every hostname this page is actually
  served from in production (`window.HARVEY_API_BASE` is never set on
  `rider-dashboard.html`). Extracted to `public/harvey-request-shared.js`
  (`window.resolveHarveyApiBase()`), loaded before both inline scripts,
  using the wizard's safer form. Verified with a Playwright check that the
  function returns the current origin. No production behavior change; the
  local-dev divergence is now fixed as a side effect.
- **Identified, not consolidated (documented follow-up):** `money()` and
  `urlBase64ToUint8Array()` are each independently duplicated (byte-for-byte
  logic, different scopes) between the wizard and the dashboard's own
  script. `STORAGE_KEYS` and `ENDPOINTS` are also each maintained as two
  separate object literals. These were left alone in this pass — the
  call sites for `STORAGE_KEYS` in particular are numerous enough
  (dozens) that consolidating them carries real regression risk for a
  purely cosmetic win, which conflicts with the instruction to "preserve
  current API contracts and DOM behavior" and "not rewrite the feature
  unnecessarily." Recommended as a separate, narrowly-scoped follow-up if
  desired.
- **Dead code removed:** `ai-support-widget.js`'s page-context detector had
  an `if (path.includes("request-ride")) return "request";` branch that
  could never fire once `request-ride.html` no longer exists (the
  `rider-dashboard` check above it already matches first). Removed.
- **Links updated:** every remaining internal link that pointed directly
  at `request-ride.html` (`support.html`, `admin-dashboard.html`,
  `driver-dashboard.html`, `privacy.html`, `driver-missions.html`,
  `app-review.html`, `mobility-os-prototype.html`) now points straight at
  `rider-dashboard.html` instead of relying on the redirect hop.

## 10. What this document does not claim

Automated tests (Jest + Playwright, added alongside this document) verify
routing, redirects, payload construction, and DOM wiring — they do not and
cannot exercise live Stripe payment authorization, live Google Maps
billing/quota behavior, real driver dispatch, or a real end-to-end ride
lifecycle against production infrastructure. Per the standing project
policy, this branch is held for a manual production click-through
(rider login, each request mode, payment, dispatch, tracking, completion,
history) before merge — see the PR description for the checklist.
