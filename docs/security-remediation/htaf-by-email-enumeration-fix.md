# HTAF Fix 1 of 3 — Eliminate Unauthenticated By-Email Enumeration

Status: **highest-priority fix from `docs/security-remediation/
htaf-admin-pii-audit.md` (finding 3).** Scoped narrowly to this one
issue per explicit instruction; the admin data-minimization, AI-triage,
admin-RBAC, and trusted-proxy/rate-limit work are each their own
separate, later PR.

## The problem (restated from the audit)

`GET /api/foundation/applications/by-email` was public, unauthenticated,
and keyed by an arbitrary `?email=` query parameter. A 200 response with
a non-null `application` confirmed "this email address has submitted a
charity transportation-assistance application" — a sensitive fact about
a real person (implies financial hardship, medical need, or disability
depending on program type), independent of which fields the response
contained. Unlike `GET /api/foundation/status/:code`, which requires the
caller to already possess a high-entropy application code, an email
address is not a secret — it's guessable, often public, or already known
to anyone who wants to check a specific person. The only mitigation was
a 20-requests/minute-per-IP rate limit, which doesn't stop a slow sweep
and is trivially diluted by rotating IPs (compounded by `getClientIp()`
trusting `X-Forwarded-For` with no trusted-proxy check — a separate,
systemic issue tracked for its own PR, not touched here).

## Client page that depended on this route (documented before removing it)

**`public/rider-dashboard.html`**, `loadHtafStatus()` — called on every
dashboard boot to populate the "HTAF application status" card. It read
`state.riderProfile?.email` and passed it as the `?email=` query param.

Critically, `state.riderProfile` in the current (pre-rider-auth-rollout)
code path comes from `getStoredRiderProfile()` — `localStorage`/
`sessionStorage`, i.e. **client-supplied, unauthenticated data**, the
exact pattern this repo's whole rider-auth security program exists to
close. So even the "legitimate" internal use of this route wasn't
actually backed by any server-side proof of ownership — a rider's
dashboard was asking the server to check an email that the *browser*
claimed was theirs, not one the server had verified.

## What this PR does

**Removed** `GET /api/foundation/applications/by-email` entirely — no
public route remains that accepts an arbitrary email and reports
whether it has an HTAF application.

**Added** `GET /api/rider/htaf-application` — `requireRider`-gated
(the same session-cookie middleware already used by
`GET /api/rider/session`), returning the same minimal field set
(`application_code, status, program_type, created_at, updated_at`) but
looked up by **`req.rider.email`** — the server's own verified record of
who is signed in — never a request query or body parameter. A rider can
therefore only ever look up their own application. There is no longer
any code path, public or authenticated, where an arbitrary email can be
tested against the HTAF table.

The decision logic is pulled into a pure, tested function,
`resolveRiderHtafLookup(rider)` (`lib/htafOperations.js`):
- No rider / not an object → `{ ok: false, statusCode: 401 }`. Fails
  closed before any query happens.
- Rider present but no email on file → `{ ok: true, email: null }` — a
  real "no application" fact, not an auth error, so the route returns
  `{ application: null }` rather than a 4xx.
- Rider with an email → `{ ok: true, email: rider.email }`, trimmed but
  otherwise untouched.

**Preserved unchanged**: `GET /api/foundation/status/:code` — still the
public applicant-status mechanism, still keyed by the high-entropy
application code, still returning the same 5 fields. Nothing about it
was touched.

**`rider-dashboard.html`**: `loadHtafStatus()` now calls
`GET /api/rider/htaf-application` with no query parameters.
`requestJson()` already sends `credentials: "include"` and already
throws on any non-2xx/`ok:false` response, and the existing `catch`
block already treats any failure as "no application found" (sets
`state.htafApplication = null` and renders the empty-state card) — so a
401 from a rider who doesn't yet have a session (the common case while
`rider_auth_ui_enabled` stays off in production) degrades to the same
empty state the card already shows for a rider with no HTAF
application, rather than an error banner. No new error-handling branch
was needed; the existing one already does the right thing here.

## Explicit adherence to the constraints given

- **Did not treat an email address as proof of authorization anywhere**
  — the new route never reads an email from the request at all.
- **Generic responses**: the new route's only two outcomes are `401`
  (no session) and `200` with `{ application: ... | null }` — there is
  no way to distinguish "this email exists but you're not authenticated
  as it" from "this email doesn't exist," because the route never
  accepts an email to check in the first place. The enumeration surface
  isn't narrowed, it's removed.
- **Did not modify**: `rider_auth_ui_enabled`/`rider_auth_enforced`
  flags, payment ownership routes, `GET /api/admin/foundation/
  applications`'s `select("*")` behavior, the CSV export, AI triage, the
  admin auth model, or `getClientIp()`/rate-limit internals. Confirmed
  by diff — the only files touched are `server.js` (route swap),
  `lib/htafOperations.js` (+tests), and `rider-dashboard.html` (one
  function body).
- **Documented the dependent client page** (`rider-dashboard.html`)
  above, before making the change, per the explicit instruction.

## Tests

`lib/htafOperations.test.js`, new `describe("resolveRiderHtafLookup
(anti-enumeration regression coverage)")` block (5 tests):

- No authenticated rider (`null`/`undefined`/non-object) fails closed
  with 401 rather than attempting any lookup.
- A real rider's own email is used correctly.
- A rider with no email on file (`null`/missing/whitespace-only) gets a
  real "no application" result, not an error — confirms the route won't
  throw or 500 on this edge case.
- **The core regression guard**: an adversarial rider object carrying
  `requestedEmail`, `query.email`, and `body.email` fields (all set to
  a different, "victim" email) still resolves to the *actual*
  `rider.email` — proving no future refactor can accidentally thread a
  client-supplied email through as if it were the session's own. This
  is the direct, testable encoding of "do not treat an email address as
  proof of authorization."
- Whitespace is trimmed; casing and the email itself are otherwise
  passed through unchanged.

Full suite: **363/363 passing** (`npx jest`), no regressions.
`node -c server.js` clean; both `rider-dashboard.html` inline
`<script>` blocks pass `node -c` after extraction.

### What these tests do not cover, and why

Route-level integration testing (actually sending an HTTP request
through `requireRider` and the new route handler) isn't part of this
codebase's toolkit — `server.js` isn't set up to be `require()`'d
without booting a real listener and connecting to Supabase (confirmed:
no `module.exports`, no `require.main` guard), and every existing test
file in this repo follows the same pattern of testing extracted pure
`lib/*.js` logic rather than live routes. The pure-function test above
covers the actual security property (the session's own email always
wins, no matter what a request tries to smuggle in); the route's HTTP
wiring (`requireRider` → `resolveRiderHtafLookup` → Supabase query) was
verified by direct code reading, not a live click-through, consistent
with how this repo has classified untestable-in-Jest paths elsewhere
(e.g. `docs/security-remediation/pr-02c-signup-session-handoff.md`'s
verification table).

## Rollback plan

Trivial revert — no migration, no flag, no data touched. Reverting
restores the old public-by-email route (and its pre-existing
enumeration gap) and the old `rider-dashboard.html` fetch call exactly
as they were.

## Next in this sequence

Per the agreed order: HTAF admin data minimization (`select("*")` →
allow-lists, a real single-record detail endpoint, an audited
server-side CSV export) is the next PR, followed by AI-triage privacy
hardening. Admin RBAC redesign and trusted-proxy/rate-limit hardening
remain their own separate, larger projects, not folded into either.
