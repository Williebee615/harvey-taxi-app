# Harvey Taxi Mobile — Production Readiness Report

**Date:** 2026-08-01
**Prepared for:** SOC 2 readiness preparation (Type I/II readiness, not a certification audit) + pre-implementation input for the planned Admin Integrations Center.
**Status: AUDIT ONLY. No fixes implemented, no production configuration changed, no PR merged as a result of this report.** Per instruction, implementation begins only after this document is reviewed and approved.

**How to read this document:** every claim is evidence-based — a repository file:line citation, a live Supabase query result, or a live `npm`/`node` command run in this session. Anything I could not verify from this environment (Render dashboard/logs, Stripe/Twilio/SendGrid/Checkr/Persona/Google Cloud consoles, live production traffic) is explicitly labeled **UNVERIFIED** — never assumed compliant, per instruction. This document consolidates two originally-separate requests (a SOC 2 readiness audit and the required pre-implementation audit for a planned Integrations Center dashboard) into one evidence base, since their required investigation overlapped almost entirely.

**Companion document:** `docs/integrations-center-audit.md` — full per-integration profiles (Stripe, Twilio, SendGrid, Google Maps, Supabase, Checkr, Persona, HTAF donations, OpenAI, Render, GitHub Actions). This report's Security Review references it rather than repeating the same evidence twice.

**Builds on:** `docs/production-hardening-phase1-audit.md` (2026-07-31) and `docs/production-incidents.md` (running log). Every finding below either reconfirms, updates, or extends those documents — prior findings are not silently re-derived, they're explicitly marked as "reconfirmed unchanged" or "new since" throughout.

---

## 1. Scores

**Methodology, stated plainly so the numbers aren't a black box:** each score starts at 100 and is reduced by open findings in that category, weighted by severity (P0 −15, P1 −6, P2 −2, P3 −0.5), floored at 0. Any category where a majority of its underlying controls are **UNVERIFIED** (not just "not found") is additionally capped — an unverified control is not a passing one. These are diagnostic numbers to prioritize work, not a certification score; no auditor would accept a self-graded number in place of evidence, which is why every score below is followed immediately by the findings driving it.

| Category | Score | Primary drivers |
|---|---|---|
| **Overall Production Readiness** | **27 / 100** | Driven down by Security (below) — an app moving money and PII cannot be scored higher than its weakest gate, and multiple unauthenticated data/payment exposure paths are live today. |
| **Security** | **12 / 100** | 8 confirmed P0 findings (§3), most reachable by anyone with no authentication at all, several forming direct chained-fraud paths (payment methods) or identity-integrity bypasses (Persona). |
| **Reliability** | **58 / 100** | Real dispatch retry/redispatch/offer-expiry logic exists and is tested; CI is minimal (no lint, no `npm audit` step, no schema-drift check); no monitoring/alerting stack found (UNVERIFIED/NOT FOUND); backup/DR posture is entirely UNVERIFIED. |
| **Compliance Readiness (SOC 2)** | **18 / 100** | Active IDOR/access-control gaps directly contradict the Security and Confidentiality trust-service criteria; audit logging exists and is broadly good but has inconsistent PII-hashing; Availability and Processing Integrity have real UNVERIFIED gaps (backup/DR, monitoring). This number reflects "not yet on a path to SOC 2 readiness," not "close." |
| **Operational Maturity** | **47 / 100** | Feature-flag infrastructure exists (two mechanisms, not consolidated); background sweeps exist behind flags; no formal monitoring/alerting/on-call process found; deployment is a standard git-push-to-Render flow with no schema-drift or rollback tooling. |
| **Integration Readiness** (for the planned dashboard specifically) | **24 / 100** | Most integrations currently expose only a boolean "configured" signal (`/api/health` already does this) with no live/test-mode detection, no webhook health history, no usage/cost tracking, and two "integrations" (Persona, Checkr) that are implemented server-side but never actually callable from any UI today. |

---

## 2. Finding format

Every finding below includes: **Evidence** (file:line or live query), **Business impact**, **Technical impact**, **Recommended remediation**, **Estimated effort**, **Rollback considerations**. Findings are grouped P0→P3. Within each severity, findings are numbered independently (P0-1, P1-1, etc.) for reference in the roadmap (§8).

---

## 3. P0 — Launch blockers

### P0-1. Rider-facing API has no authentication anywhere — systemic

**Evidence:** `lib/riderAuth.js` (session-token signing/verification) and `POST /api/rider/session/start|verify|logout` exist and work, but **no route anywhere in `server.js` calls `requireRider` or checks the rider session cookie** — confirmed by exhaustive grep; the only reference to `requireRider` in the entire repository is a forward-looking code comment (`lib/riderAuth.js:103`) describing planned work. Every one of the following routes trusts a client-supplied `riderId`/`rider_id` with zero session check:
- `GET /api/riders/:id/readiness` — server.js:8556
- `GET /api/rider/rides`, `GET /api/rider/deliveries` — server.js:11427, 11438
- `GET /api/rider/rides/:rideId` — server.js:11449 (checks `ride.rider_id === riderId`, but both values are client-supplied)
- `GET/POST/DELETE /api/rider/saved-places[/:id]` — server.js:11681, 11705, 11742
- `POST /api/rider/photo` — server.js:13977

