# HTAF Admin PII / Authorization Audit — Investigation Only

Status: **investigation only, no code changed.** Per explicit instruction:
map which admin roles can see which HTAF fields, whether `select("*")`
is necessary anywhere, and whether the by-email lookup creates an
enumeration/privacy risk — before touching any code. This document is
the map. Nothing in this PR-repair family should be re-opened to fix
these; they're tracked here for a future, separate PR.

## 1. Every route that touches `htaf_applications`, and what it exposes

| Route | Auth | Fields returned | Notes |
|---|---|---|---|
| `POST /api/foundation/apply` | none (public, gated by `ENABLE_HTAF_APPLICATIONS`) | writes only; returns `application_id`, `application_code`, `status` | Applicant's own submission — expected to see this. |
| `GET /api/foundation/status/:code` | none (public) | `application_code, status, program_type, created_at, updated_at` | Keyed by a high-entropy application code (`HTAF-YYYYMMDD-XXXXXX`) — the requester must already possess it. No PII fields. Good precedent. |
| `GET /api/foundation/public-stats` | none (public) | 4 aggregate integers only | Added in the flow-repair PR (#103); queries `status` column only. No PII possible. |
| `GET /api/foundation/applications/by-email` | none (public), rate-limited 20/min per IP | `application_code, status, program_type, created_at, updated_at` | **Keyed by email, not a secret code — see finding 3.** |
| `GET /api/admin/foundation/applications` | `requireAdmin` | `select("*")` — all 27 columns, up to 500 rows/page | **The main exposure — see finding 1.** |
| `PATCH /api/admin/foundation/applications/:id` | `requireAdmin` | writes `status`/`notes`; returns the full updated row (`select().single()`, i.e. all columns) | Same over-fetch as the list route, once per save. |
| `POST /api/admin/foundation/applications/:id/create-ride` | `requireAdmin` | reads full application row to build the ride; response includes the created/existing `ride`, not the application | Not a PII-response issue — flagged in finding 4 for a different reason. |
| `POST /api/admin/foundation/applications/:id/triage` | `requireAdmin`, rate-limited 20/min | sends a deliberately reduced field set to OpenAI; response is an AI summary, not raw applicant data | See finding 5 — reduced but not zero third-party exposure. |
| `GET /api/admin/foundation/schema-check` | `requireAdmin` | column **names** only (`htafSchemaStatus.columns`), never values | Clean. Confirmed by reading `inspectHtafSchema()` — it stores `Object.keys(sample)`, never the row's values. |
| `GET /api/admin/config-check` | `requireAdmin` | same schema-name metadata plus boolean env-var presence flags | Clean, no PII. |
| AI chat tool `lookup_htaf_status` (`/api/ai/support`) | none (public), rate-limited 20/min | same 5 fields as `/api/foundation/status/:code` | Explicitly documented in-code as "same trust tier as `/api/foundation/status/:code`" — keyed by the same high-entropy code, not a new risk. |

## 2. Admin role model: there is exactly one role

Read `requireAdmin` (`server.js:2069`) directly. There is **no
per-role or per-field access control anywhere in this codebase** — one
shared identity, reachable three ways:

1. A shared bearer token (`ADMIN_API_TOKEN`) via `x-admin-token`.
2. A shared password (`ADMIN_PASSWORD`) tied to one `ADMIN_EMAIL`, via
   headers or the login route.
3. A session cookie issued after either of the above.

All three produce the same `req.admin` shape and pass the same
`requireAdmin` gate. The only distinction anywhere in the admin surface
is `requireElevatedAdmin`, which requires specifically the token method
(not password/session) — but that's reserved for driver-compliance
overrides (`lib/driverCompliance.js`) and has nothing to do with HTAF.

**Answer to "which admin roles can see which HTAF fields": there is
only one admin role, and it can see every field of every application.**
There's no support-agent-vs-caseworker-vs-super-admin distinction to
scope down. Whoever holds the one shared admin credential — however
many people that is in practice — has full access to every applicant's
name, email, phone, income, and household size. This is a systemic
property of the whole admin surface (every `requireAdmin` route in this
app works this way), not something specific to HTAF, but it means any
HTAF-specific field-level fix (finding 1) still sits behind a
single-tier gate, not a scoped one.

## 3. `GET /api/foundation/applications/by-email` — real enumeration/privacy risk

This is the one the by-email lookup question was really asking about,
and it's a genuine finding, not a false alarm:

- **No authentication at all** — anyone on the internet can call it.
- **Keyed by email address**, not a secret. Contrast with
  `/api/foundation/status/:code`, which requires the caller to already
  possess a high-entropy code (effectively a bearer token generated at
  submission time and only ever given back to the applicant). An email
  address is not a secret — it's often public, guessable, or already
  known to an attacker who wants to check a specific person.
- **The fact returned is itself sensitive**, even though the field list
  looks minimal. A 200 response with a non-null `application` confirms
  "this email address has applied for charity transportation
  assistance" — which implies financial hardship, medical need, or
  disability, depending on `program_type`. That's a privacy-sensitive
  fact about a real person, independent of whether their name/phone/
  income also leaks. The code comment justifying this route
  ("exposing nothing beyond what `/api/foundation/status/:code` already
  exposes") is true for the *field list* but misses this: the *lookup
  key* is the actual privacy boundary here, not just which columns come
  back.
- **Rate limiting is weak and mis-targeted.** `rateLimit({ windowMs:
  60_000, max: 20, keyPrefix: "htaf_status_by_email" })` uses the
  default `keyFn` (`getClientIp`), so the limit is 20 requests/minute
  *per IP*, not per queried email. That caps how fast one IP can sweep
  through a list of candidate emails, but does nothing to prevent a
  slow sweep (20/min = ~28,800/day, indefinitely, from a single IP) or
  a distributed one (rotating IPs/proxies trivially resets the
  counter). It also doesn't stop repeated checks *of the same* email
  from different IPs, which isn't the concern here, but underscores that
  the limit is shaped around abuse-rate, not enumeration-prevention.
- **Compounding factor, not HTAF-specific:** `getClientIp()`
  (`server.js:983`) takes the first `X-Forwarded-For` entry with no
  check that it came from a trusted proxy hop. If Render doesn't strip
  or validate that header before this app sees it, a caller can set
  their own `X-Forwarded-For` value per request and get a fresh
  rate-limit bucket every time, making even the 20/min-per-IP limit
  close to meaningless. This weakens every IP-keyed rate limit in the
  app, not just this route — worth its own look as part of PR9
  (secrets/session hardening, already tracked), but it directly
  undermines this route's only real mitigation, so it's noted here too.

This route exists so the rider dashboard can show "do I have an HTAF
application" using an email the rider already typed in on their own
account — a legitimate use case. The risk is that the same endpoint is
reachable by anyone, for any email, with no proof the caller owns it.

## 4. `select("*")` on `htaf_applications` — where it's used vs. what's actually needed

Traced every field the admin UI (`public/admin-htaf.html`) actually
reads, against the 27 columns `select("*")` returns:

**Used in the list view** (rendered for every row, all fetched
applications at once): `application_code`, `first_name`, `last_name`,
`email`, `phone`, `county`, `city`, `transportation_need`, `status`,
`program_type`.

**Used only in the single-application detail view** (rendered once an
admin clicks into one specific application): `applicant_type`,
`household_size`, `monthly_income`, `destination`, `pickup_city`,
`ride_date`, `notes`.

**Never read anywhere** — not in `server.js`, not in
`admin-htaf.html`, not in any other file in this repo (confirmed by
grep across the whole codebase, not just these two files):
`review_notes`, `assigned_admin`, `client_version`, and `source`. Four
dead columns, fetched and shipped to the browser on every list load for
no reason.

**Is `select("*")` "necessary anywhere"? No — not as currently used.**
The list endpoint is the only place `htaf_applications` rows are ever
fetched by the admin client (there is no separate `GET .../:id`
detail-fetch route — the detail view and the CSV export both just index
into the array already returned by the list call). That means every
admin page load returns full PII (email, phone, income, household
size) for up to 500 applications, even though the list view itself only
displays 10 of those fields and the rest are only needed for whichever
one application (if any) the admin actually opens. A route split — a
reduced-field list endpoint plus a new, separately auditable
`GET .../:id` detail endpoint fetched only on click — would close this
without losing any functionality, but that's a code change and out of
scope for this investigation.

The `PATCH .../:id` route has the same shape of over-fetch: it returns
`select().single()` (all columns) after every status/notes update, when
the admin UI only needs to know the write succeeded.

## 5. CSV export — full PII, client-side only, zero audit trail

`exportApplicationsCsv()` (`admin-htaf.html:4537`) builds a CSV
containing `application_code, status, program_type, first_name,
last_name, email, phone, county, city, pickup_city, destination,
ride_date, applicant_type, household_size, monthly_income, created_at,
updated_at` and triggers a browser download — entirely client-side,
from data already sitting in the page's `applications` array (itself
sourced from the over-fetching list endpoint in finding 1). Compare
this to every other admin write action on this page
(`htaf_application_updated`, `htaf_application_ai_triaged`,
`htaf_application_converted_to_ride`), each of which calls `auditLog()`
server-side. **A bulk export of every applicant's full PII — the
single highest-leverage action available on this page — is the one
action that leaves no audit trail at all.** There is no server
round-trip to log, rate-limit, or restrict; it's a pure client-side
operation the browser can perform the instant the list endpoint's data
is already loaded, using data the admin's session was already handed
in finding 1.

## 6. AI triage — reduced but non-zero third-party exposure

`triageHtafApplication()` (`server.js:4810`) deliberately excludes
`first_name`, `last_name`, `email`, and `phone` from what it sends to
OpenAI — confirmed by reading the `facts` object literal directly, not
assumed. That's real, intentional minimization and should be credited
as such.

It does still send `household_size`, `monthly_income`,
`transportation_need` (free text describing the applicant's need,
sometimes medical), and `destination`/`pickup_city`. Those last two are
column names that suggest city-level granularity, but the create-ride
route (`server.js:16888`, pre-repair and post-repair alike) uses
`application.destination` and `application.pickup_city` directly as a
ride's `pickup_address`/`dropoff_address` — meaning applicants are
expected to enter full street addresses in these fields in practice,
not just city names. If so, AI triage is sending real addresses
(potentially a specific clinic, hospital, or dialysis center) to
OpenAI, along with income and stated medical/transportation need. This
app already carries a "HIPAA/BAA privacy placeholder, legal-review
TODO" from earlier work — AI triage is a concrete new data flow that
TODO should be checked against before HTAF's AI features are
considered production-safe for sensitive program types (the
`program_type` field itself isn't inspected here, but this is exactly
the kind of interaction the existing placeholder was meant to flag).

## Summary, ranked by how directly it exposes real people

1. **`GET /api/foundation/applications/by-email`** — unauthenticated,
   enumerable by anyone who can guess or already knows an email,
   confirms a sensitive fact (finding 3). Highest priority: this is
   reachable by anyone on the internet today, no admin credential
   needed.
2. **CSV export with zero audit trail** (finding 5) — requires an admin
   credential, but that credential is a single shared secret (finding
   2) with no differentiation, and a bulk PII export currently leaves
   no record of who did it or when.
3. **`select("*")` over-fetch on the list/patch routes** (finding 4) —
   requires an admin credential; the risk is blast radius (every page
   load ships full PII for up to 500 people, dead columns included)
   rather than an access-control gap per se.
4. **Single flat admin role** (finding 2) — a pre-existing, app-wide
   property, not HTAF-specific; relevant context for prioritizing 2 and
   3, not a new defect to fix in isolation.
5. **AI triage's data minimization gap** (finding 6) — partially
   mitigated already (name/email/phone excluded); the remaining fields
   sent to OpenAI are a real but lower-urgency concern, and overlaps
   with the pre-existing HIPAA/BAA TODO rather than being a new gap.

No code was changed to produce this document. Recommend deciding scope
and priority order from this list before any implementation PR is
opened.
