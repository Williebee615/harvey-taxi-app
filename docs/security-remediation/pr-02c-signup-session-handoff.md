# P0 Remediation — PR 2c: Signup → OTP → Authenticated Payment/Rider-Owned Flow

Status: **prerequisite fix, independent of PR 2b (#97) and PR 3 (#101).**
Based on `main` directly (not stacked on either open branch) because
everything it depends on — the rider-session OTP endpoints
(`/api/rider/session/start`, `/verify`, `GET /api/rider/session`) and
`rider-dashboard.html`'s session-gated boot sequence — is already merged
(PR 2a, PR #95). This PR touches only `public/rider-signup.html`. No
server-side route changes, no new flag, no migration.

**What this closes:** the last concrete gap standing between "PR 2a
merged" and "safe to ever turn `rider_auth_enforced` on" — a rider-owned
action (saving a payment method) that could be triggered *before* the
rider had a session at all, via a request that didn't even attempt to
send one.

## The problem, precisely

`rider-signup.html` offered "save a card now" immediately after account
creation, in the code path that runs while `rider_auth_ui_enabled` is
`false` (current production state). This called
`POST /api/rider/payment-methods/setup-intent` through a **third,
separate** fetch helper (`api()`, distinct from `rider-dashboard.html`'s
`requestJson()` and `apiFetch()`/`apiPost()`, both already fixed —
`requestJson()` by PR 2b, `apiFetch`/`apiPost` by PR 3) that explicitly
set `credentials: "omit"` — it never even attempted to send a session
cookie, by design, because at that point in the flow **no session
existed to send**. Once `rider_auth_enforced` is ever turned on, this
call would 401/403 for every real new rider trying to save a card during
signup — but worse, while the flag stays off (as it does today), this is
exactly the client-supplied-identity pattern this whole program exists
to close: a rider-owned write, keyed off a plain `rider_id` string with
no proof of control over the account.

## What already existed and was already correct (verified, not assumed)

Before making any change, traced the actual code rather than trusting
the existing inline comments claiming this was handled:

- **`POST /api/riders/signup` never issues a session.** Confirmed by
  reading the route: no `signRiderSession`/`setRiderSessionCookie` call
  anywhere in it. A session is issued **only** by
  `POST /api/rider/session/verify`, and only after a real Twilio
  Verify (SMS) or `verifyCode()` (email) success — confirmed by reading
  that route directly (`server.js`). So "do not auto-issue a session
  merely because signup succeeded" was **already true** before this PR;
  nothing needed to change there.
- **`rider-signup.html` already redirects to the real OTP flow when
  `rider_auth_ui_enabled` is on.** `createRiderAccount()` calls
  `isRiderAuthUiEnabled()` immediately after a successful signup and, if
  true, calls `handOffToRiderVerification()` and returns **before** ever
  reaching the payment-card code — the vulnerable path was already
  unreachable whenever the new flow is active. The gap was specifically
  in the *other* branch (flag off), the one still live in production
  today.
- **`rider-dashboard.html`'s `boot()` already gates every rider-owned
  call behind a confirmed session, when the flag is on.** Traced
  `boot() → bootstrapRiderSession() → GET /api/rider/session
  (credentials: "include") → runAuthenticatedBoot()` directly:
  `runAuthenticatedBoot()` (which calls `loadRiderStatus`/readiness,
  `loadHistory`, `loadActiveRequest`, `loadSavedPlaces`, HTAF status) is
  **only ever called after** `bootstrapRiderSession()` returns `ok:
  true` — never before, when the flag is on. This is exactly steps 3–5
  of the approved signup behavior ("issue session only after OTP →
  confirm via `GET /api/rider/session` → only then call readiness/saved
  places/history/etc."), already built and already correct.

**Conclusion: the only genuine gap was `rider-signup.html`'s own
pre-session payment-card feature.** Everything else in the "approved
signup behavior" list was already implemented correctly by PR 2a; this
PR does not re-touch or re-verify that code, only confirms it (above)
and closes the one piece that wasn't covered.

## What this PR does

**Removed entirely** — not disabled, not exempted, not left as dead
code that could be resurrected:

- `showPaymentMethodCard()`, `hidePaymentMethodCard()`,
  `savePaymentMethod()`, `initSignupStripeElements()`, and their backing
  state (`signupStripeClient`, `signupCardElement`,
  `signupPaymentRiderId`).
- The `#paymentMethodCard` HTML block (card element mount point, "Save
  Card"/"Skip for Now" buttons) and its now-unused
  `savePaymentMethodBtn`/`skipPaymentMethodBtn`/
  `signupCardElementContainer`/`signupCardErrors`/`paymentMethodCard`
  DOM references.
- The unconditional `<script src="https://js.stripe.com/v3/">` include
  — nothing on this page uses Stripe.js anymore.
- The `showPaymentMethodCard(rider.id)` call in `createRiderAccount()`'s
  legacy (flag-off) success branch.

**Not changed:** `isRiderAuthUiEnabled()`/`handOffToRiderVerification()`
— the OTP-handoff redirect stays exactly as gated behind
`rider_auth_ui_enabled` as it already was. This PR does not unblock or
change that flag's rollout in any way; it only removes the one feature
that bypassed it.

**Result:** a rider can no longer be shown a "save your card now" prompt
before completing OTP and having a real session, under either flag
state. A rider adds a payment method the same way once they're on the
dashboard: from the ride-request flow, through `apiFetch`/`apiPost`
(PR 3's CSRF-header fix applies there), in an authenticated context.

## Explicit adherence to the constraints given

- **No temporary unauthenticated exemption for SetupIntent** — none
  created. The route (`/api/rider/payment-methods/setup-intent`) is
  untouched server-side; it's simply no longer called from a pre-session
  context by any client code in this repo.
- **No auto-issued session on signup success** — confirmed already true,
  not something this PR needed to add.
- **`credentials: "omit"` pre-session payment behavior — removed**, by
  removing the feature that used it, not by adding credentials to a
  request that structurally has no session to send.

## Verification classification

| Claim | Classification | Basis |
|---|---|---|
| `POST /api/riders/signup` never issues a session | **Confirmed** | Direct code read — no session-issuing call anywhere in the route. |
| A session is only issued after real OTP verification | **Confirmed** | Direct code read of `/api/rider/session/verify` — `signRiderSession`/`setRiderSessionCookie` only reached after a successful Twilio Verify check or `verifyCode()` result. |
| When `rider_auth_ui_enabled` is on, no rider-owned call happens before a confirmed session | **Confirmed** | Direct trace of `boot()` → `bootstrapRiderSession()` → `runAuthenticatedBoot()` — the ordering is unconditional in code, not just commented. |
| The removed payment-card feature is the only remaining pre-session rider-owned action on this page | **Confirmed for this page** | Every other action on `rider-signup.html` (account creation, status check) is pre-account by definition, not rider-owned in the ownership sense this program is closing. Not a claim about any other page. |
| A new signup now completes OTP before ever reaching a card-setup or other rider-owned prompt | **Confirmed by code-path tracing, Unverified end-to-end** | This is a UI flow, not something a Jest unit test can exercise (no browser, no integration harness in this codebase). Requires the same live click-through validation as the rest of PR 2a's own gate (task #214) — this PR doesn't close that gate, it removes one specific risk that would have made turning it on unsafe. |

## No tests added

Nothing in this PR is pure logic — it's removal of dead-end client code
and an HTML/script cleanup. Existing coverage (`lib/riderAuth.test.js`,
`lib/riderPayments.test.js`) is unaffected and still passes (345/345 on
this branch, based on `main` before PR 2b/PR 3's additions). `node
--check` clean on the page's inline script.

## Rollback plan

- **Trivial revert** — this PR only removes code and one HTML block; no
  migration, no flag, no stored data touched. Reverting restores the
  removed feature exactly as it was (including its pre-existing gap) —
  not recommended, but mechanically simple if ever needed.

## Relationship to the rest of the sequence

Per the approved merge order:

1. Complete the real rider-auth UI live validation (task #214 — still
   pending, external, not touched by this PR).
2. **This PR** — resolve the signup → OTP → authenticated payment setup
   flow.
3. Merge and smoke-test PR 2b (#97).
4. Retarget PR 3 (#101) to `main`.
5. Review the resulting payment-only diff.
6. Merge PR 3 while keeping `rider_auth_enforced=false`.
7. Build the ride-ownership PR (PR 4).
8. Enable enforcement only after all dependent ownership routes and
   clients are validated.

This PR can merge independently of #97/#101 at any point — it has no
dependency on either and doesn't block on their merge order, since it
only touches `rider-signup.html` and depends solely on already-merged
PR 2a infrastructure.
