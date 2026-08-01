# Harvey Taxi Mobile — Production Hardening: Phase 1 Audit

**Date:** 2026-07-31
**Scope:** Response to the "Full Production Hardening Directive." This document covers Phase 1 (inventory + risk classification) in full, plus the parts of Phase 3 (security) and Phase 4 (schema) that could be verified directly from the codebase and live Supabase project without production/browser access. Phase 2 (live end-to-end flow verification) is explicitly marked BLOCKED — see below.

**How to read this document:** every claim below is labeled. A claim with no label is a **verified fact** — directly observed in the repository, the live Supabase project, or `npm`/`node` tool output in this session. Anything else is explicitly marked **[ASSUMPTION]**, **[ESTIMATE]**, **[UNTESTED]**, or **[BLOCKED]**.

---

## 1. Executive Production-Readiness Summary

Harvey Taxi Mobile is a single Node/Express application (`server.js`, ~19,700 lines) serving 47 static HTML pages and 124 API routes, backed by a Supabase Postgres project (45 tables, 17 committed migrations) and Stripe/Twilio/SendGrid/Checkr/Persona integrations. It is **not yet production-ready for general public launch**. The core dispatch, payment, and compliance logic is real and mostly sound — this is not a prototype — but three categories of blocker remain open:

1. **An active, unresolved onboarding blocker.** `ENABLE_PERSONA` defaults to `true` with no real Persona flow live, which has been blocking every driver from going online. A fix was identified and a Render env-var change was requested of the operator; **[UNTESTED]** whether it has taken effect — no confirmation received yet that a real driver can go online in production.
2. **No rider-side authentication.** Every `/api/rider/*` route identifies the rider purely by a client-supplied `riderId` in the request body/query — there is no session token, cookie, or password check anywhere in the rider API surface. Any client that knows (or guesses/enumerates) a rider ID can read or write that rider's saved places, payment methods, ride history, and now their profile photo.
3. **A meaningful amount of test/prototype debris sitting in the production repo and production database**, including two rider/driver "QA" records with **live `active`/`approved` status** that are currently indistinguishable from real users in the admin dashboard, and roughly a dozen orphaned or duplicate HTML pages (see §3).

None of the individual P0/P1 items below is large in isolation. Together they mean the honest answer to "is this ready for real riders, drivers, HTAF partners, and investors" is **not yet** — see §10 for the formal recommendation.

---

## 2. Complete File and Route Inventory

### 2.1 API routes (124 total, from `server.js`)

| Prefix | Count | Notes |
|---|---|---|
| `/api/admin/*` | 32 | All gated by `requireAdmin` (verified — see §5). |
| `/api/driver/*` + `/api/drivers/*` | 19 | Session-token gated (`requireDriver`) except signup/session-start/verify, which are pre-auth by design. |
| `/api/rider/*` + `/api/riders/*` | 12 | **No session auth on any of these** — see §5.1. |
| `/api/rides/*` | 6 | Mixed: `estimate`/`request` public, `authorize`/`payment-intent` should be rider-scoped (untested — see §5.1). |
| `/api/verify/*`, `/api/auth/*` | 6 | Rider self-service email/SMS verification, separate from driver OTP login. |
| `/api/checkr/*`, `/api/persona/*` | 4 | Webhook + inquiry-start routes. Webhook signature verification confirmed present in code (§5.4) — live secret validity **[UNTESTED]**. |
| `/api/push/*` | 3 | VAPID web push. |
| `/api/foundation/*` | 3 | HTAF application routes. |
| `/api/safety/*` | 2 | 911 escalation + incident report. |
| `/api/account/*` | 2 | Self-service delete-request routes — **see §2.3, linked frontend page is missing.** |
| `/api/stripe/webhook` | 1 | Signature-verified (confirmed in code). |
| `/api/ai/support` | 1 | AI dispatcher/support tool-calling endpoint. |
| Static page routes (`/foundation`, `/driver-dashboard`, etc.) | ~33 | Serve the HTML pages in §2.2 both with and without `.html`. |

Full machine-generated list is reproducible via the extraction script used for this audit (not committed — see Appendix).

### 2.2 Public pages (47 files in `public/*.html`)

Classified by evidence (referenced-by-grep across all HTML + `server.js`, plus `robots.txt`):

