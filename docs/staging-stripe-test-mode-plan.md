# Staging Stripe Test-Mode Rollout Plan

Status: **proposal — planning only, no configuration changes made**

Authorized scope: this document only. No production Stripe credentials are
added anywhere in this plan. No production payment behavior changes. No
admin test-ride bypass is proposed. No driver scoring, surge, forecasting,
autonomous dispatch, cancellation, or other unrelated work is included.

This plan exists because the controlled `dispatch_eta_persistence_enabled`
verification (see `docs/production-verification-package.md`) hit a real
wall: the production rider UI is correctly gated on a working Stripe
payment, and Stripe isn't configured in production, so no ride can be
booked end-to-end right now. Rather than work around that in production —
which is exactly how the high-priority defect below could be triggered —
this plan stands up an isolated staging stack where the real payment flow
can be exercised safely with Stripe test-mode money that can't be real.

---

## 0. What this plan does not touch

- **No production Stripe keys, of any kind, anywhere in this plan.**
- **No change to production payment behavior** — the open defect (any
  non-empty `payment_intent_id` reaching `dispatch_ride()` unverified when
  `stripe` is null) is explicitly **not fixed here**. See §8: it stays
  open and high-priority regardless of what staging proves.
- **No admin test-ride bypass.** Staging exists so the *real* rider/driver
  UI and the *real* payment code path can run safely — not so a shortcut
  can be built.
- **No production Supabase writes.** Every step below either targets a
  brand-new isolated database or is read-only against production.

---

## 1. Staging deployment: two viable options

### Option A — separate Supabase project (recommended)

A brand-new Supabase project, independent of `orgahzncmzptljapqffj` in
every respect: separate Postgres instance, separate connection URL,
separate service-role key, separate everything. No plan-tier
prerequisite — any Supabase plan can create a new project.

**Setup**: `create_project` (Supabase MCP or dashboard) → apply this
repo's schema. Every schema-affecting change in this codebase so far has
gone through either a committed migration file
(`supabase/migrations/*.sql` — currently two: `dispatch_claimed_at` and
`usage_counters`) or an ad hoc `apply_migration`/`execute_sql` call made
directly against production during earlier work in this project's history
that predates the committed-migration convention. **Before creating the
staging project, the two committed migrations replay cleanly, but the
full production schema needs a proper baseline dump** (`pg_dump
--schema-only` against production, or Supabase's own schema-diff tooling)
to capture everything that predates the migrations directory — this is
the one piece of real prerequisite work, not just applying the two files
in `supabase/migrations/`.

### Option B — Supabase branching (lower setup friction, has a prerequisite)

Supabase's branching feature (`create_branch`/`list_branches`/
`merge_branch`/`delete_branch`, already available as MCP tools in this
session) creates an isolated copy of the production schema as its own
Postgres database, with its own connection details, in seconds — no
manual schema replication needed. This is the "clearly isolated staging
schema" option.

**Prerequisite to verify before committing to this path**: Supabase
branching is a paid-plan feature (not available on the free tier). This
project's plan tier wasn't visible from `get_project`'s output — confirm
in the Supabase dashboard billing page before relying on this option, and
check `confirm_cost` if the MCP flow prompts for it. If unavailable, use
Option A.

### Recommendation

**Option B if the plan tier supports it** (near-zero schema-replication
risk, since it's a literal copy of production's actual schema rather than
a hand-assembled approximation) — **Option A as the fallback**. Either
way, the result is a Postgres database with zero data or schema
connection to production beyond having started from the same DDL.

### Staging application deployment

