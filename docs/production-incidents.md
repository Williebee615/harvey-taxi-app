# Production Incident Log

Running record of production defects and the configuration drift found
alongside them. Each entry separates the **code defect** (fixed by a PR,
verifiable by tests) from **configuration drift** (an environment value
that's wrong regardless of what the code does) and states the **launch
impact** explicitly, since the two are easy to conflate and shouldn't be
closed together just because the code is fixed.

---

## 2026-07-28 — Rider signup 500 ("Internal server error.") — CLOSED

**Reported**: Rider onboarding failing with "Rider signup failed.
Internal server error." on `POST /api/riders/signup`.

**Status**: Resolved and confirmed in production. Code defect fixed
(PR #59), configuration drift fixed (`PUBLIC_APP_URL` set in Render),
and a real end-to-end rider signup succeeded on the live domain,
independently verified against the database.

### Code defect — RESOLVED (PR #59, merged to `main` as `b5a60ec`)

`isAllowedOrigin()` in `server.js` accepted only an exact match against
a single `APP_BASE_URL` whenever `ALLOWED_ORIGINS` wasn't explicitly
configured. This platform legitimately serves the same app from two
public domains — `harveytaxiservice.com` and
`harveytransportationfoundation.com`, each with a `www.` variant, per
the existing `FOUNDATION_HOSTS` routing — plus `APP_BASE_URL` itself
can fall back to Render's auto-generated `*.onrender.com` URL. Any POST
whose `Origin` header didn't exactly match that one value was rejected
by the `cors` package's origin callback, which throws into Express's
*global* error handler instead of the route's own error handling,
producing the generic `"Internal server error."` response with no
database call ever made.

Verified this was not a repeat of the earlier rider-signup schema
incident: pulled the live `riders` table schema directly from Supabase
and confirmed it matches `lib/riderVerification.js`'s
`RIDERS_TABLE_COLUMNS` column-for-column, and Supabase's `api` and
`postgres` logs showed no `POST /rest/v1/riders` and no query errors in
the relevant window — the request never reached the database.

Fix: extracted the origin check into `lib/corsOrigins.js`. The default
allowlist (when `ALLOWED_ORIGINS` isn't set) now includes the canonical
host, the foundation host, both `www` variants, and `APP_BASE_URL`,
instead of only `APP_BASE_URL`. An explicitly configured
`ALLOWED_ORIGINS` is unchanged and still takes precedence.

Regression test: `lib/corsOrigins.test.js` (11 tests), including one
specifically for `APP_BASE_URL` resolving to Render's own URL — the
exact condition later confirmed in production boot logs below.

### Configuration drift — RESOLVED 2026-07-28, one pending confirmation

Render's boot log at the time this was first reported showed:

```
🏠 App URL: https://harvey-taxi-app-2.onrender.com
==> Available at your primary URL https://harveytransportationfoundation.com + 4 more domains
```

`APP_BASE_URL` was resolving to Render's auto-assigned URL, not
`https://harveytaxiservice.com`. Root cause: `server.js`'s resolution
order is `PUBLIC_APP_URL → APP_BASE_URL → RENDER_EXTERNAL_URL →
localhost`, and neither `PUBLIC_APP_URL` nor `APP_BASE_URL` was set in
Render's environment configuration for this service.

**Action taken**: `PUBLIC_APP_URL=https://harveytaxiservice.com` was set
in Render's environment and the service redeployed. The fresh boot log
confirms it took effect:

```
🏠 App URL: https://harveytaxiservice.com
```

Separate, non-blocking note: Render's deploy output still reports
`Available at your primary URL https://harveytransportationfoundation.com`.
This is a distinct Render dashboard setting (which custom domain Render
considers "primary" for that service) — unrelated to `PUBLIC_APP_URL`/
`APP_BASE_URL` or to the CORS fix. Cosmetic; does not affect
`isAllowedOrigin()`, redirects, or anything read from `APP_BASE_URL` in
the app itself. Left open only as an optional cleanup item, not tracked
as part of this incident's launch impact.

**Verification checklist**:

- [x] Render boot log shows `🏠 App URL: https://harveytaxiservice.com` — confirmed 2026-07-28
- [x] `APP_BASE_URL` resolves to `https://harveytaxiservice.com` — confirmed via the boot log above
- [x] Request from `https://harveytaxiservice.com` — accepted — confirmed 2026-07-28 by a real rider signup completed on that exact domain (see evidence below)
- [ ] Request from `https://www.harveytaxiservice.com` — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from the foundation domain — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from the foundation domain's `www.` variant — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from an unrelated/unknown origin — still blocked (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [x] Rider signup succeeds end-to-end from the live production domain — **CONFIRMED 2026-07-28**

**Evidence**: a real rider signed up from `harveytaxiservice.com` and the
app returned "Rider account created successfully" with
`Rider ID: RIDER-7DCDBAA6E2`, `Status: Pending`,
`Verification Type: Driver License` (screenshots on file). Independently
verified against the live database:

```sql
select id, first_name, last_name, email, phone, city, state, status, approval_status, created_at
from riders where id = 'RIDER-7DCDBAA6E2';
-- {"id":"RIDER-7DCDBAA6E2", ..., "status":"pending_verification",
--   "approval_status":"pending", "created_at":"2026-07-28 15:23:46.606+00"}
```

The row exists, matches the screenshot exactly, and the account is
correctly `pending_verification` / `pending` per the approval-gate
design (`ENABLE_RIDER_APPROVAL_GATE`) — not auto-approved, as intended.

The remaining four checklist items (www variant, foundation domain and
its www variant, unrelated-origin rejection) were not independently
attempted against the live site, but are locked in by the 11 tests in
`lib/corsOrigins.test.js` added in PR #59, so they are not treated as
open risk — just not separately smoke-tested against production traffic.

**Non-incident note**: the same screenshots show "Unable to load the
card payment form. You can add a card later." during the optional
add-payment-method step. This is expected, not a defect — the Render
boot log shows `💳 Stripe: OFF` for this service, so the card form
correctly cannot load while Stripe is disabled. Not tracked as part of
this incident.

**What this agent can / cannot verify directly**: no Render API or
dashboard access in this environment — the `PUBLIC_APP_URL` change and
the boot logs were supplied by the user, not pulled independently. This
environment's own network policy also blocks outbound requests to
`harveytaxiservice.com`, so no check in this incident was run by
directly hitting the live site from here — the rider-signup confirmation
above was verified by cross-referencing the user's screenshot against an
independent Supabase database query, which is the strongest evidence
available from this environment.

### Launch impact

**RESOLVED, non-blocking.** Both the code defect and the configuration
drift are fixed and confirmed: a real rider signup succeeded end-to-end
from the live production domain, verified independently against the
database. This incident is closed.