This is a reconfirmation of the P0 first identified in `docs/production-hardening-phase1-audit.md` §5.1 (2026-07-31) — **unchanged as of this audit (2026-08-01)**, despite rider-session infrastructure having since been built (merged PRs #89–#91).

**Business impact:** any rider's saved addresses, ride/delivery history, and profile photo can be read or overwritten by anyone who knows or enumerates a `riderId`. This is a direct, reportable privacy incident under most state breach-notification laws if exploited, and a disqualifying finding for any SOC 2 Security or Confidentiality assessment.

**Technical impact:** full read/write IDOR across the rider data surface; riderIds observed in this session (`RIDER-XXXXXXXXXX` format) are not proven cryptographically unguessable.

**Recommended remediation:** build `requireRider` middleware using the already-built `lib/riderAuth.js` primitives, and migrate each route above to use `req.rider.id` instead of a client-supplied value, exactly as `requireDriver` already does correctly for the driver surface. This work was already scoped and design-approved (`docs/rider-auth-design-proposal.md`) and paused pending a manual SMS/email login test — that test should be the immediate next step, not new design work.

**Estimated effort:** Medium-High (1 focused PR per route group, each with its own IDOR regression test, per the already-agreed phased plan) — the design and token infrastructure are done; this is route-by-route migration + testing, roughly 3–5 PRs.

**Rollback:** Each migrated route should ship behind the same fail-safe pattern already used elsewhere in this codebase (a `system_flags` kill-switch, e.g. `rider_auth_enforced`), so any single route's migration can be disabled instantly without a deploy if it breaks a legitimate client. Do not remove the (broken) fallback until the full IDOR regression suite passes against the enforced path.

---

### P0-2. Payment-method IDOR chain — read, delete, and charge against another rider's real card

**Evidence:**
- `GET /api/rider/payment-methods` (server.js:9925) — no auth; returns real Stripe payment-method IDs (`pm_...`), brand, and last4 for any `riderId` query param.
- `DELETE /api/rider/payment-methods/:paymentMethodId` (server.js:9962) — no auth; verifies the PM belongs to the *supplied* `riderId`'s Stripe customer, never that the caller *is* that rider.
- `POST /api/rides/payment-intent` (server.js:10018) — `ownsPaymentMethod()` verifies a supplied `payment_method_id` belongs to the supplied `rider_id`, never that the caller is that rider. Chained with the leak above: an attacker retrieves a victim's real `pm_...` ID, then submits it with the victim's `rider_id` to create a PaymentIntent chargeable against the victim's real saved card, for a ride the attacker controls.

**Business impact:** direct financial fraud against real riders' payment methods — this is the single most severe finding in this audit given it involves real money movement, not just data exposure. A single exploited instance is a Stripe dispute, a PCI/financial-fraud incident, and a trust-destroying event for the platform.

**Technical impact:** the attacker doesn't need to compromise Stripe at all — Stripe's own verification (`ownsPaymentMethod`) is being satisfied honestly, because the identity binding it relies on (`rider_id`) is entirely client-supplied and unverified.

**Recommended remediation:** part of P0-1's fix (require an authenticated `req.rider.id` and never read `rider_id`/`riderId` from the request body for these three routes) — this finding does not need separate infrastructure, but should be prioritized as the very first route group migrated given its severity.

**Estimated effort:** Low-Medium once P0-1's `requireRider` middleware exists — these three routes are a natural first PR.

**Rollback:** Same kill-switch pattern as P0-1.

---

### P0-3. Persona identity-verification bypass — attacker can bind their own verification to a victim's account

**Evidence:** `POST /api/persona/inquiry` (server.js:6994) accepts a client-supplied `user_id`/`user_type` with no auth. The Persona webhook (server.js:7254, `verifyPersonaSignature`) writes `persona_verified`/`persona_status` keyed only by the inquiry's `reference-id`, which was set to whatever `user_id` the (unauthenticated) inquiry-creation call supplied.

**Business impact:** this is a genuine identity-integrity failure, not just a data leak — it means "this driver's identity was verified" can become **false** in the exact system meant to guarantee it's true, with direct rider-safety implications (an unqualified or malicious individual's account marked identity-verified) and direct legal/insurance exposure if a rider is harmed by a driver whose verification was falsified this way.

**Technical impact:** low complexity to exploit — one unauthenticated POST plus completing Persona's own flow with the attacker's real (but irrelevant) documents.

**Recommended remediation:** `POST /api/persona/inquiry` must require the caller to be authenticated as the `user_id` they name (driver session for a driver, rider session for a rider) before creating an inquiry. Note this is currently moot in practice because **no page in the codebase actually calls this route successfully today** (see `docs/integrations-center-audit.md` → Persona) — `driver-signup.html`'s Persona button is a stub, and `rider-dashboard.html`'s calls a nonexistent route. Fix the auth gap as part of the same work that wires this up for real (already tracked as an open item in `docs/production-incidents.md`, 2026-07-30 entry).

**Estimated effort:** Low (auth check) + Medium (the separately-tracked "actually wire Persona into onboarding UI" work, which was already scoped and not yet built).

**Rollback:** N/A — route is not currently reachable from any UI; fixing it and wiring it up should ship together, gated by `ENABLE_PERSONA` (already exists).

---

### P0-4. Unauthenticated live-ride data exposure

**Evidence:**
- `GET /api/rides/:id/status` (server.js:11031) — no auth; returns pickup/dropoff addresses, driver name/phone/vehicle, live driver GPS coordinates, delivery PIN, and tip amount for any `rideId`.
- `GET /api/rides/:id/stream` (server.js:14500) — no auth; opens a live SSE feed of ride-stage/location events for any `rideId`.

**Business impact:** ride IDs are shared in URLs (e.g. deep links, "Open Live Tracking" buttons) and are not designed to be secret — this is a real, practically exploitable exposure of PII and safety-relevant data (a stranger tracking a rider's live location and driver's identity in real time).

**Technical impact:** no authentication of any kind on either route.

**Recommended remediation:** require the caller to be either the ride's rider (authenticated, once P0-1 ships) or its assigned driver (already has `requireDriver` infrastructure); a scoped "read-only tracking token" issued at ride-request time is a reasonable alternative if a fully-unauthenticated share link is a genuine product requirement (e.g., "share my trip with a friend") — that should be a deliberate, separately-issued token, not the raw ride ID.

**Estimated effort:** Medium — needs a product decision on whether trip-sharing is a real feature to preserve in some form, then implementation.

