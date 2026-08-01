# P0 Remediation — PR 2a: Rider Client Authentication Wiring

Status: **client-side sign-in gate only, shipped inert.** `requireRider`
is still not wired into any existing rider-owned data route
(`/api/rider/rides`, `/api/rider/saved-places`, `/api/rider/payment-methods`,
etc.) — that is PR 2b, which starts only after this PR is merged and
manually validated, and ships behind the `rider_auth_enforced` flag, left
off. This PR's own sign-in gate is itself behind a separate, default-off
rollout flag, `rider_auth_ui_enabled` (see below) — with no staging
environment available, this lets the PR merge and deploy with zero
behavior change until an admin deliberately turns it on.

## Why this PR exists (see PR 1's follow-up discussion)

Grepping every `public/*.html` file for calls to `/api/rider/session/start`,
`/verify`, or `/logout` returned zero matches anywhere in this codebase.
The rider session-cookie infrastructure (`lib/riderAuth.js`, the three
session routes) has existed and worked since before this remediation
effort started, but **no client page has ever called it.** `rider-dashboard.html`
identified "the current rider" purely from a `harvey_rider_id` value in
`localStorage` or a URL query parameter — no OTP challenge, no password,
no login step of any kind.

Enforcing `requireRider` on real data routes (PR 2b) without first fixing
this would break 100% of live rider traffic on deploy, since no browser
would hold the `harvey_rider_session` cookie `requireRider` checks. This
PR closes that gap first, as its own reviewable unit.

## Scope

- `lib/riderAuth.js`: new pure functions:
  - `buildRiderSessionBootstrap({ rider, readiness })` — the exact, allow-listed response contract for the new bootstrap endpoint.
  - `buildRiderVerificationFieldUpdate({ channel, rider })` — decides whether a successful login OTP should flip `sms_verified`/`email_verified` true, and for which single channel.
- `lib/riderAuth.test.js`: 11 new tests (5 for the bootstrap contract, 6 for the verification-field update).
- `server.js`:
  - New `GET /api/rider/session` route, `requireRider`-protected (the only *existing-route-class* addition — a new route, not a previously-unauthenticated one made authenticated).
  - `POST /api/rider/session/verify` now records which channel (phone or email) the OTP actually proved, via `buildRiderVerificationFieldUpdate`, and writes `sms_verified`/`email_verified` accordingly — never both from one successful channel, never before the existing revocation check.
- `public/rider-dashboard.html`:
  - New full-screen sign-in overlay (`#riderAuthOverlay`): phone tab (primary, Twilio Verify SMS) and email tab (fallback, existing OTP-by-email infra), code entry, resend with a 30s cooldown, generic error messaging, "Sign out" action.
  - `boot()` now calls `bootstrapRiderSession()` (`GET /api/rider/session`) before loading any dashboard data. A non-2xx response shows the sign-in overlay and halts further boot; a 2xx response hides it and proceeds exactly as before.
  - `loadRiderStatus()` changed from unconditionally overwriting `state.riderId`/`state.riderProfile` from `localStorage`/URL params to only falling back to them if the server-verified bootstrap hasn't already set them — the authenticated identity must win.
  - `localStorage`'s `harvey_rider_id` key is still written after a successful bootstrap, but strictly for non-authoritative UI continuity with code this migration hasn't reached yet (per your explicit scope note) — the bootstrap check itself never reads it back as proof of identity.
  - New `consumePendingSignupAuth()` / `tryAutoStartSignupVerification()`: on a failed bootstrap, checks for a one-time handoff left by `rider-signup.html` in `sessionStorage`, and if present, pre-fills the destination and automatically fires `session/start` so a freshly-signed-up rider lands directly on the code-entry step instead of re-typing their phone number.
- `public/rider-signup.html`: **revised per your follow-up instruction.** See "Signup-to-auth handoff" below — this was originally flagged as an out-of-scope "known gap" and has now been folded into this same PR since the change is limited to the signup-to-verification handoff itself.

**Still out of scope for this PR** (unchanged): every existing rider-owned
data route (`/api/rider/rides`, `/api/rider/saved-places`,
`/api/rider/payment-methods`, the readiness route, etc.) continues to
accept a client-supplied `riderId` exactly as before — that is PR 2b.
`request-ride.html` is not touched (see below for why).

## Signup-to-auth handoff (added in this revision)

