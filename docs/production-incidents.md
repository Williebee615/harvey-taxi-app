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

### Configuration drift — OPEN

Render's boot log for this service shows:

```
🏠 App URL: https://harvey-taxi-app-2.onrender.com
==> Available at your primary URL https://harveytransportationfoundation.com + 4 more domains
```

`APP_BASE_URL` is resolving to Render's auto-assigned URL, not
`https://harveytaxiservice.com`, and Render considers the *foundation*
domain — not the taxi domain — this service's primary URL. Root cause:
`server.js`'s resolution order is
`PUBLIC_APP_URL → APP_BASE_URL → RENDER_EXTERNAL_URL → localhost`, and
neither `PUBLIC_APP_URL` nor `APP_BASE_URL` is set in Render's
environment configuration for this service, so it falls through to
Render's own URL.

**Required action** (Render dashboard — no tool in this environment has
access to Render's control plane, so this cannot be set by the agent):

1. Render dashboard → harvey-taxi-app service → Environment.
2. Add `PUBLIC_APP_URL=https://harveytaxiservice.com`.
3. Save; let Render redeploy (or trigger a manual deploy).

This matters independently of the CORS fix: `APP_BASE_URL` is very
likely read elsewhere in the app beyond the origin allowlist (redirects,
generated links, any callback/webhook URLs built from it) — anything
keying off it is silently inheriting the wrong domain until this is
corrected. PR #59 makes the CORS check resilient to this drift; it does
not eliminate the drift itself.

**Verification checklist** (run after `PUBLIC_APP_URL` is set and the
service redeploys):

- [ ] Render boot log shows `🏠 App URL: https://harveytaxiservice.com`
- [ ] `APP_BASE_URL` resolves to `https://harveytaxiservice.com`
- [ ] Request from `https://harveytaxiservice.com` — accepted
- [ ] Request from `https://www.harveytaxiservice.com` — accepted
- [ ] Request from the foundation domain — accepted
- [ ] Request from the foundation domain's `www.` variant — accepted
- [ ] Request from an unrelated/unknown origin — still blocked
- [ ] Rider signup succeeds end-to-end from the live production domain

**What this agent can / cannot verify directly**: no Render API or
dashboard access in this environment — cannot set `PUBLIC_APP_URL` or
pull a fresh boot log independently. This environment's own network
policy also blocks outbound requests to `harveytaxiservice.com`, so the
live-domain checks above cannot be run from here either. Supabase log
and schema access *is* available, so once a real signup is attempted
after the fix, a successful `POST /rest/v1/riders` in Supabase's `api`
logs can serve as independent, corroborating evidence alongside
whatever's observed directly against the live site.

### Launch impact

**Conditional / non-blocking**, contingent on the verification checklist
above passing. PR #59 already covers the fallback case even before
`PUBLIC_APP_URL` is corrected, so the code defect does not block launch
on its own. If post-fix smoke testing confirms rider signup and
authenticated requests succeed from the live production domain, this
incident does not block launch — only the `PUBLIC_APP_URL` environment
cleanup remains open, tracked here until closed. If verification surfaces
a remaining defect, escalate before launch rather than closing this
entry.
