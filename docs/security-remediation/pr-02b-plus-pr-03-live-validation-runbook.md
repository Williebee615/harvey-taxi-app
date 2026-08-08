# Consolidated Live-Validation Runbook — PR 2b (#97) + PR 3 (#115)

## Status

`rider_auth_enforced` remains **`false`**. Both #97 and #115 are merged
to `main` and shipped inert — merging the code closes zero real
authorization gaps by itself; only turning the flag on does, and this
document is the gate that must pass before that happens. **Do not
enable `rider_auth_enforced` until every item below is checked off.**
This document does not enable it, and no admin route was called while
writing it.

**Why one consolidated runbook instead of two separate ones:** both PRs
share the exact same flag and the exact same underlying mechanism
(`requireRiderIfEnforced` + `resolveEnforcedRiderId`) — turning the flag
on affects all 12 migrated routes (the 8 from #97, the 4 from #115) in
one atomic action. Validating them one PR at a time would mean flipping
the flag on and off multiple times against production, which is more
disruptive and harder to reason about than one QA pass covering
everything the flag actually controls.

## Environment boundary (same limitation as PR 2a's runbook)

This session has no Render access, no Twilio/SendGrid account access,
no browser, and no production admin token. It cannot send or receive a
real SMS/email, click through a UI, or watch a Render log stream. Every
item below is either **[can be verified from this session]** (a direct
Supabase query or code-level check) or **[requires ops/QA]** (the
repository owner or a QA process must execute it against the real,
deployed app). This document is the checklist; it is not itself the
execution of that checklist.

## Routes this flag controls once enabled

| # | Route | Method | Source PR |
|---|---|---|---|
| 1 | `/api/riders/:id/readiness` | GET | #97 |
| 2 | `/api/rider/rides` | GET | #97 |
| 3 | `/api/rider/deliveries` | GET | #97 |
| 4 | `/api/rider/rides/:rideId` | GET | #97 |
| 5 | `/api/rider/saved-places` | GET, POST | #97 |
| 6 | `/api/rider/saved-places/:id` | DELETE | #97 |
| 7 | `/api/rider/photo` | POST | #97 |
| 8 | `/api/rider/payment-methods/setup-intent` | POST | #115 |
| 9 | `/api/rider/payment-methods` | GET | #115 |
| 10 | `/api/rider/payment-methods/:paymentMethodId` | DELETE | #115 |
| 11 | `/api/rides/payment-intent` | POST | #115 |

## Pre-flight — before touching the flag at all

| Item | Status | Basis |
|---|---|---|
| `rider_auth_enforced` currently resolves to `false` | **[requires a fresh live query]** | Last directly queried 2026-08-04 (`pr-02a-live-validation-runbook.md`), before either #97 or #115 existed. Query `system_flags` for `rider_auth_enforced` again now, immediately before starting this runbook — do not assume the four-day-old reading still holds. |
| `rider_auth_ui_enabled` (PR 2a — the client-side sign-in gate) is live and validated | **[requires ops confirmation]** | `requireRider` (which every one of the 11 routes above delegates to once enforced) only succeeds for a rider who has actually completed real OTP sign-in through PR 2a's flow. If riders cannot sign in yet, enabling this flag doesn't protect anyone — it just breaks every one of these 11 routes for every rider, since none of them have a session to present. Confirm PR 2a's own runbook is fully closed (including its still-open "Merged-deploy smoke test" and Render click-through items) before proceeding. |
| Rollback is ready | **[verified here]** | `POST /api/admin/system/disable-rider-auth-enforced` (added by #97, unmodified by #115) atomically reverts every one of the 11 routes to pre-enforcement, client-supplied-id behavior in one write, no deploy needed. |

## QA execution checklist

Use two real, distinct QA rider accounts — **Rider A** and **Rider B** —
each with real phone/email, at least one saved place, some ride/delivery
history, a profile photo, and at least one real saved Stripe payment
method (a real or Stripe-test card). Every cross-rider step below
requires Rider B to actually have the data being probed; a check against
an empty account proves nothing.

### 1. Authentication itself

- [ ] **Real SMS OTP login** — Rider A signs in via `/api/rider/session/start` + `/verify` with a real phone number and receives a real SMS code. **[requires ops/QA]**
- [ ] **Real email fallback** — Rider A (or a second test identity) signs in via the email OTP path and receives a real email code. **[requires ops/QA]**
- [ ] **Session cookie survives reload** — after signing in, reload the rider dashboard; Rider A remains signed in with no re-prompt. **[requires ops/QA]**
- [ ] **Logout invalidates the session** — Rider A logs out (`POST /api/rider/session/logout`, which bumps `session_version`), then confirm the *previous* cookie is rejected on the next request (not just that a new login is required). **[requires ops/QA]**
- [ ] **Expired/revoked session is rejected** — either wait out the session TTL or (faster) have an admin set `access_revoked = true` on Rider A's row and confirm every one of the 11 routes above rejects the still-present cookie rather than silently falling back to a client-supplied id. **[requires ops/QA, or DB-level check for the revoked case]**

### 2. Rider A can access Rider A's own data (the routes must still work at all)

- [ ] Rider A's own saved places, ride/delivery history, and photo load correctly through the dashboard.
- [ ] Rider A's own saved payment methods list correctly (`GET /api/rider/payment-methods`).
- [ ] **Legitimate Rider A payment flow still works end-to-end**: request a ride, see the fare estimate, pay with a saved card, pay with a newly entered card (with and without "save this card" checked), confirm the resulting PaymentIntent succeeds and the ride proceeds normally. This specifically exercises `apiFetch`'s new `credentials`/CSRF-header behavior (#115) — a failure here would mean that fix has a gap, not that the flag itself is wrong. **[requires ops/QA]**

### 3. Rider A cannot access Rider B's data — the actual IDOR closure (#97's routes)

For each, Rider A is signed in with a real session; the request substitutes Rider B's real id/ride id/place id where the route accepts one:

- [ ] `GET /api/riders/:id/readiness` with Rider B's id → returns Rider A's own readiness, never Rider B's.
- [ ] `GET /api/rider/rides` / `GET /api/rider/deliveries` with `riderId`/`rider_id` set to Rider B → returns only Rider A's own history, never Rider B's.
- [ ] `GET /api/rider/rides/:rideId` for one of Rider B's real rides, with `riderId` also set to Rider B → 404, never Rider B's ride details.
- [ ] `GET /api/rider/saved-places` with `riderId` set to Rider B → returns Rider A's own saved places, never Rider B's.
- [ ] `POST /api/rider/saved-places` with `riderId` set to Rider B → the created place is owned by Rider A (verify in the DB), never attached to Rider B.
- [ ] `DELETE /api/rider/saved-places/:id` on one of Rider B's real saved places, with `riderId` also set to Rider B → 404, Rider B's place is not deleted.
- [ ] `POST /api/rider/photo` with `riderId` set to Rider B → Rider A's own photo is updated, Rider B's photo is untouched.

### 4. Rider A cannot access Rider B's payment data (#115's routes — the newest, highest-stakes group)

- [ ] **Rider A cannot list Rider B's payment methods**: `GET /api/rider/payment-methods?riderId=<Rider B's id>` returns Rider A's own cards (or none), never Rider B's real saved cards.
- [ ] **Rider A cannot delete Rider B's payment method**: `DELETE /api/rider/payment-methods/:id?riderId=<Rider B's id>` against one of Rider B's real saved payment method IDs → 404 (via the existing `ownsPaymentMethod` check now operating against Rider A's own Stripe customer), and confirm in the Stripe dashboard/DB that Rider B's card was **not** detached.
- [ ] **Rider A cannot create a PaymentIntent against Rider B's Stripe customer**: `POST /api/rides/payment-intent` with `rider_id` set to Rider B's id and, separately, with `payment_method_id` set to one of Rider B's real saved payment methods → the resulting PaymentIntent must not be attached to Rider B's Stripe customer or Rider B's payment method (confirm via the Stripe dashboard, not just the API response).
- [ ] **Rider A cannot create a SetupIntent "as" Rider B**: `POST /api/rider/payment-methods/setup-intent` with `rider_id`/`riderId` set to Rider B → the resulting SetupIntent is created against Rider A's own Stripe customer, never Rider B's (this route has no live UI caller today, per `pr-03-rider-payment-ownership.md`, so this must be tested directly against the API, not through the dashboard).

### 5. Operational health

- [ ] **Render logs show no unexpected 401/403/500 pattern during the QA window** — a small number of expected 401s (from the deliberate cross-rider attempts above, which *should* fail) is normal and expected; watch instead for 401/403/500s from Rider A's or any other real, legitimate account's normal traffic, which would indicate the flag broke something for a real user rather than only blocking the deliberate attacks. **[requires ops/QA]**
- [ ] No spike in support contacts / app-store reviews mentioning "can't pay," "can't see my rides," "logged out unexpectedly," etc. in the hours after enabling. **[requires ops monitoring]**

## Decision point

- **All items pass, no unexpected 401/403/500 pattern, no regressions to Rider A's own legitimate flows:** `rider_auth_enforced` may be enabled via `POST /api/admin/system/enable-rider-auth-enforced`. Recommend a low-traffic window and immediate post-enable spot-checks of sections 2-4 above against the live flag, not just pre-enable staging/QA.
- **Any item fails, or any cross-rider attempt in sections 3-4 succeeds:** do not enable. If it was already enabled when a failure is found, disable immediately (`POST /api/admin/system/disable-rider-auth-enforced`) and treat the specific failing route as a new, still-open finding — the mechanism (`resolveEnforcedRiderId`) is unit-tested, but the wiring on that specific route may have a gap this runbook exists to catch.
- **Partial completion:** do not enable partially — `rider_auth_enforced` is a single flag covering all 11 routes at once; there is no way to enable it for only the routes that have been validated so far.

## What this document deliberately does not do

- It does not enable `rider_auth_enforced`. No admin route was called while writing it.
- It does not implement Persona ownership (PR 5), push-subscription ownership (PR 6), safety-endpoint auth (PR 7), or secrets/session hardening (PR 9) — those remain separately pending, unaffected by this flag.
- It does not touch, reference as a dependency being resolved, or unblock Direct Driver Requests, Favorite Drivers, or Prefer-a-Woman-Driver (`docs/women-driver-preference-and-favorite-drivers-architecture.md`) — those remain documentation-only and blocked on this exact gate succeeding, not on this document existing.