**Rollback:** Kill-switch pattern as above.

---

### P0-5. Safety-system spoofing — fabricated 911 alerts and incident reports

**Evidence:** `POST /api/safety/911` (server.js:18102) and `POST /api/safety/report` (server.js:18262) accept an arbitrary `ride_id`/`rider_id`/`user_id` with no auth, and broadcast/persist the alert attributed to that identity.

**Business impact:** a false-flag or denial-of-service vector against the platform's own safety escalation pipeline — real ops/admin attention (and potentially real emergency response coordination) can be triggered by a completely fabricated event attributed to a real person who never filed it.

**Technical impact:** trivial to exploit; no auth of any kind.

**Recommended remediation:** require rider or driver session auth (whichever is filing) before accepting either route; the identity in the alert should come from the authenticated session, never the request body.

**Estimated effort:** Low-Medium, depends on P0-1's rider-auth infrastructure for the rider-filed case; driver-filed case can use existing `requireDriver` today.

**Rollback:** Standard kill-switch.

---

### P0-6. Push-notification hijacking

**Evidence:** `POST /api/push/subscribe` (server.js:11552) accepts `owner_type`/`owner_id` with no auth; `sendPushNotification()` (server.js:2897) later pushes to every subscription matching that `owner_id`.

**Business impact:** an attacker can silently begin receiving another rider's or driver's ride-status/dispatch notifications — a real, if lower-severity, privacy and operational-integrity issue (e.g., the attacker learns a victim's ride timing/status).

**Technical impact:** trivial; no auth.

**Recommended remediation:** bind the subscription to the authenticated rider/driver session, not a client-supplied owner ID.

**Estimated effort:** Low, once P0-1's rider-auth exists (driver side can use `requireDriver` today).

**Rollback:** Standard kill-switch.

---

### P0-7. HTAF application-status enumeration by email

**Evidence:** `GET /api/foundation/applications/by-email` (server.js:11790) — no auth; returns HTAF application status/program type/dates for any submitted email with no proof of inbox control.

**Business impact:** enumerable disclosure of who has applied to a nonprofit medical-transportation assistance program and their approval status — this is sensitive personal/medical-adjacent information class (HTAF's own program concerns transportation assistance tied to medical need) and a real privacy exposure distinct from ordinary account data.

**Technical impact:** trivial; no auth, no rate-limit-driven proof of ownership found for this specific pattern.

**Recommended remediation:** require a short-lived, emailed verification code (already-built infrastructure exists elsewhere in this codebase, e.g. `createVerificationRecord`/`verifyCode`) before returning status by email, or require this to be looked up only via the private `application_code` the applicant already receives (that endpoint, `GET /api/foundation/status/:code`, is correctly a secret-lookup pattern today).

**Estimated effort:** Low — reuse existing OTP-by-email infrastructure.

**Rollback:** N/A, additive.

---

### P0-8. `riders` table RLS policy is misconfigured — grants unrestricted access to `public`, not `service_role`

**Evidence — CONFIRMED live, not assumed** (this closes the item `docs/production-hardening-phase1-audit.md` §5.2 flagged as needing "a 30-second confirmation query" and left open):

```sql
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in ('riders','drivers');
```
```
riders:  "Allow service role full access"  PERMISSIVE  roles={public}       cmd=ALL  qual=true   with_check=true   <-- misconfigured
riders:  "deny_all_riders"                 PERMISSIVE  roles={public}       cmd=ALL  qual=false  with_check=null  <-- inert (see below)
riders:  "service_role_riders"             PERMISSIVE  roles={service_role} cmd=ALL  qual=true   with_check=true  <-- correct
drivers: "deny_all_drivers"                PERMISSIVE  roles={public}       cmd=ALL  qual=false  with_check=null  <-- correctly denies
drivers: "service_role_drivers"            PERMISSIVE  roles={service_role} cmd=ALL  qual=true   with_check=true  <-- correct
```

Postgres RLS combines multiple **PERMISSIVE** policies with **OR**. On `riders`, `"Allow service role full access"` is scoped to `roles={public}` (i.e., every role: `anon`, `authenticated`, and `service_role` alike), not `service_role` as its name implies, and unconditionally evaluates `true`. Because permissive policies OR together, this one policy alone grants **unrestricted full CRUD access to every row in `riders`** to any Postgres role — including `anon` — regardless of what `deny_all_riders` says, since `OR(true, false) = true`. `deny_all_riders` is completely inert on this table; it can never block anything while the misnamed policy exists. **The `drivers` table does not have this extra policy and is correctly locked down** (only `service_role` can access it; `anon`/`authenticated` are correctly denied by `deny_all_drivers`, which is *not* inert there because nothing else grants `public` access).

**Business impact:** this app's own backend never triggers this bug (it connects with the `service_role` key, which bypasses RLS entirely regardless of policies) — so this is **not confirmed to be currently reachable from any client-facing code path found in this audit** (the Supabase anon/publishable key was not found embedded anywhere in `public/*.html`). However, RLS is specifically the last line of defense for exactly the scenario where a key leaks, a future engineer adds client-side Supabase usage assuming RLS protects them (a completely standard and expected assumption in the Supabase ecosystem), or someone queries the project directly with a lower-privileged key from the Supabase dashboard. As configured, that defense is not just weak — it's actively broken specifically for the one table holding full rider PII, contact info, and payment linkage.

**Technical impact:** if ever reached with anything other than the `service_role` key, full unrestricted read/write/delete on the entire `riders` table.

**Recommended remediation:** drop the `"Allow service role full access"` policy on `riders` (its name suggests it was *meant* to be `TO service_role`, duplicating the already-correct `service_role_riders` policy) — do not apply blindly; verify no other code path or Supabase-dashboard-configured API consumer relies on this specific policy name first (the standard caution for any RLS change, per the Phase 1 audit's own guidance on this exact table).

**Estimated effort:** Low (one migration, `DROP POLICY`) — but requires the "apply to a Supabase branch first, test reads/writes there" caution already documented in the Phase 1 audit §9, since RLS changes can silently return zero rows instead of erroring if done wrong.

**Rollback:** `CREATE POLICY` to restore if anything unexpectedly breaks; recommend testing on a Supabase branch first per the existing MCP tooling.

---

## 4. P1 — Must fix before public launch

| # | Finding | Evidence | Business impact | Technical impact | Remediation | Effort | Rollback |
|---|---|---|---|---|---|---|---|
| P1-1 | `POST /api/driver/offers/:offerId/decline` has no ownership check — unlike its `/accept` sibling | server.js:12060 (compare server.js:11828, which correctly checks `offer.driver_id !== driverId`) | Any authenticated driver can decline an offer never sent to them, forcing unwanted redispatch | Requires only a valid (any) driver session + a guessed/known offerId | Add the same `offer.driver_id !== driverId` → 403 check `/accept` already has | Low (few lines + 1 test) | N/A, pure correctness fix |
| P1-2 | Checkr and Persona webhook signature verification **fail open** when the secret is unset — unlike Stripe, which fails closed | `verifyCheckrSignature`/`verifyPersonaSignature`, `server.js:7843-7887`/`7208-7252`: `if (!SECRET) { return true; }` | An unconfigured webhook secret silently accepts *any* unsigned payload as genuine, able to mark a driver's background check "clear" or identity "verified" | Direct control-integrity gap on two of three third-party verification signals this platform trusts for driver eligibility | Change both to fail closed (`return false`/503) when the secret is unset, matching Stripe's pattern | Low | N/A, safety fix; verify secrets are actually configured before flipping (would otherwise silently start rejecting real webhooks) |
| P1-3 | `ADMIN_SESSION_SECRET`/`DRIVER_SESSION_SECRET` fallback chains can resolve to an empty string with no fail-closed guard | server.js:191-227; confirmed no `if (!ADMIN_SESSION_SECRET...)` guard exists, unlike `RIDER_SESSION_SECRET`/`RIDE_QUOTE_SECRET` which do | An empty-string HMAC key still signs "valid" tokens if every fallback in the chain is unset | Same class of risk the rider-session design explicitly avoided by giving `RIDER_SESSION_SECRET` no fallback at all | Add the same fail-closed 503 guard already used for rider sessions/ride quotes | Low | N/A, safety fix |
| P1-4 | Global error handler + 4 integration boundaries leak raw internal error text (including potential PII from Postgres constraint-violation messages) to the **client** whenever `NODE_ENV !== "production"` | server.js:20166-20246 (global handler), 3949-3991 (HTAF), 7100-7114 (Persona), 7735-7749 (Checkr), 10185-10199 (Stripe) — all gated by `IS_PRODUCTION = NODE_ENV === "production"` (server.js:51), a **fail-open** default | A staging/preview deploy, or any environment where `NODE_ENV` is unset/misspelled, serves raw internal errors — including a colliding rider's real email/phone from a duplicate-signup Postgres error — directly in an API response | Systemic: one flag default drives 5 leak points | Change the default assumption: treat "not explicitly `development`/`test`" as production-strict, rather than "not explicitly `production`" as safe to leak | Medium (one shared helper + audit all 5 call sites) | N/A, safety fix |
| P1-5 | Raw OTP verification code + full phone number logged to console when SMS sending is skipped | server.js:2694-2716 (`sendSms` skip-log) + 6630-6640 (call site embedding the code in the SMS body) | Anyone with server console/log access (Render logs) can read live OTP codes whenever Twilio is disabled/misconfigured — a real account-takeover vector in a misconfigured or staging environment | — | Log only a boolean ("SMS skipped") and a masked phone number, never the code or full number | Low | N/A |
| P1-6 | `riders` RLS misconfiguration | See P0-8 — listed here too since remediation effort is identical and low; kept as P0 above given worst-case impact severity | — | — | — | — | — |
| P1-7 | Persona and Checkr are fully implemented server-side but **never successfully callable from any page** | `docs/integrations-center-audit.md` → Persona/Checkr sections; driver-signup.html's Persona button is a stub; rider-dashboard.html's Persona button calls a nonexistent route (`/api/riders/start-persona`); no page calls `/api/checkr/start` | Every driver/rider onboarding funnel dead-ends at identity/background verification — this is a **product-blocking**, not just security, gap; per `docs/production-incidents.md` (2026-07-30), real applicants have been stuck for weeks | Onboarding cannot complete for any real user today | Wire the existing, working backend routes into real UI flows (already scoped as open work in the incident log) | Medium-High | N/A, additive feature work |
| P1-8 | Driver-signup SMS-verify buttons (web and mobile) call server routes that don't exist | `public/driver-signup.html:1921,2013` → `/api/drivers/verify-sms`, `/api/drivers/resend-sms`; `src/screens/DriverSignupScreen.js:82,124` → `/api/driver/verify-sms`, `/api/driver/resend-sms-verification` — none exist in `server.js` | Driver phone verification via this specific button 404s in production today | Dead frontend/backend mismatch, distinct from the Twilio-path duplication below | Either implement the missing routes or repoint these buttons at the working `/api/verify/sms/*` routes | Low-Medium | N/A |
| P1-9 | Test QA database records still live and unresolved | `docs/production-hardening-phase1-audit.md` §3 (`RIDER-QAETATEST1`, `DRIVER-QAETATEST1`, `driver_1`/"Test Driver"); confirmed still referenced client-side in `public/driver.html:14-15`, `public/driver-wallet.html:38`, `public/test-earnings.html:22-23,39`, `public/autonomous-test.html:26-27` | Inflates admin-visible rider/driver counts; indistinguishable from real accounts in the admin dashboard | — | Awaiting explicit owner approval per prior instruction — **do not touch without sign-off** (see §7 cleanup appendix) | Low once approved | Straightforward delete once confirmed non-production data |
| P1-10 | Unhashed rider PII written to `audit_logs` via a legacy/duplicate verification path | server.js:6366,6524,6642,6808,18480,18641 — `actor_id`/`metadata` carries a raw phone/email, unlike `lib/riderAuth.js`'s `hashIdentifier()` pattern correctly used by the main rider-login flow (server.js:5423,5466) | Inconsistent PII-handling standard in the very table meant to be the auditable system of record | Two different practices for the same data class in one file | Apply `hashIdentifier()`/`hashLoginDestination()` to these 6 call sites for consistency | Low | N/A |
| P1-11 | CI has no `npm audit`, no lint, no schema-drift check; previously-recorded task history claims Playwright tests were added, but none exist in the repo today | `.github/workflows/ci.yml` (read in full — 3 steps: `npm install`, `node -c server.js`, `npm test`); repo-wide search found zero Playwright files | Regressions in dependency vulnerabilities or schema drift are not caught automatically; a documented discrepancy (were Playwright tests removed, or never actually committed?) is unresolved | — | Add `npm audit --omit=dev` and a lint step to CI (both currently pass with 0 issues, so this is a low-risk addition that locks in the current clean state); investigate the Playwright discrepancy | Low | N/A, additive |
| P1-12 | Backup and disaster recovery — **UNVERIFIED** | No backup schedule, restore procedure, or recovery documentation found anywhere in the repository; no tool available in this session to query Supabase's actual backup/PITR configuration or plan tier | Cannot state whether the production database is protected against data loss, or how long a restore would take, at all | — | Obtain and document: current Supabase plan tier, backup frequency/retention, whether PITR is enabled, and a written, tested restore procedure | Low to document once the plan tier is known; Medium to actually test a restore | N/A |
| P1-13 | Monitoring and alerting — **UNVERIFIED / NOT FOUND** | No error-tracking SDK (e.g. Sentry), uptime monitor, or alerting integration referenced anywhere in `server.js`, `lib/*.js`, or `package.json` dependencies | No confirmed way anyone is notified of a production error or outage other than a human noticing | — | Stand up basic error tracking and uptime/alerting before public launch | Medium | N/A, additive |

---

## 5. P2 — Production hardening

| # | Finding | Evidence | Remediation | Effort |
|---|---|---|---|---|
| P2-1 | 3 tables with RLS fully disabled | Live Supabase check: `preferred_drivers`, `usage_counters` (app tables), `spatial_ref_sys` (PostGIS system table) — `rls_disabled_in_public` advisor, ERROR level | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + real policies (not blind enable — see Phase 1 audit §5.2 caution) | Low-Medium |
| P2-2 | 3 PostGIS `st_estimatedextent` overloads are `SECURITY DEFINER`, callable by `anon`/`authenticated` via `/rest/v1/rpc/` | Live Supabase advisor output (`anon_security_definer_function_executable` ×3, `authenticated_security_definer_function_executable` ×3) | `REVOKE EXECUTE` from `anon`/`authenticated` on these (built-in PostGIS functions, low practical risk since they return only a bounding-box estimate, not app data) | Low |
| P2-3 | `postgis` extension installed in `public` schema | Live advisor: `extension_in_public` | Move to a dedicated schema (requires care — used throughout driver-location/geo code) | Medium |
| P2-4 | 7 Postgres functions with mutable `search_path` | Live advisor: `apply_driver_compliance_override`, `apply_driver_contact_verification_override`, `dispatch_ride_atomic`, `drivers_sync_geog`, `increment_rider_session_version`, `increment_usage_counter`, `nearest_drivers`, `set_updated_at` (8 actually listed, prior audit found 7 — 1 new since, `increment_rider_session_version`, added by this session's rider-auth work) | `ALTER FUNCTION ... SET search_path = public` on each | Low, mechanical |
| P2-5 | `.gitignore` doesn't exclude `.env*` | `.gitignore` contains exactly one line, `node_modules/`; no `.env` currently exists in the repo, so nothing is leaked *yet* | Add `.env`/`.env*` to `.gitignore` before a local dev `.env` file is ever created | Trivial |
| P2-6 | Stripe has no runtime live/test-mode detection | Confirmed zero references to `sk_test_`/`sk_live_`/key-prefix checks anywhere in code; `docs/staging-stripe-test-mode-plan.md` handles this via human process only | Add a simple `STRIPE_SECRET_KEY.startsWith("sk_live_")` check, surfaced via `/api/health` and eventually the Integrations Center | Low |
| P2-7 | No OpenAI usage/cost tracking | Confirmed `completion.usage` is never read/stored anywhere; only cost controls are a 4-turn cap and a 20/min rate limit | Log `usage.total_tokens` per call to a lightweight table or the existing `ai_support_message` audit metadata | Low |
| P2-8 | No SendGrid bounce/suppression handling | Confirmed zero code references to bounce/suppress/unsubscribe for email | Add a SendGrid Event Webhook endpoint + suppression check before sending, if email deliverability becomes a concern | Medium |
| P2-9 | Two parallel feature-flag mechanisms (`system_flags` table vs. `ENABLE_*` env vars) not consolidated | Both confirmed live and in active use (4 `system_flags` rows + 13 `ENABLE_*` env flags) | Product/engineering decision on a single mechanism going forward; not urgent | Medium, deferred |
| P2-10 | Raw admin email used as unhashed `actor_id` in ~12 audit-log entries | Inconsistent with the hashing standard used for rider/driver PII elsewhere in the same file | Likely intentional (operator accountability) — needs an explicit policy decision, not an automatic fix | N/A (decision, not code) |
| P2-11 | Full raw error object logged (not `.message`) on `unhandledRejection`/`uncaughtException` | server.js:20260-20288 | Log `.message` + a truncated safe summary, consistent with every other error site in the file | Low |
| P2-12 | Postgres `error.details`/`error.hint` (can echo a colliding email/phone) logged server-side at 3 sites | server.js:2558-2576, 3291-3297, 10613-10641 | Log a generic "unique constraint violated" instead of the raw detail string | Low |
| P2-13 | Unauthenticated `/api/health` can surface raw Postgres error strings from table-existence checks | server.js:19019-19086 | Either gate behind admin auth or scrub error text to boolean-only before returning | Low |
| P2-14 | 3 major dependency versions behind on fast-moving SDKs (no known CVEs) | `openai` 4.104.0 → 7.3.0 (3 majors), `twilio` 4.23.0 → 6.0.2 (2 majors), `express` 4.22.2 → 5.2.1 (1 major) — see §6 | Plan a deliberate, tested major-version upgrade for each; not urgent absent a CVE, but a maintainability/enterprise-due-diligence concern | Medium-High per package |
| P2-15 | `rider_history_enabled` flag explicitly documented as a temporary interim measure pending rider auth, which has since partially shipped | server.js:17138-17144 comment | Revisit whether this can now be enabled, now that rider-session infrastructure exists (though P0-1 must close first — enabling this before rider auth is enforced would just add another IDOR surface) | Low to revisit, blocked on P0-1 |

---

## 6. Dependency & License Review

**Vulnerability scan:** `npm audit --omit=dev` → **0 vulnerabilities** (info/low/moderate/high/critical all zero) across 147 production, 319 dev, 29 optional dependencies (465 total).

**Declared production dependencies vs. actual usage:** all 8 (`@sendgrid/mail`, `@supabase/supabase-js`, `cors`, `express`, `openai`, `stripe`, `twilio`, `web-push`) have exactly one `require()` call each — none unused. `nodemailer` (previously flagged, high-severity CVE) is confirmed fully removed with zero residual references.

**Deprecated packages:** scanned all 409 unique installed package versions for a `deprecated` field in their `package.json` — **zero found**. Individually confirmed via `npm view <pkg>@<version> deprecated` for all 8 direct production dependencies — **none deprecated**.

**Abandoned packages:** no direct production dependency shows signs of abandonment (all 8 have current, actively-published major-version lines per npm registry lookups performed this session). A full abandonment check across all 409 transitive packages was not performed — recommend `npm outdated` review on a recurring cadence rather than a one-time check, since "abandoned" is a moving target.

**Outdated versions (no CVEs, but worth planning for):**

| Package | Current | Latest | Gap |
|---|---|---|---|
| `openai` | 4.104.0 | 7.3.0 | 3 major versions |
| `twilio` | 4.23.0 | 6.0.2 | 2 major versions |
| `express` | 4.22.2 | 5.2.1 | 1 major version |
| `@supabase/supabase-js` | 2.110.8 | 2.111.0 | Minor only |
| `stripe` | 22.3.2 | 22.4.0 | Minor only |

**License review — full scan of all 409 installed unique package/version combinations:**

| License | Count |
|---|---|
| MIT | 342 |
| ISC | 35 |
| BSD-3-Clause | 15 |
| Apache-2.0 | 7 |
| BlueOak-1.0.0 | 4 |
| BSD-2-Clause | 2 |
| CC-BY-4.0 | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |
| MPL-2.0 (`web-push`) | 1 |

**GPL/AGPL/LGPL (copyleft) packages found: zero.** **Packages with an unknown/missing license: zero.** Every dependency in this project uses a permissive license (MIT/ISC/BSD-family/Apache-2.0/BlueOak/0BSD/CC-BY) with the single exception of `web-push`'s MPL-2.0 (a weak-copyleft license that, per its own terms, only imposes source-disclosure obligations on modifications to MPL-licensed files themselves, not on this application's own code — using it as a dependency does not require this application to be open-sourced). **This is a clean result for enterprise licensing due diligence** — nothing in the current dependency tree would block an enterprise procurement/legal review on license grounds.

---

## 7. Security Review — cross-reference by topic

This section maps the P0–P2 findings above onto the specific topics requested, so nothing on the checklist is silently skipped.

| Topic | Status | Reference |
|---|---|---|
| Rider authorization | **Broken** — no enforcement anywhere | P0-1, P0-2, P0-4, P0-6 |
| Driver authorization | **Mostly correct** — `requireDriver` properly gates 17+ routes with real ownership checks (`ensureAssignedDriver`); one gap found | P1-1 |
| Admin authorization | **Correct** — all 32+ `/api/admin/*` routes gated by `requireAdmin`; the elevated-vs-ordinary tier split (`requireElevatedAdmin` for compliance overrides) verified correctly applied | No findings |
| Payment authorization | **Broken at the identity-binding layer** (Stripe's own checks pass honestly because the identity behind them is spoofable) | P0-2 |
| Webhook verification | Stripe: correct (fails closed). Checkr/Persona: **fail open** when secret unset | P1-2 |
| IDOR | 8 confirmed instances (P0), 1 partial (P1-1) | §3, §4 |
| Session management | Driver/admin sessions sound; rider sessions built but unused; two session secrets can silently become empty-string | P0-1, P1-3 |
| Environment variables | 60 vars inventoried, all traced to real usage (no dead config); no hardcoded secrets found anywhere in the repo | §7a below |
| Secrets handling | Clean — no hardcoded secrets, no `.env` committed; one gap: `.gitignore` doesn't protect against a future one | P2-5 |
| Logging | Broadly good discipline; one real OTP leak, one systemic fail-open error-detail leak | P1-4, P1-5 |
| File uploads | Driver/rider photo + delivery-proof uploads all go through Supabase Storage with a consistent upload→`getPublicUrl` pattern; no unrestricted file-type/size issue found in this pass (not exhaustively fuzz-tested) | Informational |
| Feature flags | Two mechanisms in active use, not consolidated; all `ENABLE_*` defaults reviewed, only `ENABLE_PERSONA`/`ENABLE_CHECKR`/`ENABLE_AI_SUPPORT` default `true` (inert without a matching API key present) | P2-9 |
| Service-role usage | App backend correctly uses the Supabase service-role key exclusively (bypasses RLS by design); this is why P0-8's RLS bug hasn't been hit by the app's own traffic | P0-8 |
| Supabase RLS | 3 tables fully disabled (P2-1); 1 table (`riders`) has a live misconfigured policy (P0-8); 42 other tables correctly RLS-enabled with a safe deny-by-default (service-role-only) posture | P0-8, P2-1 |
| SECURITY DEFINER functions | 3 built-in PostGIS overloads callable by `anon`/`authenticated` | P2-2 |
| Database policies | See RLS above; `drivers` table's policy set is a good reference example of the correct pattern | P0-8 |
| Test accounts | 3 unresolved live QA records, still referenced in 4 client files | P1-9 |
| Audit logging | Broadly comprehensive (60 call sites reviewed, every ride/driver/admin/payment lifecycle event covered) with good hashed-identifier discipline in the primary rider-login flow; inconsistent in a legacy verification path | P1-10, P2-10 |
| Backup and recovery | **UNVERIFIED** | P1-12 |

### 7a. Environment variable inventory summary

60 distinct environment variables read via `server.js`'s `env()`/`envBool()`/`envNumber()` helpers (or `lib/pricing.js`'s independent, dependency-free equivalent) were individually traced to a real usage site — **zero dead config found**. Full table available in the underlying research; headline points:
- `RIDER_SESSION_SECRET` and `RIDE_QUOTE_SECRET` correctly have no fallback and fail closed (503) when unset — the right pattern.
- `ADMIN_SESSION_SECRET`/`DRIVER_SESSION_SECRET` do not have the same protection (P1-3).
- Two apparent "duplicate" variable pairs flagged by the prior audit (`PERSONA_TEMPLATE_ID_*`/`*_TEMPLATE_ID`, `TWILIO_FROM_NUMBER`/`TWILIO_PHONE_NUMBER`) were traced to both call sites and confirmed to be **intentional fallback-naming shims, not bugs** — closed, no action needed.
- Rate limiting was traced end-to-end and confirmed to genuinely branch on Upstash Redis being configured, falling back to in-process memory on missing config or any live Redis-call failure — closed, no action needed.

---

## 8. Operational Review

**Production services (as visible from code):** one Node/Express monolith (`server.js`, ~20,600 lines) serving both the API and 47+ static HTML pages, backed by one Supabase Postgres project (`orgahzncmzptljapqffj`, live, healthy, Postgres 17.6.1).

**Render deployment:** no Render-specific API calls, `render.yaml`, or `Procfile` found anywhere in the repo — confirmed this is a standard Node-buildpack deployment (`package.json`'s `"start": "node server.js"` + `"engines": {"node": "22.x"}` is the entire deployment contract). Current production commit/deployment status: **UNVERIFIED** — no access to the Render dashboard from this environment.

**Custom domains:** two confirmed from code (`harveytaxiservice.com`, `harveytransportationfoundation.com`, each with a `www.` variant), per `lib/corsOrigins.js` and `CANONICAL_HOST`/`FOUNDATION_HOST` env vars. Live DNS/certificate status: **UNVERIFIED**.

**Feature flags:** see P2-9. Full current inventory — `system_flags` table: `dispatch_paused` (off), `dispatch_eta_persistence_enabled` (off, staged rollout), `dispatch_route_api_enabled` (off, staged/cost-gated rollout), `offer_expiry_sweep_enabled` (off), `rider_history_enabled` (off, explicitly interim). `ENABLE_*` env vars: 13 total, defaults reviewed in §7a.

**Scheduled jobs / background sweeps:** all implemented as in-process `setInterval` loops (not `pg_cron`, which is available in the Supabase project's extension list but not installed/used) — e.g. the offer-expiry sweep (every 15s, gated off by default). This means a sweep's schedule resets on every deploy/restart and does not run across multiple instances without the same claim-based concurrency safety already correctly implemented (`.eq("status","pending")` atomic claims) — that safety mechanism was specifically verified sound in `docs/production-incidents.md`'s 2026-07-28 entry.

**Webhooks:** Stripe (signature-verified, fails closed), Checkr (fails open when unconfigured — P1-2), Persona (fails open when unconfigured — P1-2). No SendGrid or Twilio webhook endpoints exist.

**Health endpoints:** `GET /health`, `GET /api/health` (unauthenticated, reports per-integration boolean "configured" status — a real building block for the Integrations Center, see companion doc), `GET /api/system/status`. `GET /api/admin/config-check` (admin-gated, more detail).

**Monitoring / alerting / version reporting:** **UNVERIFIED / NOT FOUND.** No error-tracking, uptime-monitoring, or alerting SDK/integration found anywhere in `package.json` or the codebase. "Version reporting" exists only in the sense that `/api/health` reports boolean integration-configured status and boot logs print config state to stdout — there is no endpoint reporting the running git commit/build version.

**Deployment process:** standard git-push-to-`main` → presumably Render auto-deploy (per the domain/URL evidence in `docs/production-incidents.md`) — no staging environment, blue/green, or canary process found in the repository. CI (`.github/workflows/ci.yml`) runs on push/PR to `main` only: `npm install`, `node -c server.js`, `npm test`, on Node 20.x and 22.x. No lint, no `npm audit`, no schema-drift check (P1-11).

---

## 9. Cleanup Appendix — inventory only, nothing removed

Per instruction, this is a list for review and future sign-off, not an action taken.

**Obsolete/placeholder files (zero references, confirmed via repo-wide grep):**
- 11 root-level placeholder `*.json` files (`data.json`, `app.json`, `drivers.json`, `commands.json`, `messages.json`, `payments.json`, `gps-locations.json`, `vehicles.json`, `rides.json`, `missions.json`, `riders.json`, `dispatches.json`) — all still 2-byte `[]` content.
- `public/test-earnings.html`, `public/autonomous-test.html`, `public/mobility-os-prototype.html` — all still present, still unreferenced by any live page.
- Root `App.js` + `src/screens/*.js` + `src/config/api.js` — orphaned React Native-shaped skeleton, no `react`/`react-native` dependency in root `package.json`, cannot run as-is; a separate, real Expo project exists at `mobile/`.

**Legacy/duplicate pages — still present, still directly reachable via static hosting (not just disk clutter):** `admin.html`, `admin-login.html`, `login.html`, `admin-home.html`, `admin-account--deletion.html`, `admin-dispatch.html`, `admin-rider-approval.html`, `admin-verification.html`, `admin-support.html`, `dispatch.html`, `driver.html`, `av-control.html`, `pay.html`, `active-trip.html` — 14 files, none linked from any live navigation, but all served by `express.static` and reachable at their own URL by anyone who requests it directly. **This is a live exposure surface, not just dead disk space** — recommend prioritizing removal (or at minimum, an auth gate) above the other cleanup items.

**Unused integrations/dead code:**
- 2 unused Twilio Verify routes (`/api/auth/send-sms-code`, `/api/auth/verify-sms-code`) — explicitly documented as "unrelated, unused" in `docs/production-incidents.md`.
- Rider-side Twilio Verify login (`/api/rider/session/start`/`/verify`) — fully built, called by no page.
- `requireUser`/Supabase-Auth-based verification path — defined, attached to zero routes as primary middleware; reachable only as `requireDriver`'s third fallback branch, which nothing in the app's own sign-up flow can ever satisfy (no `signUp`/`signInWith*` call exists anywhere).

**Duplicate services:** two parallel feature-flag mechanisms (P2-9); the `PERSONA_TEMPLATE_ID_*`/`TWILIO_*_NUMBER` naming pairs (confirmed intentional, not true duplicates, closed).

**QA records (awaiting explicit sign-off, not touched):** `RIDER-QAETATEST1`, `DRIVER-QAETATEST1` (both `status: active`), and `driver_1`/"Test Driver" (also `active`/`approved`) — all three still live in the database and still referenced in client-side test pages.

**Unused environment variables:** none found — see §7a.

---

## 10. Prioritized Remediation Roadmap

**Immediate security fixes (this week, no product decision needed):**
1. Fail-closed Checkr/Persona webhook verification (P1-2)
2. Fail-closed `ADMIN_SESSION_SECRET`/`DRIVER_SESSION_SECRET` (P1-3)
3. Fix `POST /api/driver/offers/:offerId/decline` ownership check (P1-1)
4. Fix the `NODE_ENV`-driven error-detail leak, treat unknown environments as production-strict (P1-4)
5. Stop logging OTP codes/phone numbers on SMS-skip (P1-5)
6. Fix the `riders` RLS policy misconfiguration (P0-8), via a Supabase branch test first

**Public-launch blockers (must close before any general public/marketing launch):**
7. Build and enforce `requireRider` across every rider-facing route (P0-1) — the largest single item, already designed, resume the paused implementation plan
8. Payment-method IDOR chain closes as part of the above (P0-2)
9. Fix live-ride-status/stream exposure (P0-4) — needs a product decision on trip-sharing UX
10. Fix safety-alert spoofing (P0-5) and push-hijacking (P0-6)
11. Fix HTAF status-by-email enumeration (P0-7)
12. Resolve the Persona auth gap (P0-3) as part of actually wiring Persona/Checkr into onboarding (P1-7)
13. Document and verify backup/DR posture (P1-12) — cannot honestly claim launch-readiness while this is unverified
14. Stand up minimal monitoring/alerting (P1-13)
15. Resolve the 3 unresolved QA records with explicit sign-off (P1-9)

**Enterprise-readiness work (needed before enterprise partnership due diligence, not blocking a consumer launch):**
16. RLS hardening on the remaining 3 disabled tables + SECURITY DEFINER function lockdown (P2-1, P2-2)
17. Add `npm audit`/lint/schema-drift checks to CI (P1-11)
18. Add Stripe live/test-mode detection, OpenAI usage tracking, SendGrid bounce handling (P2-6, P2-7, P2-8) — direct prerequisites for a credible Integrations Center dashboard
19. Plan major-version upgrades for `openai`/`twilio`/`express` (P2-14)
20. Consolidate the two feature-flag mechanisms (P2-9)

**SOC 2 readiness work (specific to the trust-service criteria):**
21. Everything in "Public-launch blockers" above is also SOC 2 Security-criterion blocking — the criteria are not separable from basic access control.
22. Formal, written backup/DR procedure with a tested restore (Availability criterion) — P1-12.
23. Consistent PII-hashing in audit logs (Confidentiality/Privacy criteria) — P1-10.
24. A documented, approved data-retention and test-data policy (covers the QA-records question, P1-9, as a standing policy rather than a one-off cleanup).
25. Formal change-management evidence — this project's existing PR-per-change, reviewed-before-merge, tested convention is a genuine strength here and should be explicitly documented as the change-management control, not rebuilt.

**Future operational improvements (no urgency):**
26. Legacy-page removal (§9) once confirmed unused in practice.
27. Root `App.js`/`src/` vs. `mobile/` duplication resolution, once product intent is confirmed.
28. Consider `pg_cron` for background sweeps instead of `setInterval`, for resilience across restarts.
29. Version/build reporting on `/api/health` (git commit SHA), to make "what's actually deployed" verifiable without Render dashboard access.

---

**No implementation begins on any item above without separate review and approval, per instruction.**
