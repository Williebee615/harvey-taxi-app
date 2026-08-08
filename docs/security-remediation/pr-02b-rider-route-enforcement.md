# P0 Remediation — PR 2b: Rider Route Ownership Enforcement

Status: **ships inert, behind `rider_auth_enforced` (default off).** This
PR wires `requireRider` into the P0-1 rider-owned route group named in
the approved remediation plan. It does not enable enforcement — that is
a separate, explicit admin action, to be taken only after this PR is
merged and, per your instruction, only once the authenticated client
flow (PR 2a) is confirmed live and validated in production.

## Why this is safe to merge before enforcement is turned on

Every migrated route follows the same shape:

```js
app.get(
  "/api/some/rider/route",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.body.riderId, 100)
    });
    // ...unchanged from before this PR...
  })
);
```

`requireRiderIfEnforced` (server.js) checks the `rider_auth_enforced`
system flag on every request. While it's `false` (the default, and
current live production state — see PR 2a's verified evidence),
`req.rider` is never set, `requireRiderIfEnforced` is a pure passthrough,
and `resolveEnforcedRiderId` always falls through to
`clientSuppliedRiderId` — byte-for-byte the same behavior as before this
PR, client-supplied riderId included. Merging this PR changes nothing
about current production behavior.

## Scope — the P0-1 route group only

