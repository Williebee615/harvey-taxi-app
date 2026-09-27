# CODE BLUE Phase 1 — Rider-Auth Prerequisites Added to the Enforcement Rollout

Status: **documentation only. No flag changed, no migration applied, no
route enabled/disabled by this document.** Companion to PR #130
(`code-blue/dispatch-integrity-phase-1`) and to the existing
`docs/rider-auth-design-proposal.md` / `docs/security-remediation/pr-02*`
/ `pr-240-ride-request-ownership.md` chain, which this does not replace.

## Why this exists

Phase 1 added two pieces of rider-facing behavior that lean on rider
session identity, and both surfaced the same underlying blocker the
`pr-02b-plus-pr-03-live-validation-runbook.md` already named ("Confirm
`rider_auth_ui_enabled` is `true` and the real OTP login flow has
already passed live validation" — currently unmet in production):

1. **`POST /api/rides/request`'s quote-replay response.** A replayed
   `estimate_token` (same `jti`) can never create a second ride — the
   database's unique constraint on `rides.quote_jti` makes that
   unconditional, regardless of session state. But whether the
   *response* to the duplicate request may include the original ride's
   details is now decided **only** by `resolveVerifiedRiderSession(req)`
   — a real, signature-verified `harvey_rider_session` cookie whose
   rider id matches `existingRide.rider_id`. A body-supplied `rider_id`
   that happens to match is deliberately never sufficient, and never
   was treated as sufficient in the shipped code — it produces the same
   generic `409 "This ride quote has already been used."` as a
   completely unrelated caller. See `server.js`'s `POST /api/rides/request`
   handler and its surrounding comments for the exact mechanism.
2. **`POST /api/rides/:id/cancel`**, new in Phase 1, is protected by
   `requireRider` **unconditionally** (not gated behind
   `rider_auth_enforced`) because, unlike every route in the #97/#115/#118
   chain, no existing client calls it — there is no legacy behavior to
   avoid breaking. **This route cannot be wired into any rider-facing
   UI (a "Cancel Ride" button on `rider-dashboard.html`/`request-ride.html`)
   until real rider sessions exist in production**, i.e. until
   `rider_auth_ui_enabled` is on and riders have actually signed in.
   Shipping a cancel button today would 401 for every rider. This is a
   deliberate, currently-inert route, the same "ships inert" posture
   `pr-240-ride-request-ownership.md` used for ride-creation ownership.

Neither of these claims, nor anything else in Phase 1, closes rider
ownership authorization on `/api/rides/request` itself — `riderId` on
that route remains a **legacy, unauthenticated value** read from
`req.body`/`resolveEnforcedRiderId`'s client-supplied fallback while
`rider_auth_enforced` is off (the current, unchanged production
default). Phase 1 narrows the blast radius of a *replay*, and adds one
new session-gated route; it does not authenticate ride creation.

## Prerequisites added to the rider-auth enforcement rollout

These are additive to, not a replacement for, the existing
`pr-02b-plus-pr-03-live-validation-runbook.md` checklist. `rider_auth_enforced`
must not be considered for production activation until all of the
following also pass, in addition to that runbook's existing items:

1. **Signup must establish a verified rider session or immediately
   begin the existing OTP verification flow.** Today (`rider_auth_ui_enabled`
   off), `POST /api/riders/signup` completes with no session and no
   forced handoff to verification — confirmed by code read
   (`pr-02c-signup-session-handoff.md`). This must change before
   enforcement: a new signup must not be left in a state where every
   subsequent rider-owned call is unauthenticated by construction.
2. **Rider requests must use `credentials: "include"` where cookies are
   required.** Confirmed already correct today in `rider-dashboard.html`'s
   `apiFetch` (per this session's investigation) — this item stays on
   the checklist as a regression guard for any new or changed call site,
   not because a known gap exists right now.
3. **Existing riders without sessions must receive a working sign-in/recovery
   screen.** Per `docs/rider-auth-design-proposal.md` §4.2, there is no
   legacy session to migrate — every current rider is identified only by
   a `localStorage` id. Enforcement must not silently lock out every
   existing rider; a discoverable, working sign-in flow must be reachable
   from the app they already have installed/bookmarked, not just from a
   flag flip.
4. **The WebView must preserve and transmit the session cookie correctly.**
   Not yet verified in this session — no WebView/mobile harness available.
   Required before enforcement, since a rider on the WebView wrapper
   silently losing its cookie (e.g. due to `SameSite`/storage-partitioning
   behavior in that WebView) would be indistinguishable from "no session"
   at the server and would 401 every request.
5. **The authentication UI cannot remain inaccessible behind an off-by-default
   flag when enforcement is enabled.** `rider_auth_ui_enabled` gates the
   only sign-in surface that exists (`bootstrapRiderSession()` /
   `handOffToRiderVerification()` in `rider-dashboard.html`). Turning on
   `rider_auth_enforced` while `rider_auth_ui_enabled` is still off would
   require sessions the UI gives riders no way to obtain. Confirmed by
   code read: with `rider_auth_ui_enabled` off, `runAuthenticatedBoot()`
   runs fully anonymously and the auth overlay is hidden entirely.
6. **Test new signup, existing-rider sign-in, logout, expired sessions,
   WebView persistence, and ride-request recovery** as one connected
   suite before enforcement — not as isolated unit tests. This extends
   (does not replace) `docs/rider-auth-design-proposal.md` §7's test
   list and `pr-02b-plus-pr-03-live-validation-runbook.md`'s Phase B; the
   addition here is explicitly requiring ride-request recovery (a rider
   who loses connectivity mid-request and retries, now landing on the
   `resolveVerifiedRiderSession`-gated replay path added in Phase 1) as
   part of that same connected pass, not a separate, possibly-skipped
   check.
7. **Only after items 1–6 pass should `rider_auth_enforced` be considered
   for production activation.** This restates, and does not weaken,
   `pr-02b-plus-pr-03-live-validation-runbook.md`'s existing requirement
   that `rider_auth_ui_enabled` be confirmed on and live-validated first;
   items 1–6 are additional gates layered on top of that one, not a
   substitute for it.

## What Phase 1 did not need to touch to ship the above

- No change to `rider_auth_enforced`'s default (`false`, unchanged).
- No change to `rider_auth_ui_enabled`'s default (`false`, unchanged).
- No change to any production flag, migration application, or Stripe
  behavior. This document and the code it describes are both currently
  inert with respect to production rider authentication state.
