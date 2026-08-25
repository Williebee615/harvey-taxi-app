# P0 Security Remediation Plan

**Status: PLAN ONLY. No implementation, no code, no migrations, no configuration change.** Per instruction, no work begins on any item in this document until it is separately reviewed and approved. This document supersedes general SOC 2/cleanup/UI work as the active priority — no feature work, UI enhancements, cleanup, or further SOC 2 documentation should proceed until the P0s below are resolved.

**Source:** `docs/production-readiness-report.md` §3 (P0 findings) and §4 (P1-1, folded into this plan per instruction since it's part of the requested remediation sequence). Every finding below was **independently re-verified against the current codebase in this session** — the specific code was re-read line-by-line, not re-derived from the prior audit's summary. Live Supabase state (the RLS section) was re-queried directly, twice, via two different catalog-level methods, for the same reason.

---

## 1. Verification classification — required before any implementation

Per instruction: do not overstate certainty. Each finding is classified:
- **Confirmed** — I read the actual current code/live database state myself in this session and it matches the finding exactly.
- **Likely** — evidence strongly supports the finding but a piece of it depends on something I cannot directly observe (e.g., production traffic, a key's real-world distribution).
- **Unverified** — outside what this environment can check (Render, live traffic, browser devtools on the production domain, etc.).

| # | Finding | Classification | Basis |
|---|---|---|---|
| P0-1 | Rider API has no authentication anywhere | **Confirmed** | Re-read server.js:8556, 11427, 11438, 11449, 11681, 11705, 11742, 13977 directly this session. `requireRider` confirmed absent repo-wide (grep, zero matches in server.js or lib/). Several of these routes contain their own code comments plainly stating "there's no rider session to check against" (11479-11481) and "Rider routes in this app aren't behind a session auth middleware" (13970-13973) — the codebase documents this gap about itself. |
| P0-2 | Payment-method IDOR chain (read/delete/charge another rider's card) | **Confirmed** | Re-read server.js:9925-9960 (`GET /api/rider/payment-methods`, no auth check before calling `stripe.paymentMethods.list`), 9962-10010 (`DELETE .../:paymentMethodId`, no auth), and 10018-10119 (`POST /api/rides/payment-intent`, `ownsPaymentMethod()` at `lib/riderPayments.js:55-57` checks only `paymentMethod.customer === stripeCustomerId`, never caller identity) directly this session. The chain requires 3 real requests but no authentication step anywhere in it. |
| P0-3 | Persona identity-verification bypass | **Confirmed** (mechanism) / **Likely** (real-world consequence severity) | Re-read `POST /api/persona/inquiry` (server.js:6994-7030) — accepts `user_id` from the request body with zero auth check before creating a real Persona inquiry. The mechanism is confirmed; how severe an actual exploitation would be depends on whether an attacker would bother (low value target relative to effort) — still correctly P0 given it undermines the integrity of a safety-relevant control. |
| P0-4 | Unauthenticated live-ride status/stream exposure | **Confirmed** | Re-read `GET /api/rides/:id/status` (server.js:11031-11071) and `GET /api/rides/:id/stream` (server.js:14500-14533) — neither has any auth middleware or ownership check; both key purely off `req.params.id`. |
| P0-5 | Safety-system spoofing (911 + report) | **Confirmed** | Re-read `POST /api/safety/911` (server.js:18102-18174) and `POST /api/safety/report` (server.js:18262+) — both accept `ride_id`/`rider_id`/`user_id` from the request body with zero auth. |
| P0-6 | Push-notification hijacking | **Confirmed** | Re-read `POST /api/push/subscribe` (server.js:11552-11598) — accepts `owner_type`/`owner_id` from the request body with zero auth before upserting a push subscription keyed on that owner. |
| P0-7 | HTAF application-status enumeration by email | **Confirmed** | Re-read `GET /api/foundation/applications/by-email` (server.js:11790-11814) — accepts `email` as a query parameter with zero proof of inbox control before returning application status. |
| P0-8 | `riders` RLS policy misconfigured (scoped to `public`, not `service_role`) | **Confirmed** (the misconfiguration itself and the mechanism by which it would be reachable) / **Unverified** (whether it is currently being exploited, or whether the anon key has ever left this codebase) | See §3, full dedicated section below — re-verified twice this session via two independent SQL queries against `pg_policies` and the lower-level `pg_policy` catalog. |
| (P1-1, folded in) | `POST /api/driver/offers/:offerId/decline` missing the ownership check its `/accept` sibling has | **Confirmed** | Re-read both handlers side by side this session: `/accept` (server.js:11828-11906) has an explicit `if (driverId && offer.driver_id !== driverId) return fail(..., 403)` block; `/decline` (server.js:12060-12122) has no equivalent check anywhere in its body. |

**No finding in this plan is downgraded from the prior report based on this re-verification pass — every one held up under direct re-reading.**

---

## 2. Per-finding remediation detail

### P0-1 — Rider API has no authentication

- **Affected routes:** `GET /api/riders/:id/readiness`, `GET /api/rider/rides`, `GET /api/rider/deliveries`, `GET /api/rider/rides/:rideId`, `GET /api/rider/saved-places`, `POST /api/rider/saved-places`, `DELETE /api/rider/saved-places/:id`, `POST /api/rider/photo`.
- **Root cause:** `lib/riderAuth.js` (session-token sign/verify) and `POST /api/rider/session/start|verify|logout` were built and merged, but no `requireRider` middleware was ever written, and none of the above routes were migrated to use one. They still trust a client-supplied `riderId`/`rider_id` exactly as they did before rider-session infrastructure existed.
- **Exploit scenario:** an attacker who knows or enumerates a `riderId` (format `RIDER-XXXXXXXXXX`, not proven cryptographically unguessable) calls any of the above with that ID as a query/body parameter and receives or mutates that rider's data — no credential of any kind required.
- **Business impact:** full read/write PII exposure across every rider's saved addresses, ride/delivery history, and profile photo; a reportable privacy incident if exploited; disqualifying for SOC 2 Security/Confidentiality criteria.
- **Technical impact:** total loss of confidentiality and integrity for rider-owned data at the application layer (the RLS layer is a separate, equally real gap — see P0-8 — but this app's own backend bypasses RLS by design, so this finding is independent of that one).
- **Remediation approach:** build `requireRider` in `server.js` mirroring `requireDriver`'s structure (verify the signed session cookie via `lib/riderAuth.js`'s `verifyRiderSession`, check `session_version` currency, attach `req.rider = { id, ... }`), then migrate each route above to read `req.rider.id` and stop reading `riderId`/`rider_id` from the request. Ship behind a `system_flags` kill-switch (e.g. `rider_auth_enforced`) so any single route's migration can be reverted instantly without a deploy.
- **Regression tests:** extract the middleware's core decision logic (token valid? session_version current? not expired?) into a pure function in `lib/riderAuth.js` (the primitives already exist — `verifyRiderSession`, `isSessionVersionCurrent`) and unit-test it directly, matching this repo's established pattern (`lib/riderAuth.test.js` already has 112 tests for the token layer). Add one cross-rider IDOR regression test per migrated route (Rider A's session cannot read/write Rider B's data) as its own PR ships, not deferred to the end.
- **Rollback:** kill-switch flip, no deploy needed, per the pattern already used for `rider_history_enabled`.
- **Estimated effort:** Medium-High — the hard design/token work is already done (docs/rider-auth-design-proposal.md, approved); this is disciplined route-by-route migration, roughly 3-4 separate PRs (see §4 sequencing).

### P0-2 — Payment-method IDOR chain

- **Affected routes:** `GET /api/rider/payment-methods`, `DELETE /api/rider/payment-methods/:paymentMethodId`, `POST /api/rides/payment-intent` (the `payment_method_id`/`rider_id` attachment branch specifically, server.js:10070-10119).
- **Root cause:** identical to P0-1's root cause (no `requireRider`), compounded by `ownsPaymentMethod()` (`lib/riderPayments.js:55-57`) checking only that a payment method belongs to *a* rider's Stripe customer — never that the caller *is* that rider.
- **Exploit scenario:** attacker calls `GET /api/rider/payment-methods?riderId=<victim>` (no auth) to obtain the victim's real `pm_...` ID; either `DELETE`s it directly, or submits it with `rider_id=<victim>` to `POST /api/rides/payment-intent`, which attaches the victim's real card to a PaymentIntent the attacker controls (`ownsPaymentMethod` passes honestly, because the identity behind the check is spoofable, not because Stripe is misconfigured).
- **Business impact:** direct financial fraud against real riders' saved cards — the single most severe finding in scope; a Stripe dispute and trust-destroying incident if exploited even once.
- **Technical impact:** the attacker never needs to defeat Stripe's own security — they satisfy it honestly by supplying a real, if stolen, association.
- **Remediation approach:** part of P0-1's fix — once `requireRider` exists, these three routes read `req.rider.id` exclusively and never accept `rider_id`/`riderId` from the request body/query for this purpose.
- **Regression tests:** a test proving `GET /api/rider/payment-methods` returns 401/403 (not another rider's data) when called with a valid session for Rider A and a `riderId` query param naming Rider B; same shape for `DELETE` and for the `payment-intent` attachment branch.
- **Rollback:** same kill-switch as P0-1 (this is not a separate flag — see §4, this ships as part of the P0-1 PR sequence's first, highest-priority route group).
- **Estimated effort:** Low-Medium once `requireRider` exists — recommend this be the very first route group migrated, given severity.

### P0-3 — Persona identity-verification bypass

- **Affected routes:** `POST /api/persona/inquiry`.
- **Root cause:** the route accepts `user_id`/`user_type` from the request body with no check that the caller is authenticated as that user.
- **Exploit scenario:** attacker POSTs `{user_type:"driver", user_id:"<victim>", email:<attacker's own>, ...}`; completes Persona's real identity flow with their own documents; Persona's webhook (keyed only by `reference-id`, i.e. the `user_id` from the original request) marks the **victim's** account `persona_verified: true`.
- **Business impact:** a false identity-verification record on a real account — a safety-integrity failure with legal/insurance exposure if a rider is later harmed by a driver whose verification was falsified this way.
- **Technical impact:** low complexity to exploit.
- **Remediation approach:** require the caller to present a valid driver session (`requireDriver`, already exists) or rider session (`requireRider`, once built) matching the `user_id`/`user_type` named in the request, before creating the inquiry. Note this route is **currently unreachable from any live UI** (see `docs/integrations-center-audit.md` → Persona) — recommend fixing the auth gap in the same PR that finally wires Persona into real onboarding, not as a standalone change to a currently-dead endpoint.
- **Regression tests:** a test proving an authenticated driver cannot create an inquiry naming a different driver's `user_id`.
- **Rollback:** N/A — route has no current caller; shipping the fix and the wiring together means there's nothing to roll back to.
- **Estimated effort:** Low (the auth check) + Medium (the separately-scoped "wire Persona into onboarding" work).

### P0-4 — Unauthenticated live-ride status/stream exposure

- **Affected routes:** `GET /api/rides/:id/status`, `GET /api/rides/:id/stream`.
- **Root cause:** both key purely off the `rideId` URL parameter with no session check of any kind.
- **Exploit scenario:** anyone who obtains or guesses a `rideId` (shared in deep links, e.g. `?ride_id=...`) can read full pickup/dropoff addresses, driver name/phone/vehicle, live GPS, delivery PIN, and tip amount, or open a live SSE feed of the same.
- **Business impact:** real-time location/PII exposure of both rider and driver to a stranger — a safety-relevant privacy failure, not just a data leak.
- **Technical impact:** none of Stripe/Persona/Checkr's complexity here — this is a pure missing-auth-check finding.
- **Remediation approach:** requires a product decision first (not a pure engineering call): is unauthenticated trip-sharing (e.g., "share my ride with a friend") a real, wanted feature? If yes, replace the raw `rideId` with a separately-issued, scoped, expiring share token (a natural extension of the `lib/rideQuote.js` signed-token pattern already in this codebase). If no, require the caller to be the ride's authenticated rider or its assigned driver.
- **Regression tests:** a test proving neither route returns ride data for a caller who is not the ride's rider/driver (or, if a share-token path ships, that only a valid, unexpired, ride-scoped token works).
- **Rollback:** kill-switch, same pattern.
- **Estimated effort:** Medium — gated on the product decision above before engineering estimate is final.

### P0-5 — Safety-system spoofing (911 + report)

- **Affected routes:** `POST /api/safety/911`, `POST /api/safety/report`.
- **Root cause:** both accept `ride_id`/`rider_id`/`user_id` from the request body and persist/broadcast them as the alert's attributed identity with no auth check.
- **Exploit scenario:** anyone submits a fabricated 911 alert or incident report naming a real rider/ride, triggering real ops/admin attention (and potentially real emergency-response coordination) for an event that never happened.
- **Business impact:** false-flag/denial-of-service against the platform's own safety escalation pipeline; real reputational and potentially legal exposure if a fabricated report is acted on and creates harm or wastes emergency-response resources.
- **Technical impact:** trivial to exploit; no auth of any kind today.
- **Remediation approach:** require an authenticated rider (`requireRider`, once built) or driver (`requireDriver`, exists today) session; the identity attributed to the alert must come from the session, never the request body.
- **Regression tests:** a test proving the persisted `rider_id`/`submitted_by` always matches the authenticated caller, never a body-supplied override.
- **Rollback:** kill-switch, same pattern. **Caution specific to this pair**: because this is a safety-critical path, recommend an explicit manual verification step (a real test submission in a staging environment) before flipping the flag in production, not just a passing test suite.
- **Estimated effort:** Low-Medium — the driver-filed case can ship immediately using `requireDriver` (no dependency on P0-1); the rider-filed case depends on `requireRider` existing first.

### P0-6 — Push-notification hijacking

- **Affected routes:** `POST /api/push/subscribe`.
- **Root cause:** accepts `owner_type`/`owner_id` from the request body with no auth check before upserting a subscription keyed on that owner.
- **Exploit scenario:** attacker registers their own browser's push subscription against `owner_id:"<victim-riderId>"`; `sendPushNotification()` (server.js:2897) later pushes to every subscription matching that owner, so the attacker silently receives the victim's ride-status notifications.
- **Business impact:** privacy leak of a victim's ride timing/status to an attacker; lower severity than P0-2/P0-3/P0-4 but still a real confidentiality failure.
- **Technical impact:** trivial to exploit.
- **Remediation approach:** bind the subscription to the authenticated session's identity (driver: `requireDriver`, exists today; rider: `requireRider`, once built), never a client-supplied `owner_id`.
- **Regression tests:** a test proving a subscription request is rejected (or silently rebound to the caller's own identity) if `owner_id` doesn't match the authenticated session.
- **Rollback:** kill-switch, same pattern. Driver-side can ship independently of P0-1.
- **Estimated effort:** Low once the relevant session middleware exists.

### P0-7 — HTAF application-status enumeration by email

- **Affected routes:** `GET /api/foundation/applications/by-email`.
- **Root cause:** returns HTAF application status keyed on an email with no proof the caller controls that inbox.
- **Exploit scenario:** anyone can enumerate whether an arbitrary email address has applied to the foundation program and its current status.
- **Business impact:** disclosure of a sensitive personal/medical-assistance-adjacent fact about real people; distinct privacy exposure from ordinary account data.
- **Technical impact:** trivial; rate-limited (20/min) but not auth-gated.
- **Remediation approach:** reuse this codebase's existing OTP-by-email infrastructure (`createVerificationRecord`/`verifyCode`) to require a short-lived emailed code before returning status by email — this route has no dependency on `requireRider` and can ship independently and immediately.
- **Regression tests:** a test proving status is only returned after a valid, unexpired code for that specific email is presented.
- **Rollback:** additive change; if it breaks a legitimate integration, the OTP step can be feature-flagged off without touching the rest of the route.
- **Estimated effort:** Low — this is the cheapest, most independent P0 fix in this plan and has no dependency on any other item.

### P0-8 — `riders` RLS policy misconfiguration

See §3 below for the full dedicated deep-dive requested. Summary: **confirmed** misconfiguration, remediation is a single `DROP POLICY`, but must be sequenced last among the P0s and tested on a Supabase branch first (see §4's reasoning).

### (Folded in) Driver-offer `/decline` missing ownership check

- **Affected routes:** `POST /api/driver/offers/:offerId/decline`.
- **Root cause:** copy-paste divergence from its `/accept` sibling — the ownership check was never added.
- **Exploit scenario:** any authenticated driver (a valid session, just not the one the offer was dispatched to) who obtains an `offerId` can decline someone else's pending offer, forcing an unwanted redispatch.
- **Business impact:** operational integrity issue (unwanted redispatch, potential driver confusion/complaint) rather than a data-confidentiality one — lower severity than the other 8, which is why the original report placed it at P1, but it's included in this plan because the user's requested remediation sequence explicitly includes it (item 7).
- **Technical impact:** requires a real (any) driver session — not reachable by a fully unauthenticated caller, unlike the P0s above.
- **Remediation approach:** add the identical `if (driverId && offer.driver_id !== driverId) return fail(..., 403)` block `/accept` already has.
- **Regression tests:** a test proving Driver B cannot decline an offer dispatched to Driver A (mirroring the equivalent test that should already cover `/accept`, if one doesn't already exist — verify during implementation).
- **Rollback:** pure additive correctness fix; trivial to revert.
- **Estimated effort:** Low — smallest, most contained fix in this entire plan.

---

## 3. Special attention — the `riders` RLS policy, in full

### 3.1 Exact SQL definition

Re-queried directly this session via two independent methods for cross-confirmation.

**Method 1 — `pg_policies` view** (higher-level, human-readable):
```sql
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in ('riders','drivers');
```
```
riders:  "Allow service role full access"  PERMISSIVE  roles={public}       cmd=ALL  qual=true   with_check=true
riders:  "deny_all_riders"                 PERMISSIVE  roles={public}       cmd=ALL  qual=false  with_check=null
riders:  "service_role_riders"             PERMISSIVE  roles={service_role} cmd=ALL  qual=true   with_check=true
drivers: "deny_all_drivers"                PERMISSIVE  roles={public}       cmd=ALL  qual=false  with_check=null
drivers: "service_role_drivers"            PERMISSIVE  roles={service_role} cmd=ALL  qual=true   with_check=true
```

**Method 2 — lower-level `pg_policy` system catalog**, joined and decoded directly (confirms Method 1 is not a `pg_policies` view artifact):
```sql
select
  c.relname as table, pol.polname as policy_name, pol.polpermissive as is_permissive,
  pol.polcmd as command_char,
  case when pol.polroles = array[0]::oid[] then 'PUBLIC (all roles)'
       else (select string_agg(rolname, ', ') from pg_roles where oid = any(pol.polroles))
  end as effective_roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relname in ('riders','drivers');
```
Result for `"Allow service role full access"`: `is_permissive=true`, `command_char='*'` (ALL), **`effective_roles='PUBLIC (all roles)'`** (derived from `polroles = array[0]::oid[]`, the canonical Postgres representation of the PUBLIC pseudo-role in a policy's role list — this is not an inference, it's what the value `0` in that array specifically and only means), `using_expression='true'`, `with_check_expression='true'`.

**Reconstructed equivalent DDL** (from the catalog fields above, for readability — not a literal `pg_dump` capture):
```sql
CREATE POLICY "Allow service role full access" ON public.riders
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
```

### 3.2 Effective roles

**PUBLIC** — in PostgreSQL, this means literally every role, with no exception, including `anon` and `authenticated` (Supabase's two REST-API-facing roles) as well as `service_role`. This is distinct from the correctly-scoped `service_role_riders` policy, which uses `TO service_role` and only applies to that one role.

### 3.3 Whether the Supabase REST API could reach it

**Confirmed, as a matter of how the mechanism works** (this is standard, documented PostgREST/Supabase behavior, not specific to this project): Supabase's REST API is served by PostgREST, which reads the caller's JWT (from the `apikey`/`Authorization` header), extracts its `role` claim, and executes the request as that Postgres role. An anonymous request using the project's publishable/anon key runs as the `anon` role; a logged-in Supabase-Auth user's request runs as `authenticated`. Because `"Allow service role full access"` is scoped to `PUBLIC`, **it applies to both of those roles**, and — because PostgreSQL combines multiple `PERMISSIVE` policies with logical OR — its unconditional `USING (true)` grants full access regardless of what `deny_all_riders` (also permissive, `USING (false)`) says. In plain terms: **a request to `GET https://orgahzncmzptljapqffj.supabase.co/rest/v1/riders` carrying nothing more than the project's anon/publishable API key would, today, return every row in the `riders` table.**

### 3.4 Whether the service-role policy was accidentally created with the wrong role

**Likely, not confirmed as a historical fact** (I have no access to Supabase's audit/activity log to see who created this or when). The evidence supporting "yes, this was an accident":
- A **separate, correctly-scoped** policy (`service_role_riders`, `TO service_role`) already exists and does exactly what `"Allow service role full access"`'s name claims to do — the two are functionally redundant in intent.
- **Neither policy, nor `deny_all_riders`, appears in any committed migration file** — confirmed by grepping every file in `supabase/migrations/` for the word "policy" (zero matches, any case). All `riders`/`drivers` RLS policies exist purely as live database state, created outside this project's normal migration-based schema-change discipline (via Supabase Studio's UI or a manual SQL Editor session). This is itself worth noting as a distinct, smaller finding: **this project's committed migration history does not reflect its actual RLS configuration**, so any future engineer reading the migrations folder would have no idea these policies exist at all.
- The naming style (a descriptive English sentence in quotes, vs. the short `snake_case` names of its siblings) is consistent with it having been created via Supabase Studio's graphical policy editor at a different time than the other two, which read like they were named by someone deliberately setting up the current, correct deny-by-default pattern afterward and not realizing the earlier one was still active.

### 3.5 Whether this is currently exploitable or only a latent misconfiguration

Three distinct questions, each answered separately per instruction not to conflate them:

1. **Does the misconfiguration exist?** **Confirmed.** Direct SQL evidence, twice, above.
2. **Would it grant real access if reached via the anon/authenticated role?** **Confirmed**, as a matter of how RLS policy combination works — this is not speculative.
3. **Is it currently being reached/exploited, or has the anon key ever left this codebase?** **Unverified.** I found no Supabase URL or anon/publishable key embedded anywhere in `public/*.html`, `src/`, or `mobile/`'s source in this repository — this app's own backend connects exclusively with the `service_role` key (which bypasses RLS regardless of any policy), and I found no evidence any other client in this codebase talks to Supabase's REST API directly. However:
   - I have not inspected a compiled/bundled build artifact of the `mobile/` Expo app (only its source), so I cannot fully rule out a key being embedded there.
   - Supabase's anon/publishable key is **designed to be shareable** — Supabase's own security model assumes it is not secret and relies on RLS as the actual gate. This means "we didn't find it in the repo" is not the same reassurance it would be for an actual secret; the key could be known to some other consumer (an internal tool, an old prototype, a support interaction) without ever having been committed to this git history.
   - **The correct posture, and the one this plan recommends, is to treat this as a real, live risk requiring a fix — not a theoretical one requiring further proof before acting** — precisely because Supabase's own design assumes the key is not the control that's supposed to be protecting this data. RLS is.

### 3.6 What this plan is NOT doing yet

Per explicit instruction, **the policy has not been changed.** The recommended fix (drop the misconfigured `"Allow service role full access"` policy, leaving `deny_all_riders` + `service_role_riders` — the exact pattern `drivers` already correctly has) is scoped as its own, last-sequenced PR in §4, to be tested against a Supabase branch before touching the live project, consistent with this project's own established caution for RLS changes.

---

## 4. First remediation sequence — dependencies and safest order

Per instruction, each item ships as its own separate, focused PR — no combining unrelated fixes.

| Order | PR | Depends on | Why this order |
|---|---|---|---|
| 1 | **Rider authentication and `requireRider`** — build the middleware; do not yet migrate any route to use it (land it inert, fully unit-tested, behind a flag default-off) | Nothing — the token infrastructure (`lib/riderAuth.js`) already exists and is tested | Every other rider-facing fix (2, 3, 5-partial, 6-partial) depends on this middleware existing. Landing it first, inert, lets it be reviewed and tested in isolation before any route's behavior changes. |
| 2 | **Ride ownership enforcement** — migrate `GET /api/rider/rides`, `/deliveries`, `/rides/:rideId`, and `GET/POST/DELETE /api/rider/saved-places[/:id]`, `POST /api/rider/photo` to `requireRider` | PR 1 | Addresses the bulk of P0-1's surface area in one coherent, reviewable group (all read/write rider-data routes, same shape of fix, same test pattern). |
| 3 | **Payment authorization and payment-method ownership** — migrate `GET/DELETE /api/rider/payment-methods[/:id]` and the `payment-intent` attachment branch to `requireRider` | PR 1 (not PR 2 — this can proceed in parallel with PR 2 once PR 1 lands, since it touches different routes) | Given P0-2 is the single highest-severity finding (real financial fraud), recommend this be reviewed/merged with priority even though PRs 2 and 3 could technically be built in parallel — do not let payment-method ownership wait behind the full rider-data migration if it can ship sooner. |
| 4 | **Persona inquiry ownership** — add the auth check to `POST /api/persona/inquiry`, ideally as part of the separately-scoped "wire Persona into onboarding" work | PR 1 (for the rider-side check; driver-side can use existing `requireDriver`) | Lower urgency than 2/3 given the route currently has no live caller — sequenced here so it doesn't block the higher-severity, currently-reachable fixes above it. |
| 5 | **Push-subscription ownership** — bind `POST /api/push/subscribe` to the authenticated session | PR 1 for the rider case; driver case has no dependency and could ship even earlier if preferred | Lower severity (confidentiality of notification timing, not data/money) — placed after the higher-severity items. |
| 6 | **Safety endpoint authentication** — `POST /api/safety/911` and `/api/safety/report` | PR 1 for the rider case; driver case has no dependency | Sequenced deliberately after the data/money fixes despite being a safety-relevant route, because (per §2's note) this specific pair warrants a manual, real-environment verification step before flipping its flag — that takes calendar time to arrange, which shouldn't block the faster wins above it. |
| 7 | **Driver-offer ownership consistency** — add the missing check to `/decline` | Nothing — fully independent of the rider-auth work | Smallest, lowest-risk, no dependencies — could actually ship first if a quick, isolated win is wanted while PR 1 is in review, but sequenced here to keep this table's ordering matching the priority the user specified. |
| 8 | **RLS policy corrections** — drop `"Allow service role full access"` on `riders` | Nothing functionally, but **must be tested on a Supabase branch first**, and should land after the application-layer fixes above are stable, so that if anything unexpected surfaces from the RLS change, it's not confused with an application-layer regression happening at the same time | Deliberately sequenced last among the P0 database/application fixes despite being, on its own, a trivial one-line change — RLS changes on a live table are the kind of "can silently return zero rows instead of erroring" risk this project's own prior audit already flagged, and isolating it from the busier application-layer PRs makes any regression easy to attribute. |
| 9 | **Secrets/session hardening** — fail-closed guards for `ADMIN_SESSION_SECRET`/`DRIVER_SESSION_SECRET` (P1-3) and fail-closed Checkr/Persona webhook verification (P1-2) | Nothing | Technically P1, not P0, in the original severity classification — included here because it's part of the same "session/secret integrity" theme as PR 1 and is a natural, low-effort companion once that code is being touched anyway. |

**Cross-cutting dependency note:** PRs 2, 3, 5, and 6 all depend on PR 1 landing first, but are otherwise independent of each other and could be built/reviewed in parallel by different people once PR 1 is merged — they touch disjoint sets of routes. PRs 4, 7, and 8 have no dependency on PR 1 and could, in principle, be pulled forward if a quick isolated win is wanted while PR 1 is in review — noted in the table above where applicable.

**Every PR in this sequence ships with its own cross-identity regression test(s) as part of that PR, not deferred to a final testing phase** — this matches the standing instruction from earlier in this project's history ("do not postpone the IDOR tests until after enforcement") and this plan extends that same discipline to every route group here, not just the rider-session work it originated with.

---

## 5. Deliverable summary

This is the complete P0 remediation roadmap requested. **No implementation begins on any item above until this roadmap is separately approved.** Once approved, recommend proceeding strictly in the order in §4, opening each as its own PR per the "do not combine unrelated security fixes" instruction, with the regression tests for each landing in the same PR as its fix.