**Live, in active use, no issues found:**
`index.html`, `rider-dashboard.html`, `driver-dashboard.html`, `request-ride.html`, `request-food.html`, `request-groceries.html`, `rider-signup.html`, `driver-signup.html`, `htaf-application.html`, `foundation.html`, `support.html`, `settings.html`, `contact.html`, `leadership.html`, `terms.html`, `admin-dashboard.html`, `admin-htaf.html`, `admin-gps.html`, `admin-live-dispatch-map.html`, `admin-dispatch-console.html`, `admin-autonomous-pilot.html`, `autonomous-analytics.html`, `av-control.html`* , `driver-missions.html`, `driver-wallet.html`.

*`av-control.html` has zero inbound references from any other page and is `robots.txt`-disallowed — **[ESTIMATE]** this is a pre-`admin-autonomous-pilot.html` prototype, superseded when that panel was built. Needs confirmation, not deletion, until confirmed unused in practice.

**Intentional redirect stubs — PRESERVE (per directive, "required redirects"):**
`rider.html`, `rider-live-chat.html`, `rider-live-trip.html`, `rider-live-vehicle.html`, `rider-tracking.html`, `rider-trip.html` — all 37-line meta-refresh stubs to `rider-dashboard.html`, built deliberately in an earlier consolidation pass. **Do not touch.**

**Test/scratch pages — cleanup candidates (already `robots.txt`-disallowed, meaning someone already flagged them as non-production; the files themselves were simply never removed):**

| File | Purpose (from content) | Referenced anywhere? | Production impact if removed | Safe-to-delete evidence | Rollback |
|---|---|---|---|---|---|
| `public/test-earnings.html` | 50-line scratch page titled "Test Add Earnings" | No (only `robots.txt`) | None | Zero inbound links; title and content are explicitly a manual test tool | `git revert` |
| `public/autonomous-test.html` | 60-line scratch page titled "Autonomous Ride Test" | No (only `robots.txt`) | None | Same as above | `git revert` |
| `public/mobility-os-prototype.html` | 627-line standalone prototype, `noindex,nofollow`, built as an explicit prototype (see task history) | No (only `robots.txt`) | None — never wired into any real flow | Explicitly built and documented as a prototype; not linked from `index.html` or any nav | `git revert` |

