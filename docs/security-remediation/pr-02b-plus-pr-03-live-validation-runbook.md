# Consolidated Live-Validation Runbook — PR 2b (#97) + PR 3 (#115) + Ride-Creation Ownership (#118)

## Status

`rider_auth_enforced` remains **`false`**. #97, #115, and #118 are all
merged to `main` and shipped inert — merging the code closes zero real
authorization gaps by itself; only turning the flag on does. **No admin
route was called while writing this document**, and it does not enable
the flag.

**Added since the previous revision:** #118 (task #240) wires the same
`requireRiderIfEnforced`/`resolveEnforcedRiderId` mechanism onto
`POST /api/rides/request`, closing a gap #115's own doc had explicitly
named "PR 4: ride ownership" and scoped out. This was found while
independently reviewing the now-closed PR #101 before closing it as
superseded by #115. It matters here specifically because
`verifyPaymentIntentForRide()` compares a PaymentIntent's
`metadata.rider_id` (trustworthy since #115) against `ride.rider_id` —
until #118, the *ride* side of that comparison was still whatever a
client claimed at creation time. This runbook could not have proven
ride-creation ownership before #118 landed, since `/api/rides/request`
was outside #97's and #115's scope entirely.

**Correction from the previous revision of this document:** an earlier
draft said "do not enable until every item below is checked off,"
including the cross-rider IDOR/payment-ownership tests. That is
internally impossible: while `rider_auth_enforced` is `false`,
`requireRiderIfEnforced` is a deliberate no-op passthrough and
`resolveEnforcedRiderId` always falls through to the client-supplied
id — by design, per both PRs' own "ships inert" framing. The IDOR and
payment-ownership protections **do not exist yet while the flag is
off**, so no pre-enable test can observe them working. Asking for them
to pass before enabling was asking for evidence that cannot exist yet.

This revision replaces "validate everything, then enable" with the
correct sequence for a protection that is inert until a flag flips:
**enable in a controlled window → validate immediately against the
live, now-enforcing routes → keep enabled or roll back based on what
that validation finds.** Sections 3 and 4 below (the cross-rider and
payment-ownership tests) are Phase B activities, performed *after*
enabling, not gates the flag must pass to be turned on.

**Why one consolidated runbook instead of separate ones per PR:** all
three PRs share the exact same flag and the exact same underlying
mechanism (`requireRiderIfEnforced` + `resolveEnforcedRiderId`) —
turning the flag on affects all 13 route-method combinations across 12
route paths (8 route-method combinations across 7 paths from #97, 4
from #115, 1 from #118) in one atomic action. Validating them one PR at
a time would mean flipping the flag on and off multiple times against
production, which is more disruptive and harder to reason about than
one QA pass covering everything the flag actually controls.

## Environment boundary (same limitation as PR 2a's runbook)

This session has no Render access, no Twilio/SendGrid account access,
no browser, and no production admin token. It cannot send or receive a
real SMS/email, click through a UI, watch a Render log stream, or call
the admin enable/disable routes against production. Every item below is
either **[can be verified from this session]** (a direct Supabase query
or code-level check) or **[requires ops/QA]** (the repository owner or
a QA process must execute it against the real, deployed app). This
document is the runbook; it is not itself the execution of that
runbook — the checkboxes below must be filled in by whoever actually
runs it, not assumed complete because this document exists.

## Routes this flag controls once enabled

13 route-method combinations across 12 route paths (`/api/rider/saved-places`
is the one path with two methods gated by this flag — GET and POST):

| # | Route | Method | Source PR |
|---|---|---|---|
| 1 | `/api/riders/:id/readiness` | GET | #97 |
| 2 | `/api/rider/rides` | GET | #97 |
| 3 | `/api/rider/deliveries` | GET | #97 |
| 4 | `/api/rider/rides/:rideId` | GET | #97 |
| 5 | `/api/rider/saved-places` | GET | #97 |
| 6 | `/api/rider/saved-places` | POST | #97 |
| 7 | `/api/rider/saved-places/:id` | DELETE | #97 |
| 8 | `/api/rider/photo` | POST | #97 |
| 9 | `/api/rider/payment-methods/setup-intent` | POST | #115 |
| 10 | `/api/rider/payment-methods` | GET | #115 |
| 11 | `/api/rider/payment-methods/:paymentMethodId` | DELETE | #115 |
| 12 | `/api/rides/payment-intent` | POST | #115 |
| 13 | `/api/rides/request` | POST | #118 |

## QA accounts and financial-safety ground rules

Use two real, distinct QA rider accounts — **Rider A** and **Rider B**
— each with real phone/email, at least one saved place, some
ride/delivery history, a profile photo, and at least one saved payment
method. A third possibility, a dedicated **QA revocation account**, is
used only for the session-revocation test (below) so that neither Rider
A nor Rider B's ability to keep testing is disrupted mid-run.

**Financial-safety rules for every payment-related step in this
runbook, no exceptions:**

- **Never confirm or capture a real charge as part of an ownership
  test.** The cross-rider PaymentIntent/SetupIntent checks in Phase B
  verify *who a resource is attached to* (via the Stripe dashboard or
  API response's `customer`/`payment_method` fields), not whether a
  charge can be completed. Create the PaymentIntent, inspect its
  attachment, then leave it unconfirmed or explicitly cancel it — never
  call `confirm` against it.
- **Rider B's saved payment method must be a designated QA payment
  method** (a Stripe test-mode card if the QA environment uses test
  mode; if this must be tested against Stripe live mode, a specific
  card set aside for this purpose, never an arbitrary unrelated real
  rider's production card). The point of this test is proving the
  *attachment* is rejected, not proving anything about a real person's
  real card.
- **Rider A's own legitimate payment flow (Phase B, step 1) may use a
  real authorization** against Rider A's own saved or entered card,
  with Rider A's own consent — that is normal, already-existing app
  behavior (and `capture_method: "manual"` means it authorizes, not
  captures, consistent with how this app already works today). This
  rule only restricts the *cross-rider ownership* tests, not Rider A's
  own ordinary use of the app.

## Phase A — Pre-enable

Everything in this phase can genuinely be verified **while the flag is
still `false`** — it establishes that turning the flag on is safe to
attempt, not that the protections it will turn on already work (they
can't be observed working yet; see the correction above).

| Item | Status |
|---|---|
| **Freshly confirm `rider_auth_enforced` currently resolves to `false`.** Query `system_flags` directly, right before starting — do not rely on any earlier reading in this document's history. | **[requires a fresh live query]** |
| **Confirm `rider_auth_ui_enabled` is `true` and the real OTP login flow has already passed live validation.** `requireRider` (which every route in the table above delegates to once enforced) only succeeds for a rider who has actually completed real sign-in through PR 2a's flow. If riders cannot sign in yet, enabling this flag doesn't protect anyone — it just breaks all 13 route-method combinations for every rider, since none of them would have a session to present. Confirm PR 2a's own runbook is fully closed, including its previously-open "Merged-deploy smoke test" and Render click-through items, before proceeding. | **[requires ops confirmation]** |
| **Confirm the current deployment actually contains #97, #115, and #118.** Check the Render deployment's commit SHA against `1644ebff020e112ac32adce8679ee2689277461a` (#97's merge commit), `b6165109e8add83e23883b5652f23d571f18b8dd` (#115's merge commit), and `4b84d13a0a6c6ec3d41258d1fba31eb81ce174cc` (#118's merge commit) — the live deployment must be at or after all three. | **[requires ops confirmation]** |
| **Confirm legitimate Rider A session creation works today**, independent of this flag (real OTP sign-in against the live app, session cookie issued, `GET /api/rider/session` returns Rider A's identity). This is testing PR 2a, not this flag — but it must work before Phase B, since Phase B's very first step depends on it. | **[requires ops/QA]** |
| **Verify Rider A, Rider B, and the QA revocation account are prepared** — each with the real phone/email, saved place, ride/delivery history, photo, and (for A and B) a saved payment method described above. | **[requires ops/QA]** |
| **Verify the rollback path is reachable before you need it.** Confirm an admin can authenticate and successfully call `POST /api/admin/system/disable-rider-auth-enforced` (safe to call even while the flag is already `false` — it's an idempotent upsert to `"false"`) so there is no doubt the rollback mechanism itself works at the moment it might actually be needed. | **[requires ops confirmation]** |
| **Record the QA start timestamp**, to scope the Render-log review in Phase B to the actual test window rather than searching all logs. | **[requires ops/QA]** |

**Do not claim any cross-rider ownership protection is validated at the
end of Phase A.** Nothing in this phase touches the flag; it only
confirms the preconditions for safely attempting Phase B.

## Phase B — Controlled production enablement

Performed in one sitting, during a low-traffic window, with an operator
ready to execute the rollback at the first sign of trouble.

1. **Enable.** `POST /api/admin/system/enable-rider-auth-enforced`.
2. **Immediately confirm the flag actually took effect** — query
   `system_flags` again (or call a route from the table above with a
   known-mismatched `riderId` and confirm it now returns the
   *authenticated* rider's data, not the client-supplied one) — do not
   assume the enable call succeeded just because it returned `200`.
3. **Run Rider A's legitimate own-account flows first, before any
   attack test:**
   - Rider A's own saved places, ride/delivery history, and photo load
     correctly.
   - Rider A's own saved payment methods list correctly.
   - **Rider A's own ride request succeeds and creates a ride correctly
     attributed to Rider A**: request a ride, confirm `POST
     /api/rides/request` returns success, and confirm the created ride's
     `rider_id` in the database is Rider A's own id (#118) — not just
     that the request succeeded, but that ownership was recorded
     correctly.
   - Rider A's full payment flow works end-to-end, continuing from the
     ride just created above: see the fare estimate, pay with a saved
     card, pay with a newly entered card (with and without "save this
     card"), confirm the resulting PaymentIntent authorizes normally and
     the ride proceeds. This specifically exercises `apiFetch`'s
     `credentials`/CSRF-header behavior added in #115 — a failure here
     indicates a gap in that fix, not a problem with the flag itself.
   - **If any legitimate flow breaks: disable the flag immediately
     (`POST /api/admin/system/disable-rider-auth-enforced`) and stop.**
     Do not proceed to the attack tests below against a build that
     already can't serve its own legitimate riders — fix the
     regression, then restart this runbook from Phase A once fixed.
4. **Only if step 3 passes completely**, perform the deliberate Rider A
   → Rider B cross-rider tests (#97's and #118's routes; "identity
   substitution" and "resource ownership" cases have different correct
   outcomes —
   see the table below, since a `401` on any of these usually means
   *authentication itself* broke, not that the IDOR fix "worked"):

   | Route | Test | Correct outcome |
   |---|---|---|
   | `GET /api/riders/:id/readiness` | Call with Rider B's id in `:id`, Rider A's session | **200, Rider A's own readiness** — the client-supplied id is silently ignored, never Rider B's data and never an error. |
   | `GET /api/rider/rides` / `GET /api/rider/deliveries` | Call with `riderId`/`rider_id` set to Rider B | **200, Rider A's own history only** — same identity-substitution outcome, not an error. |
   | `GET /api/rider/rides/:rideId` | One of Rider B's real ride ids, `riderId` also set to Rider B | **404** — this is a resource-ownership check (the specific ride doesn't belong to the resolved rider), correctly a denial, not Rider B's data. |
   | `GET /api/rider/saved-places` | `riderId` set to Rider B | **200, Rider A's own saved places only.** |
   | `POST /api/rider/saved-places` | `riderId` set to Rider B | **200, but the created row's `rider_id` in the database is Rider A's**, never Rider B's — verify in the DB, not just the response. |
   | `DELETE /api/rider/saved-places/:id` | One of Rider B's real saved place ids, `riderId` also set to Rider B | **404**, and Rider B's place is confirmed still present in the DB afterward. |
   | `POST /api/rider/photo` | `riderId` set to Rider B | **200, but Rider A's own photo is what gets updated**; Rider B's photo is unchanged. |
   | `POST /api/rides/request` | Rider A signed in, `rider_id` in the request body set to Rider B | **200, but the created ride's `rider_id` in the database is Rider A's**, never Rider B's (#118) — verify in the DB, not just the response, same as the saved-places POST row above. |

   A `401` on any of the rows above (rather than the outcome listed)
   means the *authentication* layer failed for Rider A's own valid
   session — a bug distinct from and more serious than an IDOR gap,
   and grounds for immediate rollback regardless of what the rest of
   the run shows.

   **A distinct scenario `POST /api/rides/request` needs beyond the
   identity-substitution row above: unauthenticated ride creation must
   fail once enforcement is on.** Every row in the table assumes Rider A
   has a valid session; this checks the case where there is no session
   at all. With no cookie sent (a cleared/expired session, or a raw
   direct API call), `POST /api/rides/request` must be rejected by
   `requireRider` before the handler ever runs — not fall through to
   creating a ride with `rider_id: null` or any client-supplied value.
   This is the one route in this runbook where a truly unauthenticated
   attempt is both realistic (a public-facing creation endpoint, unlike
   the read/update routes above which already require knowing an
   existing resource id) and worth checking on its own.

5. **Perform the payment-ownership tests** (#115's routes), following
   the financial-safety rules above — no real charge is confirmed or
   captured against Rider B's designated QA payment method at any point:

   | Route | Test | Correct outcome |
   |---|---|---|
   | `GET /api/rider/payment-methods` | `riderId` set to Rider B | **200, Rider A's own cards only (or none)**, never Rider B's. |
   | `DELETE /api/rider/payment-methods/:paymentMethodId` | One of Rider B's real payment method ids, `riderId` also set to Rider B | **404**, and Stripe/DB confirm Rider B's card is still attached afterward. |
   | `POST /api/rides/payment-intent` | `rider_id` set to Rider B, separately with `payment_method_id` set to one of Rider B's real (QA) payment methods | The created PaymentIntent's `customer`/`payment_method` in the Stripe dashboard show **Rider A's Stripe customer, never Rider B's** — inspect and then leave unconfirmed/cancel it. **Do not confirm/capture it.** |
   | `POST /api/rider/payment-methods/setup-intent` | `rider_id`/`riderId` set to Rider B | The created SetupIntent's `customer` is **Rider A's Stripe customer, never Rider B's**. This route has no live UI caller today (per `pr-03-rider-payment-ownership.md`), so test it directly against the API. |

6. **Session lifecycle, using the dedicated QA revocation account (not
   Rider A or B), so the rest of the run isn't disrupted:**
   - **Logout invalidates the session:** log out
     (`POST /api/rider/session/logout`, which bumps `session_version`),
     then confirm the *previous* cookie is rejected on the next request
     — not just that a new login is required.
   - **Revoked session is rejected:** have an admin set
     `access_revoked = true` on the QA revocation account, confirm a
     route from the table above rejects the still-present cookie rather
     than falling back to any client-supplied id, **then restore
     `access_revoked = false` on that account immediately afterward**
     so it remains usable for future runs.
7. **Review Render logs** for the QA window recorded in Phase A.
   Expected during this window: `404`s from the resource-ownership
   tests above (step 4's `GET/DELETE .../:id`-style rows), and the one
   deliberate `401` from the revoked-session test in step 6. **Not
   expected, and worth investigating regardless of whether the rest of
   the run looked fine:** `401`s anywhere else (they mean a legitimately
   signed-in rider's authentication failed), or any `500`s. Distinguish
   these from each other explicitly in whatever log summary is
   recorded — do not lump "some errors appeared" together without
   separating expected test denials from unexpected authentication
   failures.

## Phase C — Decision

**Keep `rider_auth_enforced` enabled only if all of the following hold:**
- Every legitimate Rider A flow in step 3 passed.
- Every cross-rider attempt in steps 4-5 produced its listed correct
  outcome (no case where Rider A actually reached Rider B's data or a
  Rider B-attached payment resource).
- No unexpected `401`/`500` pattern in step 7's log review.
- Logout and revocation behaved correctly in step 6, and the QA
  revocation account's `access_revoked` was restored to `false`.

**Roll back immediately (`POST /api/admin/system/disable-rider-auth-enforced`)
if any of the following occur, at any point during or after Phase B:**
- Rider A can actually reach Rider B's data or a payment resource
  attached to Rider B (not merely an unexpected status code — actual
  cross-rider data exposure).
- A legitimate rider (Rider A, or real production traffic observed
  after enabling) cannot perform normal operations.
- An unexpected authentication or payment error pattern appears in
  production logs.

**No partial enablement.** `rider_auth_enforced` is a single flag
covering all 13 route-method combinations at once; there is no way to
enable it for only the routes that have been validated so far. If any
single route in Phase B fails, the correct action is to roll back the
whole flag, fix that specific route's wiring, and restart this runbook
from Phase A — not to leave the flag on while treating one route as a
known exception.

**Record the outcome here once this runbook is actually executed** (not
before): final flag state (`true`/`false`), the timestamp of that final
state, and a one-line summary of which phase the run concluded at.

> _Execution record — filled in by whoever runs this, not by this
> document's authoring session:_
> - Date/time executed:
> - Final `rider_auth_enforced` state:
> - Outcome: kept enabled / rolled back — reason:

## What this document deliberately does not do

- It does not enable `rider_auth_enforced`. No admin route was called
  while writing it.
- It does not implement Persona ownership (PR 5), push-subscription
  ownership (PR 6), safety-endpoint auth (PR 7), secrets/session
  hardening (PR 9), or the driver-offer `/decline` ownership gap
  (PR 8) — those remain separately pending, unaffected by this flag.
- It does not touch, reference as a dependency being resolved, or
  unblock Direct Driver Requests, Favorite Drivers, or
  Prefer-a-Woman-Driver
  (`docs/women-driver-preference-and-favorite-drivers-architecture.md`).
  **Even after this runbook's Phase C concludes "keep enabled,"** those
  three features remain implementation-blocked until PR 5 (Persona),
  PR 6 (push ownership), PR 7 (safety authentication), PR 9
  (secrets/session hardening), and PR 8 (driver-offer decline
  ownership) are each separately handled per that architecture
  document's own §D.12 dependency table — this runbook closing out
  successfully resolves the rider-auth/payment-ownership gate only, not
  the full set of P0 items that document names as prerequisites.