Per your explicit instruction ("Do not combine payment ownership, public
ride tracking, Persona, push, safety, RLS, or unrelated cleanup into
either PR"), this PR touches exactly the routes named in
`docs/p0-security-remediation-plan.md`'s P0-1 finding:

| Route | Method | Commit |
|---|---|---|
| `/api/riders/:id/readiness` | GET | 2/5 |
| `/api/rider/rides` | GET | 2/5 |
| `/api/rider/deliveries` | GET | 2/5 |
| `/api/rider/rides/:rideId` | GET | 2/5 |
| `/api/rider/saved-places` | GET | 3/5 |
| `/api/rider/saved-places` | POST | 3/5 |
| `/api/rider/saved-places/:id` | DELETE | 3/5 |
| `/api/rider/photo` | POST | 4/5 |

Payment methods (P0-2) are explicitly out of scope — that's PR 3.
Persona (P0-3), ride status/stream (P0-4), safety endpoints (P0-5), push
subscriptions (P0-6), and the `riders` RLS policy (P0-8) are PRs 4-9 per
the approved sequence.

## Commit sequence (small groups, per your instruction)

1. **Flag foundation** — `requireRiderIfEnforced`, `resolveEnforcedRiderId`
   (5 unit tests), admin enable/disable routes. Inert by itself, no route
   touched.
2. **Readiness + rider ride/delivery history** — 4 GET routes.
3. **Saved places CRUD** — 3 routes, plus a client fix (see below).
4. **Photo upload** — 1 route.
5. **This document.**

## A gap this migration would have introduced silently — now fixed

While migrating saved places, I found that `requireRider` rejects every
non-`GET` request without the existing `x-requested-with: harvey-rider-app`
CSRF header (`hasRiderClientHeader`, server.js) — but
`rider-dashboard.html`'s general-purpose `requestJson()` never sent it;
only PR 2a's own sign-in flow (`authRequest()`) did. Left unfixed, the
day `rider_auth_enforced` was turned on, every real authenticated
rider's `POST`/`DELETE` calls to saved places and photo upload would
have started failing with `403` — a self-inflicted outage of exactly the
routes this PR is meant to secure, not fix. `requestJson()` now sends
this header on every request (harmless on `GET`, which the server
doesn't check), so every existing call site is ready before the flag is
ever turned on.

## Verification classification (per your "do not overstate certainty" standard)

| Claim | Classification | Basis |
|---|---|---|
| While the flag is off, behavior is unchanged | **Confirmed** | Every migrated route's non-enforced path is the identical code that existed before this PR; `resolveEnforcedRiderId` is unit-tested to fall through to the client-supplied value whenever `authenticatedRiderId` is falsy. |
| `resolveEnforcedRiderId` always prefers the authenticated identity once one exists | **Confirmed** | 5 unit tests, including a same-request victim/attacker-id conflict case. |
| Once enabled, these 8 routes can no longer be used to read/write another rider's data via a spoofed `riderId` | **Confirmed** (mechanism) / **Unverified** (live end-to-end) | The mechanism is unit-tested and the wiring is a direct, minimal middleware application — but this codebase has no integration-test harness (no supertest/Express test client), so no automated test exercises an actual HTTP request through `requireRiderIfEnforced` end-to-end. Live verification requires the flag to actually be turned on against a real deployment with a real session cookie, which is exactly the gated next step. |
| `requestJson()`'s new header doesn't break any existing, unrelated call site | **Likely** | It's an additive header on every request; the server only inspects it for non-GET rider-session and (once enabled) rider-owned routes. No other route in this codebase reads this header, confirmed by grep. Not exhaustively re-tested against every one of `requestJson`'s many call sites across the dashboard by hand. |

## Regression tests

`lib/riderAuth.test.js` — 5 new cases under
`describe("resolveEnforcedRiderId — the IDOR fix itself")`:

1. An authenticated identity always wins over a client-supplied one, even when they differ (the literal victim/attacker scenario).
2. An authenticated identity wins even when no client-supplied value was sent at all.
3. Falls back to the client-supplied value only when there's no authenticated identity (flag off / not yet enforced).
4. No authenticated identity and no client-supplied value returns `""`, never `undefined`/`null`.
5. An empty-string authenticated id (defensive — should never happen) is treated as absent, not as a valid identity.

No additional per-route tests were added: every migrated route's only
new logic is the one-line call into `resolveEnforcedRiderId`, already
exhaustively covered above. The pre-existing ownership checks each route
already had (`ride.rider_id !== riderId`, `existing.rider_id !== riderId`)
are unchanged and were not re-tested here.

Full suite: `npx jest` — 350/350 passing (13 suites). `node -c server.js`
clean. Both `rider-dashboard.html` `<script>` blocks `node --check`ed
clean.

**What live/manual validation this still needs, before enabling the flag:**
this codebase's lack of an integration-test harness means the actual
end-to-end IDOR closure (rider A's session genuinely cannot read/write
rider B's saved places, photo, readiness, or ride history) has not been
exercised against a live server in this environment. That validation
needs the same kind of controlled procedure PR 2a went through — a
QA rider account, a real session cookie, and a second rider's data to
attempt (and fail) to access.

## Known follow-ups, not fixed in this PR

- **Signup handoff for readiness** (documented in PR 2a): `rider-signup.html`
  calls `GET /api/riders/:id/readiness` immediately post-signup, before
  any session exists. Once `rider_auth_enforced` is on, that call will
  fail. Needs a decision (auto-session-on-signup, or defer the readiness
  check) before enabling the flag for real.
- **Payment method routes are not touched here.** `POST /api/rides/payment-intent`'s
  ownership gap (P0-2) remains open until PR 3.

## Rollback plan

- **Instant, no deploy:** the flag was never turned on for this PR — there
  is nothing to roll back in production. If it were ever turned on and
  needed reverting, `POST /api/admin/system/disable-rider-auth-enforced`
  reverts every one of these 8 routes to client-supplied-riderId behavior
  atomically, in one write.
- **Full revert:** reverting this PR's commits removes `requireRiderIfEnforced`,
  `resolveEnforcedRiderId`, the flag admin routes, and all 8 route
  migrations. No data was altered by this PR — it added no migration and
  changed no stored value.

## Production verification checklist

- [ ] Deploy succeeds; CI (`node -c server.js`, `npm test`) green.
- [ ] Immediately after deploy, confirm `rider_auth_enforced` still
      resolves `false` (no behavior change from before this PR).
- [ ] Before enabling: confirm PR 2a's `rider_auth_ui_enabled` has been
      turned on and validated in production (per its own runbook) — this
      PR's routes have no working client login flow to rely on otherwise.
- [ ] Before enabling: decide on the `rider-signup.html` readiness-call
      follow-up above.
- [ ] Enable via `POST /api/admin/system/enable-rider-auth-enforced`,
      then run the same class of controlled, QA-account validation PR 2a
      used — including at least one deliberate cross-rider IDOR attempt
      that must fail — before treating this as closed.
- [ ] Disable immediately (`POST /api/admin/system/disable-rider-auth-enforced`)
      if any of the 8 routes misbehaves for a real, legitimately
      authenticated rider.
