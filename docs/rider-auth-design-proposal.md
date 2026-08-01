# Rider Authentication — Architecture Proposal

**Status: PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.** No code, schema, or route changes have been made for this. This document is the design deliverable requested before any implementation begins.

**Problem being solved:** every `/api/rider/*` and `/api/riders/*` route (saved places, payment methods, profile photo, ride/delivery history) currently identifies "who is calling" from a client-supplied `riderId` in the request body or query string, with zero session, cookie, or token verification anywhere in that surface. Any client that knows or guesses a rider ID can read or write that rider's data. This proposal closes that gap the same way `requireDriver` already closes it on the driver side — but not by copying that pattern exactly; see §2.4 for why.

---

## 1. Rider login method

### 1.1 Recommendation: SMS OTP as primary, email OTP as secondary/recovery — both via **Twilio Verify**, not the homegrown SMS path

**Primary: SMS OTP via Twilio Verify** (the same `TWILIO_VERIFY_SERVICE_SID` already live in Render from the driver-login hotfix, PR #81/#82).

Why Twilio Verify specifically, not the app's existing homegrown SMS OTP (`createVerificationRecord`/`sendSms`/`verifyCode` against the `verification_codes` table, currently used for rider self-verification at `/api/verify/sms/start`): that homegrown path sends through the raw Twilio Messaging API on `TWILIO_FROM_NUMBER`, a toll-free number that is **still not verified for A2P messaging** (documented in `docs/production-incidents.md`, 2026-07-31 — this was the exact root cause of driver SMS never arriving, fixed for driver login by switching to Twilio Verify, but the toll-free number's own verification was explicitly left as an unresolved follow-up). Building rider login on the homegrown path would silently resurrect the identical delivery failure for riders. Twilio Verify's infrastructure is exempt from that registration requirement for OTP use cases and is already proven working end-to-end this session.

**Secondary / recovery: Email OTP** via the existing `createVerificationRecord`/`verifyCode` + SendGrid path (email delivery has no equivalent toll-free/A2P restriction, and this path is already used and presumably working for rider email self-verification).

**Rejected for now: magic links.** A clickable link is more phishable (a link can be forwarded/screenshotted/copy-pasted more easily than context suggests a code should be), and a 6-digit code keeps the UX identical on both channels (rider types a code either way) and identical to the driver login UX already shipped. Revisit if user research says otherwise — this is a product call, not just security.

**Why not a password?** Nothing in the current rider signup flow collects or would need to store a password, and adding one adds a whole separate attack surface (password reset flow, credential stuffing, storage) for no benefit over OTP for a ride-hailing app's login frequency. Not recommended.

### 1.2 Account-enumeration protection

- `POST /api/rider/session/start` (proposed route, mirroring `/api/driver/session/start`) must return **the same response** whether or not the submitted phone/email matches a real rider: `{"ok": true, "sent": true}` (or a generic hint), never a distinguishable "no account found" error. This is a deliberate change from the *existing* rider self-verification routes, which are not login and can afford to be more informative.
- No route should ever accept a raw `riderId` and echo back whether it exists (several current admin-adjacent lookups do this correctly already by requiring admin auth first — the new rider-facing route must not add a new unauthenticated lookup-by-id path).

### 1.3 Resend, attempt, and expiration limits

Reuse the existing, already-solid `verification_codes` schema and `createVerificationRecord`/`verifyCode` helpers (hashed code via `hashToken()`, `timingSafeEqualString()` compare, `max_attempts: 5`, expiry via `VERIFY_TTL_MINUTES`) — this infrastructure is good and shouldn't be rebuilt, only reused with `purpose: "rider_login"`.

