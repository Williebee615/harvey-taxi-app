# P0 Remediation — PR 1: `requireRider` Foundation

Status: **Not wired into any route.** This PR adds the middleware and its
session-validation logic only. No existing route's behavior changes as a
result of this PR — `requireRider` is defined but not yet attached to any
`app.get`/`app.post`/etc. call. Wiring it into rider-owned routes is PR 2.

## Scope

- `lib/riderAuth.js`: new pure function `resolveRiderAuthOutcome({ verification, riderRow, now })`.
- `lib/riderAuth.test.js`: 11 new unit tests for `resolveRiderAuthOutcome`.
- `server.js`: new `requireRider(req, res, next)` middleware (defined, not attached to any route).

No migrations, no config changes, no client changes.

## Threat model

Every rider-facing route in this codebase today (`/api/rider/*`, `/api/rides/*`,
`/api/safety/*`, `/api/push/subscribe`, `/api/persona/inquiry`) authorizes
requests using a client-supplied identifier (`riderId`/`rider_id` in the
query string, body, or URL param) with no proof that the caller controls
that identity. `requireRider` is the primitive that replaces that pattern:
it establishes *who the caller actually is* from a cryptographically signed,
server-issued session cookie (`harvey_rider_session`), independent of
anything the client claims about itself in the request body.

Actors this defends against:
- An unauthenticated caller with no session cookie at all.
- An authenticated rider attempting to act as a *different* rider by
  changing a `riderId` value in the request (the IDOR pattern this whole
  remediation plan exists to close — closed once PR 2 wires this in).
- A rider whose session was logged out, force-logged-out by an admin, or
  whose access was revoked, but who retains a previously issued,
  unexpired, validly signed cookie.
- Cross-site request forgery against state-changing rider endpoints (via
  the existing `x-requested-with` custom-header check, which forces a CORS
  preflight that the app's origin allow-list already rejects for
  disallowed origins).

Out of scope for this PR specifically (deferred to PR 2 and later): which
routes require this middleware, and what happens to routes that currently
accept an unauthenticated `riderId` once this is enforced.

## Exploit scenario (what this closes, once wired in by PR 2)

Today, `GET /api/rider/rides?riderId=<victim-id>` (and every sibling route)
returns the victim's ride history, PII, and in-progress trip data to
anyone who can guess or enumerate a rider ID — no session, no password, no
OTP required. `requireRider` is the mechanism PR 2 will use to reject that
request unless the caller presents a valid session cookie for that exact
rider, and to source the rider identity from the verified session instead
of the query string at all (removing the `riderId` parameter as an
authorization input entirely, not just adding a check alongside it).

## Design notes / evidence

- Session tokens are HMAC-SHA256 signed (`lib/riderAuth.js:signRiderSession`/
  `verifyRiderSession`), stored in an `HttpOnly`, `SameSite=Lax`,
  `Secure`-in-production cookie (`harvey_rider_session`) — never a bearer
  token in `localStorage`.
- Revocation is real: `session_version` on the `riders` row is compared
  against the version embedded in the token
  (`isSessionVersionCurrent`). Logout, an admin Force Logout, or an
  access-revoked deletion all invalidate every previously issued token in
  one atomic update, without a session table or denylist.
- `resolveRiderAuthOutcome` is a pure function (no I/O) — `requireRider` in
  `server.js` does the cookie read and the one Supabase lookup, then hands
  both to the pure function for the actual authorize/deny decision. This
  mirrors the split already used for `buildLogoutOutcome`, keeping the
  decision itself unit-testable without a live database or HTTP request.
- Fails closed: if `RIDER_SESSION_SECRET` is not configured, every call
  returns `503` rather than falling back to any default or skipping
  verification — consistent with how `RIDE_QUOTE_SECRET` already behaves
  elsewhere in this codebase.
- CSRF: the existing `x-requested-with: harvey-rider-app` header
  requirement (already used by the login/logout routes) is enforced for
  every non-`GET` request through this middleware.
- A rider row that no longer exists, an access-revoked rider, and a
  stale-`session_version` token are all distinguished (401 vs. 403 vs.
  401) but a nonexistent-rider case never returns 404 — an unauthenticated
  caller must never be able to use this middleware's response to test
  whether a given rider ID currently exists.

## Regression tests

`lib/riderAuth.test.js` — 11 new cases under
`describe("resolveRiderAuthOutcome — requireRider's auth decision (P0 remediation, PR #1)")`:

1. No session at all → 401, no `riderId` ever exposed on the outcome.
2. Tampered/malformed/bad-signature token → 401.
3. Expired token → 401 (never falls through to authenticated).
4. Valid signature naming a rider row that no longer exists → 401, not 404.
5. `access_revoked` rider → 403.
6. Soft-deleted rider (`deleted_at` set) → 403.
7. Token's `session_version` stale against the live row (logged out
   elsewhere / Force Logout) → 401.
8. Rider row with a `null`/non-integer `session_version` → treated as `0`,
   not as "always current."
9. Fully valid, current, active session → authenticated; `riderId` comes
   from the *verified token*, never echoed back from input.
10. `shouldRenew` is carried through from `shouldRenewSession` unchanged
    (not recomputed) — verified both before and after the TTL halfway
    point.

Full suite run: `npx jest` — 331/331 passing (13 suites), including all
pre-existing tests, confirming no regression to unrelated modules.

`node -c server.js` — syntax check passes.

## Rollback plan

This PR adds new, inert code only — it does not modify the behavior of
any existing route, cookie, or session flow. Rollback is a plain revert
of the commit/PR; no data migration, no cookie invalidation, and no
client changes are involved. There is no production-behavior difference
to roll back from, since `requireRider` is not called anywhere yet.

## Production verification checklist

Because this PR changes no route behavior, production verification is
limited to confirming the deploy is inert as intended:

- [ ] Deploy succeeds; `node -c server.js` passes in CI (already verified locally).
- [ ] `npm test` passes in CI (already verified locally: 331/331).
- [ ] Existing rider login, logout, and every currently-live rider route
      continue to behave identically post-deploy (manual smoke check:
      login, view dashboard, log out).
- [ ] No new route in the OpenAPI/route inventory references `requireRider`
      yet (confirms this PR did not accidentally wire it in early).

Real production verification of `requireRider`'s actual enforcement
behavior happens in PR 2, once it is attached to real routes.
