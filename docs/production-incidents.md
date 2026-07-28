# Production Incident Log

Running record of production defects and the configuration drift found
alongside them. Each entry separates the **code defect** (fixed by a PR,
verifiable by tests) from **configuration drift** (an environment value
that's wrong regardless of what the code does) and states the **launch
impact** explicitly, since the two are easy to conflate and shouldn't be
closed together just because the code is fixed.

---

## 2026-07-28 — Rider signup 500 ("Internal server error.")

**Reported**: Rider onboarding failing with "Rider signup failed.
Internal server error." on `POST /api/riders/signup`.

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
- [ ] Request from `https://harveytaxiservice.com` — accepted (pending a real signup attempt)
- [ ] Request from `https://www.harveytaxiservice.com` — accepted (pending)
- [ ] Request from the foundation domain — accepted (pending)
- [ ] Request from the foundation domain's `www.` variant — accepted (pending)
- [ ] Request from an unrelated/unknown origin — still blocked (pending)
- [ ] Rider signup succeeds end-to-end from the live production domain (pending)

Checked Supabase's `api` logs after the redeploy: no `POST
/rest/v1/riders` yet, only routine `GET /rest/v1/riders?select=*&limit=1`
health-check-style queries and unrelated ride/audit-log traffic. This is
neutral, not a defect signal — nobody has attempted a rider signup since
the redeploy, so there's no request yet to confirm against. The
remaining checklist items close as soon as a real signup is attempted
and either succeeds (expected) or surfaces something to investigate.

**What this agent can / cannot verify directly**: no Render API or
dashboard access in this environment — the `PUBLIC_APP_URL` change and
the fresh boot log above were both supplied by the user, not pulled
independently. This environment's own network policy also blocks
outbound requests to `harveytaxiservice.com`, so the live-domain checks
above cannot be run from here. Supabase log and schema access *is*
available and was used to confirm no request has reached the database
yet; the same check can confirm a successful insert once a real signup
is attempted.

### Launch impact

**Non-blocking.** Both the code defect and the configuration drift are
now addressed. The only remaining item is confirming a real end-to-end
signup succeeds from the live domain, which is expected to pass given
the boot log confirmation above — this entry stays open only until that
confirmation lands, not because of any known outstanding defect. If a
real signup attempt surfaces something unexpected, escalate immediately
rather than treating this as closed.
