# Integrations Center — Pre-Implementation Audit

**Status: AUDIT ONLY, per instruction. No UI built, no code written for the planned Admin Integrations Center dashboard.** This document is the required pre-implementation audit; implementation begins only after this is reviewed and approved.

**Companion document:** `docs/production-readiness-report.md` — the SOC 2 readiness report. Security findings specific to an integration are cited briefly here with a pointer to that document's numbered finding, not repeated in full.

**Methodology:** every integration below was traced by reading its actual initialization code, every route that depends on it, its webhook handler (if any) and signature-verification logic, and — critically — whether any page in `public/` or `src/` actually, successfully calls its API routes today. "Implemented" and "reachable from the live product" are reported as separate facts, because for two integrations (Persona, Checkr) they are not the same thing.

---

## 1. Stripe (payments)

- **Purpose:** collect rider payment for rides (charge only — no payouts/Connect).
- **Production/Test status:** **no runtime detection exists.** The code does `new Stripe(STRIPE_SECRET_KEY)` with whatever key is configured and never inspects its prefix (`sk_test_`/`sk_live_`). A live/test badge for the dashboard **cannot be built from anything in the codebase today** without adding a new check. Per `docs/staging-stripe-test-mode-plan.md`, mode is currently managed entirely by human/deployment discipline, and that same document notes Stripe was reportedly unconfigured in production at the time it was written (not independently re-verified this session).
- **Health status:** `/api/health` reports `Boolean(stripe)` only (configured vs. not) — server.js:19099-19101.
- **Required environment variables:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (non-secret, served to browser via `GET /api/stripe-key`).
- **Required webhooks:** `POST /api/stripe/webhook` — signature-verified via `stripe.webhooks.constructEvent`, correctly fails closed (503) if `stripe`/`STRIPE_WEBHOOK_SECRET` unconfigured. This is the **reference-correct** webhook pattern in this codebase.
- **Authentication method:** secret-key bearer auth (SDK-managed).
- **Dependencies:** `stripe` npm package (v22.3.2, current, MIT-equivalent license, no known CVEs).
- **Current implementation status:** fully implemented — customer creation, setup intents, payment-method list/detach, payment-intent creation, ride authorization binding (amount/currency/rider/reuse checks in `lib/riderPayments.js`).
- **Known risks:** see production readiness report **P0-2** (payment-method IDOR chain — the identity binding around Stripe's own correct checks is spoofable, not a Stripe defect itself) and **P2-6** (no live/test-mode detection).
- **Belongs in the Integrations Center:** **Yes.** Recommend the card show: configured (yes/no), webhook configured (yes/no), last webhook received timestamp (derivable from `audit_logs` where `action = 'stripe_webhook_received'`), and — once P2-6 ships — live/test mode. Do **not** attempt "last successful request" beyond what audit logging already captures without adding new instrumentation.

---

## 2. Twilio (SMS / Verify)

- **Purpose:** SMS-based OTP for rider/driver login and self-service verification; ride-stage SMS notifications to riders.
- **Production/Test status:** no live/test concept in Twilio's own model (account-level, not key-prefix based) — N/A.
- **Health status:** `/api/health` reports `Boolean(twilioClient)` — but this single boolean conflates two different products (see risk below).
- **Required environment variables:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (falls back to `TWILIO_PHONE_NUMBER` — confirmed intentional naming shim, not a duplicate config item), `TWILIO_VERIFY_SERVICE_SID`, `ENABLE_REAL_SMS` (gates client creation itself, defaults `false`).
- **Required webhooks:** none found — Twilio is outbound-only in this codebase (no inbound SMS webhook, no delivery-status callback endpoint).
- **Authentication method:** Account SID + Auth Token (SDK-managed); Verify uses a separate Service SID.
- **Dependencies:** `twilio` npm package (v4.23.0; 2 major versions behind current, no known CVE — see readiness report §6).
- **Current implementation status — four parallel/overlapping code paths, only some reachable from the live product:**
  1. **Homegrown SMS** (`createVerificationRecord`/`verifyCode`/`sendSms`) — still live, backs `/api/verify/sms/start|confirm`, `/api/verify/email/start|confirm`, account-deletion OTP, and **ride-stage rider notifications** (`notifyRideStage`, the one genuinely live user-facing use of `TWILIO_FROM_NUMBER` today). **No page in `public/` calls `/api/verify/sms/start|confirm`** — these routes exist for the notification helper's internal reuse, not as a UI-facing feature today.
  2. **Twilio Verify — driver login** (`/api/driver/session/start|verify`) — **confirmed live and reachable**, called from `public/driver-dashboard.html`.
  3. **Twilio Verify — rider login** (`/api/rider/session/start|verify`) — fully implemented, **but no page anywhere calls it.** This is the unused half of the rider-auth system referenced throughout the readiness report's P0-1.
  4. **A second, unused Twilio Verify pair** (`/api/auth/send-sms-code`, `/api/auth/verify-sms-code`) — explicitly documented in `docs/production-incidents.md` as "unrelated, unused."
- **Known risks:**
  - `ENABLE_REAL_SMS` (default `false`) gates the *entire* `twilioClient` object, meaning Twilio Verify (OTP login) and the homegrown raw-SMS path are both inoperable together whenever it's off — a dashboard "Twilio: ON/OFF" toggle needs to reflect this coupling explicitly, not just report a boolean.
  - `TWILIO_FROM_NUMBER` is a toll-free number that (per `docs/production-incidents.md`, 2026-07-31) never completed Twilio's toll-free verification, causing silent `Undelivered`/error-30032 failures. It is **still actively used** for ride-stage rider SMS notifications today, and failures there are silently swallowed (`.catch(() => {})`) with no visible error to rider, driver, or admin.
  - `public/driver-signup.html`'s own SMS-verify button, and the mobile app's equivalent screen, both call server routes that **do not exist** (`/api/drivers/verify-sms`, `/api/drivers/resend-sms`, `/api/driver/verify-sms`, `/api/driver/resend-sms-verification`) — a fourth, distinct dead-code finding from the parallel-paths issue above.
- **Belongs in the Integrations Center:** **Yes**, but the "SMS delivery health" card as originally envisioned cannot show real delivery status without new instrumentation — Twilio delivery-status callbacks are not wired up anywhere. Recommend the card show: configured (yes/no), which sub-path is active (`ENABLE_REAL_SMS` + Verify Service SID present), and last-known-good login timestamp derivable from `audit_logs`. The toll-free-verification risk should be a standing, visible warning on this card, not just a doc footnote.

---

## 3. SendGrid (email)

- **Purpose:** rider email OTP login, self-service email-verification link, ride-stage email notifications.
- **Production/Test status:** N/A (SendGrid has no test/live key concept).
- **Health status:** `/api/health` reports `Boolean(sgMail && SENDGRID_API_KEY)`.
- **Required environment variables:** `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (falls back to `SUPPORT_FROM_EMAIL` → `SUPPORT_EMAIL`), `SENDGRID_FROM_NAME`, `ENABLE_REAL_EMAIL` (default `true`).
- **Required webhooks:** **none configured.** No SendGrid Event Webhook endpoint exists in this codebase.
- **Authentication method:** API key.
- **Dependencies:** `@sendgrid/mail` (v8.1.6, current, MIT license, no known CVE).
- **Current implementation status:** fully implemented for outbound send; when disabled/unconfigured, `sendEmail()` silently no-ops (`{sent:false, skipped:true}`) rather than throwing — most callers don't check the return value, so this is effectively silent in production if misconfigured.
- **Known risks:** **zero bounce/suppression-list handling found anywhere** — a hard-bounced or suppressed address will keep being sent to indefinitely with no feedback loop; this can affect SendGrid sender reputation over time. No dedicated CVE/security risk beyond this operational gap.
- **Belongs in the Integrations Center:** **Yes**, with an honest caveat on the card: "Suppression/bounce status" as requested in the original spec **cannot be shown today** — there is no data source for it. Recommend either building the Event Webhook first (a real, scoped follow-up item) or shipping the card without that field rather than fabricating a status.

---

## 4. Google Maps (two genuinely separate products/keys)

- **Purpose:** (a) `GOOGLE_MAPS_BROWSER_KEY` — client-side Places Autocomplete, Distance Matrix (fare-estimate distance), Geocoder, live-tracking map rendering. (b) `GOOGLE_ROUTES_API_KEY` — server-side Routes API v2, used only for driver-ETA estimation.
- **Production/Test status:** N/A (Google API keys aren't test/live-scoped the way Stripe's are).
- **Health status:** `/api/health` reports `Boolean(GOOGLE_MAPS_BROWSER_KEY)`; the server-side key has no equivalent boolean reported anywhere found in this audit.
- **Required environment variables:** `GOOGLE_MAPS_BROWSER_KEY` (client-safe, referrer-restricted by design), `GOOGLE_ROUTES_API_KEY` (server-side secret), plus `ROUTE_API_TIMEOUT_MS`, `ROUTE_API_MONTHLY_QUOTA`, `ROUTE_API_MOVEMENT_THRESHOLD_MILES` tuning the server-side path's cost/behavior.
- **Required webhooks:** none — both are request/response APIs.
- **Authentication method:** API key, per-request header (`X-Goog-Api-Key` for Routes API) or URL param (Maps JS).
- **Dependencies:** none — both are raw `fetch()`/dynamic-`<script>` integrations, no SDK.
- **Current implementation status:** the browser key is confirmed genuinely live (Places/Distance Matrix/Geocoder all wired into `rider-dashboard.html`'s ride-request wizard, per this project's own recent work — see PR #92). The server-side Routes API key is fully implemented (`callGoogleRoutesApi()`) but gated behind `dispatch_route_api_enabled` (a `system_flags` row, default `false`) and — per `docs/eta-persistence-plan.md`/`docs/staging-stripe-test-mode-plan.md` — intentionally kept off in production; only the Haversine-only ETA path is currently live.
- **Known risks:** confirmed **not** a naming duplication (the prior audit's open question) — two independently-used keys for two independent Google Cloud products. The live-domain "Distance unavailable" issue investigated separately in this project's history is a `GOOGLE_MAPS_BROWSER_KEY` configuration question (key/API-enablement/billing in Google Cloud Console), unrelated to the server-side key.
- **Belongs in the Integrations Center:** **Yes**, as two separate cards (browser key vs. server-side Routes API), since they're operated, billed, and risk-managed independently — combining them into one card would hide the fact that one is live-by-default and the other is a cost-gated, currently-off feature flag.

---

## 5. Supabase (database, storage, auth, realtime)

- **Purpose:** primary datastore (45 tables), file storage for driver/rider photos and delivery proof, and (unused) auth capability.
- **Production/Test status:** one live project (`orgahzncmzptljapqffj`, `us-east-1`, Postgres 17.6.1, status `ACTIVE_HEALTHY` as of this audit) — no separate staging Supabase project referenced anywhere in the codebase (branching capability exists via the MCP tooling but no evidence a persistent staging branch is in regular use).
- **Health status:** `/api/health`'s `checkRequiredTables()` performs a real per-table existence/connectivity check — a genuine health signal, currently unauthenticated (readiness report P2-13).
- **Required environment variables:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (both required at boot via `requireEnv`, process exits if missing — correctly fail-closed).
- **Required webhooks:** N/A — the app connects directly via the service-role key, bypassing RLS by design; no Supabase-side webhook is used.
- **Authentication method:** service-role key (bypasses RLS entirely — this is why the RLS misconfiguration in readiness report **P0-8** hasn't been hit by the app's own traffic, but is still a real defense-in-depth gap for any other access path).
- **Dependencies:** `@supabase/supabase-js` (v2.110.8, one minor version behind, no known CVE).
- **Current implementation status by sub-feature:**
  - **Database:** fully live, 45 tables, 19 migrations, real row activity (422 audit-log rows, 25 drivers, 11 riders, 3 HTAF applications observed live).
  - **Storage:** genuinely used — three buckets (`driver-photos`, `rider-photos`, `delivery-proof-photos`), consistent upload→`getPublicUrl` pattern.
  - **Realtime:** **confirmed NOT used anywhere** — zero `.channel()`/`postgres_changes` calls found; "real-time" only appears as UI copy/section headings. Live tracking uses ordinary polling (`setInterval` + `fetch`) instead.
  - **Authentication (GoTrue):** **effectively dead code in practice.** A real verification path exists (`getUserFromRequest`/`supabase.auth.getUser`) as the third fallback branch inside `requireDriver()`, but nothing in the app's own sign-up/login flow ever issues a Supabase Auth JWT (no `signUp`/`signInWith*` call exists anywhere) — this app manages its own `riders`/`drivers`/admin tables and HMAC-signed sessions exclusively.
- **Known risks:** see readiness report **P0-8** (riders RLS misconfiguration), **P2-1** (3 tables with RLS fully disabled), **P2-2** (SECURITY DEFINER PostGIS functions), **P2-3** (postgis extension in public schema), **P2-4** (7-8 functions with mutable search_path). Backup/DR posture: **UNVERIFIED** (readiness report P1-12) — no tool available in this session to query the project's actual backup/PITR configuration or plan tier.
- **Belongs in the Integrations Center:** **Yes**, and this is the integration with the most real, buildable health signal already available (`checkRequiredTables()`). Recommend the card show Database/Storage connectivity (real), and be explicit that Realtime and Auth show "not in use" rather than a fabricated status, since showing them as monitored integrations would misrepresent the architecture.

---

## 6. Checkr (driver background checks)

- **Purpose:** driver background-check initiation and result tracking.
- **Production/Test status:** N/A (account-level, not key-prefix based).
- **Health status:** `/api/health` reports `Boolean(CHECKR_API_KEY)` only.
- **Required environment variables:** `CHECKR_API_KEY`, `CHECKR_WEBHOOK_SECRET`, `CHECKR_PACKAGE` (default `"driver_standard"`), `CHECKR_WORK_CITY`/`CHECKR_WORK_STATE`/`CHECKR_WORK_COUNTRY` (default Nashville, TN, US), `ENABLE_CHECKR` (default `true`).
- **Required webhooks:** `POST /api/checkr/webhook` — signature-verified, but **fails open** (`return true`) when `CHECKR_WEBHOOK_SECRET` is unset (readiness report P1-2).
- **Authentication method:** Basic auth (API key as username, empty password) on outbound REST calls.
- **Dependencies:** none — raw `fetch()`, no SDK.
- **Current implementation status:** `POST /api/checkr/start` is fully implemented and correctly `requireDriver`-gated. **Confirmed: no page in `public/` calls it.** This exactly matches the still-open finding in `docs/production-incidents.md` (2026-07-30) — unresolved as of this audit.
- **Known risks:** onboarding dead-end (readiness report P1-7); webhook fail-open (P1-2). "Pending invitations" as requested in the original card spec cannot be shown without new code — no invitation-status list endpoint exists today.
- **Belongs in the Integrations Center:** **Yes**, but today the honest card would show "Connected: [depends on key]" and then nothing else real — recommend building this card only alongside (not before) the onboarding-UI work that actually makes Checkr invitations happen, or the dashboard will display a permanently-empty, misleading "no activity" state for an integration nobody can actually trigger yet.

---

## 7. Persona (identity verification)

- **Purpose:** driver and rider identity verification (ID document + selfie match).
- **Production/Test status:** N/A.
- **Health status:** `/api/health` reports `Boolean(PERSONA_API_KEY)` — separately from and easily confused with `ENABLE_PERSONA` (the readiness-gate flag), a confusion `docs/production-incidents.md` specifically documents having caused a multi-week driver-onboarding outage.
- **Required environment variables:** `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_TEMPLATE_ID_RIDER` (falls back to `PERSONA_RIDER_TEMPLATE_ID` — confirmed intentional naming shim), `PERSONA_TEMPLATE_ID_DRIVER` (same pattern), `ENABLE_PERSONA` (default `true` — unchanged since the incident that traced a driver-lockout to this exact default).
- **Required webhooks:** `POST /api/persona/webhook` — signature-verified, but **fails open** when `PERSONA_WEBHOOK_SECRET` is unset (same class of gap as Checkr, readiness report P1-2).
- **Authentication method:** Bearer API key on outbound REST calls.
- **Dependencies:** none — raw `fetch()`.
- **Current implementation status:** `POST /api/persona/inquiry` is fully implemented server-side, **but has no working caller anywhere**: `driver-signup.html`'s "Start Persona Verification" button is a stub that only shows a status message and calls nothing; `rider-dashboard.html`'s equivalent button calls `POST /api/riders/start-persona`, **a route that does not exist on the server** — this specific 404-on-click is a new finding beyond what the prior incident log recorded.
- **Known risks:** the P0-3 identity-verification-bypass finding in the readiness report (client-supplied `user_id` with no auth) is currently **not reachable from the live product** (no UI can successfully trigger it), which lowers immediate exploitability but does not lower the severity of what should be fixed before this is wired up for real — fixing the auth gap should happen in the same PR that finally connects Persona to onboarding.
- **Belongs in the Integrations Center:** **Yes**, with the same caution as Checkr — build this card's real functionality alongside the onboarding-UI fix, not before, or it will show a permanently-empty state.

---

## 8. HTAF donation integrations (Zeffy / PayPal)

- **Purpose (as commonly assumed):** accept donations to the Harvey Transportation Assistance Foundation.
- **Actual implementation — plainly stated, since this is likely mischaracterized in prior planning:** **there is no backend integration with either Zeffy or PayPal.** Repo-wide search for "Zeffy" returns zero matches anywhere in the codebase. "PayPal" appears in exactly three files (`rider-dashboard.html`, `foundation.html`, `htaf-application.html`), in every case as a **plain outbound `<a href="https://www.paypal.com/us/fundraiser/charity/5906918" target="_blank">` link** — never a `fetch()` call, never an API key, never a webhook, never a donation-amount or donation-success callback of any kind. `server.js` itself has zero references to "paypal," "zeffy," or "donation."
- **Production/Test status:** N/A — not an API integration.
- **Health status:** N/A — the app has no visibility into whether the link even loads, let alone whether a donation succeeded.
- **Required environment variables:** none exist.
- **Required webhooks:** none exist.
- **Authentication method:** N/A.
- **Dependencies:** none.
- **Current implementation status:** a static outbound link, dismissible via a "No Thanks" button, shown after a successful ride request.
- **Known risks:** none from a security standpoint (it's just a link) — the risk here is purely **expectation-setting**: any dashboard or planning document that describes this as a monitorable "Zeffy" or "PayPal" integration will build a card with nothing real to show.
- **Belongs in the Integrations Center:** **No, not as a monitored integration.** If donation visibility is genuinely wanted, that requires first building a real backend integration (Zeffy has a documented API; PayPal Donations/Checkout API is another option) — that's new product work, not something the Integrations Center can surface from what exists today. Recommend removing "HTAF donation webhook health" from the dashboard's initial scope entirely, or explicitly labeling this card "External link only — no integration."

---

## 9. AI Providers (OpenAI)

- **Purpose:** `/api/ai/support` — a scoped, read-only tool-calling support/triage widget (HTAF status lookup, ride status lookup, ride-workflow navigation helper). Explicitly designed to never return addresses, fares, driver names, or phone numbers (confirmed both in code comments and in the actual tool-response shaping).
- **Production/Test status:** N/A.
- **Health status:** `/api/health` reports `Boolean(openai)`; when `openai` is null, the route returns a canned fallback reply rather than erroring.
- **Required environment variables:** `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`), `ENABLE_AI_SUPPORT` (default `true`).
- **Required webhooks:** none.
- **Authentication method:** Bearer API key (SDK-managed).
- **Dependencies:** `openai` npm package (v4.104.0 — **3 major versions behind** current 7.3.0; no known CVE, but this is the largest version gap of any dependency in the project — see readiness report P2-14).
- **Other AI providers in use:** **confirmed none.** Repo-wide search for Anthropic/Claude/Cohere/Gemini/Mistral references found matches only in `docs/ai-dispatch-commander-architecture.md`, describing a **separate, unmerged git branch** (`claude/ai-agents-upgrade-rvgfyh`) proposing a future multi-provider abstraction (`lib/pilotProvider.js`) — that file does not exist in the current working tree. OpenAI (`gpt-4o-mini`) is the only AI provider wired into the live codebase today.
- **Current implementation status:** fully implemented and live; cost controls are a hard 4-turn cap and a 20-requests/minute rate limit.
- **Known risks:** **zero usage/cost tracking** — `completion.usage` (token counts) is never read or stored anywhere; the only per-call record is an audit-log entry noting message length in characters, not cost (readiness report P2-7).
- **Belongs in the Integrations Center:** **Yes**, but "Usage summary" as originally specified **cannot be shown today** without adding token-usage logging first — recommend building that logging as a prerequisite, not fabricating a usage number from message-length proxies.

---

## 10. Render (deployment infrastructure)

- **Purpose:** hosts the running Node process.
- **Production/Test status:** N/A — this is infrastructure, not an API this app calls.
- **Health status:** **UNVERIFIED** — no Render API access from this environment; cannot report current deployment status, commit, or uptime.
- **Required environment variables:** none that this app reads *for* Render specifically — `RENDER_EXTERNAL_URL` is one fallback link in the `APP_BASE_URL` resolution chain, which is Render *injecting* a variable into the process, not the app calling Render's API.
- **Required webhooks:** none.
- **Authentication method:** N/A.
- **Dependencies:** none — confirmed no Render SDK, no `render.yaml`, no `Procfile` anywhere in the repository. Deployment is inferred to be Render's standard Node-buildpack auto-detection from `package.json`.
- **Current implementation status:** N/A (not an app-level integration).
- **Known risks:** none identifiable from code; everything about Render's actual configuration (env vars, deploy hooks, scaling, custom domain/SSL state) is **UNVERIFIED** from this environment.
- **Belongs in the Integrations Center:** **Only if a Render API token is provisioned specifically for this purpose** — the dashboard's "Render deployment status / current production commit / environment" fields cannot be populated from anything currently in this codebase; they would require a new, separate integration (Render's own REST API) built from scratch, with its own new API key to manage and protect (itself subject to the same "never display secrets" rule as everything else).

---

## 11. GitHub Actions (CI)

- **Purpose:** run tests on every push/PR to `main`.
- **Production/Test status:** N/A.
- **Health status:** visible via the GitHub Actions UI/API; not surfaced anywhere inside this application today.
- **Required environment variables:** none beyond what GitHub Actions provides automatically.
- **Required webhooks:** N/A (GitHub Actions is itself often a webhook consumer of GitHub events, not something this app has a webhook relationship with).
- **Authentication method:** N/A.
- **Dependencies:** N/A.
- **Current implementation status:** one workflow (`.github/workflows/ci.yml`), 3 steps (`npm install`, `node -c server.js`, `npm test`), matrix on Node 20.x/22.x. No lint, no `npm audit`, no schema-drift check (readiness report P1-11).
- **Known risks:** none security-relevant; the gap is coverage (see P1-11).
- **Belongs in the Integrations Center:** **Optional, lower priority** — a "last CI run status" card is easy to build (GitHub's own API) and low-risk (no secrets to protect beyond a read-only GitHub token), but it's operationally distinct from the payment/comms/verification integrations that are the dashboard's core purpose. Reasonable to defer to a later phase.

---

## 12. Remaining services — confirmed none found

Searched explicitly and found **no evidence of**: a dedicated error-tracking/APM service (Sentry, Datadog, New Relic, etc. — none referenced in `package.json` or code), an uptime-monitoring service, a CDN/edge-config service beyond whatever Render provides by default, a separate analytics platform (no Segment/Mixpanel/Amplitude/GA reference found in `public/*.html` beyond a generic `trackEvent()` helper that appears to be a local no-op/console-log wrapper, not verified against any real analytics backend in this pass), or any additional payment/identity/communications vendor beyond the 7 covered above. If any of these exist purely as Render environment configuration with no corresponding code reference, they are **UNVERIFIED** from this environment, not confirmed absent.

---

## 13. Architecture recommendation for the eventual dashboard build

(Recorded here per the original request that "additional providers can be added later without redesigning the page" — a design note, not implementation.)

- Model each integration as a small, self-describing config object (`{ name, envVarsRequired: [...], healthCheck: fn, webhookAction: "..." }`) rather than hardcoding a card per provider in the page markup — this satisfies "do not hardcode providers" without needing to build a full plugin system for what is currently 7-9 real integrations.
- The existing `GET /api/health` boolean-configured pattern is the right foundation to extend, not replace — it already has the right shape (per-integration object), it just needs to move behind admin auth (it's currently unauthenticated — readiness report P2-13) and grow richer fields per integration as instrumentation is added.
- Recommend explicitly **not** building real functionality for the Checkr, Persona, or HTAF-donation cards until their underlying gaps (P1-7 for the first two, "not a real integration at all" for the third) are resolved — a dashboard showing permanently-empty or fabricated status for three of nine cards on day one undermines trust in the other six that do have real data.
