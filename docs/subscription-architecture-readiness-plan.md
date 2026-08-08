# Subscription Architecture & Readiness Plan

**Status: PLANNING ONLY — NOT APPROVED, NOT IMPLEMENTED.** No code, schema,
migration, or route changes have been made for this. No feature flag for
any part of this exists. This document is the design deliverable
requested before any implementation begins.

**Hard gate, stated up front and repeated at the end of this document:**
implementation of anything in this plan **must not start** until:
- `rider_auth_enforced` is turned on and live-validated (the PR #95/PR 2b
  gate currently open, tracked as task #214);
- rider and organization ownership controls (§9.1, §9.2) are in place;
- payment-method and Stripe-customer ownership enforcement (PR 3) is
  complete;
- Stripe webhook signature verification and idempotency (§2.4, §9.4) are
  implemented as designed;
- the relevant P0 authorization fixes this gate depends on are closed.

Subscriptions add a second, higher-value payment-and-identity surface on
top of the rider-auth system this program is still in the middle of
hardening — building it before that foundation is solid would mean
repeating the exact class of IDOR mistake this whole remediation program
exists to fix, on a surface with recurring billing attached. See §9 for
the full security review.

**Explicitly not a blocker for this gate:** PR 4's residual
`spatial_ref_sys` write-grant issue (task #213). That finding is about an
extension-owned PostGIS system table's write privileges — it has no
relationship to rider identity, subscription ownership, Stripe billing,
or entitlement logic, and gating subscription work on it would conflate
a real but unrelated infrastructure-hardening item with the rider-auth
foundation subscriptions actually depend on. It stays open, tracked, and
required for broader production-hardening/SOC 2 readiness (§9.6 still
applies the same RLS discipline to every *new* table this plan
introduces) — it just doesn't independently block subscription
development once the items above are actually secure.

---

## 0. What this document does not do

- **No implementation.** No migration files, no route code, no client
  code, no Stripe product/price objects created (test or live).
- **No feature flags created or enabled.** When implementation eventually
  begins, it follows this codebase's existing `system_flags` pattern
  (ships inert behind a default-`false` flag, same as every PR in the
  rider-auth series) — but that's a future PR's work, not this one.
- **No existing payment routes modified.** `/api/rides/payment-intent`,
  `/api/rider/payment-methods*`, `/api/stripe/webhook`'s existing
  `payment_intent.*` handling, and everything else in the current
  one-time-payment path are untouched by this plan. Where subscriptions
  need to extend shared infrastructure (the webhook endpoint, the Stripe
  customer record), that's called out explicitly as additive, not a
  modification of current behavior.
- **No launch timeline.** This is architecture and readiness, not a
  sprint plan.

---

## 1. Subscription tiers

Four tiers, per your list, each mapped to a distinct real-world buyer and
billing shape — these are not just price points on the same product, they
have different subscriber types (individual vs. organization) and that
distinction drives the data model in §4.

### 1.1 Rider Plus — individual, self-service

- **Subscriber:** a single rider (`riders.id`), self-purchased.
- **Billing:** monthly or annual (annual at a discount), card via Stripe.
- **Candidate entitlements** (final list is a product decision, not a
  security one — flagged as configurable, see §5): waived per-ride
  booking fee, a dispatch **scoring preference** (see §1.5's guardrail —
  not "priority dispatch" in the sense of overriding anything), free
  cancellation window extension, faster support-channel routing, one
  free HTAF donation match per month (ties into the existing HTAF
  donation-prompt backlog item, task #172).
- **Analogy in existing code:** closest existing precedent is the
  `rider_history_enabled`/`rider_auth_ui_enabled` style of per-rider
  gated behavior, except entitlement now depends on paid state, not a
  global flag — see §5.

### 1.2 Business — organization, multi-seat

- **Subscriber:** an organization (new concept, §4.2), not a single
  rider. One billing owner, N employee riders as "seats."
  - **Billing:** per-seat monthly, invoiced or card, at the organization
  level via a single Stripe Customer for the org.
- **Candidate entitlements:** centralized billing/expense reporting,
  admin-configurable ride policies (e.g., spending caps, allowed ride
  types, business-hours-only), consolidated receipts, seat management UI.
- **New ownership dimension:** a rider can be a member of an org without
  being the org's billing owner — this is a new authorization axis this
  codebase doesn't have yet (today, ownership is 1:1 rider-to-resource
  everywhere). Treated as its own IDOR-risk surface in §9.2.

### 1.3 Healthcare — organization or individual, compliance-aware

- **Subscriber:** either an individual rider (recurring personal medical
  transport) or a healthcare organization (a clinic/case-management org
  booking non-emergency medical transport, "NEMT," for its patients —
  structurally identical to Business's org model, different entitlement
  set and compliance posture).
- **Compliance tie-in:** this app already has a HIPAA/BAA privacy
  placeholder (task #5 in this project's history, "Draft HIPAA/BAA
  privacy placeholder with legal-review TODO") — any Healthcare-tier
  subscriber whose ride data constitutes PHI under a signed BAA needs
  that legal review completed and a real BAA in place **before** this
  tier accepts its first real healthcare-organization customer, not just
  before this tier's code ships. Flagged as a non-engineering blocker,
  separate from and in addition to the P0 security gate above.
- **Naming/marketing guardrail — see §1.5, not optional:** this tier is
  "compliance-aware," never marketed or documented as "HIPAA compliant"
  until the legal review, a real signed BAA, data minimization, access
  controls, retention rules, and operational safeguards referenced above
  are actually in place. "Compliance-aware" describes intent and
  architecture; "HIPAA compliant" is a legal/operational claim this plan
  has no basis to make yet.
- **Candidate entitlements:** recurring/scheduled appointment rides,
  patient-roster management (org-side), caregiver-notification hooks,
  audit-friendly ride logs for compliance reporting.

### 1.4 HTAF Partner — organization, sponsor-funded

- **Subscriber:** an HTAF-partner organization (nonprofits, county
  agencies, or corporate sponsors funding rides for HTAF-eligible
  riders) — not paying for their *own* rides, paying for a pool of
  *other* riders' rides/subscriptions. This is the corporate-sponsored
  subscription model from your last paragraph, applied specifically to
  the existing HTAF program (`htaf_applications` table, already live).
- **Candidate entitlements:** a funded seat pool (§7.4) that HTAF-eligible
  riders (referencing existing `htaf_applications.status = 'approved'`
  gating, not a new eligibility system) can be assigned into, sponsor-side
  usage reporting, no card-on-file requirement for the *rider* (the
  sponsor's card/invoice covers it).
- **Relationship to existing HTAF code:** this tier sits **alongside**,
  not instead of, the existing one-off HTAF application/ride-request
  flow — it's an additional funding mechanism (ongoing sponsored
  subscription vs. one-time approved ride), not a replacement.

### 1.5 Marketing and entitlement-language guardrails — apply to every tier above

Two constraints on how any tier's benefits are named, documented, or
marketed, added per explicit review feedback on this plan:

- **Never "HIPAA compliant."** The Healthcare tier (§1.3) is
  "compliance-aware" — everywhere in product copy, sales material, this
  document, and any future implementation doc — until legal review, a
  real signed BAA, data minimization, access controls, retention rules,
  and operational safeguards are all actually complete and verified.
  "HIPAA compliant" is a specific legal/operational claim about a
  completed state, not an architecture intent, and this plan does not
  put this app in a position to make that claim.
- **No subscription tier may promise guaranteed priority over emergency,
  safety, accessibility, or HTAF eligibility rules.** Any
  dispatch-related entitlement (the Rider Plus candidate entitlement in
  §1.1, and anything similar in Business/Healthcare) means, at most, an
  approved scoring preference applied only when operationally and
  legally appropriate — never a guarantee that a paying rider's request
  is served ahead of an emergency, a safety-flagged situation, an
  accessibility-required dispatch, or an HTAF-eligibility-driven
  assignment. "Priority dispatch" as a marketing phrase is avoided in
  favor of language like "dispatch scoring preference" precisely to
  avoid implying a guarantee this system must never actually provide.
  Whatever the entitlement resolver (§5.1) eventually implements here
  needs to structurally enforce this — the scoring preference must be
  one input the existing dispatch/matching logic weighs, never a bypass
  of emergency/safety/accessibility/HTAF-eligibility logic, and that
  constraint belongs in that feature's own design review when it's
  actually built, not assumed to fall out of this plan automatically.

---

## 2. Stripe Billing integration — subscriptions, not one-time payments

### 2.1 Why Stripe Billing (Subscriptions + Prices + Products), not repeated PaymentIntents

The existing payment code (`server.js`, `/api/rides/payment-intent`) uses
one-shot `PaymentIntent`s per ride — correct for that use case, wrong for
recurring billing (no automatic retry/dunning, no proration, no invoice
generation, no trial support). Stripe Billing is the standard, correct
tool for exactly this: `Product` → `Price` (recurring) → `Subscription`,
with Stripe handling renewal, retries, and invoicing.

### 2.2 Object model

- **Product** (Stripe): one per tier (`Rider Plus`, `Business`,
  `Healthcare`, `HTAF Partner`) — created once via Stripe Dashboard or
  API, referenced by ID, not recreated per subscription.
- **Price** (Stripe): one or more per Product — e.g., Rider Plus monthly
  vs. annual, Business per-seat monthly. Prices are the billable unit
  Stripe's Subscription API actually references.
- **Customer** (Stripe): **reuse the existing `riders.stripe_customer_id`
  customer for individual tiers** (Rider Plus, individual Healthcare) —
  do not create a second Stripe Customer per rider. For org tiers
  (Business, Healthcare-org, HTAF Partner), create one Stripe Customer
  per **organization**, referenced from the new `organizations` table
  (§4.2), separate from any individual rider's customer object.
- **Subscription** (Stripe): the actual recurring billing object,
  `customer` + `items: [{price}]`, optionally `trial_period_days`,
  optionally a `discounts`/promotion code (§8.1).
- **Invoice** (Stripe): generated automatically by Stripe per billing
  cycle; not something this app generates itself.

### 2.3 Checkout surface: Stripe Checkout (hosted) vs. Elements (embedded)

**Recommendation: Stripe Checkout (hosted) for v1**, not a custom
Elements form, for these reasons specific to this app:

- The existing payment-methods flow already uses Stripe Elements for
  one-time ride payment (`request-ride.html`, SetupIntent-based card
  entry) — subscriptions could reuse that same embedded pattern later,
  but Checkout ships faster, has Stripe-hosted PCI scope, and natively
  supports promotion codes, trials, and tax collection without this app
  building any of that UI itself. Migrate to embedded Elements post-v1
  if product wants a fully in-app checkout experience.
- Checkout Session `mode: "subscription"`, with `client_reference_id` set
  to the authenticated rider's or organization's ID (server-generated,
  never client-supplied — see §9.1) so the webhook handler can attribute
  the resulting subscription without trusting anything the client sent
  back.

### 2.4 Webhook integration — extend the existing endpoint, don't create a new one

Extend the existing `POST /api/stripe/webhook` handler (`server.js:18890`,
already verifies `stripe-signature` via `STRIPE_WEBHOOK_SECRET` and
`stripe.webhooks.constructEvent`) with new `event.type` branches, rather
than standing up a second webhook endpoint:

| Stripe event | Local effect |
|---|---|
| `checkout.session.completed` (mode=subscription) | Create local `subscriptions` row from `client_reference_id` + the new `subscription` ID on the session. |
| `customer.subscription.created` | Confirm/upsert local row (idempotent on `stripe_subscription_id`). |
| `customer.subscription.updated` | Sync `status`, `current_period_end`, `cancel_at_period_end` — drives entitlement cache invalidation (§5.3). |
| `customer.subscription.deleted` | Mark local row `canceled`, revoke entitlements immediately. |
| `invoice.paid` | Confirm renewal, extend `current_period_end`, clear any grace-period flag (§6.4). |
| `invoice.payment_failed` | Start/continue grace-period tracking (§6.4), do **not** immediately revoke — Stripe Smart Retries handles retry timing. |
| `customer.subscription.trial_will_end` | Trigger pre-trial-end notification (email/push, reusing existing SendGrid/push infra). |

**Idempotency:** every handled event's `event.id` gets recorded (new
`stripe_webhook_events` table or extend an existing dedup mechanism if
one exists) before side effects run, so Stripe's at-least-once delivery
can't double-apply a renewal or double-revoke a cancellation.

---

## 3. Promo codes, free trials, gift subscriptions, corporate sponsorship — designed in now

Per your explicit ask, these are designed as first-class parts of the
data model below, not bolted on later.

### 3.1 Promo codes — Stripe Promotion Codes as source of truth

Use Stripe's native `Coupon`/`PromotionCode` objects (percent-off,
amount-off, or free-trial-extension coupons), applied at Checkout Session
creation (`discounts: [{promotion_code}]`) or entered by the rider on the
Checkout page directly (Stripe supports this natively). **Do not build a
parallel local discount-calculation system** — that's a well-known way to
drift from what Stripe actually billed. Local `promo_codes` table (§4.5)
exists only to:
- Map internally-meaningful codes (e.g., an HTAF-partner-specific code,
  a marketing campaign code) to the underlying Stripe `promotion_code` ID.
- Track locally-relevant metadata Stripe doesn't need: which campaign,
  which admin created it, internal usage caps beyond what Stripe enforces.

### 3.2 Free trials — Stripe-native trial period, local trial-state cache

`Subscription.trial_period_days` (or `trial_end`) at creation. Local
`subscriptions.status = 'trialing'` mirrors Stripe's own subscription
status (Stripe uses exactly this status string), so entitlement checks
(§5) don't need special-case trial logic beyond treating `trialing` as an
active-entitlement status. **Open product decision, flagged not
resolved:** whether trials require a card upfront (Stripe supports
both). Recommendation leans toward requiring a card (reduces trial-abuse
risk given this is a payments-adjacent, real-money-touching platform),
but this is a product/growth tradeoff, not a security requirement — call
out explicitly for a decision before implementation.

### 3.3 Gift subscriptions

New `gift_subscriptions` table (§4.6): a purchaser (an existing rider, or
a non-rider gift-giver via a lightweight guest Checkout) buys a
fixed-duration subscription for a **recipient** identified by email/phone,
not by rider ID (the recipient may not have an account yet). Flow:

1. Purchaser completes Stripe Checkout for a gift product/price
   (one-time payment, not itself recurring — the *gift* is a one-time
   purchase of N months of a recurring plan for someone else).
2. On `checkout.session.completed`, generate a redemption code
   (high-entropy, single-use, same `hashToken()`/timing-safe-compare
   pattern already used for OTP codes in `lib/riderAuth.js`-adjacent
   code), email it to the recipient.
3. Recipient redeems the code (requires an authenticated rider session —
   redemption creates or activates a real `subscriptions` row scoped to
   *their* `stripe_customer_id`, never the purchaser's) for
   `duration_months`, after which it either lapses to free tier or
   prompts the recipient to continue on their own card — product
   decision, not resolved here.
4. Redemption is itself a rider-authenticated action and must go through
   the same non-bypassable identity resolution as everything else in
   §9.1 — a redemption code proves "this gift belongs to whoever redeems
   it correctly," not "this gift belongs to whatever `riderId` the
   request body claims."

### 3.4 Corporate-sponsored subscriptions

This is the general mechanism HTAF Partner (§1.4) is a specific instance
of. New `corporate_sponsorships` table (§4.7): a sponsor organization
funds a **seat pool** (N subscription-months available for assignment)
rather than a single subscription. An admin (sponsor-side, via a
sponsor-scoped admin role — new concept, see §7.3) or Harvey Taxi admin
assigns pool seats to specific riders, each assignment creating a normal
`subscriptions` row with `sponsor_id` set and `payer_type = 'corporate_sponsor'`
so the rider's entitlement works identically to a self-paid subscription
from the entitlement-check code's point of view (§5.1) — sponsorship is a
billing-attribution detail, not a different entitlement code path,
which keeps §5's entitlement logic from needing per-payer-type branching.

---

## 4. Database schema additions (design only — no migration files written)

All new tables follow the exact RLS pattern this codebase just finished
proving out in PR #98 (`docs/security-remediation/pr-04-rls-hardening.md`):
RLS enabled, a `service_role_X` policy (`to service_role using (true) with
check (true)`), a `deny_all_X` policy (`to public using (false)`), zero
grants to `anon`/`authenticated`. This is a direct continuation of that
just-verified pattern, not a new security posture to design from
scratch — and consistent with the confirmed finding that this app has
zero client-side Supabase usage anywhere (100% of DB access is
server-side via `server.js`'s service-role client).

### 4.1 `subscription_plans`

Local mirror of Stripe Products/Prices, for fast reads without hitting
Stripe's API per request.

| Column | Notes |
|---|---|
| `id` | PK |
| `tier` | `rider_plus` \| `business` \| `healthcare` \| `htaf_partner` |
| `stripe_product_id`, `stripe_price_id` | Stripe is source of truth; this is a cache |
| `billing_interval` | `month` \| `year` |
| `seat_based` | bool — true for Business/Healthcare-org/HTAF Partner |
| `active` | bool — soft-disable without deleting history |
| `entitlement_key` | references the entitlement config in §5.2, not a new enum to keep in sync by hand |

### 4.2 `organizations`

| Column | Notes |
|---|---|
| `id` | PK |
| `org_type` | `business` \| `healthcare` \| `htaf_partner` |
| `name` | |
| `billing_owner_rider_id` | FK riders — the one rider who can manage billing |
| `stripe_customer_id` | org-level Stripe Customer, distinct from any member rider's own |
| `status` | `active` \| `suspended` \| `closed` |

### 4.3 `organization_members`

| Column | Notes |
|---|---|
| `org_id`, `rider_id` | composite key |
| `role` | `owner` \| `admin` \| `member` |
| `seat_status` | `active` \| `invited` \| `removed` |
| `joined_at` | |

### 4.4 `subscriptions`

The core table — one row per active or historical subscription,
regardless of subscriber type or payer type.

| Column | Notes |
|---|---|
| `id` | PK |
| `subscriber_type` | `rider` \| `organization` |
| `subscriber_id` | polymorphic FK (rider or organization, per `subscriber_type`) |
| `plan_id` | FK `subscription_plans` |
| `stripe_subscription_id`, `stripe_customer_id` | Stripe is source of truth for status |
| `status` | mirrors Stripe's own values: `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `paused` |
| `current_period_start`, `current_period_end` | |
| `cancel_at_period_end` | bool |
| `trial_end` | nullable |
| `payer_type` | `self` \| `gift` \| `corporate_sponsor` — billing-attribution only, see §3.4 |
| `sponsor_id` | nullable FK `corporate_sponsorships`, set iff `payer_type = 'corporate_sponsor'` |
| `gift_id` | nullable FK `gift_subscriptions`, set iff `payer_type = 'gift'` |
| `created_at`, `updated_at` | |

### 4.5 `promo_codes`

Local metadata layer over Stripe Promotion Codes, per §3.1.

| Column | Notes |
|---|---|
| `id` | PK |
| `code` | human-entered code, unique |
| `stripe_promotion_code_id` | Stripe is source of truth for discount logic |
| `campaign_label` | internal only |
| `created_by_admin_id` | audit trail |
| `restricted_to_plan_ids` | nullable array/join table |
| `active` | |

### 4.6 `gift_subscriptions`

Per §3.3.

| Column | Notes |
|---|---|
| `id` | PK |
| `purchaser_rider_id` | nullable (guest gift purchase) |
| `redemption_code_hash` | hashed, same pattern as existing OTP `hashToken()` |
| `plan_id` | FK `subscription_plans` |
| `duration_months` | |
| `recipient_email`, `recipient_phone` | at least one required |
| `status` | `unredeemed` \| `redeemed` \| `expired` \| `revoked` |
| `stripe_checkout_session_id` | the one-time purchase payment |
| `redeemed_by_rider_id`, `redeemed_at` | set on redemption |
| `expires_at` | unredeemed codes expire (recommend 12 months) |

### 4.7 `corporate_sponsorships`

Per §3.4.

| Column | Notes |
|---|---|
| `id` | PK |
| `sponsor_org_id` | FK `organizations` (org_type constrained to sponsor-capable types) |
| `plan_id` | FK `subscription_plans` — what tier the pool funds |
| `seat_pool_size`, `seats_used` | |
| `billing_type` | `card` \| `invoice` (nonprofits/agencies often need net-30 invoicing, not card-on-file — flagged as a real requirement, not an edge case, for HTAF Partner specifically) |
| `stripe_customer_id` | sponsor's own Stripe Customer |
| `contract_start`, `contract_end` | |
| `status` | `active` \| `exhausted` \| `expired` \| `terminated` |

### 4.8 `subscription_events` (audit log)

Mirrors the existing `auditLog()` pattern already used for admin actions
elsewhere in this codebase — every lifecycle transition, whether
webhook-driven or admin-driven, gets a row.

| Column | Notes |
|---|---|
| `id` | PK |
| `subscription_id` | FK |
| `event_type` | `created`, `upgraded`, `downgraded`, `canceled`, `renewed`, `payment_failed`, `grace_period_started`, `grace_period_expired`, `admin_comp_granted`, `admin_comp_revoked`, `gift_redeemed`, `sponsor_seat_assigned` |
| `actor_type` | `system_webhook` \| `admin` \| `rider` |
| `actor_id` | nullable, whoever triggered it |
| `stripe_event_id` | nullable, for webhook-driven rows, doubles as idempotency key |
| `before_status`, `after_status` | |
| `created_at` | |

### 4.9 `stripe_webhook_events`

Idempotency ledger for the extended webhook handler (§2.4) — records
`event.id` before processing so retried deliveries no-op.

---

## 5. Feature entitlement system

### 5.1 Central entitlement resolver — fail-closed, identity-bound, never client-supplied

A single server-side function, `resolveEntitlements({ authenticatedRiderId })`
(deliberately named to match the existing `resolveEnforcedRiderId`
naming convention from PR 2b), is the **only** code path anything in
this app uses to answer "what is this rider allowed to do." It:

- Takes **only** an authenticated identity (`req.rider.id` once PR 2b's
  `rider_auth_enforced` is live — see §9.1 for why this cannot ship
  before that), never a client-supplied `riderId`/`planId`/`tier`.
- Looks up the rider's own active subscription **and** any organization
  membership's entitlements (a Business/Healthcare-org member inherits
  the org's plan without having their own `subscriptions` row) —
  resolved server-side from `organization_members` + `organizations` +
  `subscriptions`, never from anything the client asserts about its own
  org membership.
- Returns a plain entitlement set (e.g.,
  `{ waivedBookingFee: true, dispatchScoringPreference: true, ... }` —
  named per §1.5's guardrail, not `priorityDispatch`, so the field name
  itself doesn't imply a guarantee the system must never make), never the
  raw tier name alone — call sites check specific entitlements, not
  `tier === "rider_plus"` string comparisons scattered through the
  codebase, so entitlement definitions can change per-tier without
  touching every call site.
- **Fails closed**: no subscription, expired subscription, `past_due`
  past its grace period, DB error, or cache error all resolve to the
  free-tier entitlement set (empty/baseline), never to an elevated one.
  This mirrors the exact fail-closed discipline already established for
  `getSystemFlag` (missing row or query error → fallback, never
  "assume enabled") and for `requireRiderIfEnforced`.

### 5.2 Entitlement definitions live in code, not scattered inline

A single config object (e.g. `lib/subscriptionEntitlements.js`, mirroring
`lib/riderAuth.js`'s pure-function style so it's unit-testable the same
way `resolveEnforcedRiderId` was) maps `tier` → entitlement set. Adding
or changing what a tier includes is a one-file change, not a grep-and-edit
across every route that currently checks something ad hoc.

### 5.3 Caching and invalidation

Per-request Stripe lookups are too slow/costly; DB lookups on every
request are acceptable given this app's existing query patterns
(comparable to the existing per-request `getSystemFlag` calls) but a
short in-process cache (keyed by rider/org ID, a few seconds TTL) is
reasonable for hot paths. **Invalidation must be event-driven, not just
TTL-based**: every webhook event in §2.4's table that changes `status`
must proactively invalidate that subscriber's cache entry, so a
cancellation or downgrade takes effect immediately rather than waiting
out a TTL — this matters specifically for the "cannot bypass payment
ownership checks" requirement in §9: a stale cache is a real, if
short-lived, entitlement-bypass window.

---

## 6. Upgrade, downgrade, cancellation, grace period, failed payment, renewal

### 6.1 Upgrade / downgrade

Use Stripe's native subscription-update with `proration_behavior:
"create_prorations"` (upgrade takes effect immediately, prorated charge
on next invoice) or `"none"` for downgrades that should take effect at
the next renewal rather than immediately refunding the difference —
**recommend downgrades apply at period end, upgrades apply immediately**,
the common SaaS pattern, but flag as a product decision. Local
`subscriptions.plan_id` updates on the corresponding webhook
(`customer.subscription.updated`), not optimistically on the request that
initiated the change — the webhook is the confirmation, not the API call
that kicked it off.

### 6.2 Cancellation

Default to `cancel_at_period_end: true` (rider keeps access through the
period they already paid for) rather than immediate revocation, matching
standard subscription UX expectations. Immediate cancellation (with or
without a prorated refund) is a distinct, explicit action, not the
default button.

### 6.3 Renewal

Fully Stripe-driven (`invoice.paid` extends `current_period_end`
locally). No local renewal logic to build — this is exactly the kind of
thing that goes wrong when apps try to reimplement what Stripe already
does correctly.

### 6.4 Grace period and failed payment

On `invoice.payment_failed`: mark `status = 'past_due'`, start a grace
period (recommend 3–7 days, configurable, not hardcoded), during which
entitlements **remain active** (avoid punishing a rider for a transient
card issue) but the rider sees a clear in-app "update your payment
method" prompt. Stripe's own Smart Retries continues attempting the
charge on its own schedule during this window. If the grace period
expires without a successful retry, entitlements revoke
(`resolveEntitlements` falls back to free tier per §5.1's fail-closed
rule) and `subscription_events` logs `grace_period_expired`. If Stripe's
retry succeeds at any point, `invoice.paid` fires and clears the grace
state regardless of where in the window it happened.

---

## 7. Admin subscription management

Extends the existing admin dashboard pattern (`requireAdmin`-gated
routes, `admin-dashboard.html`, existing `auditLog()` calls) rather than
introducing a new admin surface.

### 7.1 Rider/org subscription lookup and management

New `requireAdmin` routes: list/search subscriptions, view a single
subscription's full history (from `subscription_events`), manually
trigger a Stripe-side action (cancel, refund) via the Stripe API using
the existing server-side Stripe client — never a client-side Stripe call
from the admin panel.

### 7.2 Manual comp / grant

Admin-initiated free/discounted access (e.g., an HTAF Partner comp
outside the normal sponsorship-pool flow, or a support-driven goodwill
credit) creates a `subscriptions` row with `payer_type` extended to
include `admin_comp` (or reuse `corporate_sponsor` with a synthetic
internal sponsor — a naming/design decision to finalize during
implementation, not blocking for this plan) and **always** logs to
`subscription_events` with the granting admin's ID — comps are audit
trail from day one, not a quiet backdoor.

### 7.3 Org and sponsor-side self-service admin (later phase)

A lighter-weight, org-scoped admin role (an `organization_members.role
= 'admin'` rider can manage their own org's seats/billing without full
Harvey Taxi `requireAdmin` access) is a real need for Business/Healthcare
org owners and HTAF Partner sponsor admins, but is scoped as a **later
phase**, not v1 — v1 assigns/manages seats via Harvey Taxi admin on the
org's behalf. Flagged now so the `organization_members.role` column
exists from the start (cheap to add now, expensive to retrofit), even
though the self-service UI for it isn't v1.

### 7.4 Seat-pool assignment (HTAF Partner / corporate sponsorship)

Admin UI to assign/revoke individual riders against a
`corporate_sponsorships` pool's remaining `seat_pool_size -
seats_used`, cross-checked against `htaf_applications.status =
'approved'` for HTAF-specific pools per §1.4.

---

## 8. Analytics and revenue reporting

### 8.1 What Stripe already provides — don't rebuild it

Stripe's own Billing/Revenue dashboards already compute MRR, churn, and
revenue recognition correctly from the actual billing events — this app
should link out to / embed Stripe's reporting for financial reporting
that needs to be audit-grade, rather than reimplementing revenue
recognition logic locally (a well-known source of accounting bugs when
apps try).

### 8.2 What's worth building locally

Product-specific views Stripe can't provide because they need this app's
own data (tier ↔ ride-behavior correlation, org seat utilization, HTAF
sponsorship pool consumption): extend the existing
`/api/admin/operations-overview` pattern (`server.js`) with a new
`/api/admin/subscriptions-overview` route — active subscriptions by
tier, trial-to-paid conversion rate, grace-period/at-risk count, seat
utilization per org, sponsorship pool remaining-seat counts. Read-only
aggregation queries against `subscriptions`/`subscription_events`/
`organizations`, `requireAdmin`-gated, same pattern as the existing
overview endpoint.

---

## 9. Security review

This is the section your instructions specifically asked for, and the
one this plan treats as non-negotiable rather than a nice-to-have.

### 9.1 Subscription entitlement must never be reachable via a client-supplied identity

This is the exact bug class this entire session's remediation program
exists to fix (P0-1 through P0-8, the rider-IDOR family). Subscriptions
must not reopen it:

- Every entitlement check (§5.1) and every subscription-mutating route
  (checkout initiation, cancellation, redemption) must resolve identity
  the same way PR 2b's migrated routes do: authenticated session
  identity (`req.rider.id`) always wins, a client-supplied ID is never
  trusted for "whose subscription is this."
- **Consequence, stated plainly: subscription entitlement enforcement
  cannot be meaningfully secure until `rider_auth_enforced` is actually
  on.** While that flag is off (its current state — confirmed `false`
  in production as of this session), there is no authenticated
  `req.rider` to bind a subscription to at all, only the same
  client-supplied `riderId` pattern PR 2b exists to close. This is the
  concrete reason subscriptions cannot launch — not just "shouldn't for
  process reasons" — before that gate closes. Any subscription
  implementation work that happens before then must stay entirely behind
  its own default-off flag and touch no rider-facing route.
- Checkout Session `client_reference_id` (§2.3) is set server-side from
  the authenticated identity at session-creation time, never from a
  client-supplied field in the create-checkout-session request body.

### 9.2 Organization membership is a new ownership dimension — needs its own IDOR review

Individual rider ownership (`ride.rider_id !== riderId`-style checks) is
well-established in this codebase and about to be fully closed by PR 2b.
Org-scoped ownership (§4.2/4.3) is new: "is this rider allowed to manage
*this organization's* billing/seats" is a different question than "is
this rider who they say they are," and needs its own explicit checks
(`organization_members.role IN ('owner','admin')` AND
`organization_members.org_id = :targetOrgId` AND
`organization_members.rider_id = req.rider.id`) on every org-management
route — modeled on, but not identical to, the rider-ownership pattern.
Flagged as its own review item for whenever org-tier implementation
actually begins, not assumed to be automatically covered by the
rider-auth work.

### 9.3 Payment ownership — reuse, don't reinvent

Individual-tier billing reuses the existing
`riders.stripe_customer_id` + `ownsPaymentMethod()` pattern
(`server.js`) exactly as-is — a rider's subscription payment method is
still just a payment method on their existing Stripe Customer, checked
the same way. Org-tier billing introduces org-level Stripe Customers
(§2.2) with their own equivalent ownership check (§9.2), never allowing
a rider to attach or view an org's payment method without a verified
`organization_members` role.

### 9.4 Webhook trust boundary

Reuses the existing signature-verified webhook (`STRIPE_WEBHOOK_SECRET`,
`stripe.webhooks.constructEvent`) — no new trust boundary introduced.
The new idempotency ledger (§4.9) prevents a replayed/duplicated webhook
delivery from double-crediting a renewal or double-processing a
cancellation.

### 9.5 Admin routes

All new admin routes (§7) reuse `requireAdmin` exactly as every existing
admin route does — no new admin-auth mechanism introduced.

### 9.6 RLS

Covered in §4's header — every new table gets the same
deny-by-default/service-role-only pattern just verified end-to-end in
PR #98, with the same before/after evidence discipline (`pg_policies`,
role-switched functional tests) applied when these tables are actually
created.

### 9.7 What this section explicitly does not claim

This is a design-time review, not a penetration test. Once
implementation begins, this needs the same treatment every rider-auth PR
in this program got: unit tests for the pure entitlement-resolution
logic (mirroring `resolveEnforcedRiderId`'s test suite), an honest
Confirmed/Likely/Unverified verification-classification table in that
PR's own doc, and — given this codebase's confirmed lack of an
integration-test harness — an explicit live/manual validation runbook
before any entitlement-gated feature actually goes live, the same
pattern PR 2a's runbook (and its current open gate) already established.

---

## 10. API changes required

**No existing route's behavior changes.** All additions:

**Rider-facing (require authenticated rider identity, per §9.1):**
- `POST /api/subscriptions/checkout-session` — create a Stripe Checkout
  Session for a given plan; `client_reference_id` set server-side.
- `GET /api/subscriptions/me` — current rider's subscription + entitlements.
- `POST /api/subscriptions/cancel` — cancel own subscription.
- `POST /api/subscriptions/gift/redeem` — redeem a gift code.

**Organization-facing (require verified org membership, per §9.2):**
- `GET /api/organizations/:orgId` — org detail (owner/admin only).
- `POST /api/organizations/:orgId/members` — invite/add a seat.
- `DELETE /api/organizations/:orgId/members/:riderId` — remove a seat.

**Admin-facing (require `requireAdmin`, per §9.5):**
- `GET /api/admin/subscriptions` — list/search.
- `GET /api/admin/subscriptions/:id` — detail + event history.
- `POST /api/admin/subscriptions/:id/comp` — manual grant.
- `POST /api/admin/sponsorships/:id/assign-seat` — HTAF/corporate pool assignment.
- `GET /api/admin/subscriptions-overview` — analytics (§8.2).

**Webhook (extends existing endpoint, per §2.4):**
- `POST /api/stripe/webhook` — new `event.type` branches added to the
  existing handler; no new endpoint, no change to existing
  `payment_intent.*` handling in that same handler.

---

## 11. Mobile and web UX flow

- **Discovery/upsell:** a subscription entry point on the rider dashboard
  (`rider-dashboard.html`) and post-ride ("you could have saved $X with
  Rider Plus") — non-intrusive, dismissible, not a paywall on core
  ride-booking.
- **Plan selection → Checkout:** tier comparison screen → Stripe Checkout
  redirect (§2.3) → return to a confirmation state that polls
  `GET /api/subscriptions/me` rather than trusting the Checkout redirect
  URL's query params for status (the webhook, not the redirect, is the
  source of truth for whether the subscription actually activated).
- **Trial banner:** persistent, dismissible-but-reappearing banner during
  `trialing` status showing days remaining, matching the existing
  design-language of other status banners already in the dashboard.
- **Grace-period / dunning UI:** a non-dismissible (higher urgency than
  the trial banner) prompt during `past_due`, with a direct link to
  update the payment method, reusing the existing Stripe Elements
  card-update component already built for ride payment methods.
- **Org seat management (Business/Healthcare):** a lightweight
  owner/admin-only screen — list members, invite by email, remove a
  seat — v1 can be admin-assisted per §7.3 with this UI as a later phase.
- **Gift purchase flow:** "Gift Rider Plus" entry point, recipient
  email/phone capture, guest Checkout for non-rider purchasers.
- **Gift redemption flow:** a redemption-code entry screen, gated behind
  rider login (redeeming requires an authenticated identity per §3.3).
- **Promo code entry:** native Stripe Checkout promo-code field (§3.1) —
  no custom UI needed for v1.
- **Mobile-specific:** all of the above needs the same mobile-layout and
  keyboard-behavior verification already required (and still pending
  independent verification) for PR 2a's own UI per its runbook — same
  bar, not a lower one because it's "just billing UI."

---

## 12. Sequencing and rollout (high-level, not a sprint plan)

1. **Blocked until:** PR 2b's `rider_auth_enforced` live-validated (task
   #214); rider and organization ownership controls (§9.1, §9.2) in
   place; PR 3 (payment ownership) complete; Stripe webhook signature
   verification and idempotency (§2.4, §9.4) implemented as designed.
   **Not a blocker:** PR 4's `spatial_ref_sys` item (task #213) — open,
   tracked, required for broader production-hardening/SOC 2 readiness,
   but unrelated to rider identity, subscription ownership, billing, or
   entitlements (see §0).
2. Schema migrations (§4) — written and reviewed with the same
   before/after evidence discipline as PR #98, applied to production
   only after Supabase branch-testing is confirmed available or an
   equivalent staged/reversible process is agreed (the same "test on a
   branch first" requirement PR 4 hit a real limitation on — resolve
   that limitation or have an explicit alternative agreed before
   applying subscription schema changes, since these tables will hold
   real payment-relationship data from day one).
3. `lib/subscriptionEntitlements.js` + unit tests (§5.2), inert — no
   route wired yet, same "foundation commit" pattern PR 2b's own commit
   sequence used.
4. Webhook handler extension (§2.4), behind its own default-off flag —
   inert until enabled.
5. Rider-facing routes (§10), behind a default-off flag, small
   groups with tests alongside each group — same discipline as PR 2b's
   5-commit sequence.
6. Org/admin/analytics surfaces (§7, §8) after individual-tier
   subscriptions are live-validated.
7. Org self-service admin (§7.3), gift redemption UX polish, and
   promo-code custom UI (if ever needed beyond Stripe's native field)
   as later phases, not v1.

---

## 13. Open product decisions (not resolved by this plan, flagged for you)

- Trial: card-required or not (§3.2).
- Downgrade timing: immediate vs. period-end (§6.1).
- Gift lapse behavior: hard-stop vs. prompt-to-continue (§3.3).
- Exact entitlement list per tier (§1's "candidate entitlements" are
  starting points, not final).
- Whether HTAF Partner sponsorship needs invoice/net-30 billing support
  in Stripe (likely yes for agencies/nonprofits, flagged in §4.7,
  needs confirmation before implementation since it changes the
  Checkout/Billing integration shape for that tier specifically).

---

## 14. Referral system — companion document

Referral and rewards architecture (rider-to-rider, driver-to-driver,
Business/Healthcare partner, HTAF community-partner, and admin
promotional-campaign programs) is specified as a separate companion
document rather than folded into this one, given its size and its own
distinct fraud-model requirements: **`docs/referral-system-architecture.md`**.
Same status — planning only, not implemented — and it inherits this
document's gates (§0, §12) plus its own additional ones (identity/
payment/ride-status trustworthiness and a dedicated privacy/anti-fraud
review), specified in that document's own §16.