**Orphaned/duplicate legacy admin & driver pages — flagged, NOT yet recommended for deletion (need your confirmation these aren't bookmarked/used out-of-band):**

| File | Purpose | Referenced anywhere? | Evidence this is superseded |
|---|---|---|---|
| `public/admin.html` (962 lines) | Old, self-contained admin console | Only outbound-links to `admin-login.html`/`login.html`; nothing links to it | Predates `admin-dashboard.html`; forms its own disconnected cluster with `admin-login.html`/`login.html` |
| `public/admin-login.html` (229 lines) | Old admin login page | Referenced only by `admin.html`/`login.html` | `admin-dashboard.html` has its own inline login form + cookie session (built this session) |
| `public/login.html` (223 lines) | Generic login page | Referenced only by `admin.html` | Same disconnected cluster |
| `public/admin-home.html` (53 lines) | Old admin landing page | Referenced only by `admin-account--deletion.html` | Superseded by `admin-dashboard.html` |
| `public/admin-account--deletion.html` (390 lines, note the double-dash — likely a typo'd filename) | Standalone account-deletion review page | Referenced only by `admin-home.html` | **`admin-dashboard.html` already has a working "Account Deletion Requests" panel** (built and wired to `/api/admin/deletion-requests` this session) — this is a confirmed duplicate |
| `public/admin-dispatch.html` (514 lines) | Old dispatch board | None | Superseded by `admin-dispatch-console.html` / `admin-live-dispatch-map.html` |
| `public/admin-rider-approval.html` (149 lines) | Standalone rider-approval page | None | Superseded by `admin-dashboard.html`'s Pending Riders panel |
| `public/admin-verification.html` (327 lines) | Standalone verification review page | None | Overlaps with `admin-dashboard.html` |
| `public/admin-support.html` (124 lines) | Standalone support console | None | Overlaps with `admin-dashboard.html`'s AI Operations Brain / support tooling |
| `public/dispatch.html` (43 lines) | Tiny dispatch stub | None (except `robots.txt`) | Superseded |
| `public/driver.html` (112 lines) | "Driver Console" | None | Superseded by `driver-dashboard.html` |
| `public/pay.html`, `public/active-trip.html` | Older payment/trip pages | None (except `robots.txt`) | Superseded by `request-ride.html`'s in-wizard Stripe flow and rider-dashboard's active-request card |

**Two confirmed broken links (real defects, not cleanup — P1):**

1. `public/rider-dashboard.html:10073` links to `tip-driver.html?...` — **this file does not exist anywhere in the repo.** Any rider who taps "tip driver" gets a 404.
2. `public/index.html` links to `delete-account.html` — **this file also does not exist.** The backend routes it would need (`POST /api/account/rider/delete`, `POST /api/account/driver/delete-request`) already exist and work — there is simply no page for a rider to actually use them from the homepage link.

### 2.3 Non-web scaffolding found at repo root

- **Eleven 3-byte placeholder JSON files at repo root** (`data.json`, `app.json`, `drivers.json`, `commands.json`, `messages.json`, `payments.json`, `gps-locations.json`, `vehicles.json`, `rides.json`, `missions.json`, `riders.json`, `dispatches.json`) — confirmed **zero references** anywhere in `server.js` or `lib/`. These are inert scaffold/mock files, dated to the same original commit (2026-07-22), predating the real Supabase-backed implementation. **Safe-to-delete evidence:** zero references, trivial (`[]`) content, verified by grep across the whole repo. **Rollback:** `git revert`.
- **A second, orphaned React app at repo root** (`App.js` + `src/screens/*.js`, using raw `react-native` imports) with **no corresponding `react`/`react-native` dependency anywhere in the root `package.json`** — this code cannot run as-is. It only references itself.
- **A separate, self-contained Expo/React Native project in `mobile/`** (own `package.json` with real `expo`/`react-native` deps, `eas.json`, `babel.config.js`) — **[ASSUMPTION]** this looks like the actual (dormant, not currently built/deployed by CI) mobile app shell, distinct from and probably meant to supersede the root-level `App.js`/`src/`. Needs your confirmation of intent before either is touched — CI does not build or reference either one today.

### 2.4 Supabase (live project `orgahzncmzptljapqffj`)

- **45 tables**, all in `public` schema. **42 have RLS enabled; 3 do not** (`preferred_drivers`, `spatial_ref_sys`, `usage_counters` — `spatial_ref_sys` is a PostGIS system table, the other two are this app's own tables). This was already flagged in an earlier session and is still open — see §5.2.
- **17 committed migrations**, most recent `20260731125001_add_rider_photo_url`. No evidence of missing migrations for anything currently referenced in `server.js` — spot-checked this session for `access_revoked`/`deleted_at`/`deleted_reason`/`deleted_by` (drivers+riders) and `photo_url` (both tables); all present and match code. **A full column-by-column diff against every `.select()`/`.insert()`/`.update()` call in `server.js` has not been done — [ESTIMATE], not verified.**
- **`system_flags` table has 4 rows** — feature-flag state lives partly in this table and partly in Render env vars (`ENABLE_*` booleans read via `envBool()`). Two different flag mechanisms for the same concept (feature flags) is itself a P3 hardening item — recommend consolidating in a later phase, not urgent.

### 2.5 CI / GitHub Actions

One workflow, `.github/workflows/ci.yml`: on every push/PR to `main`, runs `npm install`, `node -c server.js`, `npm test` on Node 20.x and 22.x. **No lint step, no `npm audit`, no schema-drift check, no Playwright/E2E run.** Despite an earlier task in this project's history being logged as "Add committed Playwright regression tests," **no Playwright files exist in the repository today** — either they were never actually committed or were removed since. This is a discrepancy worth resolving, not just a gap.

### 2.6 Render environment variables (inventory of what code expects — I cannot read your actual Render config from here)

`server.js` reads ~50 named environment variables via its own `env()`/`envBool()`/`envNumber()` helpers. Full list, grouped:

- **Core:** `NODE_ENV`, `PORT`, `APP_BASE_URL`, `PUBLIC_APP_URL`, `RENDER_EXTERNAL_URL`, `CANONICAL_HOST`, `FOUNDATION_HOST`, `ALLOWED_ORIGINS`, `SESSION_SECRET`, `JSON_LIMIT`, `LARGE_JSON_LIMIT`, `RAW_WEBHOOK_LIMIT`.
- **Admin:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_API_TOKEN`, `HARVEY_ADMIN_TOKEN`, `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_HOURS`, `ADMIN_LIST_LIMIT`.
- **Driver session:** `DRIVER_SESSION_SECRET`, `DRIVER_SESSION_TTL_HOURS`.
- **Feature flags:** `ENABLE_AI_SUPPORT`, `ENABLE_AUTO_REDISPATCH`, `ENABLE_CANONICAL_REDIRECT`, `ENABLE_CHECKR`, `ENABLE_DELIVERY`, `ENABLE_FOOD_DELIVERY`, `ENABLE_GROCERY_DELIVERY`, `ENABLE_HTAF_APPLICATIONS`, `ENABLE_PAYMENT_GATE`, `ENABLE_PERSONA` **(currently the open blocker, §1)**, `ENABLE_REAL_EMAIL`, `ENABLE_REAL_SMS`, `ENABLE_RIDER_APPROVAL_GATE`.
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_PHONE_NUMBER` **(two names for what may be the same number — worth confirming only one is actually used)**, `TWILIO_VERIFY_SERVICE_SID`.
- **SendGrid:** `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, `SUPPORT_EMAIL`, `SUPPORT_FROM_EMAIL`.
- **Checkr:** `CHECKR_API_KEY`, `CHECKR_PACKAGE`, `CHECKR_WEBHOOK_SECRET`, `CHECKR_WORK_CITY`, `CHECKR_WORK_STATE`, `CHECKR_WORK_COUNTRY`.
- **Persona:** `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, and **four** related template-id vars: `PERSONA_TEMPLATE_ID_DRIVER`, `PERSONA_TEMPLATE_ID_RIDER`, `PERSONA_DRIVER_TEMPLATE_ID`, `PERSONA_RIDER_TEMPLATE_ID` — **[ESTIMATE]** this looks like a naming-convention drift (two different call sites using two different names for what may be the same two values) rather than four distinct settings; worth a direct code read before assuming which pairs are actually live.
- **Maps/AI:** `GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_ROUTES_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
- **Push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **Rate limiting:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — **[ASSUMPTION]** if unset, rate limiting almost certainly falls back to in-process memory, which would not be shared across multiple Render instances if you ever scale horizontally. Worth confirming which mode is active.
- **Dispatch/business tuning:** `DISPATCH_TIMEOUT_SECONDS`, `MAX_DISPATCH_ATTEMPTS`, `DRIVER_SEARCH_RADIUS_MILES`, `ASSUMED_DELIVERY_SPEED_MPH`, `EMAIL_VERIFY_TTL_HOURS`, `VERIFY_TTL_MINUTES`, `AUDIT_LOG_LIMIT`, `OVERVIEW_CACHE_TTL_SECONDS`, `ROUTE_API_MONTHLY_QUOTA`, `ROUTE_API_MOVEMENT_THRESHOLD_MILES`, `ROUTE_API_TIMEOUT_MS`.

**I have no way to confirm what is actually set in Render from this environment** (confirmed this session — my outbound network is proxied and cannot reach `harveytaxiservice.com` or the Render dashboard). Everything above is "what the code expects," not "what is configured." A live confirmation (e.g., screenshotting the Render env var list, redacting secret values) is a prerequisite for closing out Phase 1 with confidence.

---

## 3. Test-Artifact Cleanup Inventory

Combining §2.2/§2.3 with a direct database check for named QA records:

| Item | Type | Referenced/Live? | Production impact | Safe-to-delete evidence | Rollback | Recommendation |
|---|---|---|---|---|---|---|
| 11 root-level placeholder `*.json` files | Scratch scaffold | Not referenced by any code | None | Zero references, 3-byte trivial content | `git revert` | **Safe to remove** |
| `public/test-earnings.html` | Scratch test page | Not linked; `robots.txt`-disallowed | None | Title/content is explicitly a manual test tool | `git revert` | **Safe to remove** |
| `public/autonomous-test.html` | Scratch test page | Not linked; `robots.txt`-disallowed | None | Same | `git revert` | **Safe to remove** |
| `public/mobility-os-prototype.html` | Abandoned prototype | Not linked; `robots.txt`-disallowed | None | Explicitly built as a prototype, never wired into any real flow | `git revert` | Recommend removing, but low urgency — confirm you don't want to keep it as a design reference first |
| `public/admin.html`, `admin-login.html`, `login.html` | Duplicate/legacy admin cluster | Only reference each other | None if removed — nothing else points to them | Predates `admin-dashboard.html`'s cookie-based login | `git revert` | Flag for removal after you confirm no one has this bookmarked |
| `public/admin-home.html`, `admin-account--deletion.html` | Duplicate/legacy admin cluster | Only reference each other | None | `admin-dashboard.html` already has a working, wired Account Deletion Requests panel | `git revert` | **Confirmed duplicate — safe to remove** |
| `public/admin-dispatch.html`, `admin-rider-approval.html`, `admin-verification.html`, `admin-support.html`, `dispatch.html`, `driver.html`, `av-control.html`, `pay.html`, `active-trip.html` | Orphaned legacy pages | Zero inbound references | None found | Each superseded by a named current page (see §2.2 table) | `git revert` | Flag for removal after your confirmation |
| Root `App.js` + `src/screens/*` | Orphaned scaffold | Self-referencing only; no runnable dependency | None (already non-functional) | No `react`/`react-native` in root `package.json` | `git revert` | Confirm intent before removing — may be a stale duplicate of `mobile/` |
| `nodemailer` dependency (`package.json`) | Unused dependency | **Zero `require("nodemailer")` calls anywhere in the codebase** | None | High-severity known vulnerability (see §5.6), completely unused | `git revert` / `npm install` | **Safe to remove — do this regardless of anything else** |
| `RIDER-QAETATEST1` (riders table) | Live DB record, `status: active` | Currently rendered as a real "active rider" in the Active Riders panel built this session | Inflates rider counts shown to admin | N/A — **explicitly withheld per your instruction** | N/A | **Do not touch. Awaiting your approval per the directive.** |
| `DRIVER-QAETATEST1` (drivers table) | Live DB record, `status: active`, `approval_status: approved` | Same — appears in Active Drivers panel | Inflates driver counts | N/A — **explicitly withheld** | N/A | **Do not touch.** |
| `driver_1` / "Test Driver" / `driver@test.com` (drivers table) | **A third, previously unflagged test record** — older ID scheme (`driver_1` instead of `DRV-XXXXXXXXXX`), `status: active`, `approval_status: approved` | Also live in the Active Drivers panel | Inflates driver counts; the non-standard ID format may also interact oddly with any code that assumes the `DRV-` prefix | N/A — flagging only | N/A | **New finding — do not touch until you've reviewed it; not previously named in your instructions.** |

**Explicitly preserved, no action taken or proposed:** all `*.test.js` files (11, all in `lib/`), `.github/workflows/ci.yml`, all migrations, `docs/production-incidents.md`, `docs/production-verification-package.md`, all redirect stubs (§2.2), all legal/compliance pages (`privacy.html`, `privacy-policy.html`, `terms.html`).

---

## 4. Live Schema-Drift Report

- **No committed-vs-live drift found** in the specific columns spot-checked this session: `drivers.access_revoked/deleted_at/deleted_reason/deleted_by`, `riders.access_revoked/deleted_at/deleted_reason/deleted_by`, `drivers.photo_url`, `riders.photo_url` — all present live and match their migrations.
- **A full column-by-column diff has not been performed.** [ESTIMATE, not verified] Given the pattern already found once this session (the `access_revoked` columns were referenced in code for weeks before their migration was written — see `docs/production-incidents.md`, 2026-07-31 entry), I would not be surprised if there are 1-2 more similar gaps elsewhere in a 19,700-line file with 45 tables. Recommend a scripted diff (every `.from("table").select("a, b, c")` string literal in `server.js`, cross-referenced against `information_schema.columns`) as a Phase 4 deliverable, not attempted here due to scope.
- No schema baseline/snapshot script exists yet for spinning up a clean staging environment (Phase 4 asks for this explicitly — not yet built).

---

## 5. Security Findings

### 5.1 Broken access control — rider API has no authentication (P0)

Every `/api/rider/*` and `/api/riders/*` route (payment methods, saved places, ride/delivery history, and the new photo-upload route added this session) identifies "who is calling" purely from a `riderId` string the client sends. There is no session cookie, token, or password check anywhere in this surface — confirmed by direct code read this session while building the rider photo-upload feature. Compare to the driver side, which has a real signed-session-token flow (`requireDriver`, OTP login via Twilio Verify).

**Concretely:** anyone who learns another rider's ID (sequential-looking IDs, a leaked URL, a support ticket, or simple enumeration since IDs appear to follow a guessable pattern) can read that rider's saved addresses and ride history, and can attempt to add/remove their payment methods or upload a photo to their profile.

**This is a P0** — it's an active IDOR (Insecure Direct Object Reference) across the entire rider-facing API surface, not a single endpoint. I did not build any new endpoint in this pattern without noting it was consistent with the existing (already-broken) convention — every rider PR I opened this session flagged this explicitly rather than silently treating it as normal.

### 5.2 RLS gaps in Supabase (P1)

- `preferred_drivers`, `usage_counters` (application tables) and `spatial_ref_sys` (PostGIS system table) have RLS **disabled entirely** — exposed to `anon`/`authenticated` roles if anyone ever queries them via the public Supabase REST API directly (not just through your Express backend). Remediation SQL was already generated in an earlier session and is reproduced here for your decision — **not applied**, since enabling RLS with no policies would silently block all access if anything does query these tables directly:
  ```sql
  ALTER TABLE public.preferred_drivers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
  ```
- The remaining 42 tables have RLS **enabled with zero policies** — this is actually the *safe* default (no policy + RLS on = no access at all for `anon`/`authenticated`; your backend uses the service-role key, which bypasses RLS entirely), but it means your entire authorization model lives in `server.js`'s own middleware, not in the database. That's a legitimate architecture choice, not a defect — flagging only so it's an explicit, confirmed decision rather than an assumption.
- `riders` has one explicit policy, `"Allow service role full access"`, `USING(true)` — Supabase's linter flags any `USING(true)` policy as a warning by default. **[ASSUMPTION, needs confirmation]** this is very likely scoped to the `service_role` only (matching its name) and therefore fine, but I have not verified the policy's `roles` restriction directly — worth a 30-second confirmation query before considering this closed.

### 5.3 Dependency vulnerability (P1, one-line fix)

`npm audit` reports **one high-severity vulnerability**: `nodemailer` (multiple CVEs: SMTP command injection, CRLF header injection, SSRF via the `raw` option, TLS validation bypass). **Confirmed `nodemailer` is never `require()`'d anywhere in this codebase** — it is dead weight. Removing it from `package.json` fully resolves the finding with zero behavior change.

### 5.4 Webhook signature verification (confirmed present, live validity untested)

Stripe (`/api/stripe/webhook`), Checkr (`/api/checkr/webhook`), and Persona (`/api/persona/webhook`) all have signature-verification code present. **[UNTESTED]** whether the configured webhook secrets in Render actually match what Stripe/Checkr/Persona are sending in production — this requires either a live webhook event or a signed test payload, which I cannot generate from here.

### 5.5 Admin authentication (recently hardened, now resolved)

The plaintext-password-in-localStorage issue reported and fixed this session (PR #84) is closed. `requireAdmin()` correctly gates all 32 `/api/admin/*` routes behind token, password, or a proper `HttpOnly`/`SameSite=Lax`/`Secure` session cookie — confirmed by direct code read.

### 5.6 Function search-path hardening (P3, low severity)

Supabase's advisor flags 7 Postgres functions (`apply_driver_compliance_override`, `apply_driver_contact_verification_override`, `dispatch_ride_atomic`, `drivers_sync_geog`, `increment_usage_counter`, `nearest_drivers`, `set_updated_at`) with a mutable `search_path`. Standard hardening is to pin `SET search_path = public` on each. Low real-world risk in this project (no untrusted schemas exist), but a cheap, mechanical fix.

### 5.7 Everything else on the directive's Phase 3 checklist

CORS, CSRF, XSS, injection, unsafe file uploads, sensitive logging, secrets-in-git-history, rate limiting/OTP abuse, and account enumeration were **not exhaustively audited in this pass** — this document is Phase 1 plus the security findings that fell directly out of the inventory work (Supabase advisors + dependency audit + the rider-auth gap found while building the photo feature). A dedicated Phase 3 pass is still owed and should be its own focused piece of work, likely with `/security-review` run explicitly against the diff of each subsystem.

---

## 6. Critical-Flow Status Matrix

| Flow | Status | Basis |
|---|---|---|
| Rider signup | **[ESTIMATE] likely works** | Fixed in an earlier session (missing-column hotfix); not re-verified live this pass |
| Rider email/SMS verification | **[UNTESTED]** | No live click-through this session |
| Rider readiness / login | **[ESTIMATE] likely works**, but **no session auth** (§5.1) | Code read only |
| Ride request → fare → Stripe payment | **[UNTESTED]** | No live click-through; Stripe test-mode vs. live-mode status not confirmed |
| Dispatch → driver assignment → ETA | **[UNTESTED]** | Code exists and was extended this session (etaEstimation.js); no live run |
| Trip completion / receipt / history | **[UNTESTED]** | — |
| HTAF donation prompt | **NOT BUILT** | Backlog item, not started |
| Driver signup → Checkr → Persona | **[BLOCKED]** | `ENABLE_PERSONA` misconfiguration (§1) prevents completing this even in principle until confirmed fixed |
| Driver OTP login | **[VERIFIED]** | User confirmed receiving and using a real Twilio Verify SMS code this session |
| Driver go-online (readiness gate) | **[BLOCKED]**, pending Render env confirmation | Last known state: failed with "cannot go online until verification is complete"; fix identified, not yet confirmed |
| Driver accept/decline, en route, arrived, complete, earnings | **[UNTESTED]** | Code exists; no live run this session |
| Admin approval (rider/driver) | **[ESTIMATE] likely works** | Fixed and reviewed in earlier sessions (PR #77/#178) |
| Admin compliance/contact-verification override | **[ESTIMATE] likely works** | Atomic RPC + audit logging built and unit-tested this project's history; not live-clicked |
| Admin dispatch monitoring, cancellation, refunds | **[UNTESTED]** | — |
| Account deletion (rider + driver) | **PARTIALLY BROKEN** | Backend routes exist and work per code read; **the rider-facing entry page (`delete-account.html`) does not exist** (§2.2) |

No flow above should be treated as "production ready" on the strength of this document alone — the labels above are the honest state, most of which is **[UNTESTED]** or **[ESTIMATE]**, exactly per the directive's own rule against overclaiming.

---

## 7. P0–P4 Remediation Backlog

**P0 — active exposure, fix before anything else:**
1. Rider API has no session authentication (§5.1) — every `/api/rider/*` route.
2. Confirm `ENABLE_PERSONA=false` actually took effect in Render (§1) — currently blocking all driver onboarding.

**P1 — required before public launch:**
3. Remove unused `nodemailer` dependency (high-severity CVE, zero-risk removal).
4. Fix or remove the two broken links: `tip-driver.html`, `delete-account.html` (§2.2).
5. Decide and apply RLS on `preferred_drivers` / `usage_counters` (with real policies, not blind `ENABLE`).
6. Confirm webhook secrets (Stripe/Checkr/Persona) are live-valid, not just present.
7. Resolve the `PERSONA_TEMPLATE_ID_*` / `TWILIO_*_NUMBER` naming duplication (confirm which names are actually read live).
8. Live-verify every flow marked `[UNTESTED]` in §6 — this is the largest remaining item, and mostly requires the operator's own click-through since I cannot reach production from this sandbox.

**P2 — important hardening:**
9. Confirm `riders`' `USING(true)` policy is scoped to `service_role` only.
10. Pin `search_path` on the 7 flagged Postgres functions.
11. Confirm rate limiting is backed by Upstash Redis (shared) rather than in-process memory, if Render ever runs >1 instance.
12. Consolidate the two feature-flag mechanisms (`system_flags` table vs. `ENABLE_*` env vars).
13. Full column-by-column schema-drift script (§4) instead of spot-checks.
14. Add a CI schema-drift check per the directive's Phase 4 ask.

**P3 — operational improvement:**
15. Remove confirmed-orphaned legacy pages (§3) after your sign-off.
16. Add a lightweight boot-time required-columns check (previously proposed, never built — see task history).
17. Add `npm audit` and a lint step to CI.

**P4 — optional / later:**
18. Resolve root `App.js`/`src/` vs `mobile/` duplication once intent is confirmed.
19. Decide fate of `mobility-os-prototype.html` (keep as design reference vs. remove).

---

## 8. Proposed PR Sequence

Each item below is a separate, focused, reviewable PR — nothing bundled:

1. **PR: Remove `nodemailer`** — one-line `package.json` change, zero behavior risk. Can merge immediately.
2. **PR: Rider API authentication** — this is the P0. Needs a design decision first (session cookie like drivers? Or a lighter per-request signed token, given the rider app currently has no login step at all — that's a product question, not just an engineering one). **Recommend discussing approach with you before I write code**, since it changes how every rider page authenticates.
3. **PR: Fix `tip-driver.html` and `delete-account.html`** — build the two missing pages (or remove the dead links if the features aren't wanted yet).
4. **PR: Remove confirmed test/scaffold files** (§3's "safe to remove" rows only — root JSON scaffolds, `test-earnings.html`, `autonomous-test.html`) — held for your go-ahead per the directive.
5. **PR: RLS + function search_path hardening** — Supabase migration, reviewed with you first since RLS changes can break access if policies are wrong.
6. **PR: CI hardening** — add `npm audit`, lint, and (once written) the schema-drift check.
7. **Docs-only PR: this audit document**, once you've reviewed and corrected anything I got wrong.

Items not yet turned into a PR (live flow verification, legacy-page removal, mobile-app-duplication resolution) need your input first per §7/§9 before a PR makes sense.

---

## 9. Rollback Plan for Every P0/P1 Fix

All of the above are additive or subtractive file/config changes on isolated feature branches, each opened as its own PR against `main` and never merged without your review — the existing convention this project has followed all session. Standard rollback for every item is `git revert <merge-commit>`, since:

- File removals (nodemailer, test pages, scaffold JSON) are trivially reversible via revert — nothing else depends on them (that's the safety evidence in §3).
- The rider-auth PR (#2) is the only genuinely risky one — it changes how every rider request is validated. Recommend feature-flagging it (a new `system_flags` row, same pattern already used for `rider_history_enabled`) so it can be disabled instantly without a deploy if it breaks something, rather than relying on revert-and-redeploy alone.
- RLS changes (#5) are the second-riskiest — a bad policy can silently return zero rows instead of erroring. Recommend applying to a Supabase branch first (the MCP tooling supports this) and testing reads/writes there before merging to the live project.

---

## 10. Final Recommendation

## NO-GO for general public launch, CONDITIONAL GO for continued controlled/limited use

Reasoning:
- The rider API's lack of authentication (§5.1) is disqualifying on its own for any launch involving real riders' payment methods and addresses — this must close first.
- The Persona onboarding blocker (§1) needs a confirmed fix before any real driver can complete onboarding.
- The large `[UNTESTED]` surface in §6 means most critical paths have not been proven end-to-end since the last round of changes; several were touched this session (rider photo upload, admin panels, admin auth) without a live click-through.
- None of the above is a sign of a fundamentally broken product — the architecture (atomic RPCs for auditable admin actions, separated compliance-vs-approval logic, real Stripe/Twilio/Checkr/Persona integration, a real test suite protecting the pricing/dispatch/compliance logic) is sound engineering. The gap is verification and a couple of concrete, well-scoped security fixes, not a rebuild.

**Recommended immediate order**, matching your directive's own "Immediate ordering" section:
1. Confirm `ENABLE_PERSONA` fix (blocked on your Render access).
2. Resolve PR #79 live validation once (1) is confirmed.
3. Fix the rider-API-authentication P0 (needs your input on approach first).
4. Remove `nodemailer` (zero-risk, do this today).
5. Everything else in §7/§8, in the stated priority order.

---

## Appendix: Methodology and Limits

- Route/file inventories were generated by direct `grep`/`node`-script extraction against the checked-out `main` branch (post-PR-#85 merge) in this session.
- Supabase findings came from `list_tables`, `list_migrations`, and `get_advisors` (security) against the live project `orgahzncmzptljapqffj`.
- Dependency findings came from `npm audit --omit=dev` against the committed `package-lock.json`.
- **I have no access to the Render dashboard, Render logs beyond what you paste into chat, or the live production domain** (confirmed this session — outbound requests to `harveytaxiservice.com` are blocked by this sandbox's network policy). Every claim about "what's actually configured/running in production" is therefore either sourced from logs you've pasted, or explicitly marked `[UNTESTED]`/`[BLOCKED]`.
- This document does not yet cover: exhaustive CORS/CSRF/XSS/injection review, OTP-abuse/rate-limit load testing, secrets-in-git-history scanning, uptime/backup verification, or a full manual click-through of every flow in §6. Those remain open work, explicitly scoped in §7.
