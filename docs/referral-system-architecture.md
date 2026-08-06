# Referral System Architecture — Companion to PR #99 (Subscription Architecture & Readiness Plan)

**Status: PLANNING ONLY — NOT APPROVED, NOT IMPLEMENTED.** No code,
schema, migration, Stripe object, or feature flag has been created for
this. This document is a companion to
`docs/subscription-architecture-readiness-plan.md` (merged, approved
baseline), not a replacement for it — where this doc references
entitlements, Stripe promotion codes, or the RLS pattern, it means
exactly the mechanisms that document already defines, reused rather
than redesigned.

**Same hard gate as the subscription plan, restated with referral-
specific additions (§16):** implementation must not start until rider
authentication is enforced and live-validated, driver
authentication/readiness is enforced, rider and payment ownership fixes
are complete, ride completion/refund status is trustworthy, and — new
for referrals specifically — organization-membership authorization is
designed for partner referrals and a dedicated privacy/anti-fraud review
is complete. A referral system is, structurally, an *automated reward
system triggered by other people's identity and payment events* — it
inherits every identity/payment risk the subscription plan already
flags, plus its own (fraud rings, self-dealing, fabricated accounts)
that a normal paid-subscription flow doesn't have to the same degree.

---

## 0. What this document does not do

Same non-goals as PR #99, restated: no implementation, no migrations,
no Stripe objects (test or live), no feature flags created or enabled,
no existing routes modified, no launch timeline.

---

## 1. V1 recommended scope vs. deferred

### 1.1 V1 scope

- **Rider-to-rider program**, live-validated end to end, config-driven
  (not hardcoded) amounts:
  - Referrer reward: ride credit, **recommended $5, configurable**.
  - New-rider reward: ride credit, **recommended $5, configurable**.
  - Qualification: referred rider's **first paid, non-refunded ride**.
  - Cap: **five qualified referrals per rider per month, configurable**.
- **HTAF community-partner program**, attribution/impact tracking only
  — **no automatic monetary reward** in V1, per your explicit
  recommendation. Exists so partner outreach has real numbers
  (referred signups, rides, HTAF applications) without building a
  payout mechanism this program doesn't need yet.
- The underlying **generic architecture** (all five program types,
  full data model, fraud controls) ships as designed here, because
  retrofitting fraud controls onto a live reward system later is far
  riskier than designing them in from the start (this is exactly why
  you asked for this as architecture-first work) — but only the two
  programs above are recommended to actually *launch* in V1.

### 1.2 Deferred past V1

- **Driver-to-driver program**: architecture fully specified below
  (§4), reward **amount intentionally left undetermined** pending
  acquisition-budget/driver-economics analysis — a finance/growth
  decision, not an engineering one. The qualification gate (Checkr +
  Persona + admin approval + N completed rides + zero fraud flags) is
  not deferred — that's a fixed security requirement regardless of
  reward amount, specified now so it's correct whenever the amount is
  set.