Add on top of it (none of this exists today for the *login* use case, only implicitly for self-verification):
- **Resend limit:** reuse the existing `rateLimit({ windowMs, max, keyPrefix })` middleware (already used for e.g. `saved_places_create`) — recommend `max: 3` per 10 minutes, keyed by destination (phone/email), plus a separate, looser IP-based limit (`max: 10` per 10 minutes) to slow distributed abuse without blocking a shared-IP household.
- **Attempt limit:** already enforced by `verifyCode()`'s `max_attempts: 5` — no change needed, just confirm the login route uses this helper rather than reinventing it.
- **Expiration:** already enforced (`VERIFY_TTL_MINUTES`, currently whatever that env var is set to — confirm it's a sane value like 10 minutes for login, not left at a signup-appropriate longer window if those differ).

---

## 2. Session design

### 2.1 Server-signed session

Mirror the driver pattern's core mechanism (HMAC-SHA256 signed, self-contained, `iat`/`exp` payload — `signDriverSession`/`verifyDriverSession`), with one deliberate addition: a **`session_version`** claim, checked against a new `riders.session_version` column at verification time. This is the one schema change this design needs (§6) and it's what makes logout/revocation actually work — see §2.3.

```
payload = { sub: "harvey-rider", rider_id, session_version, iat, exp }
token   = base64url(payload) + "." + HMAC-SHA256(RIDER_SESSION_SECRET, base64url(payload))
```

New env var: `RIDER_SESSION_SECRET` (mirrors `DRIVER_SESSION_SECRET`) — must be its own secret, not reused from the driver or admin secret, so that compromising one session type doesn't compromise the others.

### 2.2 Expiration and refresh

- Recommend a **shorter** default TTL than the driver session's 24 hours — riders open the app far less predictably than an on-shift driver. Recommend `RIDER_SESSION_TTL_HOURS` default **72 hours (3 days)**, refreshed (re-issued) on any successful authenticated request older than, say, half its remaining TTL — a lightweight "sliding session" so an active rider is never logged out mid-use, but an abandoned session still expires. This is a judgment call, not a hard security requirement — flagged as **Decision #2** below.
- No refresh-token complexity (separate long-lived refresh token + short-lived access token) recommended for v1 — the sliding-expiry single token is simpler and matches this app's existing driver pattern. Revisit only if a real need for shorter access-token TTLs emerges later.

### 2.3 Logout and revocation

This is the one place the driver pattern is genuinely insufficient to copy: **`requireDriver`'s stateless token has no revocation mechanism at all** — a driver token is valid until natural expiry no matter what "logout" does client-side (confirmed by code read: no `driver_sessions` table usage anywhere despite the table existing; no driver logout route found in `server.js`). That's an acceptable gap for a driver's own device but not acceptable here, since the directive explicitly requires real logout and `access_revoked` enforcement.

Proposed mechanism: **`riders.session_version` (integer, default 0)**.
- Every issued session token embeds the rider's `session_version` at issuance time.
- `requireRider` middleware checks the token's `session_version` against the *current* value in the `riders` row — mismatch = reject, "Your session has expired. Please sign in again."
- **Logout** (`POST /api/rider/session/logout`) increments `session_version` by 1 — instantly invalidates every outstanding token for that rider, on every device, with a single `UPDATE`. No session table, no denylist to grow unbounded, no cron cleanup needed.
- **Account deletion / `access_revoked = true`** already exists as a column (added this session, PR #80) — `requireRider` must check it exactly like `requireDriver` already does, independent of `session_version`.
- **Admin-forced logout** (e.g., support needs to kill a compromised rider's sessions) is now a one-line admin action: bump `session_version`. Worth exposing as an admin-dashboard button in a later PR, not required for v1.

### 2.4 Cookie vs. bearer token — **recommend HttpOnly cookie**, with tradeoffs stated

| | **HttpOnly cookie (recommended)** | Bearer token (driver's current pattern) |
|---|---|---|
| XSS resistance | Token is never readable by page JS — an XSS bug elsewhere on the page can't steal it | Token typically lives in `localStorage` to survive reloads — any XSS on the page can read and exfiltrate it outright |
| Migration surface | Browser attaches it automatically to every same-origin request — none of the ~15 rider fetch call-sites need to be touched to *attach* the token (only to *stop sending riderId*, which is required either way) | Every call site must remember to attach an `x-rider-token` header — more places for a future contributor to forget it and accidentally reopen the hole |
| Precedent in this app | Matches the admin session cookie already shipped and working (`htaf_admin_session` — `HttpOnly`, `Secure` in prod, `SameSite=Lax`) | Matches the driver session (`x-driver-token`) |
| CSRF exposure | Requires a mitigation (see below) since cookies are sent automatically by the browser | None — a bearer token must be deliberately attached, so it isn't vulnerable to CSRF by construction |
| Native mobile app fit | Slightly more setup for a future pure-native client (needs a cookie jar) | Simpler for a hypothetical future native client |

**CSRF mitigation if cookie is chosen:** `SameSite=Lax` already blocks the classic cross-site `<form>`/link-navigation CSRF vector. Layer on top: require a custom header (e.g. `X-Requested-With: harvey-rider-app`) on every state-changing rider request — a cross-origin `fetch()` with a custom header triggers a CORS preflight, which this app's existing strict origin allow-list (`lib/corsOrigins.js`, already unit-tested) will reject for any origin not on the list. This combination is standard practice and avoids building a separate CSRF-token-issuance system for v1. A double-submit CSRF token remains available as defense-in-depth later if ever needed.

**Given the current app has no `mobile/` app actually in production** (confirmed dormant in the Phase 1 audit) and every rider surface today is a same-origin web page served by this same Express app, the cookie's downsides don't currently apply, and its XSS-resistance directly closes the highest-severity failure mode. **Recommend the cookie. This is Decision #1, but I have a clear recommendation, not a coin flip.**

---

## 3. Route protection

### 3.1 `requireRider` middleware (design, not code)

Structurally mirrors `requireDriver`:

1. Read the session cookie (or, if bearer is chosen instead, the `x-rider-token` header).
2. Verify signature + expiry via `verifyRiderSession(token)` (mirrors `verifyDriverSession`).
3. Check `session_version` match (§2.3) — reject on mismatch.
4. Load the rider row by the token's `rider_id` — 404 if missing (matches the driver pattern's already-correct not-found handling from this session's earlier hotfix work).
5. Check `access_revoked === true` — 403 if revoked (mirrors `requireDriver` exactly).
6. Set `req.rider = riderRow`. **Every downstream handler must read `req.rider.id`, never `req.body.riderId` / `req.query.riderId` / `req.params.riderId`.** This is the actual fix — the middleware existing is necessary but not sufficient if a handler still trusts a client-supplied ID for anything.

### 3.2 Routes to migrate to `requireRider`

Every one of these currently reads `riderId`/`rider_id` from the request instead of a session (confirmed by direct code read this session):

| Route | Current identification | Fix |
|---|---|---|
| `GET /api/rider/saved-places` | query `riderId` | `req.rider.id` |
| `POST /api/rider/saved-places` | body `riderId`/`rider_id` | `req.rider.id` |
| `DELETE /api/rider/saved-places/:id` | (need to confirm at implementation time, likely query/body) | `req.rider.id` + ownership check on the place row |
| `GET /api/rider/payment-methods` | query `riderId` | `req.rider.id` |
| `POST /api/rider/payment-methods/setup-intent` | body `rider_id` | `req.rider.id` |
| `DELETE /api/rider/payment-methods/:paymentMethodId` | query `riderId` | `req.rider.id` + **verify the payment method actually belongs to this rider's Stripe customer before calling Stripe** (see §3.3 — this specific route is the clearest IDOR-to-money-adjacent path in the whole audit) |
| `GET /api/rider/rides` | query `riderId` | `req.rider.id` |
| `GET /api/rider/rides/:rideId` | query `riderId` + `rideId` param | `req.rider.id`, and confirm the route already filters `WHERE rider_id = ...` (needs verification at implementation time — if it currently trusts the query `riderId` for the ownership filter, that's the IDOR) |
| `GET /api/rider/deliveries` | query `riderId` | `req.rider.id` |
| `POST /api/rider/photo` | body `riderId` | `req.rider.id` (this route was added this session, following the *existing* — broken — convention; explicitly flagged as such in its own PR description) |
| `POST /api/account/rider/delete` | (confirm at implementation) | `req.rider.id` |
| `GET /api/riders/:id/readiness` | `:id` URL param, no auth at all today | Becomes `GET /api/rider/readiness` (no param) once sessions exist — **or**, if this route must stay callable pre-login (e.g. a client checking readiness before a session exists yet), keep it but never let it return anything beyond a boolean-ish status, no PII |

**Not in `/api/rider/*` namespace but rider-owned and currently unverified — also in scope:**

| Route | Issue |
|---|---|
| `POST /api/rides/request` | Need to confirm at implementation time whether the created ride's `rider_id` comes from an authenticated session or a body field |
| `POST /api/rides/:id/authorize` | Payment authorization — must verify the ride belongs to the calling rider before authorizing a charge |
| `POST /api/rides/payment-intent` | Same — must verify ride/rider ownership before creating a Stripe PaymentIntent tied to that ride |
| `GET /api/rides/:id/status`, `GET /api/rides/:id/stream` | Lower severity (read-only ride status) but should still verify the requester is either the ride's rider, its assigned driver, or an admin — not "anyone with the ride ID," since ride IDs may appear in URLs shared for tracking links today. **Needs a product decision**: if public tracking links (e.g. "share your ETA") are a real feature, this route may need to stay intentionally open by design — flagged as **Decision #3**, not assumed. |

### 3.3 Ownership verification specifics

- **Payment methods / Stripe customer:** every payment-method route must load the rider's own `stripe_customer_id` from `req.rider` (never from the request) and pass *that* to Stripe, then additionally confirm any `paymentMethodId` the client references is actually attached to that customer before deleting/using it — Stripe itself will often error on a mismatched customer, but the app should check first and return a clean 403/404 rather than relying on Stripe's error message.
- **Rides:** every ride-scoped route must `WHERE rider_id = req.rider.id AND id = :rideId` in the same query, not fetch-by-id-then-check, and not fetch-by-id-then-trust — the query itself should be incapable of returning another rider's row.

---

## 4. Transition strategy

### 4.1 Inventory of every current `riderId` call site

Backend (§3.2 table above is the authoritative list — 12 routes in `/api/rider*`, 3 in `/api/rides/*` needing a closer look).

Frontend — every place that currently sends a `riderId` and will need to stop:
- `public/rider-dashboard.html` — the primary rider app; every `apiPost`/`requestJson` call currently threading `state.riderId` into the request body/query needs that removed (the session cookie replaces it automatically). This is the largest single file to touch.
- `public/request-ride.html` — the ride-booking wizard; same pattern for ride creation/estimate/payment calls.
- `public/rider-signup.html` — signup itself necessarily happens *before* a session exists; this page's flow changes from "signup, then store riderId in localStorage" to "signup, then immediately start a login session" (see §4.3).
- `public/admin-dashboard.html` — **not affected**: admin actions that reference a `riderId` (e.g. `approveRider(id)`) are admin-authenticated already and legitimately need to target an arbitrary rider by ID; nothing here changes.

### 4.2 Compatibility impact on current rider sessions

Every currently "logged in" rider today is really just a browser with a `riderId` sitting in `localStorage` (confirmed: `getStoredRiderId()` reads `localStorage`/`sessionStorage`/URL params, no server-issued token exists at all yet). **There is no real session to migrate — there is nothing to preserve.** This significantly *simplifies* the rollout: there's no "existing session token format" to support during a transition, because no server-issued rider session has ever existed.

### 4.3 Safe migration path

1. Ship `requireRider` and the new login routes **behind a feature flag** (`rider_auth_enforced` in `system_flags`, exact same mechanism already proven for `rider_history_enabled` — `getSystemFlag()`/admin enable/disable routes). While the flag is off, `requireRider` falls back to today's behavior (trust `riderId` from the request) — so the middleware can be deployed and even wired into every route **before** it's actually enforced, with zero behavior change until the flag flips.
2. Ship the rider login UI (new "Sign in" step) on `rider-dashboard.html`/`request-ride.html` while the flag is still off — riders can start signing in for real, but nothing yet *requires* it.
3. Flip the flag on in a low-traffic window, monitoring `audit_logs` for a spike in 401s (which would indicate real riders who haven't gone through the new login step yet).
4. **Every existing rider must complete a one-time login** once the flag is on — there is no session to silently carry forward (per §4.2, none exists today). This should be framed to riders as "we've added secure sign-in," not a account-loss event — their `riders` row, ride history, saved places, etc. are all untouched; only the *access method* changes.

### 4.4 Rollback

Flip `rider_auth_enforced` back off — instantly reverts to current behavior with no deploy required, using the exact mechanism already proven for `rider_history_enabled`/`dispatch_paused`/`offer_expiry_sweep_enabled`. This is why the flag-gated approach is recommended over a hard cutover.

---

## 5. Security requirements checklist

| Requirement | Approach |
|---|---|
| Rate limiting | Existing `rateLimit()` middleware, per-destination and per-IP on login-start; per-rider on sensitive mutations (payment methods, deletion) |
| OTP hashing | Already correct in `verification_codes` (`hashToken()`) — reuse, don't rebuild |
| Replay prevention | `verification_codes.used_at` already prevents code reuse; session tokens are single-use-per-issuance via `session_version` bump on logout |
| Session-token rotation | Sliding-expiry re-issuance (§2.2); `session_version` bump forces full rotation on logout/revocation |
| CSRF protection (if cookies) | `SameSite=Lax` + custom-header-triggers-CORS-preflight (§2.4) |
| Strict CORS | Already exists (`lib/corsOrigins.js`, unit-tested) — confirm it covers the new login routes, no new work expected |
| Audit logging | Reuse existing `auditLog()` helper for `rider_login_started`, `rider_login_succeeded`, `rider_login_failed`, `rider_logout` |
| IDOR regression tests | New `lib/riderAuth.test.js` (pure logic) + a set of `server.js`-level integration-style tests — see §7 |

---

## 6. Schema / migration requirements

**One column, one table unaffected:**

```sql
alter table public.riders
  add column if not exists session_version integer not null default 0;
```

No new table needed — `verification_codes` (OTP delivery) and `audit_logs` (login events) already exist and already fit this use case. This is deliberately the smallest schema footprint that satisfies real revocation (§2.3).

New env var: `RIDER_SESSION_SECRET` (and optionally `RIDER_SESSION_TTL_HOURS`, defaulting per §2.2).

New `system_flags` row: `rider_auth_enforced` (defaults to `"false"`, same pattern as `rider_history_enabled`).

---

## 7. Required tests

Per the directive, plus this project's existing convention of pure-logic unit tests backing every server route (`lib/*.js` + `*.test.js`):

1. **Unauthenticated access rejected** — every migrated route returns 401 with no session cookie/token.
2. **Rider A cannot read or modify Rider B** — call every migrated route as Rider A's session, targeting Rider B's saved place / payment method / ride ID; expect 403/404, never the data.
3. **Client-supplied `riderId` is ignored** — call a migrated route with a valid session for Rider A *and* a body/query `riderId` for Rider B; assert the response acts on Rider A's data, proving the parameter has no effect post-migration.
4. **Revoked/deleted rider rejected** — session for a rider with `access_revoked = true` gets 403.
5. **Expired or malformed token rejected** — expired `exp`, tampered signature, and garbage tokens all get 401 (mirrors existing `verifyDriverSession` test coverage pattern, if any exists — confirm and extend).
6. **Logout invalidates access** — issue a session, call logout, confirm the *same* token now fails (proves `session_version` actually gets checked, not just incremented).
7. **Legitimate rider flows continue working** — full happy-path regression: login → book a ride → add a saved place → upload a photo → view history → logout, all as one continuous session.

Pure decision logic (token verification, `session_version` matching, OTP-purpose scoping) should live in a new `lib/riderAuth.js`, unit-tested the same way `lib/driverCompliance.js` is — dependency-injected, no live DB required for the core logic tests. The ownership-boundary tests (#2, #3) necessarily need a live/staging Supabase project since they're proving a database query's `WHERE` clause is correct, not just a pure function.

---

## 8. Phased PR sequence

Each is its own focused, reviewable PR, consistent with how every fix has shipped this session:

1. **PR: `lib/riderAuth.js` + tests** — pure session-token sign/verify/version-check logic, zero routes touched, zero risk. Mirrors `lib/driverCompliance.js`'s existing pattern.
2. **PR: schema migration** — `riders.session_version` column + `rider_auth_enforced` system_flags seed row. Applied to a Supabase branch first, verified, then to the live project — reversible via `git revert` + a follow-up migration to drop the column if ever truly needed (won't be, since it defaults harmlessly to 0).
3. **PR: login/logout routes** — `POST /api/rider/session/start`, `POST /api/rider/session/verify`, `POST /api/rider/session/logout`, all flag-gated as "available" but not yet "required" (§4.3 step 1). Includes rate limiting + audit logging.
4. **PR: `requireRider` middleware**, wired into every route in §3.2's table, but **soft-enforced** behind `rider_auth_enforced` (falls back to today's behavior when the flag is off) — this is the PR that actually needs the most careful review, since it touches every rider route, even though its *behavior* doesn't change until the flag flips.
5. **PR: frontend login UI** on `rider-dashboard.html` / `request-ride.html` / `rider-signup.html`, stop sending `riderId` from the frontend once the session exists (can ship ahead of the flag flip — the backend still accepts the old parameter as a fallback until step 6).
6. **Ops action, not a PR:** flip `rider_auth_enforced` on in Supabase, monitor, keep the flip-off rollback ready for at least a full day of real traffic before considering it final.
7. **PR: remove the flag and the fallback path** once confident — delete the "trust `riderId` from request" code entirely, making `requireRider` unconditional. This is the PR that actually closes the P0, not step 4.
8. **PR: IDOR regression test suite** (§7, items 2/3 specifically) — could ship alongside step 7 as the thing that proves it's safe to remove the fallback.

### Estimated effort

**[ESTIMATE]** — I have not built this yet, so treat these as planning-grade, not committed:
- Steps 1-3: half a day each, low complexity, high confidence (closely mirror existing driver-session code).
- Step 4: the largest single piece — a full day, mostly careful review time given it touches ~12 routes, even though each individual change is small.
- Step 5 (frontend): a full day — `rider-dashboard.html` alone is over 10,000 lines and every fetch call site needs auditing, not just the obvious ones.
- Steps 6-8: a day of monitoring/soak time plus half a day of cleanup work.
- **Total: roughly 4-5 focused working days**, not counting your review/approval turnaround between each PR, and not counting whatever the live click-through testing in §7 surfaces.

---

## 9. Decisions requiring your approval before implementation starts

1. **Cookie vs. bearer token** (§2.4) — I recommend the HttpOnly cookie. Please confirm or override.
2. **Session TTL** (§2.2) — I proposed 72 hours with sliding refresh as a reasonable default; this is a product/UX call as much as security. Confirm or specify a different window.
3. **Ride-status/stream routes and public tracking links** (§3.2) — do riders currently rely on sharing a ride-tracking link with someone who isn't logged in (e.g. "watch my ride")? If yes, `GET /api/rides/:id/status`/`stream` need a deliberately-scoped exception, not a blanket lockdown. If no, they get the same ownership check as everything else. **I don't know the answer to this from the code alone — it's a product question.**
4. **Rollout timing** — do you want the flag-flip (§4.3 step 3, §8 step 6) to happen in a specific low-traffic window, or is current traffic low enough that timing doesn't matter yet? (Given the audit's NO-GO status, likely the latter, but confirming.)
5. **Whether to also build the admin "force logout a rider" button** mentioned in §2.3 — trivial once `session_version` exists, but it's a scope decision on whether it ships in this program or later.

I have not started implementation on any of the above and will not until you respond to this proposal.
