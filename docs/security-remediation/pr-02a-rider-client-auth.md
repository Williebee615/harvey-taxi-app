# P0 Remediation — PR 2a: Rider Client Authentication Wiring

Status: **client-side sign-in gate only.** `requireRider` is still not wired
into any existing rider-owned data route (`/api/rider/rides`,
`/api/rider/saved-places`, `/api/rider/payment-methods`, etc.) — that is
PR 2b, which starts only after this PR is merged and manually validated,
and ships behind the `rider_auth_enforced` flag, left off.

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

- `lib/riderAuth.js`: new pure function `buildRiderSessionBootstrap({ rider, readiness })` — the exact, allow-listed response contract for the new bootstrap endpoint.
- `lib/riderAuth.test.js`: 5 new tests for `buildRiderSessionBootstrap`.
- `server.js`: new `GET /api/rider/session` route, `requireRider`-protected (the only route this PR protects — a *new* route, not an existing one).
- `public/rider-dashboard.html`:
  - New full-screen sign-in overlay (`#riderAuthOverlay`): phone tab (primary, Twilio Verify SMS) and email tab (fallback, existing OTP-by-email infra), code entry, resend with a 30s cooldown, generic error messaging, "Sign out" action.
  - `boot()` now calls `bootstrapRiderSession()` (`GET /api/rider/session`) before loading any dashboard data. A non-2xx response shows the sign-in overlay and halts further boot; a 2xx response hides it and proceeds exactly as before.
  - `loadRiderStatus()` changed from unconditionally overwriting `state.riderId`/`state.riderProfile` from `localStorage`/URL params to only falling back to them if the server-verified bootstrap hasn't already set them — the authenticated identity must win.
  - `localStorage`'s `harvey_rider_id` key is still written after a successful bootstrap, but strictly for non-authoritative UI continuity with code this migration hasn't reached yet (per your explicit scope note) — the bootstrap check itself never reads it back as proof of identity.

**Out of scope for this PR** (unchanged): every existing rider-owned data
route continues to accept a client-supplied `riderId` exactly as before.
`rider-signup.html` and `request-ride.html` are not touched — see "Known
gaps" below for why.

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

## Known gaps flagged for your decision (not fixed in this PR)

**`rider-signup.html` calls rider-owned routes with no session either.**
Right after a successful signup, `rider-signup.html` calls
`GET /api/riders/:id/readiness` and `POST /api/rider/payment-methods/setup-intent`
using the just-created `riderId` — before any OTP login. Today this works
because those routes are unauthenticated; once PR 2b enforces
`requireRider` on the readiness route, a rider who just signed up will
hit those calls with no session and be redirected into the new sign-in
gate immediately, effectively asking them to log in a second time right
after signup. This PR does not solve that (it's a signup-flow product
decision — e.g., should `POST /api/riders/signup` auto-issue a session
cookie immediately, since the rider already supplied a real phone/email?)
and deliberately left it out rather than guessing. Recommend deciding
this before PR 2b enables `rider_auth_enforced` for the readiness route.

**`request-ride.html` no longer exists** as a standalone file — its
functionality was fully merged into `rider-dashboard.html`'s wizard
overlay in an earlier PR, and no other file references it. Confirmed via
`ls`/grep; out of scope per your own instruction ("only if still
independently reachable").

## Regression tests

`lib/riderAuth.test.js` — 5 new cases under
`describe("buildRiderSessionBootstrap — GET /api/rider/session's response contract")`:

1. Returns exactly the allow-listed keys (`rider_id`, `first_name`, `last_name`, `ready`, `approval_status`, `checks`) — nothing more.
2. Never leaks `stripe_customer_id`, `phone`, `email`, `password_hash`, `persona_status`, `internal_notes`, or `address` even when present on the input rider row.
3. `rider_id` always comes from `rider.id`; `first_name`/`last_name`/`approval_status` fall back to `null`, never thrown, when absent.
4. `ready`/`checks` come from the `readiness` argument, not guessed from the rider row.
5. A missing `readiness` argument never throws; defaults to not-ready with empty checks.

Full suite: `npx jest` — 336/336 passing (13 suites), no regressions.
`node -c server.js` passes. Both `rider-dashboard.html` `<script>` blocks
extracted and checked with `node --check` — both parse cleanly.

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

- [ ] Real SMS OTP: request a code with a real phone number tied to an
      active rider row, receive it via Twilio, complete sign-in.
- [ ] Real email OTP: same, via the email fallback tab.
- [ ] Cookie survives a full page reload (sign in, reload, confirm the
      dashboard loads without re-prompting).
- [ ] Logout actually invalidates the session (sign out, then confirm a
      reload shows the sign-in gate again, not the dashboard).
- [ ] A revoked or expired session correctly returns to the sign-in gate
      rather than an error page or a stuck loading state.
- [ ] Resend-code cooldown behaves correctly against the server's real
      rate limits (10/min per IP, 3/10min per destination on `start`).
- [ ] Mobile viewport check (the overlay's responsive breakpoint, on-screen
      keyboard behavior for `inputmode="numeric"`/`tel`/`email`).

## Rollback plan

Pure addition: a new backend route (`GET /api/rider/session`, gated by
`requireRider`, itself inert until PR 1 is live) and new, additive client
UI. No existing route's behavior changes, no migration, no config change.
Reverting this PR removes the sign-in gate and the bootstrap route only;
the dashboard returns to its prior (still-vulnerable, pre-PR-2a)
behavior, unchanged from before this PR. No data was altered.

## Production verification checklist

- [ ] Deploy succeeds; CI (`node -c server.js`, `npm test`) green.
- [ ] Visiting `rider-dashboard.html` with no cookie shows the sign-in
      gate, not dashboard content.
- [ ] Manual validation items above all pass.
- [ ] Confirm `rider_auth_enforced` remains off/unset in production (PR 2b's
      flag, not introduced by this PR, but worth confirming it doesn't
      exist yet from an earlier partial rollout).