A second Render Web Service, deployed from this same GitHub repository,
either from a dedicated long-lived `staging` branch or from `main` with
staging-only environment variables (recommended: `main`, so staging is
always testing what's about to ship, not a diverging copy). Render
assigns it its own `*.onrender.com` URL automatically — no DNS or domain
work required for staging.

**One thing this plan can lean on for free**: `lib/corsOrigins.js` (PR
#59) already builds its default allow-list from whatever `APP_BASE_URL`
resolves to, including a bare Render URL — this was the exact production
incident that PR fixed. A fresh staging Render service needs no CORS
configuration at all; it will work correctly out of the box the same way
production did once `APP_BASE_URL` was set correctly.

---

## 2. Environment variables — staging only, never production

| Variable | Staging value | Notes |
|---|---|---|
| `SUPABASE_URL` | staging project/branch URL | Never production's |
| `SUPABASE_SERVICE_ROLE_KEY` | staging project/branch service-role key | Never production's |
| `STRIPE_SECRET_KEY` | Stripe **test-mode** secret key (`sk_test_...`) | From the same Stripe account's test-mode dashboard view — Stripe keeps test and live keys/data completely separate at the account level |
| `STRIPE_PUBLISHABLE_KEY` | Stripe **test-mode** publishable key (`pk_test_...`) | Served to the client via the existing `/api/stripe-key` route, unchanged |
| `STRIPE_WEBHOOK_SECRET` | Stripe **test-mode** webhook signing secret | See §3 — this is a distinct secret from any live-mode webhook, generated when the staging webhook endpoint is registered |
| `DRIVER_SESSION_SECRET` | a new, staging-only random secret | **Never reuse production's value** — a leaked staging secret must not be able to mint a valid production driver session token |
| `ADMIN_API_TOKEN` | a new, staging-only random value (or unset) | Same reasoning — never share with production |
| `APP_BASE_URL` | the staging Render URL | Lets CORS and absolute-link generation resolve correctly, per §1 |
| `TWILIO_*` | reuse production's, or a separate subaccount/number | SMS is a transport, not a data or auth boundary — sending a real OTP SMS from staging doesn't expose or weaken anything production-side. A separate number is a nice-to-have for cleanliness (e.g. so a staging text is visibly distinguishable), not a security requirement |
| `SENDGRID_*` | reuse production's, or a separate sender identity | Same reasoning as Twilio |
| `GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_ROUTES_API_KEY` | reuse production's, restricted to the staging domain if the key supports HTTP-referrer/IP restrictions | Optional — staging doesn't need real routing-API testing for this plan; `dispatch_route_api_enabled` stays off in staging too (§6) |
| `NODE_ENV` / `RENDER` | whatever marks this a non-production instance | Confirms `IS_PRODUCTION`-gated code paths behave as expected in logs during verification |

**Key isolation guarantee**: even if every one of these staging values
were somehow leaked, none of them can authenticate against or write to
the production database, mint a valid production driver/admin session, or
move real money — because none of them are production's values.

---

## 3. Stripe webhook endpoint (test mode)

`POST /api/stripe/webhook` (existing route, no code change) needs a
**second, separate webhook endpoint registered in Stripe's dashboard**,
pointed at the staging URL:

```
https://<staging-app>.onrender.com/api/stripe/webhook
```

Stripe's dashboard has an explicit "Test mode" toggle that keeps test and
live webhook endpoints, signing secrets, and event history entirely
separate — registering a test-mode endpoint here has zero interaction
with any production webhook configuration. The signing secret Stripe
generates for this new endpoint is the staging `STRIPE_WEBHOOK_SECRET`
value from §2. `server.js`'s existing webhook handler
(`stripe.webhooks.constructEvent(..., STRIPE_WEBHOOK_SECRET)`) needs no
changes — it already verifies against whatever secret is configured in
its own environment.

---

## 4. Using Stripe test cards through the existing rider UI

No code change needed — `public/rider-dashboard.html`'s payment step
(traced in the last session: `initStripeElements()`, real
`stripeClient.confirmCardPayment()`) already does exactly what's required
once a **test-mode** publishable key is being served. Stripe's published
test card works immediately in that same, unmodified card element:

- Card number: `4242 4242 4242 4242`
- Any future expiry date, any 3-digit CVC, any postal code

This proves the *real* code path — `/api/rides/payment-intent` →
`stripeClient.confirmCardPayment()` → `/api/rides/:id/authorize`'s real
`stripe.paymentIntents.retrieve()` verification branch (currently
unreachable in production only because `stripe` is null there) — with
money that Stripe guarantees cannot settle as real.

---

## 5. Staging rider and driver accounts

Both created **through the real signup endpoints against the staging
deployment** — not by direct SQL, unlike the design considered (and
rejected) for the production attempt. This matters here specifically
because it also validates the real signup/verification code paths, not
just dispatch:

- **Rider**: `POST /api/riders/signup` against staging, then real
  email/SMS verification through staging's own verification endpoints
  (staging has its own `verification_codes` table — nothing shared with
  production).
- **Driver**: `POST /api/drivers/signup` against staging, approved
  through staging's own admin panel (a staging `ADMIN_API_TOKEN`/admin
  login — never production's), positioned online via
  `PATCH`/whatever the real driver-dashboard UI uses to set availability
  and location.

### OTP method — recommendation: the normal SMS OTP flow, unmodified

Your requirement was "normal SMS OTP, or a staging-safe method that
doesn't weaken production authentication." The normal flow is the
recommendation here, for a simple reason: it requires **zero new code**.
`POST /api/driver/session/start` / `/verify` already work exactly as
designed against staging's own `verification_codes` table and staging's
own `DRIVER_SESSION_SECRET` — there is nothing to weaken, because staging
authentication is already fully decoupled from production's the moment
`DRIVER_SESSION_SECRET` differs (§2). A real phone number you control
receives a real OTP SMS the same way it would in production; the only
difference is which deployment sent it.

*Not recommended*: a fixed/bypass staging OTP code. Even gated to
non-production, it's a new code path that has to be built, reviewed, and
kept from ever leaking into the production build — avoidable complexity
and risk for no benefit, since the real flow already works with zero
staging-specific code.

---

## 6. Enabling and verifying ETA persistence in staging

Staging has its own `system_flags` table (Option A/B both start with a
copy of production's schema, but staging's *rows* are staging's own from
the moment it's created — no shared data). Enable independently:

```sql
-- Run against the STAGING project/branch only.
insert into system_flags (key, value, reason, updated_at)
values ('dispatch_eta_persistence_enabled', 'true', 'Staging verification', now())
on conflict (key) do update set value = 'true', reason = excluded.reason, updated_at = now();
```

`dispatch_route_api_enabled` and `offer_expiry_sweep_enabled` stay
**off** in staging too — this plan verifies the same one flag that's
already enabled in production; it doesn't expand scope to the other two.

Verification then follows exactly the sequence already designed and
already halted in production (`docs/production-verification-package.md`
§1, `docs/eta-persistence-plan.md` §9) — rider request → real Stripe
test-mode PaymentIntent → real `/authorize` → real `dispatchRide()` →
confirm `driver_eta_to_pickup_minutes`/`driver_distance_to_pickup_miles`
populate at offer creation → real driver OTP login → accept → location
pings → confirm ETA refreshes and decays sensibly → enroute → arrived —
run against the staging database with the same verification queries,
just pointed at the staging project/branch instead of production.

---

## 7. Isolation guarantees — how staging cannot affect production

| Concern | Guarantee |
|---|---|
| Database writes | Staging's Postgres instance (separate project, or a Supabase branch) has no connection, replication, or shared row to production's. A staging `INSERT` physically cannot reach the production database. |
| Payment / money | Stripe test mode is isolated at Stripe's own infrastructure level — test PaymentIntents, charges, and webhook events are a completely separate object space from live mode, regardless of which app or environment created them. No real charge can result from a test-mode key under any circumstance. |
| Driver/admin auth | Staging uses its own `DRIVER_SESSION_SECRET`/`ADMIN_API_TOKEN` (§2). A token signed with staging's secret fails verification against production's `requireDriver`/admin checks, and vice versa — this is a property of HMAC signing, not configuration discipline. |
| Webhooks | Stripe delivers test-mode events only to the test-mode endpoint registered in §3, never to production's webhook URL (if one is ever configured) — this is enforced by Stripe, not by this app. |
| Notifications (SMS/email) | If Twilio/SendGrid credentials are shared, a staging action sends a real SMS/email — cosmetically visible to whoever receives it, but writes nothing to and reads nothing from production's database. Use a separate number/sender identity if even that shared side-effect is undesirable. |
| CORS / routing | Staging's own `APP_BASE_URL` naturally scopes `lib/corsOrigins.js`'s allow-list to the staging domain (§1) — it cannot serve or accept requests as production's origin. |

---

## 8. Cleanup and rollback

Staging is disposable by construction — nothing here is meant to be
long-lived beyond this verification:

1. Delete the staging Stripe webhook endpoint from the Stripe dashboard
   (test mode).
2. Delete the staging Render Web Service.
3. Delete the staging Supabase project (Option A) or the Supabase branch
   (Option B via `delete_branch`) — this alone removes every staging
   rider, driver, ride, offer, and verification-code row at once, since
   it's the entire database.
4. Rotate/discard the staging-only `DRIVER_SESSION_SECRET` and
   `ADMIN_API_TOKEN` values — they were never shared with production, so
   there's nothing to "roll back" there, just confirm they're not reused
   anywhere else.

No production `DELETE`/rollback statements are needed at any point in
this plan, because nothing in it ever writes to production.

If instead you want to **keep** staging around as a standing pre-prod
environment rather than tearing it down after this one verification,
that's a reasonable follow-on decision — but it's a separate choice with
its own ongoing cost (a second Render service, a second Supabase
project/branch) and isn't assumed by this plan.

---

## 9. Acceptance criteria for promoting the payment + ETA flow to production

All of the following, verified in staging, before any production change:

1. A real rider, using the real UI, completes a real Stripe test-mode
   card payment and reaches `payment_authorized` — through
   `/api/rides/payment-intent` → `confirmCardPayment()` →
   `/api/rides/:id/authorize`'s real (not skipped) Stripe-verification
   branch.
2. `dispatchRide()` runs, a `driver_offers` row is created, and
   `driver_eta_to_pickup_minutes`/`driver_distance_to_pickup_miles` are
   populated on the `rides` row within the same request/shortly after.
3. A real driver, authenticated through the real SMS OTP flow, accepts
   the offer, and subsequent `POST /api/driver/location` pings correctly
   refresh the persisted ETA/distance with sane values (matching the
   query patterns in `docs/production-verification-package.md` §1.5).
4. No warning-level log lines from `computeAndPersistEta`/
   `persistPickupEtaBestEffort` during the run, and no latency/error
   regression on the dispatch or location-update routes.
5. **The payment_intent_id defect (§8 of `docs/production-incidents.md`,
   logged in PR #70) is fixed and itself verified in staging** — i.e.
   confirm `/api/rides/request` and `/api/rides/:id/authorize` correctly
   reject an unverified/placeholder `payment_intent_id` once the fix
   lands, using the same staging stack, before that fix (or real Stripe
   keys) ever reaches production.
6. A written sign-off that production `STRIPE_SECRET_KEY`/
   `STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET` will be **live-mode**
   keys added directly to production's own environment (never copied from
   staging, which are test-mode and cannot process real charges) — this
   is a deliberate, separate, explicit action at promotion time, not an
   automatic carry-over from staging.

Only once all six are met should production Stripe configuration or the
payment-verification fix be considered ready to ship.

---

## 10. Effort estimate

| Item | Work | Estimate |
|---|---|---|
| Staging Supabase project/branch + schema baseline | Create + verify schema matches production | 0.5–1 day (branching) or 1–2 days (fresh project + pg_dump baseline) |
| Staging Render service + env vars | Deploy, configure, confirm boot health | 0.5 day |
| Stripe test-mode keys + webhook registration | Dashboard configuration, no code | <0.5 day |
| Staging rider/driver account creation + OTP verification | Real signup + real verification flow | 0.5 day |
| Full controlled-ride verification run (§6) | Repeat the exact sequence already designed for production | 0.5 day |
| Payment defect fix + staging re-verification (acceptance criterion 5) | Separate, already-scoped defect (PR #70) — not included in this estimate, tracked on its own | Tracked separately |
| **Total (excluding the defect fix itself)** | | **~2–4 days** |

---

## 11. What stays exactly as it is

- `dispatch_eta_persistence_enabled` remains **`true`** in **production**
  — nothing in this plan changes that; it's fire-and-forget and dormant
  with zero active production rides, so it stays enabled while staging is
  built out.
- `dispatch_route_api_enabled` and `offer_expiry_sweep_enabled` remain
  **`false`** in production, and are **not** enabled in staging by this
  plan either.
- The payment_intent_id verification gap (`docs/production-incidents.md`,
  PR #70) **remains open and high priority** in production. This staging
  plan does not fix it and does not reduce its priority — if anything,
  tracing the real UI flow to write this plan reconfirmed the gap is only
  reachable via a direct API call bypassing the UI, which is exactly the
  kind of access a future attacker (not just this planning exercise)
  could also use. Recommend it be fixed and shipped to production
  independently of and before staging is built, if resourcing allows —
  the fix itself doesn't require staging to develop or test (it's a
  server-side validation tightening, testable the same way every other
  fix in this codebase has been: pure-function extraction + Jest
  regression tests), only to *exercise the resulting real payment flow*
  end-to-end, which is what staging is for.
