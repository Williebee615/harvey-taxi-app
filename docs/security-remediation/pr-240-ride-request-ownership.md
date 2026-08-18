# P0 Remediation — Ride-Creation Ownership (`POST /api/rides/request`)

Status: **ships inert, behind the existing `rider_auth_enforced` flag**
(#97/#115, default off). Wires the same `requireRiderIfEnforced` +
`resolveEnforcedRiderId` mechanism onto `POST /api/rides/request` that
the rest of this remediation series already uses — no new flag, no new
middleware.

## Where this came from

Filed as task #240 while independently reviewing the now-closed PR #101
(superseded by #115) before closing it. PR #101's own doc explicitly
scoped this route out as "PR 4: ride ownership," separate from payment
ownership — and #115 preserved that same scope boundary. Confirmed on
`main` before starting: `/api/rides/request` still read `rider_id`
straight from `req.body` with zero session wiring, identical in shape
to the payment-route gap #115 closed.

## Why this matters even though #97 and #115 are already merged

`ride.rider_id` — set here, at ride creation — is the value
`verifyPaymentIntentForRide()` (`lib/riderPayments.js`) compares a
PaymentIntent's `metadata.rider_id` against when a ride authorizes.
#115 made the PaymentIntent side of that comparison trustworthy
(`metadata.rider_id` is now the resolved, session-derived identity, not
a raw client-supplied one). Until this PR, the *ride* side of the same
comparison was still whatever a client claimed at `/api/rides/request`
time — so the check was comparing a trustworthy value against an
untrustworthy one. This closes the second half.

## What changed

Exactly the established shape, applied to one route:

```js
app.post(
  "/api/rides/request",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    // ...
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.rider_id, 100)
    });
    // ...unchanged from before this PR: riderId is reused for the
    // readiness check (if present) and ride.rider_id at insert time.
  })
);
```

While `rider_auth_enforced` is `false` (the default, current production
state), `req.rider` is never set and `resolveEnforcedRiderId` falls
through to the client-supplied value — byte-for-byte the same behavior
as before this PR.

**Client-side:** no change needed. `rider-dashboard.html`'s ride-request
call already goes through `apiPost`/`apiFetch`, which #115 already fixed
to send both `credentials: "include"` and the `X-Requested-With`
CSRF header. Confirmed by reading the call site
(`CONFIG.ENDPOINTS.requestRide` via `apiPost`) before relying on it.

## What this deliberately does not touch

- **`rider_name`/`rider_phone`** (`req.body`, written onto the ride
  record) are unchanged — this PR fixes the *identity* field
  (`rider_id`), matching the same narrow scope discipline #97 and #115
  used (fix the field that determines ownership/authorization; leave
  descriptive fields written alongside it for their own review if ever
  needed). Not a currently-known authorization gap, since nothing
  authorizes against these two fields.
- **`verifyAndConsumeRideQuote()`'s own internal quote-consistency
  check** (`server.js`, reads `req.body.rider_id || req.body.riderId`
  directly to confirm a submission still matches the quote token
  `/api/rides/estimate` issued) is unchanged, for the same reason #115
  left it unchanged when fixing `/api/rides/payment-intent`: that's a
  "does this request match the quote it claims to be redeeming" check,
  a different question from "who owns this ride," and quote-matching
  behavior is out of scope for an ownership fix.
- **`/api/rides/estimate`** itself (where the quote token's own
  `rider_id` field originates) is untouched — flagged as a further
  open item below, not fixed here.

## Verification classification

| Claim | Classification | Basis |
|---|---|---|
| While the flag is off, behavior is unchanged | **Confirmed** | Identical reasoning to every prior PR in this series — `resolveEnforcedRiderId` unit-tested to fall through to the client-supplied value whenever `authenticatedRiderId` is falsy; the route's non-enforced path is the pre-existing code. |
| An authenticated session always wins over a spoofed `rider_id` | **Confirmed** | 3 new tests in `lib/riderAuth.test.js`, named against this specific route. |
| Once enabled, a ride can no longer be created with a `rider_id` claiming to belong to a rider other than the one actually authenticated | **Confirmed (mechanism), Unverified (live end-to-end)** | Same structural limitation as every PR in this series — no integration-test harness exists to exercise an actual HTTP request through `requireRiderIfEnforced` against this route. Requires live validation with a real session cookie. |
| `apiFetch`'s existing credential/CSRF-header behavior covers this route's client call site | **Confirmed** | Read the call site directly (`apiPost(CONFIG.ENDPOINTS.requestRide, ...)`) — same helper #115 already fixed, no separate client change needed here. |

## Tests

`lib/riderAuth.test.js` — 3 new tests under `describe("resolveEnforcedRiderId
— applied to POST /api/rides/request (ride-creation ownership)")`,
mirroring the existing payment-route describe block: authenticated
session wins over a spoofed `rider_id`, pre-enforcement passthrough
unchanged, and the no-identity-at-all case (the route creates the ride
with `rider_id: null` rather than inventing one — unchanged from before
this PR).

No new tests for `verifyPaymentIntentForRide`/`ownsPaymentMethod` — this
PR doesn't touch either; their existing coverage (including the
composition-level tests salvaged from #101 in `lib/riderPayments.test.js`)
already covers the payment side of this chain.

Full suite: `npx jest` — 17 suites, 479 tests passing (476 existing + 3
new). `node -c server.js` clean.

## Effect on the consolidated live-validation runbook

This adds a 13th route-method combination to the set
`rider_auth_enforced` controls
(`docs/security-remediation/pr-02b-plus-pr-03-live-validation-runbook.md`).
That document is being updated in the same PR sequence to add
`POST /api/rides/request` to its route table, recalculate the route
count, and add the four ride-creation-ownership scenarios named in
review: Rider A submitting Rider B's `rider_id`, confirming the created
ride belongs to Rider A, confirming unauthenticated creation fails once
enforcement is on, and confirming Rider A's own legitimate ride
request + payment authorization still succeeds end-to-end.
`rider_auth_enforced` stays `false` until that updated runbook is
actually executed — this PR does not change that.

## Open item, not fixed here

`/api/rides/estimate` (where the quote token's own `rider_id` field is
first set, before `/api/rides/request` or `/api/rides/payment-intent`
ever see it) still needs its own review to confirm whether it has the
same class of gap. Not investigated as part of this PR — flagged so it
isn't lost, consistent with this series' practice of naming adjacent
gaps rather than silently leaving them for a future session to
rediscover from scratch.

## Rollback plan

- **Instant, no deploy:** the flag was never turned on for this PR —
  nothing to roll back in production. If it were ever turned on and
  needed reverting, the existing
  `POST /api/admin/system/disable-rider-auth-enforced` reverts every
  route migrated by #97, #115, and this PR to client-supplied-riderId
  behavior atomically, in one write.
- **Full revert:** reverting this PR's commit removes the middleware
  wiring on this one route and the 3 new tests. No data was altered —
  no migration, no stored value changed.
