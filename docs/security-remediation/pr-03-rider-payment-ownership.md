# P0 Remediation — PR 3: Payment Route Ownership Enforcement

Status: **ships inert, behind the same `rider_auth_enforced` flag PR 2b
introduced (default off).** This PR closes the P0-2 finding named in the
approved remediation sequence (`docs/security-remediation/pr-02b-rider-route-enforcement.md`
explicitly deferred payment methods to this PR) by wiring the identical
`requireRiderIfEnforced` + `resolveEnforcedRiderId` mechanism onto the
four payment-related routes PR 2b didn't touch. It does not enable
enforcement — that is a separate, explicit admin action, taken only
after PR 2b's own routes are confirmed live-validated and this PR's own
checklist below passes too.

## How this PR was triggered

While investigating a rider-facing "Direct Driver Request" architecture
proposal (unrelated feature work, kept fully separate — see
`docs/women-driver-preference-and-favorite-drivers-architecture.md`
§D.12), a dependency check on rider/payment ownership required reading
the actual current routes rather than trusting this session's own prior
task-tracker labels. That read found:

- `requireRiderIfEnforced`/`resolveEnforcedRiderId` (PR 2b, PR #97)
  exist only on PR #97's branch, not on `main` — PR #97 is real, open,
  and unmerged, not "completed" as this session's task tracker had it.
- Four routes — `POST /api/rider/payment-methods/setup-intent`,
  `GET /api/rider/payment-methods`, `DELETE /api/rider/payment-methods/:paymentMethodId`,
  and `POST /api/rides/payment-intent` — all read `rider_id`/`riderId`
  directly from the request body or query string, with no session
  check of any kind, independent of any flag. The delete route's own
  comment names the pattern explicitly: "Same 404-either-way ownership
  check used by `/api/rider/saved-places`" — the exact insecure pattern
  PR 2b exists to close, still live on the payment surface.
- The client-side fetch helper actually used for these calls
  (`apiFetch`/`apiPost`, `public/rider-dashboard.html`) sent neither the
  session cookie (`credentials: "include"`) nor the CSRF header
  `requireRider` checks on non-`GET` requests — despite a comment in
  `rider-signup.html` (written for a since-removed pre-session
  SetupIntent call) already claiming this was fixed "(PR 3)". It
  wasn't; this PR is what makes that comment true.

This PR is scoped to fixing exactly that — the P0-2 route group, plus
the one client-side gap that would have silently broken these routes
for real riders the moment `rider_auth_enforced` was ever turned on. It
intentionally does not touch Parts A-D of the matching-preferences
architecture doc, PR #114 (already merged, documentation only), or any
other PR in the sequence.

## Scope — the P0-2 route group only

| Route | Method |
|---|---|
| `/api/rider/payment-methods/setup-intent` | POST |
| `/api/rider/payment-methods` | GET |
| `/api/rider/payment-methods/:paymentMethodId` | DELETE |
| `/api/rides/payment-intent` | POST |

Persona (P0-3), ride status/stream (P0-4), safety endpoints (P0-5), push
subscriptions (P0-6), and secrets/session hardening (P0-9/PR 9) remain
explicitly out of scope, per the same approved sequence PR 2b followed.

## Mechanism — identical to PR 2b, reused rather than duplicated

This PR is branched from PR #97's branch (`security/pr2b-rider-route-enforcement`),
not from `main`, specifically so it reuses PR 2b's already-reviewed,
already-tested `requireRiderIfEnforced`/`resolveEnforcedRiderId` and the
existing `rider_auth_enforced` flag rather than inventing a second,
parallel flag/middleware pair for the same underlying property ("does a
request carry a real rider session, and does the route actually use it
instead of whatever the client also sent"). Every migrated route follows
the same shape PR 2b established:

```js
app.post(
  "/api/rider/payment-methods/setup-intent",
  requireRiderIfEnforced,
  rateLimit(/* unchanged */),
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.rider_id || req.body.riderId, 100)
    });
    // ...unchanged from before this PR...
  })
);
```

**Merge order note:** because this PR is based on PR #97's branch rather
than `main`, merging PR #97 first (or merging this PR as a stack on top
of it) avoids any duplicate-definition conflict. If PR #97 is closed or
substantially reworked instead of merged, this PR's base will need to be
rebased onto `main` with `requireRiderIfEnforced`/`resolveEnforcedRiderId`
re-added — the functions themselves are small and unchanged from PR
#97's version, so that rebase is mechanical, not a redesign.

While `rider_auth_enforced` is `false` (the default, and current live
production state per PR 2b's own evidence), `req.rider` is never set,
`requireRiderIfEnforced` is a pure passthrough, and `resolveEnforcedRiderId`
always falls through to `clientSuppliedRiderId` — byte-for-byte the same
behavior as before this PR, client-supplied `rider_id`/`riderId`
included. **Merging this PR changes nothing about current production
behavior.**

## `POST /api/rides/payment-intent` — one additional cleanup

This route previously re-read `req.body.rider_id` three separate times
(the Stripe-customer-attachment check, the PaymentIntent's `metadata.rider_id`,
and the `auditLog()` call) — three chances for those reads to drift out
of sync with each other. `riderId` is now resolved exactly once, at the
top of the handler, and that single value is reused in all three places.
This is a correctness cleanup riding along with the security fix, not a
second unrelated change: with three separate raw reads, a future edit to
any one of them could silently create a mismatch between what a
PaymentIntent's metadata says and what the audit log says, for the exact
same request.

## Client-side gap fixed: `apiFetch`/`apiPost` (`public/rider-dashboard.html`)

Found while confirming these routes would actually work once
`rider_auth_enforced` is eventually turned on: `apiFetch` (the helper
`loadSavedPaymentMethods()` and the PaymentIntent-creation call both use)
sent neither `credentials: "include"` nor the `X-Requested-With:
harvey-rider-app` header PR 2a's `requestJson()` fix already added
elsewhere. Left unfixed, turning on `rider_auth_enforced` would have
broken every real rider's saved-card list and payment flow immediately —
the identical self-inflicted-outage risk PR 2b caught and fixed for
`requestJson()`, just on a different fetch helper this PR is the first
to touch. Both are now added unconditionally in `apiFetch`, harmless
while the flag is off (the server only checks the header on non-`GET`
requests once enforcement is actually on).

`rider-signup.html`'s existing comment already asserted this fix existed
("PR 3") — it didn't, until this PR. No code change was needed there;
the comment is accurate now.

## `POST /api/rider/payment-methods/setup-intent` has no current live caller

Confirmed by search: no page in `public/` currently calls this route.
The only prior caller (`rider-signup.html`, pre-session card setup) was
already removed as part of PR 2c
(`docs/security-remediation/pr-02c-signup-session-handoff.md`). This
route remains reachable by any direct API caller today regardless of UI
wiring, so it's still in scope for this fix, but enabling enforcement on
it carries zero UI-breakage risk, unlike the other three routes in this
group.

## Verification classification (per this codebase's "do not overstate certainty" standard)

| Claim | Classification | Basis |
|---|---|---|
| While the flag is off, behavior on all four routes is unchanged | **Confirmed** | Every migrated route's non-enforced path is the identical code that existed before this PR; `resolveEnforcedRiderId` is unit-tested (`lib/riderAuth.test.js`) to fall through to the client-supplied value whenever `authenticatedRiderId` is falsy. |
| `resolveEnforcedRiderId` always prefers the authenticated identity, including for a spoofed rider_id aimed at another rider's Stripe customer | **Confirmed** | Existing PR 2b tests plus 3 new payment-specific tests below, covering the same victim/attacker shape named against this PR's own routes. |
| Once enabled, these 4 routes can no longer be used to list, create a SetupIntent for, delete, or attach a PaymentIntent to another rider's Stripe customer via a spoofed `rider_id`/`riderId` | **Confirmed** (mechanism) / **Unverified** (live end-to-end) | Same limitation PR 2b documented: this codebase has no integration-test harness (no supertest/Express test client), so no automated test exercises an actual HTTP request with a real session cookie through `requireRiderIfEnforced` against these routes specifically. Live verification requires the flag to actually be turned on against a real deployment, exactly the gated next step below. |
| `apiFetch`'s new `credentials`/header additions don't break any other call site | **Likely** | Both are additive; `credentials: "include"` only matters when the server actually checks a cookie (nothing does yet, flag off), and the header is only inspected by `requireRider`-protected non-`GET` routes. `apiFetch`/`apiPost` are used elsewhere in this file beyond payments (not exhaustively re-tested against every call site by hand). |

## Regression tests

`lib/riderAuth.test.js` — 3 new cases under `describe("resolveEnforcedRiderId
— applied to the P0-2 payment routes (P0 remediation, PR #3)")`, naming
the same underlying decision against this PR's own routes rather than
relying solely on PR 2b's generic coverage: an authenticated session
winning over a rider_id aimed at another rider's Stripe customer, the
still-open pre-flag fallback behavior, and the "neither present" empty-
string case every migrated route already treats as a 400.

No additional per-route tests were added, for the same reason PR 2b gave:
every migrated route's only new logic is the one-line call into
`resolveEnforcedRiderId`, already covered above. The pre-existing
ownership checks each route already had (`ownsPaymentMethod(...)`) are
unchanged and were not re-tested here.

Full suite: `npx jest` — 13 suites, 353 tests, all passing (350 from PR
2b's branch + 3 new here). `node -c server.js` clean. Both
`rider-dashboard.html` `<script>` blocks `node --check`ed clean.

**What live/manual validation this still needs, before enabling the flag:**
the same class of controlled procedure PR 2a and PR 2b both required — a
QA rider account, a real session cookie, and a second rider's payment
data (saved cards, a Stripe customer ID) to attempt and fail to access.
Specifically:

- [ ] With a QA rider A signed in (real session cookie), attempt `GET
      /api/rider/payment-methods?riderId=<rider-B-id>` for a real rider
      B with saved cards — must return rider A's own cards (or none),
      never rider B's.
- [ ] With rider A signed in, attempt `DELETE
      /api/rider/payment-methods/:id?riderId=<rider-B-id>` against one
      of rider B's real saved payment method IDs — must fail (404, per
      the existing `ownsPaymentMethod` check now operating against
      rider A's own Stripe customer), never delete rider B's card.
- [ ] With rider A signed in, attempt `POST /api/rides/payment-intent`
      with `rider_id` set to rider B's id and a `payment_method_id`
      belonging to rider B — must not attach rider B's payment method
      to the resulting PaymentIntent.
- [ ] With rider A signed in, confirm `POST
      /api/rider/payment-methods/setup-intent` and a normal, real
      rider's own saved-card flow (list, add via Stripe Elements, list
      again showing the new card, delete) all still work end-to-end
      through `apiFetch`'s new credentialed requests.
- [ ] Confirm a request with **no** session cookie at all (e.g., an
      expired/cleared session) to any of the four routes is rejected by
      `requireRider` once enforcement is on, rather than silently
      falling back to a client-supplied `rider_id`.

## Known follow-ups, not fixed in this PR

- **PR #97 (PR 2b) itself remains open and unmerged.** This PR depends
  on it for `requireRiderIfEnforced`/`resolveEnforcedRiderId` — see
  "Merge order note" above.
- **Persona, safety, push, and secrets/session hardening (PR 5, 7, 6, 9)
  remain untouched and pending**, per the approved sequence.
- **Direct Driver Requests, Favorite Drivers, and Prefer-a-Woman-Driver**
  (`docs/women-driver-preference-and-favorite-drivers-architecture.md`)
  remain documentation-only and explicitly blocked from any
  implementation until this PR and PR 2b are both merged, live-validated,
  and their flags are deliberately enabled — not before. This PR is the
  P0 foundation those features' own §D.12 gate depends on; it is not
  itself a step toward building them.

## Rollback plan

- **Instant, no deploy:** the flag was never turned on for this PR —
  there is nothing to roll back in production. If it were ever turned on
  and needed reverting, `POST /api/admin/system/disable-rider-auth-enforced`
  (added by PR 2b, reused here) reverts every route migrated by either
  PR to client-supplied-riderId behavior atomically, in one write.
- **Full revert:** reverting this PR's commits removes the 4 route
  migrations, the `apiFetch` credential/header fix, and this document.
  No data was altered by this PR — it added no migration and changed no
  stored value.

## Production verification checklist

- [ ] Deploy succeeds; CI (`node -c server.js`, `npm test`) green.
- [ ] Immediately after deploy, confirm `rider_auth_enforced` still
      resolves `false` (no behavior change from before this PR).
- [ ] Before enabling: confirm PR 2b's own routes have been
      live-validated per its runbook, and PR 2a's `rider_auth_ui_enabled`
      is confirmed live.
- [ ] Enable via `POST /api/admin/system/enable-rider-auth-enforced`
      (shared with PR 2b — enabling it turns on enforcement for both PRs'
      routes at once), then run the "live/manual validation" checklist
      above, including every deliberate cross-rider attempt, which must
      fail.
- [ ] Disable immediately (`POST /api/admin/system/disable-rider-auth-enforced`)
      if any of these 4 routes misbehaves for a real, legitimately
      authenticated rider.