**Before:** `rider-signup.html`'s `createRiderAccount()` treated a
successful `POST /api/riders/signup` response as sufficient to act as
that rider — it immediately called `GET /api/riders/:id/readiness`-adjacent
UI and `POST /api/rider/payment-methods/setup-intent` (via
`showPaymentMethodCard`), and linked straight to
`rider-dashboard.html?riderId=...`, all before any OTP challenge. This is
exactly the "session issued from a signup response alone" pattern the
approved scope forbids.

**Now:**

1. On a successful signup, `createRiderAccount()` no longer shows the
   payment-method card or links directly to the dashboard. Instead it
   calls `handOffToRiderVerification({ channel: "phone", destination: payload.phone })`,
   which stores the channel + destination in `sessionStorage` (not a URL
   query param — kept out of browser history and referrer headers) and
   redirects to `rider-dashboard.html` after a short confirmation message.
2. `rider-dashboard.html`'s `boot()` runs its normal `bootstrapRiderSession()`
   check first (as before); since a freshly-signed-up rider has no
   session yet, this fails as expected, the sign-in overlay is shown, and
   `tryAutoStartSignupVerification()` reads and immediately clears the
   pending handoff, pre-fills the phone tab with the number just entered
   at signup, and calls the same `requestLoginCode()` a manual "Send
   code" click would — landing the rider directly on the code-entry step
   of the identical dashboard sign-in flow, no separate signup-specific
   OTP UI to duplicate or drift out of sync.
3. On successful verification, `POST /api/rider/session/verify` now marks
   `sms_verified: true` (phone) or `email_verified: true` (email) — only
   the one channel actually proven by that OTP — before issuing the
   session cookie exactly as it already did.
4. The client's existing `completeSignIn()` (unchanged from before this
   revision) then calls `GET /api/rider/session` to load identity from
   the server and proceeds straight into `runAuthenticatedBoot()` — the
   rider is never asked to sign in a second time, and readiness/payment
   setup/saved places/history are only ever fetched inside
   `runAuthenticatedBoot()`, i.e. strictly after the authenticated
   session exists.

`payload.phone` is always present (signup validation requires it), so
this always uses the phone channel — email is available as the
dashboard's fallback tab if the rider prefers it or the SMS doesn't
arrive, exactly as for a returning rider.

**Still not addressed here, on purpose:** `rider-signup.html`'s separate
"Check Rider Status" feature (a pre-existing, differently-scoped utility
that looks up `GET /api/riders/:id/readiness` by a saved rider ID with no
session at all) is untouched. That is the same underlying vulnerability
class PR 2b closes at the route level; rewriting that separate feature
now would be scope creep beyond "the signup-to-auth handoff."

## Requirements checklist (against your approved scope)

