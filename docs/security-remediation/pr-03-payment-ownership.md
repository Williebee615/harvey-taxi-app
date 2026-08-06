# P0 Remediation — PR 3: Payment Method & Stripe Ownership

Status: **ships inert, behind the same `rider_auth_enforced` flag as PR
2b (default off).** This PR is stacked on the still-open PR 2b branch
(`security/pr2b-rider-route-enforcement`, GitHub PR #97) specifically to
reuse its `requireRiderIfEnforced`/`resolveEnforcedRiderId` mechanism
rather than duplicating it — per your instruction to reuse the existing
middleware and shared ownership helpers, this PR introduces no new
middleware, no new flag, and no new identity-resolution logic. **This PR
should not be merged before PR 2b merges** (or the two merged together);
it depends on PR 2b's commits being present.

## Scope — payment ownership and Stripe authorization only

Per your explicit instruction, this PR is narrowly scoped. **Explicitly
excluded, each a separate follow-on PR:** ride status ownership, ride
tracking ownership, refund logic, completed-ride integrity, referral or
subscription work, UI redesigns. Sequencing, per your instruction:

- **PR 3 (this PR):** payment method & Stripe ownership.
- **PR 4 (next):** ride ownership (ride details, status, tracking, streams).
- **PR 5 (after):** refund and completed-ride integrity.

## Routes migrated (4)

| Route | Method | Gap before this PR |
|---|---|---|
| `/api/rider/payment-methods/setup-intent` | POST | `rider_id` taken from `req.body`, unauthenticated — anyone could open a SetupIntent (and thus attach a payment method) against **any** rider's Stripe Customer by supplying their ID. |
| `/api/rider/payment-methods` | GET | `riderId` taken from `req.query`, unauthenticated — anyone who knew/guessed a rider ID could list that rider's saved cards (masked, but still a real information-disclosure IDOR). |
| `/api/rider/payment-methods/:paymentMethodId` | DELETE | `riderId` taken from `req.query`, unauthenticated. `ownsPaymentMethod()` already prevented deleting a payment method that didn't belong to the *claimed* rider — but the claimed rider itself was never verified. |
| `/api/rides/payment-intent` | POST | `rider_id` taken from `req.body`, unauthenticated, used to (a) resolve which Stripe Customer/saved card to attach and (b) write `metadata.rider_id` onto the created PaymentIntent — the exact value `verifyPaymentIntentForRide()` (`lib/riderPayments.js`, already existing, already well-tested) later trusts as "the payment's rider" when a ride authorizes against this intent. |

Every route follows PR 2b's exact shape:

```js
app.get(
  "/api/rider/payment-methods",
  requireRiderIfEnforced,
  rateLimit(...),
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });
    // ...unchanged from before this PR...
  })
);
```

While `rider_auth_enforced` is `false` (current production state),
`req.rider` is never set and `resolveEnforcedRiderId` always falls
through to the client-supplied value — byte-for-byte the same behavior
as before this PR. Confirmed via full test suite pass (357/357) and
direct code-path tracing, same standard as every PR in this series.

## What this PR does NOT change, and why that's correct

**`/api/rides/:id/authorize` is untouched.** Its existing
`verifyPaymentIntentForRide()`/`authorizePaymentIntentForRide()` checks
(currency, amount, ride-binding, and — critically — that
`intent.metadata.rider_id` matches `ride.rider_id`) already do real,
correct, Stripe-verified "does this PaymentIntent belong to this rider
and this ride" checking, built and exhaustively tested in earlier work
(PR #70/#72, `lib/riderPayments.test.js`'s existing 20+ tests for
`verifyPaymentIntentForRide`). That logic was already sound *given
trustworthy inputs*. What was **not** sound was one of those inputs:
`intent.metadata.rider_id` was written at PaymentIntent creation time
from an unauthenticated, client-supplied `req.body.rider_id`. This PR
fixes exactly that input. `/authorize` needed no changes because its
verification logic was never the defect — the untrusted data feeding
into it was.

This also means the "correct ride" half of "verify every PaymentIntent
belongs to both the authenticated rider and the correct ride" is only
*partially* closed by this PR. The **rider** half is now trustworthy
(this PR). The **ride** half (`ride.rider_id`, set by
`/api/rides/request`, which still takes a client-supplied `rider_id`
today) is not — that's explicitly PR 4's scope ("ride ownership"), not
this one. Stated plainly so this isn't overclaimed: until PR 4 lands,
`verifyPaymentIntentForRide`'s rider-match check is comparing a
now-trustworthy value (the intent's rider) against a still-not-fully-
trustworthy one (the ride's rider) on the other side.

**`/api/rides/request` (ride creation) is untouched** for the same
reason — it's ride ownership, not payment ownership.

## No client-supplied rider ID, customer ID, or payment method ID is trusted

- **Rider ID:** fixed by this PR (above) — resolved via
  `resolveEnforcedRiderId`, never a raw `req.body`/`req.query` read,
  once the flag is on.
- **Stripe Customer ID:** was **already** never accepted directly from
  the client anywhere in this codebase — confirmed by re-reading every
  payment route; `stripeCustomerId` is always derived server-side via
  `getOrCreateStripeCustomer(rider)` or a direct `rider.stripe_customer_id`
  column read, keyed off the (now-fixed) resolved rider, never a
  `req.body.customer_id`-style field. No code change needed here; stated
  as a verified finding, not assumed.
- **Payment method ID:** accepted from the client (it has to be —
  that's how a rider picks *which* saved card to use), but never trusted
  at face value. `ownsPaymentMethod()` (existing, already tested) checks
  it against the resolved rider's own Stripe Customer before it's used
  for anything. This check was already correct; what this PR fixes is
  that the customer id it's checked against is now derived from a
  trustworthy rider id.

## A second, related gap found and fixed: the CSRF header on `apiFetch`/`apiPost`

PR 2b fixed `rider-dashboard.html`'s `requestJson()` helper to always
send the `x-requested-with: harvey-rider-app` header `requireRider`
requires on every non-GET request. While migrating the payment routes,
found that **a separate, parallel fetch helper in the same file —
`apiFetch`/`apiPost`, used by `loadSavedPaymentMethods()` and the
payment-intent creation call, among others — was never fixed the same
way.** Left unfixed, the day `rider_auth_enforced` was turned on, every
real rider's payment-intent creation (`apiPost`) would have started
failing with `403` — a self-inflicted outage of the exact route this PR
is meant to secure, discovered the same way PR 2b found its own
CSRF-header gap: by tracing what a real client call would actually send
once enforcement is live, not just what the server-side check expects.

Fixed by adding the same header to `apiFetch`'s base headers (one
addition, same pattern as `requestJson()`'s existing fix). This
incidentally also protects every other route already using
`apiFetch`/`apiPost` in this file (the readiness fallback call, push
subscription, ride route-failure logging, and others) from the same
class of self-inflicted outage — a beneficial side effect, noted
honestly rather than either hidden or treated as unrelated scope creep,
since it's the same one-line fix applied to the same shared helper PR 2b
already established the precedent for fixing proactively.

## A related gap found and documented, NOT fixed here — needs a product decision, same class as PR 2a's existing signup-handoff gap

`rider-signup.html` calls `POST /api/rider/payment-methods/setup-intent`
during signup (`savePaymentMethod()`, saving a card immediately after
account creation, before the rider has ever logged in) via a **third,
separate** fetch helper (`api()`, not `apiFetch`/`requestJson`) that
sets `credentials: "omit"` — meaning it never sends a session cookie at
all, by design, and never sends the CSRF header either.

This is not a bug this PR introduces or should fix — it's a
**structural consequence of this app's signup flow having no session at
the point a card is saved**, the exact same class of gap PR 2a's own
documentation already flagged for the post-signup readiness call
(`docs/security-remediation/pr-02a-rider-client-auth.md`/`pr-02b-...md`'s
"Known follow-ups": *"rider-signup.html calls readiness immediately
post-signup, before any session exists... Needs a decision (auto-
session-on-signup, or defer the readiness check) before enabling the
flag for real."* The identical decision now also governs this route: once
`rider_auth_enforced` is on, a brand-new rider trying to save a card
during signup will get rejected (no session to authenticate with) unless
that decision is made and implemented first.

**Not fixed here, per your explicit scope instruction against UI
redesigns and against solving problems outside "payment ownership and
Stripe authorization" narrowly defined** — the actual fix is a session-
bootstrapping / signup-flow decision, not a payment-ownership one.
Flagged as a **hard prerequisite to enabling `rider_auth_enforced` for
real**, on top of the already-known readiness-call gap, not a new
independent blocker — both stem from the same root cause and should
likely be resolved together, in whichever PR/decision addresses the
signup-handoff question.

## Verification classification (per your "do not overstate certainty" standard)

| Claim | Classification | Basis |
|---|---|---|
| While the flag is off, behavior is unchanged | **Confirmed** | Identical to PR 2b's own reasoning — `resolveEnforcedRiderId` unit-tested to fall through to the client-supplied value whenever `authenticatedRiderId` is falsy; every migrated route's non-enforced path is the pre-existing code. |
| `resolveEnforcedRiderId` always prefers the authenticated identity once one exists | **Confirmed** | Inherited from PR 2b's own 5-test suite, unchanged by this PR — not re-tested here to avoid duplicating coverage, per your reuse instruction. |
| `ownsPaymentMethod`/`verifyPaymentIntentForRide` correctly reject cross-account/replay/forged-metadata attempts | **Confirmed** | Pre-existing, exhaustive test coverage (20+ cases, `lib/riderPayments.test.js`, from PR #70/#72) — unchanged, re-verified passing, not re-litigated. |
| The specific composition this PR wires (resolved identity → customer lookup → ownership check) closes the named attack chains | **Confirmed at the logic level, Unverified end-to-end** | 7 new composition tests (below) prove the pieces compose correctly. No integration-test harness exists in this codebase (no supertest/Express test client) to prove an actual HTTP request through the real routes behaves this way — same structural limitation as every PR in this series. |
| The `apiFetch` CSRF-header fix doesn't break any existing call site | **Likely** | Additive header, same pattern already proven safe by PR 2b's identical fix to `requestJson()`. Not exhaustively re-tested against every one of `apiFetch`/`apiPost`'s call sites by hand. |
| Once enabled, these 4 routes can no longer be used to view/attach/detach another rider's payment methods, or create a PaymentIntent misattributed to another rider | **Confirmed (mechanism), Unverified (live end-to-end)** | Same honest limitation as above — requires live validation with a real session cookie against a real deployment, the same gated next step every prior PR in this series has needed. |

## Regression tests

`lib/riderPayments.test.js` — added `describe("PR 3 — payment-route
IDOR/cross-account composition")`, 7 new tests:

1. IDOR attempt — attacker claims the victim's riderId; once enforced,
   the authenticated identity wins and the victim's card is unreachable
   through the resolved-customer-lookup composition.
2. Pre-enforcement (flag off) — behaves exactly as before, client-
   supplied riderId trusted, matching the documented pre-existing gap.
3. Cross-account replay — a payment method genuinely owned by the
   victim is confirmed to resolve `true` for the victim's own customer
   id and `false` for the attacker's.
4. PaymentIntent creation — the same resolved identity feeds both the
   attachment lookup and the intent's `metadata.rider_id`, closing the
   "two independent reads of the same untrusted field" defect directly.
5. Downstream defense-in-depth — a forged-metadata intent is still
   rejected by the pre-existing `verifyPaymentIntentForRide` check
   independent of this PR's fix, confirming the two layers are genuinely
   independent, not one covering for a gap in the other.
6. Negative — no identity at all resolves to `""`, never
   `undefined`/`null` (existing `if (!riderId)` guards keep working).
7. Negative — `ownsPaymentMethod` never throws and never defaults to
   `true` on missing/malformed input.

No pure logic in `resolveEnforcedRiderId`, `ownsPaymentMethod`, or
`verifyPaymentIntentForRide` themselves was re-tested — all three
already have exhaustive, passing coverage from PR 2b and PR #70/#72
respectively. Duplicating that coverage here would contradict your
"reuse rather than duplicate" instruction; what's new is proving the
*composition*, which is what the 7 tests above do.

Full suite: `npx jest` — **357/357 passing** (13 suites, up from 350 —
7 new). `node -c server.js` clean. Both `rider-dashboard.html`
`<script>` blocks `node --check`ed clean.

## Rollback plan

- **Instant, no deploy:** the flag was never turned on for this PR —
  nothing to roll back in production. If it were ever turned on and
  needed reverting, the same `POST /api/admin/system/disable-rider-auth-enforced`
  PR 2b introduced reverts every one of PR 2b's *and* this PR's routes
  to client-supplied-riderId behavior atomically, in one write — no
  separate flag or admin route needed for this PR specifically.
- **Full revert:** reverting this PR's commits removes the 4 route
  migrations and the `apiFetch` header fix. No data was altered — no
  migration, no stored value changed. Reverting the `apiFetch` fix
  specifically would reopen the CSRF self-inflicted-outage risk for
  every route using that helper, not just payment ones — worth noting
  if a partial revert is ever considered.

## Production verification checklist

- [ ] Deploy succeeds; CI (`node -c server.js`, `npm test`) green.
- [ ] Immediately after deploy, confirm `rider_auth_enforced` still
      resolves `false` (no behavior change from before this PR).
- [ ] Before enabling: PR 2b's own checklist items (PR 2a validated,
      the rider-signup.html readiness-call decision made) — plus, new
      for this PR, **the same signup-handoff decision must also cover
      the setup-intent call**, per the gap documented above.
- [ ] Enable via the existing `POST /api/admin/system/enable-rider-auth-enforced`,
      then run the same class of controlled, QA-account validation prior
      PRs used — including at least one deliberate cross-rider payment-
      method IDOR attempt (view, attach, detach) that must fail, and one
      deliberate PaymentIntent-rider-mismatch attempt that must fail —
      before treating this as closed.
- [ ] Disable immediately if any of the 4 routes misbehaves for a real,
      legitimately authenticated rider.