- **Business and Healthcare partner referral programs**: architecture
  specified (§5), launch deferred until the Business/Healthcare
  subscription tiers themselves are live (PR #99 §12) — a partner
  referral program for a product that doesn't have paying partner
  customers yet has nothing to attribute against.
- **Admin promotional campaigns** (§6): the construct is specified now
  since it shares the same tables as every other program, but no
  specific campaign is designed or scheduled here.
- **Driver earnings-bonus payout automation, subscription-discount
  rewards via Stripe promotion codes, and gift/cash-withdrawal paths**:
  specified (§7, §11) but not built until their respective dependent
  systems (driver payout pipeline changes, subscription tiers) exist.

---

## 2. Referral programs — five distinct programs, five distinct reward rules

Per your explicit instruction, there is **no shared reward rule**. Every
program is its own `referral_programs` row (§9.1) with its own
`reward_rule_config`; nothing in the qualification or reward-issuance
code path is allowed to hardcode a dollar amount, a cap, or a
qualification threshold — those always come from the program's own
config row, looked up by `program_id`, never assumed.

| Program | Subject | Reward model | V1 status |
|---|---|---|---|
| **Rider-to-rider** | Existing rider refers a new rider | Ride credit to both, per §1.1 | **Launch** |
| **Driver-to-driver** | Existing driver refers a new driver applicant | Driver earnings bonus, amount TBD | Architecture only, deferred |
| **Business/Healthcare partner** | An org (or a rider on behalf of an org) refers a new org customer | Subscription discount (Stripe promo code) or admin-approved one-time credit/attribution | Architecture only, deferred |
| **HTAF community-partner** | An HTAF-partner org refers eligible riders/other partners | Attribution + impact tracking only, no automatic reward | **Launch (tracking only)** |
| **Admin promotional campaign** | Admin-defined, time-boxed | Whatever the campaign config specifies, within the same guardrails (non-cash-by-default, server-computed) as every other program | Construct specified, no campaign scheduled |

---

## 3. Rider-to-rider referral lifecycle

### 3.1 Flow (matches your spec exactly)

1. Authenticated rider requests/receives a unique referral code + link
   (`GET/POST /api/referrals/code`, §10 — server-generated, never
   client-chosen).
2. New person opens the link, signs up.
3. Attribution recorded **once**, immutably, at signup completion
   (§8.2) — not at link-click time (a click isn't an account).
4. Referred rider completes identity/contact verification (reuses the
   existing OTP verification infrastructure — `createVerificationRecord`/
   `verifyCode` — no new verification mechanism).
5. Referred rider completes their **first eligible paid, non-refunded**
   ride.
6. Referral becomes `qualified` (§9.4).
7. Rewards issued to referrer and (per program config) the referred
   rider.

**A signup by itself never qualifies for a reward** — enforced
structurally by keeping `referral_attributions` (signup happened) and
`referral_qualifications` (the actual qualifying event happened)
as separate tables (§9) with separate status fields; nothing reads
attribution status as if it were qualification status.

### 3.2 State machine

```
attribution:  (none) -> pending -> active -> [void_self_referral | void_duplicate | void_fraud]
qualification (per attribution): not_started -> verification_pending -> verified
              -> first_ride_pending -> ride_completed_holdback -> qualified
              -> [disqualified_refund | disqualified_fraud | expired_window]
reward (per qualified attribution, per recipient): pending -> issued -> [redeemed | reversed | expired]
```

`ride_completed_holdback` (§13.6) is a deliberate short window (recommend
3–7 days, configurable, not resolved here) between "ride completed" and
"reward issued," specifically to catch a late refund/dispute before
money moves rather than after.

---

## 4. Driver-to-driver referral lifecycle

### 4.1 Flow (matches your spec exactly, all steps required, none optional)

A driver reward does not qualify until the referred applicant:

1. Completes signup.
2. **Passes** both Checkr and Persona verification (reuses existing
   driver compliance infrastructure and its existing
   `apply_driver_compliance_override`/verification-status columns — no
   new verification mechanism, only a new *qualification check* that
   reads those existing statuses).
3. Is administratively approved (reuses existing driver-approval admin
   route pattern).
4. Completes a **configurable** number of legitimate rides (program
   config, not hardcoded — recommend starting around 10–20 completed
   rides as a strawman, explicitly flagged as an open decision, §16).
5. Has **no** fraud, duplicate-account, or payment-abuse flags open
   against them at evaluation time.

**Never awarded merely because an application was submitted** —
structurally enforced the same way as §3.1: `referral_qualifications`
for a driver-program attribution cannot reach `qualified` status without
passing through `checkr_passed` + `persona_passed` + `admin_approved` +
`ride_count_met` + `fraud_clear` sub-states, each independently
evaluated and logged (`referral_events`), not a single boolean anyone
can flip.

### 4.2 State machine

```
qualification (driver program): applicant_signed_up -> checkr_pending -> checkr_passed
    -> persona_pending -> persona_passed -> admin_review_pending -> admin_approved
    -> rides_in_progress (n of N) -> fraud_clear_check -> qualified
    -> [disqualified_checkr_failed | disqualified_persona_failed | disqualified_admin_rejected
        | disqualified_fraud | frozen_pending_fraud_review]
```

`frozen_pending_fraud_review` is a distinct state from `disqualified` —
a fraud flag pauses progress toward qualification without permanently
closing it, pending admin review (§14), since not every flag is
confirmed fraud.

---

## 5. Business, Healthcare, and HTAF community-partner referrals

These are structurally different from the two consumer programs above:
the "conversion event" is a sales/partnership relationship, not a single
ride, and volumes are low enough that **full automation is not
recommended for V1** even where it's architecturally possible.

- **Business/Healthcare partner referrals**: attribution and
  verification-of-signup work the same way as the consumer flow (§8,
  §9), but qualification is **admin-approved**, not purely event-driven
  — a Harvey Taxi admin confirms the referred organization became a
  genuine paying customer (via `POST /api/admin/referrals/partner-
  exception`, §10) before a reward issues. Reward is typically a Stripe
  promotion-code-based subscription discount for the new org (reusing
  PR #99 §3.1/§8.1's existing "Stripe is source of truth for discounts"
  pattern) or an admin-approved one-time credit/attribution for the
  referring party.
- **HTAF community-partner referrals**: attribution recorded the same
  way, but the program's `reward_rule_config` specifies
  `reward_type: partner_attribution_only` — no reward object is ever
  created, only `referral_events`/reporting rows. This isn't a
  simplification for engineering convenience; it matches your explicit
  instruction that HTAF referrals should track impact, not auto-pay.

---

## 6. Admin-managed promotional campaigns

A fifth program type using the exact same tables (§9), distinguished by
`program_type = 'admin_campaign'` and a bounded `start_at`/`end_at`. An
admin creates a campaign with its own `reward_rule_config` (which
existing reward types it uses, amounts, caps, qualification window)
through the same admin tooling (§14) every other program uses — no
separate "campaigns" subsystem, so campaign-specific logic doesn't
silently diverge from the fraud/audit discipline applied everywhere
else. `reward_rule_config` amounts are still never hardcoded in code —
they live in the campaign's own row, editable (and pausable) by admins
within guardrails (§13's caps and non-cash-by-default rule apply to
every program type without exception, campaigns included).

---

## 7. Reward types — configurable catalog, not a single mechanism

`reward_type` is a fixed enum on `referral_rewards`/`referral_programs`,
each with its own issuance mechanism:

| `reward_type` | Issuance mechanism | Cash-withdrawable? |
|---|---|---|
| `ride_credit` | Internal ledger (§13.1), redeemed against a future ride's fare, server-side | No, by default |
| `waived_booking_fee` | Entitlement-style flag applied to a specific future ride (not a stored dollar amount) | N/A |
| `subscription_discount` | Stripe Promotion Code, applied at the recipient's next Checkout (PR #99 §3.1) | N/A (discount, not cash) |
| `subscription_trial_extension` | Extends `subscriptions.trial_end` (PR #99 §3.2), no monetary object at all | N/A |
| `promotional_credit` | Same ledger as `ride_credit`, distinct `entry_type`/label for reporting | No, by default |
| `driver_earnings_bonus` | New entry in the existing `driver_earnings` ledger (§11.4) with a distinct type/reason, not a new payout system | Follows existing driver-earnings payout rules, not this system's own |
| `htaf_sponsored_ride_credit` | Ledger entry, funded against a `corporate_sponsorships` seat pool (PR #99 §4.7) rather than Harvey Taxi's own account | No |
| `partner_attribution_only` | No reward object created — `referral_events`/reporting rows only | N/A |

**Rider referrals prefer non-cash credit types initially** (`ride_credit`)
per your instruction. **No reward of any type is cash-withdrawable
unless a separate, explicit approval process sets
`referral_rewards.cash_withdrawable = true`** — this is not a default
anyone can flip from a normal reward-issuance code path; it requires its
own reviewed admin action, logged distinctly in `referral_events`.

---

## 8. Attribution rules

### 8.1 Link and code format

Opaque, high-entropy code (not sequential, not derived from the
referrer's rider ID or name) — same generation discipline as this
codebase's existing verification-code infrastructure
(`hashToken()`-style hashing at rest, timing-safe comparison on lookup).
Full shareable link: `https://harveytaxiservice.com/r/<code>`. The code
itself is long-lived (tied to the referrer's account, doesn't expire on
its own) for the evergreen rider-to-rider/driver-to-driver programs;
**admin-campaign codes carry the campaign's own `end_at`** and stop
resolving once it passes.

### 8.2 Attribution timing and immutability

**Recommendation adopted as designed, matching yours exactly**: the
first valid referral code resolved **before account creation or during
signup** is captured (server-side, §10.2 — never a client-supplied
`referredBy` field trusted at face value), and becomes **immutable once
the first eligible ride begins** for that account. Before that point, a
resolved-but-unattributed code reference may be superseded only by
another *earlier* first-touch resolution (there isn't one, by
definition, since first-touch is captured once) — practically, this
means: first code wins, period, and nothing after signup can change it.

### 8.3 First-touch vs. last-touch

**First-touch**, not last-touch. Rationale: last-touch attribution is
gameable — a bad actor could intercept an already-organically-acquired
signup at the last moment (e.g., sending a referral link to someone who
was already about to sign up anyway) and claim credit. First-touch
rewards whoever actually introduced the person, which is both more
fraud-resistant and the more defensible "did this referral actually
cause this signup" story for accounting purposes (§13.7).

### 8.4 One attribution per new account

Enforced at the schema level: `referral_attributions.new_account_id`
carries a **unique constraint** (scoped to `new_account_type`) — a given
rider or driver account can be the "referred" party in exactly one
attribution row, ever, permanently. Not a soft application-level check
only.

### 8.5 Multiple codes entered

Only the first successfully resolved code (§8.2/§8.3) is attributed.
Any subsequent code entry attempt (same session or a later one, before
the account's first ride) is recorded as a `referral_events` row for
visibility (useful for fraud analysis — someone repeatedly trying
different codes is itself a signal, §14) but never changes the
already-captured attribution.

### 8.6 Self-referrals

**Prohibited, checked at attribution time, not just reward time** — a
resolve/attribution attempt is rejected outright (not silently
recorded as `pending` and later disqualified) if the new account shares
the referrer's authenticated identity, or matches on phone, email,
payment method fingerprint, or device fingerprint (§13's fraud-signal
fields). Fail-closed: if a fraud-signal check itself errors or can't
run, treat as **not eligible for attribution** rather than defaulting
to allowing it.

### 8.7 Existing accounts

**Ineligible.** A referral code resolved by someone who already has a
Harvey Taxi rider or driver account (matched by phone/email/device, not
just "is currently logged in") does not create a valid attribution,
regardless of when they created that account relative to the code. This
program is for net-new user acquisition, not re-attributing existing
users.

### 8.8 Campaign-specific qualification windows

The evergreen rider-to-rider program uses a **bounded** default window
too (recommend 60–90 days from signup to qualifying first ride,
configurable, not infinite — bounds the outstanding-liability question
in §13.7). Admin campaigns (§6) can set their own, shorter or longer,
window via `reward_rule_config`. An attribution whose qualifying event
hasn't occurred by the window's end moves to `expired_window`, not left
open indefinitely.

### 8.9 Canceled, refunded, and disputed rides

**Never count as the qualifying event.** Two enforcement points, not
one: (a) the qualification check itself only considers rides whose
status is genuinely completed-and-paid at evaluation time; (b) the
`ride_completed_holdback` state (§3.2) delays final reward issuance by a
short window specifically so a refund or dispute that lands shortly
after ride completion can still flip qualification to
`disqualified_refund` before any money moves. If a refund/chargeback
lands *after* a reward already issued (rare, given the holdback, but
possible), §13.5 defines the reversal path — the reward is reversed via
a ledger entry, never just silently left as an accounting discrepancy.

---

## 9. Database design

Same RLS discipline as every table added in PR #98/#99: RLS enabled,
`service_role_X`/`deny_all_X` policy pair, zero grants to
`anon`/`authenticated`. Restated once here rather than per table below.

### 9.1 `referral_programs`

| Column | Notes |
|---|---|
| `id` | PK |
| `program_type` | `rider_to_rider` \| `driver_to_driver` \| `business_partner` \| `healthcare_partner` \| `htaf_community_partner` \| `admin_campaign` |
| `name`, `status` (`active`/`paused`/`ended`) | |
| `reward_rule_config` | jsonb — reward type(s), amounts/benefits, caps, qualification thresholds, window length. **The only place amounts live.** |
| `start_at`, `end_at` | nullable except for `admin_campaign` |
| `created_by_admin_id`, `created_at` | |

### 9.2 `referral_codes`

| Column | Notes |
|---|---|
| `id` | PK |
| `program_id` | FK |
| `owner_type` | `rider` \| `driver` \| `organization` \| `admin_campaign` |
| `owner_id` | polymorphic per `owner_type` |
| `code` | unique, opaque, hashed at rest |
| `status` | `active` \| `revoked` \| `expired` |
| `created_at`, `expires_at` | |

### 9.3 `referral_attributions`

| Column | Notes |
|---|---|
| `id` | PK |
| `code_id`, `program_id` | FK |
| `new_account_type` | `rider` \| `driver` |
| `new_account_id` | **unique per `new_account_type`** (§8.4) |
| `attribution_method` | `link_click` \| `code_entry` |
| `attributed_at` | |
| `fraud_signal_hash` | hashed phone/email/device composite, for dedup checks (§13.3) — hashed, not raw PII retained longer than needed |
| `status` | `pending` \| `active` \| `void_self_referral` \| `void_duplicate` \| `void_fraud` |

### 9.4 `referral_qualifications`

| Column | Notes |
|---|---|
| `id` | PK |
| `attribution_id` | FK |
| `qualifying_event_type` | program-specific (`first_paid_ride`, `checkr_persona_admin_rides_fraud_clear`, `partner_admin_approved`, etc.) |
| `qualifying_event_ref` | e.g. `ride_id`, nullable per event type |
| `status` | see the state machines in §3.2/§4.2 |
| `holdback_until` | nullable, §3.2/§8.9 |
| `evaluated_at` | |

### 9.5 `referral_rewards`

| Column | Notes |
|---|---|
| `id` | PK |
| `attribution_id`, `qualification_id`, `program_id` | FK |
| `recipient_type` | `referrer` \| `referred` |
| `recipient_id` | rider or driver |
| `reward_type` | §7's enum |
| `amount_or_benefit` | jsonb (credit cents, discount %, trial days — shape depends on `reward_type`) |
| `cash_withdrawable` | bool, default `false` (§7) |
| `status` | `pending` \| `issued` \| `redeemed` \| `reversed` \| `expired` |
| `issued_at`, `reversed_at`, `reversed_reason`, `expires_at` | |

### 9.6 `referral_events` (audit log)

Mirrors the existing `auditLog()`/`subscription_events` pattern.

| Column | Notes |
|---|---|
| `id` | PK |
| `attribution_id`, `qualification_id`, `reward_id` | nullable FKs, whichever applies |
| `event_type` | e.g. `attributed`, `verification_completed`, `qualified`, `disqualified`, `reward_issued`, `reward_reversed`, `fraud_flag_raised`, `admin_override` |
| `actor_type` | `system` \| `admin` \| `rider` \| `driver` |
| `actor_id`, `before_status`, `after_status`, `metadata` | |
| `created_at` | |

### 9.7 `referral_fraud_flags`

| Column | Notes |
|---|---|
| `id` | PK |
| `subject_type` | `attribution` \| `rider` \| `driver` \| `device` |
| `subject_id` | |
| `flag_type` | `self_referral` \| `duplicate_device` \| `duplicate_payment_method` \| `referral_loop` \| `fabricated_application` \| `velocity_abuse` |
| `detected_by` | `system_rule` \| `admin_review` |
| `status` | `open` \| `confirmed` \| `dismissed` |
| `resolved_by_admin_id`, `resolved_at`, `created_at` | |

### 9.8 `referral_credit_ledger`

The internal, auditable ledger §12.1/§13.1 requires — **the source of
truth for credit balances, not Stripe.**

| Column | Notes |
|---|---|
| `id` | PK |
| `subject_type` (`rider`/`driver`), `subject_id` | |
| `reward_id` | FK `referral_rewards` |
| `entry_type` | `issue` \| `redeem` \| `reverse` \| `expire` |
| `amount_cents` | signed (redeem/reverse/expire are negative relative to balance) |
| `balance_after_cents` | running balance, computed at write time |
| `ride_id` | nullable, set when `entry_type = 'redeem'` against a specific ride |
| `created_at` | |

---

## 10. API design (additive only — no existing route modified)

### 10.1 Rider/driver-facing (authenticated identity only, §13.1)

- `GET /api/referrals/me` — own code(s) per eligible program, stats,
  reward history.
- `POST /api/referrals/code` — idempotent get-or-create own active code
  for a given program; code value always server-generated.
- `POST /api/referrals/redeem-credit` (internal, called by the ride-
  request flow, not directly by the client) — applies available
  `referral_credit_ledger` balance to a ride's fare, capped (§13.4),
  server-computed only.

### 10.2 Public, unauthenticated (rate-limited, non-enumerable)

- `GET /api/referrals/resolve/:code` — validates a code exists and is
  active; returns a generic success/failure, never "this code belongs to
  X" or any distinguishing detail (same account-enumeration-protection
  discipline as the existing rider-auth design, PR 2a). On success, sets
  a short-lived, server-signed attribution token (signed cookie or
  server-side session value) — **this token, not a client-supplied code
  string, is what the subsequent signup request reads** to actually
  create the `referral_attributions` row, closing the "client-supplied
  code at signup" trust gap.

### 10.3 Organization-facing (verified org membership, per PR #99 §9.2)

- `GET /api/organizations/:orgId/referrals` — partner-program
  attribution/status view for org owners/admins.

### 10.4 Admin-facing (`requireAdmin`)

- `POST /api/admin/referrals/programs` — create/update/pause a program.
- `GET /api/admin/referrals/attributions` \|
  `/qualifications` \| `/rewards` — list/filter/detail.
- `GET /api/admin/referrals/fraud-flags`,
  `POST /api/admin/referrals/fraud-flags/:id/resolve`.
- `POST /api/admin/referrals/rewards/:id/reverse` — **requires a
  written reason field**, always audited (§14).
- `POST /api/admin/referrals/partner-exception` — manual
  qualification/approval for Business/Healthcare/HTAF partner referrals
  (§5).
- `GET /api/admin/referrals/reports/*` — §15's report set.

---

## 11. Qualification state machine — see §3.2 (rider) and §4.2 (driver)

Business/Healthcare/HTAF partner qualification (§5) is simpler and
mostly admin-driven: `attributed -> admin_review_pending ->
[qualified | rejected]`, since these are low-volume, sales-assisted
relationships rather than automated event triggers.

---

## 12. Security and fraud controls — mapped to concrete mechanisms

Every item from your required list, with the specific mechanism that
addresses it (not a restatement of the requirement):

| Requirement | Mechanism |
|---|---|
| Self-referrals | §8.6 — blocked at attribution time via identity/phone/email/payment-method/device match, fail-closed. |
| Duplicate accounts | New dedup check (phone/email/device hash) at attribution *and* qualification time — flagged explicitly as **new infrastructure this codebase doesn't have today** (confirmed via code search: no existing device-fingerprinting or duplicate-account-detection mechanism), not a reuse of something existing. |
| Referral-code guessing/enumeration | High-entropy opaque codes, rate-limited resolve endpoint, generic non-distinguishing responses (§10.2), same discipline as the existing rider-auth account-enumeration protection. |
| Repeated phone/email/payment method/device | Same dedup infrastructure as above, applied as a hard block, not just a flag, at attribution time; re-checked at qualification time in case the link wasn't caught initially. |
| One person referring themselves through another identity | Best-effort via device/payment-method fingerprint linking across accounts — **stated honestly as never fully solvable** (an industry-wide limitation, not specific to this design); backstopped by velocity-based fraud flags (§9.7 `velocity_abuse`) and admin review, not claimed as a hard guarantee. |
| Rewards from canceled/refunded/chargeback/fraudulent rides | §8.9 — holdback window + qualification re-check + post-issuance reversal path (§13.5). |
| Referral loops | Attribution-time graph check: reject (or flag) an attribution if the new account is already an ancestor of the referring code's owner in the attribution graph — not just a pairwise "did A refer B and B refer A" check, since loops can be longer than two hops. |
| Fabricated driver applications | §4.1 — qualification requires real Checkr pass + real Persona pass + real admin approval + real completed rides, each independently verified against existing systems, never inferred from application submission alone. |
| Unauthorized admin reward adjustments | Every admin-initiated change goes through `requireAdmin` + a mandatory reason field + a `referral_events` row — no reward-affecting route accepts an unaudited direct write. |
| Client-supplied reward amounts or qualification status | No reward-affecting route's accepted request schema includes an amount or status field at all — not merely validated server-side, structurally absent from what the client can send. All amounts come from `reward_rule_config`; all statuses are computed from DB state by server-side evaluation logic. |

### 12.1 Identity boundary — the same rule as PR #99, restated for referrals specifically

**Referral identity must come from authenticated sessions, never from
URL parameters, `localStorage`, or a client-supplied rider/driver ID.**
This applies to every referral-affecting action: generating a code,
resolving a code (the *code* is public/shareable, the resulting
attribution is bound to whoever's authenticated session actually
completes signup, not to any client-asserted identity), checking
reward status, and redeeming credit. Same structural dependency as PR
#99 §9.1: this cannot be meaningfully secure until `rider_auth_enforced`
(and the equivalent driver-session enforcement) is actually live — see
§16.

---

## 13. Payment and accounting rules

### 13.1 Credit ledger, not unrestricted cash

`referral_credit_ledger` (§9.8) is the single source of truth for any
rider/driver's referral-credit balance — **not** a `riders.credit_balance`
column that could drift from its history, and **not** Stripe (§11).
Balance is always computable as the sum of that subject's ledger
entries, never stored redundantly.

### 13.2 Issuance reason

Every `issue` entry references its `reward_id`, which in turn references
the `program_id`/`attribution_id`/`qualification_id` chain — full
provenance for every dollar issued, always traceable back to a specific
referral event, never a bare "credit added" with no reason.

### 13.3 Expiration

`referral_rewards.expires_at` (recommend 6–12 months from issuance,
configurable per program, not resolved here) — an unredeemed credit
past its expiration gets an `expire` ledger entry, zeroing it out and
removing it from outstanding-liability reporting (§13.7).

### 13.4 Redemption

Applied at ride-request time (`POST /api/referrals/redeem-credit`,
called server-side by the existing ride-request flow, never a
client-supplied redemption amount) — **capped at a maximum credit
amount per ride** (program-configurable, not resolved here; recommend
capping well below full fare, e.g. no more than 50% of the ride's cost,
so credits reduce cost but don't fund entirely free unlimited rides,
flagged as an open decision).

### 13.5 Reversal after refunds or fraud

A `reverse` ledger entry (negative, referencing the same `reward_id`)
whenever: a qualifying ride is refunded/disputed after reward issuance
(§8.9), or a fraud flag is confirmed against an already-issued reward
(§14). If the credit was already redeemed against a ride before
reversal, the reversal still records (balance can go negative in the
ledger history to reflect this — a real accounting event, not hidden),
flagged for admin/finance follow-up rather than silently written off.

### 13.6 Maximum credit per ride

Same cap as §13.4 — restated because it's both a redemption-time
control and an accounting control (bounds per-ride discount exposure).

### 13.7 Combination with subscription benefits

**Recommendation, not resolved as final**: referral credits and
subscription discounts (PR #99) may combine, but the combined discount
on a single ride cannot exceed the ride's actual cost (no ride is ever
free-and-then-some) — a server-side cap at redemption time, not a
policy relying on riders not stacking things.

### 13.8 Financial reporting treatment

Outstanding, unredeemed, unexpired referral credit is a **liability**
(money the business has promised, not revenue) — should surface in
admin financial reporting (§15) as its own line, computed from
`referral_credit_ledger` balances, distinct from Stripe's own revenue
reporting (PR #99 §8.1), since Stripe never sees non-cash internal
credits at all.

### 13.9 Outstanding promotional-credit liability

Same computation as §13.8, reported as a standalone admin metric
(§15) — total issued-minus-redeemed-minus-expired-minus-reversed
across all subjects, at a point in time.

### 13.10 Driver bonuses

Flow through the **existing** `driver_earnings` ledger (`server.js`,
already the system of record for driver payouts) as a new entry with a
distinct type/reason (e.g. `referral_bonus`), not a parallel payout
system. **Tax/accounting classification of referral bonuses (1099
treatment, whether it's treated as earnings or a separate incentive
payment) is a non-engineering question for your accountant/legal
counsel** — flagged explicitly rather than assumed, since getting this
wrong has real compliance consequences distinct from anything this
document can resolve technically.

---

## 14. Stripe interaction

**Stripe Promotion Codes only where a subscription discount is the
actual reward** (`subscription_discount`, `subscription_trial_extension`
reward types, §7) — reusing PR #99 §3.1's existing pattern exactly,
no new Stripe integration shape introduced.

**Stripe coupons are never the source of truth for ride credits or
driver bonuses.** Those flow entirely through `referral_credit_ledger`
(§13.1) and the existing `driver_earnings` ledger (§13.10) respectively
— internal, auditable, queryable independent of Stripe, per your
explicit instruction.

---

## 15. Admin tools

All `requireAdmin`-gated, matching your required list:

- Create/pause/resume a referral program (§10.4).
- Configure reward rules and caps — editing `reward_rule_config`
  directly, with a `referral_events` row logging every change.
- View attribution and qualification events — full drill-down from
  program → code → attribution → qualification → reward → ledger.
- Review suspected fraud (`referral_fraud_flags` queue, §9.7).
- Reverse rewards with a **written, required** reason (§10.4, §13.5).
- Approve exceptional partner referrals (§5, `partner-exception` route).
- Export reports (§16 below — CSV/API export of any report view).

Every manual adjustment is `requireAdmin`-gated and produces a
`referral_events` row with `actor_type = 'admin'` and `actor_id` set —
no exceptions, no adjustment path that bypasses the audit trail.

---

## 16. Required reports

`GET /api/admin/referrals/reports/*`, extending the same
`/api/admin/operations-overview`-style aggregation pattern PR #99 §8.2
uses:

- Invitations sent (code shares/link opens, to the extent trackable —
  flagged as best-effort since a "share" isn't always a server-observed
  event, e.g., a copy-pasted link shared outside the app).
- Signups attributed.
- Qualified referrals.
- Completed first rides (rider program specifically).
- Rewards issued and redeemed.
- Cost per acquired rider / driver (total reward spend ÷ qualified
  referrals, by program).
- Fraud/reversal rate.
- Conversion rate by campaign.
- Subscription conversions attributable to referrals (cross-references
  PR #99's subscription data).
- Partner lead conversion (Business/Healthcare/HTAF programs).

---

## 17. Required implementation gates

Referral implementation stays blocked until:

1. `rider_auth_enforced` is live and validated (task #214) — same gate
   as PR #99, non-negotiable for the identity-binding reasons in §12.1.
2. Driver authentication/readiness is enforced — the driver-side
   equivalent; the driver referral program's qualification gate (§4.1)
   is meaningless if driver identity itself isn't trustworthy.
3. Rider and payment ownership fixes are complete (PR 3, task #204).
4. Ride completion and refund status are trustworthy — depends on the
   same ride/payment-ownership hardening the remaining P0 PRs (tasks
   #206–#210) are working through; §8.9's entire refund-holdback design
   assumes ride/refund status can be trusted, which isn't true until
   that hardening lands.
5. Organization-membership authorization is designed for partner
   referrals — PR #99 §9.2's own open item; the Business/Healthcare
   partner program (§5) depends on it directly.
6. A dedicated **privacy and anti-fraud review** is complete — broader
   than the security review above, specifically covering: what
   fraud-signal data (phone/email/device hashes, §9.3) is retained, for
   how long, and under what legal basis; whether device fingerprinting
   (§12, flagged as new infrastructure) has its own privacy-policy and
   possibly consent implications; and sign-off from whoever owns privacy
   policy/legal for this app, not just an engineering security review.

**Unlike PR #99's revision, `spatial_ref_sys` (task #213) is not a
blocker here either**, for the same reason it isn't for subscriptions —
unrelated to any of the above.

---

## 18. Rollout flags

Following this codebase's existing `system_flags` convention exactly —
ships inert behind default-`false` flags, each **program independently
toggleable** so, for example, the rider-to-rider program could go live
before HTAF tracking does, or vice versa:

- `referral_rider_to_rider_enabled`
- `referral_driver_to_driver_enabled`
- `referral_business_healthcare_partner_enabled`
- `referral_htaf_community_partner_enabled`
- `referral_admin_campaigns_enabled`

A program's flag being off means its `referral_programs` row (if it
exists at all) is inert — no code resolves, no attribution records, same
"byte-for-byte unchanged behavior while off" discipline as every prior
PR in this program (PR 2b's own framing, reused here).

---

## 19. Test plan

- **Unit tests** for every pure decision function this needs — modeled
  directly on `resolveEnforcedRiderId`'s test suite (PR 2b) and
  `lib/pricing.js`'s/`lib/rideQuote.js`'s existing pure-function test
  style: `resolveReferralAttribution` (first-touch logic, self-referral
  rejection, duplicate-account rejection), `evaluateQualification` (per
  program type's state machine), `computeRewardAmount` (reads
  `reward_rule_config`, never a hardcoded literal in the function
  itself, tested against multiple program configs to prove no
  hardcoding crept in), `applyCreditRedemption` (cap enforcement, §13.4).
- **Fraud-scenario tests specifically**: self-referral attempt, referral
  loop (2-hop and 3-hop), duplicate device across two "different"
  accounts, refund-after-issuance reversal, expired-window attribution,
  multiple-code-entry (only first wins).
- **Same honest limitation as every prior PR in this program**: this
  codebase has no integration-test harness (no supertest/Express test
  client), so end-to-end behavior (an actual HTTP signup completing a
  real attribution, a real webhook triggering a real qualification)
  can't be automatically verified in CI — only the pure logic can.
  Requires the same live/manual validation runbook discipline as PR
  2a's (`pr-02a-live-validation-runbook.md`) before any program's flag
  is turned on for real users, with the same itemized PASS/FAIL/BLOCKED
  evidence standard, not a summary attestation.

---

## 20. Rollback plan

- **Instant, no deploy**: any program's flag (§18) reverts to inert
  behavior immediately via the existing admin-flag-toggle pattern — no
  in-flight attribution/qualification/reward record is deleted, they
  just stop being created/evaluated for new events.
- **Reward reversal**: already a first-class ledger operation (§13.5),
  not a special rollback-only code path — the same mechanism used for
  ordinary refund-driven reversals handles an "we're turning this
  program off and need to reverse recent issuances" scenario if that's
  ever needed.
- **Full revert**: reverting the implementing PR's commits removes the
  resolver functions, routes, and admin tooling; the additive-only
  tables (§9) either stay (harmless, inert, matches this codebase's
  general practice of not deleting historical data on rollback) or get
  dropped via a follow-up migration if genuinely unwanted — a decision
  for whoever executes the rollback, not resolved here.

---

## 21. Open product decisions (not resolved by this plan, flagged for you)

- Driver referral bonus amount and exact ride-count threshold (§1.2,
  §4.1) — pending acquisition-budget/driver-economics input.
- Holdback window length (§3.2/§8.9) — recommend 3–7 days, not fixed.
- Rider-to-rider qualification window (§8.8) — recommend 60–90 days,
  not fixed.
- Reward expiration window (§13.3) — recommend 6–12 months, not fixed.
- Maximum credit-per-ride cap (§13.4/§13.6) — recommend ≤50% of fare,
  not fixed.
- Whether Business/Healthcare partner referrer rewards are ever
  cash-eligible with separate approval (§7) — not decided here.
- Device-fingerprinting mechanism (§12) — new infrastructure to design
  or buy (a third-party fraud/device-ID vendor is a reasonable option
  worth evaluating rather than building fingerprinting in-house), not
  specified at the implementation level in this plan.
- All dollar amounts throughout this document are recommendations,
  explicitly configurable via `reward_rule_config` (§9.1), never
  intended to be hardcoded anywhere in an eventual implementation.