- [x] Real OTP challenge only — no silent login from `localStorage`, URL params, rider ID, email, or phone alone. Both `session/start` and `session/verify` require the CSRF header and go through Twilio Verify (SMS) or `createVerificationRecord`/`verifyCode` (email); neither branch can be satisfied by supplying an ID alone.
- [x] Session cookie remains `HttpOnly`, `SameSite=Lax`, `Secure`-in-production — unchanged from the existing `setRiderSessionCookie`/`clearRiderSessionCookie`, never copied into `localStorage` by this PR's new code.
- [x] Session-status/bootstrap endpoint: `GET /api/rider/session`.
- [x] After login, identity loads from the server (`bootstrapRiderSession()`); `harvey_rider_id` is no longer treated as proof of identity by this page's own boot sequence.
- [x] Resend-code handling (30s cooldown, re-uses `session/start`).
- [x] Generic, no-enumeration responses — unchanged pre-existing server behavior (`RIDER_SESSION_START_RESPONSE` is always `{sent:true}`); this PR's UI always advances to the code-entry step regardless of match.
- [x] Expired/invalid-code errors — generic "invalid or expired" message; a distinct message for a `403` (access-revoked) response.
- [x] Logout — calls `POST /api/rider/session/logout`, then clears local state and re-shows the sign-in gate regardless of whether the network call succeeded.
- [x] Session-expired/revoked handling — any non-2xx from the bootstrap check (expired, revoked, no session) uniformly shows the sign-in gate.
- [x] Mobile-friendly UI — single-column card, large tap targets, `inputmode`/`autocomplete` attributes set per field, responsive down to 480px.
- [x] `GET /api/rider/session` returns only rider ID, display name, and verification/readiness state — never payment data or internal fields. Enforced by an explicit allow-list function (`buildRiderSessionBootstrap`) with a test proving the response's keys are *exactly* `{rider_id, first_name, last_name, ready, approval_status, checks}`, and a second test proving a rider row's `stripe_customer_id`, `phone`, `email`, `persona_status`, and other sensitive fields never appear in the serialized response even when present on the input row.
- [x] `requireRider` not wired into any existing rider-owned route.
- [x] `rider_auth_enforced` left off (it doesn't gate anything yet — PR 2b introduces it).

## Known gaps

**`rider-signup.html`'s post-signup flow — RESOLVED in this revision.**
Originally flagged here as an out-of-scope gap (signup called
readiness/payment-setup with no session); see "Signup-to-auth handoff"
above for the fix, folded into this same PR per your follow-up
instruction since it stayed limited to the signup-to-verification
handoff.

**`request-ride.html` no longer exists** as a standalone file — its
functionality was fully merged into `rider-dashboard.html`'s wizard
overlay in an earlier PR, and no other file references it. Confirmed via
`ls`/grep; out of scope per your own instruction ("only if still
independently reachable").

## Regression tests

`lib/riderAuth.test.js` — 11 new cases across two describe blocks:

`buildRiderSessionBootstrap — GET /api/rider/session's response contract` (5):
1. Returns exactly the allow-listed keys (`rider_id`, `first_name`, `last_name`, `ready`, `approval_status`, `checks`) — nothing more.
2. Never leaks `stripe_customer_id`, `phone`, `email`, `password_hash`, `persona_status`, `internal_notes`, or `address` even when present on the input rider row.
3. `rider_id` always comes from `rider.id`; `first_name`/`last_name`/`approval_status` fall back to `null`, never thrown, when absent.
4. `ready`/`checks` come from the `readiness` argument, not guessed from the rider row.
5. A missing `readiness` argument never throws; defaults to not-ready with empty checks.

`buildRiderVerificationFieldUpdate — marking phone/email verified on a successful login OTP` (6):
1. A successful phone OTP marks `sms_verified: true` when not already true.
2. A successful email OTP marks `email_verified: true` when not already true.
3. A phone OTP never also marks `email_verified`.
4. An email OTP never also marks `sms_verified`.
5. Returns `null` (no write needed) when the channel's flag is already true.
6. A rider row missing the verification columns entirely (`undefined`, not `false`) still returns an update, not `null`.

Full suite: `npx jest` — 342/342 passing (13 suites), no regressions.
`node -c server.js` passes. Both `rider-dashboard.html` `<script>` blocks
and `rider-signup.html`'s script block extracted and checked with
`node --check` — all parse cleanly.

**What is not covered by automated tests, and why:** this codebase has no
integration-test harness (no supertest, no Express test client) — every
existing test is a pure-function unit test. The genuinely new *route*
behavior (`GET /api/rider/session` end-to-end, the SMS/email OTP round
trip, cookie set/clear over real HTTP, the client's DOM interactions) has
no automated coverage here and needs the manual validation below before
merge, per your explicit requirement.

## Manual validation — REQUIRED before merge, NOT performed by me

I do not have a browser, a real phone number, or a real inbox in this
environment, so none of the following has been validated and each must
be done by a human before this PR merges:

- [ ] Real SMS OTP login (existing rider): request a code with a real
      phone number tied to an active rider row, receive it via Twilio,
      complete sign-in.
- [ ] Real email OTP login (existing rider): same, via the email
      fallback tab.
- [ ] New signup → OTP → authenticated dashboard: create a brand-new
      rider account, confirm it lands on the dashboard's code-entry step
      with the phone pre-filled (no re-typing), confirm the code arrives,
      confirm a successful verify goes straight to the dashboard with no
      second sign-in prompt, and confirm `sms_verified` is now `true` on
      that rider's row.
- [ ] Cookie survives a full page reload (sign in, reload, confirm the
      dashboard loads without re-prompting).
- [ ] Logout actually invalidates the session (sign out, then confirm a
      reload shows the sign-in gate again, not the dashboard).
- [ ] A revoked or expired session correctly returns to the sign-in gate
      rather than an error page or a stuck loading state.
- [ ] Resend-code cooldown behaves correctly against the server's real
      rate limits (10/min per IP, 3/10min per destination on `start`).
- [ ] Mobile viewport/keyboard check (the overlay's responsive breakpoint,
      on-screen keyboard behavior for `inputmode="numeric"`/`tel`/`email`)
      on both the returning-rider sign-in and the new-signup handoff.

**Staging note (per your instruction):** none of the above should be
validated directly in production. I have no Render/deployment access
from this environment to stand up a temporary staging deployment myself,
so this PR now ships with the second option instead — a narrowly
controlled, default-off rollout flag (below) — so the manual validation
above can happen safely against production once real accounts exist to
test with, without exposing every rider to an unvalidated sign-in gate
in the meantime.

## Rollout flag: `rider_auth_ui_enabled` (added in this revision)

Directly addressing your flagged risk: *"PR #95 currently gates the
entire dashboard even though existing data routes remain
unauthenticated... it could lock every rider out while leaving the
underlying IDOR vulnerability open."* This flag makes that impossible by
construction, not just by discipline:

- `GET /api/rider/auth-ui-config` — new, public, unauthenticated route.
  Returns `{ enabled: boolean }`, backed by `getSystemFlag("rider_auth_ui_enabled", "false")`
  — defaults to **off**.
- `POST /api/admin/system/enable-rider-auth-ui` / `disable-rider-auth-ui` —
  `requireAdmin`-gated, mirroring the existing `rider_history_enabled`
  admin-toggle pattern exactly (audit-logged, `system_flags` upsert).
- **With the flag off (the default):** both `rider-dashboard.html`'s
  `boot()` and `rider-signup.html`'s post-signup handler check this flag
  first and, if off, run their exact pre-PR-2a code paths — no sign-in
  overlay, no signup handoff, no behavior change from what's live today.
  This PR can merge and deploy to production **completely inert**.
- **Flipping it on** (via the admin route, after real SMS/email OTP
  delivery has been confirmed working, per the manual validation
  checklist above) is what actually activates the sign-in gate and the
  signup handoff for every rider, in one atomic, instantly-reversible
  step — flipping it back off immediately restores the pre-PR-2a
  behavior with no deploy required.

This is deliberately a separate flag from the future `rider_auth_enforced`
(PR 2b): that one controls whether the *server* rejects unauthenticated
requests to rider-owned routes; this one only controls whether the
*client* shows the sign-in gate at all. `rider_auth_enforced` still does
not exist yet and is not touched by this PR.

## Rollback plan

Pure addition: a new backend route (`GET /api/rider/session`, gated by
`requireRider`, itself inert until PR 1 is live), a new public config
route and two admin-toggle routes for `rider_auth_ui_enabled`, and new,
additive client UI. No existing route's behavior changes, no migration,
no config change. Two independent rollback layers:

1. **Instant, no deploy:** flip `rider_auth_ui_enabled` off via the admin
   route — every rider immediately falls back to the pre-PR-2a boot
   behavior on their next page load.
2. **Full revert:** reverting this PR's commit removes the sign-in gate,
   the bootstrap route, and the flag routes entirely; the dashboard
   returns to its prior (still-vulnerable, pre-PR-2a) behavior, unchanged
   from before this PR. No data was altered by this PR itself (the one
   new data write, marking `sms_verified`/`email_verified` on a
   successful login OTP, only ever sets a previously-`false` flag to
   `true` and is not reverted by rolling back the code, but is also not
   something that needs to be — it only ever records something that
   became true).

## Production verification checklist

- [ ] Deploy succeeds; CI (`node -c server.js`, `npm test`) green.
- [ ] Immediately after deploy, confirm `GET /api/rider/auth-ui-config`
      returns `{ enabled: false }` — the PR must land inert.
- [ ] Confirm `rider-dashboard.html` and `rider-signup.html` both behave
      identically to before this PR while the flag is off (no sign-in
      overlay, signup still shows the payment-method card and direct
      dashboard link).
- [ ] Complete the manual validation checklist above against production
      with the flag still off (calling the sign-in routes directly, or
      via a controlled test after temporarily flipping the flag on for a
      single test session).
- [ ] Only then, flip `rider_auth_ui_enabled` on via
      `POST /api/admin/system/enable-rider-auth-ui`.
- [ ] Confirm `rider_auth_enforced` remains off/unset in production (PR 2b's
      flag, not introduced by this PR, but worth confirming it doesn't
      exist yet from an earlier partial rollout).

## Controlled live validation

Full pre-enable checklist, step-by-step validation procedure, and
evidence log: see
[`docs/security-remediation/pr-02a-live-validation-runbook.md`](./pr-02a-live-validation-runbook.md).
Live-verified as of this writing (queried the production Supabase
project directly): `rider_auth_ui_enabled` and `rider_auth_enforced` both
currently resolve to `false` (no row exists for either key in
`system_flags`, and `getSystemFlag` fails closed to `"false"` on both a
missing row and a query error). Everything else in that checklist
(Twilio/SendGrid health, Render deploy, real OTP delivery, browser-based
checks) requires ops/QA access this session doesn't have.
