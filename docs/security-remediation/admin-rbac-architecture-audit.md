# Admin RBAC Architecture & Authorization Audit

Status: **investigation and proposed architecture only — no authorization
code written.** Per explicit instruction, this stops here for review.
Nothing in this document changes `requireAdmin`, adds a role column,
or touches any route. The next, separate task (also not started) is
the trusted-proxy/rate-limit audit; after that, the rider-auth/ownership
sequence.

## READ THIS FIRST: a critical finding surfaced during the inventory

While cataloguing what data each admin route touches (not while looking
for this specifically), two routes were found to actively expose
**password hashes and live verification codes** to any holder of the
single flat admin credential:

- **`GET /api/admin/drivers`** and **`GET /api/admin/riders`** both use
  `.select("*")` with **no field allow-list**, and return the raw rows
  directly as `{ drivers: rows }` / `{ riders: rows }` with no
  stripping anywhere in the route.
- Confirmed via `information_schema.columns`: both `drivers` and
  `riders` have `password` and `password_hash` columns. Confirmed via a
  live, read-only count against production: **1 driver and 4 riders
  currently have a non-null `password_hash`** — this is not a
  theoretical/dead column, it holds real data today.
- The same `select("*")` also returns, among other things:
  `email_verification_token`, `sms_verification_code`, `sms_code`
  (raw, unhashed OTP codes with their own expiry columns — a live code
  could be used for account takeover before it expires),
  `email_verification_token_hash`, `sms_verification_code_hash`,
  `phone_verification_code_hash`, `persona_last_payload` /
  `checkr_last_payload` (raw third-party identity-verification/
  background-check webhook payloads, jsonb), and (riders only)
  `verification_payload`, `id_last4`, `stripe_customer_id`.
- Both routes are `requireAdmin`-gated only (the same single shared
  admin credential this whole audit is about), and both are real,
  live UI surfaces — confirmed via grep that `admin-dashboard.html`
  and `admin-live-dispatch-map.html` call them.

**This is independent of the RBAC redesign and does not need role
infrastructure to fix** — it's the same "explicit allow-list instead
of `select(\"*\")`" pattern already applied to the HTAF admin routes in
the prior PR sequence (#106). I flagged it here rather than fixing it
immediately because the instruction for this task was audit-only; recommend treating it as its own
small, urgent, separate PR (allow-list `drivers`/`riders` list-route
selects to the fields the admin UI actually renders) **before** or
**in parallel with** the RBAC work below, not gated behind it. Noted
again in the route inventory table (rows 21, 22) and factored into the
role-matrix recommendation for those two routes.

## Methodology

Every `app.get/post/patch/delete("/api/admin/...")` route in `server.js`
was located (35 distinct route+method combinations), then read directly
to determine: what table(s) it touches, what column selection it uses
(explicit list vs. `select("*")`), whether it writes, and what its
current middleware is. Two live, read-only Supabase queries (schema
introspection + the password-hash count above) were run to verify
claims rather than assume them from column names alone. No production
data was modified. No code was written or changed.

## Full route inventory

Legend — **Auth**: current middleware. **PII**: exposes personally
identifying applicant/driver/rider data. **Fin**: exposes or affects
fare, payout, or payment-processor data. **Compl**: exposes or affects
verification/background-check/deletion/audit state. **Writes**:
mutates production state (vs. read-only).

| # | Route | Method | Auth today | Data accessed | PII | Fin | Compl | Writes | Recommended min. role | Elevated/re-auth? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/api/admin/login` | POST | none (is the login itself) | admin email/password compare | — | — | — | session cookie | n/a (public entry point) | n/a |
| 2 | `/api/admin/logout` | POST | none | clears cookie | — | — | — | session cookie | n/a | n/a |
| 3 | `/api/admin/session` | GET | none (reads cookie) | admin's own email | — | — | — | no | n/a | n/a |
| 4 | `/api/admin/foundation/applications` | GET | requireAdmin | HTAF list, minimized (#106) | low | — | — | no | htaf_caseworker | no |
| 5 | `/api/admin/foundation/applications/:id` | GET | requireAdmin | HTAF full detail (name/email/phone/income/notes) | **yes** | — | — | no | htaf_caseworker | no |
| 6 | `/api/admin/foundation/applications/:id` | PATCH | requireAdmin | writes status/notes, minimized response (#106) | low (write) | — | — | **yes** | htaf_caseworker | no |
| 7 | `/api/admin/foundation/applications/export` | POST | requireAdmin | bulk full-PII CSV, audited+reason-gated (#106) | **yes (bulk)** | — | — | no (read+file) | htaf_caseworker, but see note | **yes — recommend requiring reason is already there; consider requiring super_admin or a second factor for bulk export given blast radius** |
| 8 | `/api/admin/foundation/schema-check` | GET | requireAdmin | column names only | — | — | — | no | any admin role (diagnostic) | no |
| 9 | `/api/admin/foundation/applications/:id/triage` | POST | requireAdmin | reads full application server-side, sends minimized facts to OpenAI (#107) | low (post-hardening) | — | — | no (no DB write) | htaf_caseworker | no |
| 10 | `/api/admin/foundation/applications/:id/create-ride` | POST | requireAdmin | reads full HTAF application, creates a real `rides` row (fare, payout) | **yes** | **yes** | — | **yes** | htaf_caseworker for the action; **dispatcher or finance visibility into the created ride** | consider elevated — this is the one HTAF route that creates real financial/dispatch state, currently no different from a read-only list view |
| 11 | `/api/admin/config-check` | GET | requireAdmin | boolean env-var presence + schema metadata | — | — | — | no | super_admin (operational config, not a caseworker concern) | no |
| 12 | `/api/admin/stream` (SSE) | GET | requireAdmin | **fans out every `broadcastSse()` event to every connected admin**, including `htaf_ride_created` which carries `rider_name`/`rider_phone` (confirmed by reading the create-ride route's broadcast payload) | **yes (real-time, unscoped)** | possible | — | no | **needs its own scoping decision — see note below** | n/a |
| 13 | `/api/admin/overview` | GET | requireAdmin | aggregate counts | — | — | — | no | dispatcher/support/finance (dashboard) | no |
| 14 | `/api/admin/metrics` | GET | requireAdmin | aggregate counts, active ride counts | — | — | — | no | dispatcher/support/finance | no |
| 15 | `/api/admin/operations-overview` | GET | requireAdmin | aggregate counts + integration health | — | — | — | no | dispatcher/support/finance | no |
| 16 | `/api/admin/rides` | GET | requireAdmin | **`select(\"*\")` on `rides`** — rider name/phone, addresses, fare, payout, everything | **yes** | **yes** | — | no | dispatcher (needs full ride detail to do the job); support with a reduced view | no, but see minimization note |
| 17 | `/api/admin/rides/:id/status` | PATCH | requireAdmin | writes ride status | low | possible (affects payout timing) | — | **yes** | dispatcher | no |
| 18 | `/api/admin/rides/:id/assign-driver` | POST | requireAdmin | writes driver assignment | low | — | — | **yes** | dispatcher | no |
| 19 | `/api/admin/drivers` | GET | requireAdmin | **`select(\"*\")` on `drivers` — see critical finding above** | **yes (severe)** | possible (`stripe_account_id`) | **yes (severe — password/verification data)** | no | dispatcher/support need a driver list, but **not** the password/verification columns | n/a until minimized |
| 20 | `/api/admin/riders` | GET | requireAdmin | **`select(\"*\")` on `riders` — see critical finding above** | **yes (severe)** | possible (`stripe_customer_id`) | **yes (severe — password/verification data)** | no | support needs a rider list, but **not** the password/verification columns | n/a until minimized |
| 21 | `/api/admin/drivers/:id/approve` | PATCH | requireAdmin | writes approval fields only — confirmed does not fabricate Checkr/Persona results (good existing design, PR #77/#78) | low | — | moderate (gates dispatch eligibility) | **yes** | dispatcher or compliance (operational gate, not itself a compliance verification) | no |
| 22 | `/api/admin/drivers/:id/contact-verification-override` | PATCH | requireAdmin | overrides email/phone verification | low | — | **yes** | **yes** | compliance | yes — this bypasses a real verification step |
| 23 | `/api/admin/drivers/:id/compliance-override` | PATCH | **requireElevatedAdmin (already elevated)** | overrides Checkr/Persona compliance gate | low | — | **yes (highest stakes)** | **yes** | compliance / super_admin | **already correctly elevated — the one existing precedent for this pattern; the RBAC design should generalize it, not invent a new one** |
| 24 | `/api/admin/drivers/:id/reject` | PATCH | requireAdmin | writes rejection | low | — | moderate | **yes** | dispatcher or compliance | no |
| 25 | `/api/admin/riders/:id/approve` | PATCH | requireAdmin | writes approval, sets email/sms verified (PR #175) | low | — | moderate | **yes** | support or compliance | no |
| 26 | `/api/admin/audit-logs` | GET | requireAdmin | **full audit trail** — every admin/system action, including export reasons, override justifications | — | — | **yes (this IS the compliance record)** | no | compliance / super_admin only | consider yes — this is the record that would catch abuse of every other route, so it shouldn't be readable by every role it's meant to watch |
| 27 | `/api/admin/system/pause-dispatch` | POST | requireAdmin | platform-wide dispatch pause | — | — | — | **yes (platform-wide)** | super_admin / dispatcher-lead | consider yes given blast radius |
| 28 | `/api/admin/system/resume-dispatch` | POST | requireAdmin | platform-wide dispatch resume | — | — | — | **yes (platform-wide)** | super_admin / dispatcher-lead | consider yes |
| 29 | `/api/admin/system/enable-rider-history` | POST | requireAdmin | feature flag | — | — | — | **yes** | super_admin | no |
| 30 | `/api/admin/system/disable-rider-history` | POST | requireAdmin | feature flag | — | — | — | **yes** | super_admin | no |
| 31 | `/api/admin/system/enable-rider-auth-ui` | POST | requireAdmin | feature flag — gates the live rider-auth rollout | — | — | — | **yes** | super_admin | **yes — this flag's rollout is the single most security-relevant flag in the codebase right now (task #214)** |
| 32 | `/api/admin/system/disable-rider-auth-ui` | POST | requireAdmin | feature flag | — | — | — | **yes** | super_admin | yes, same reasoning |
| 33 | `/api/admin/deletion-requests` | GET | requireAdmin | account-deletion request queue | **yes** | — | **yes (privacy/legal compliance)** | no | compliance | no |
| 34 | `/api/admin/deletion-requests/:id/approve` | POST | requireAdmin | **finalizes account deletion — irreversible** | **yes** | — | **yes** | **yes (irreversible)** | compliance / super_admin | **yes — irreversible destructive action on user data** |
| 35 | `/api/admin/deletion-requests/:id/reject` | POST | requireAdmin | restores access | **yes** | — | **yes** | **yes** | compliance | no |
| 36 | `/api/admin/compliance/audit` | GET | requireAdmin | driver compliance status, already column-limited (good existing example) | low | — | **yes** | no | compliance / dispatcher (to know who's eligible) | no |

Note: there is currently **no dedicated finance admin surface** —
financial data (fare, payout, `stripe_account_id`/`stripe_customer_id`)
is embedded read-only inside the rides/drivers/riders routes and the
`driver_earnings` table (referenced by `/api/admin/metrics`, not
separately exposed). The proposed `finance` role below is therefore
scoped to what exists today (read access to fare/payout data inside
rides and driver-earnings views); if a dedicated payout/refund
management surface is built later, it should default into `finance`
and `super_admin` only, not the flat `requireAdmin` gate.

## Two systemic patterns worth calling out before the role matrix

1. **`select("*")` over-fetch is not unique to the pre-fix HTAF
   routes.** `/api/admin/rides`, `/api/admin/drivers`,
   `/api/admin/riders`, and `/api/admin/audit-logs` all still do it.
   RBAC alone does not fix this — a `dispatcher` role scoped to "can
   read `/api/admin/rides`" would still receive the same over-fetched
   payload unless the route itself is also minimized. Recommend pairing
   the RBAC rollout with the same allow-list treatment already proven
   out on the HTAF routes, prioritized by the severity found above
   (`drivers`/`riders` first).
2. **The SSE stream (`/api/admin/stream`) has no concept of scope.**
   Every connected admin socket receives every broadcast event
   platform-wide, including at least one (`htaf_ride_created`) that
   carries PII. A role-based permission model on the initial route
   handshake doesn't help here by itself, since the vulnerability is in
   what gets pushed to an already-open connection, not in who can open
   it. This needs its own design pass (event-level filtering by role,
   or splitting the single stream into role-scoped channels) — flagged
   as a known gap, not solved in this document.

## Proposed role matrix

Six roles, server-side enforced, **deny by default**: a request is
rejected unless a role is explicitly granted the specific permission it
needs — there is no implicit "admin can do everything" fallback once
this ships. `super_admin` is not special-cased in the authorization
logic; it is simply the role granted every permission, so removing a
permission from it works exactly like removing it from any other role
(no separate code path to keep in sync).

| Role | Intended holder | Route groups granted |
|---|---|---|
| **super_admin** | Platform owner/operator | Everything, including system flags, RBAC administration itself, and the audit log. |
| **htaf_caseworker** | HTAF program staff | HTAF list/detail/PATCH/triage/create-ride (#4–#10). **Not** general rides/drivers/riders, **not** system flags, **not** audit logs. Export (#7) requires the reason gate already built (#106) plus, per the table above, consider requiring `super_admin` co-sign or restricting to a smaller sub-set of `htaf_caseworker` accounts given its blast radius — flagged for the design discussion, not decided here. |
| **dispatcher** | Ride operations staff | Rides list/status/assign-driver (#16–#18), driver approve/reject (#21, #24) as operational (not compliance) gates, dashboard aggregates (#13–#15). **Not** compliance overrides, **not** deletion requests, **not** audit logs. |
| **support** | Rider/driver-facing support staff | Read-only rides/drivers/riders lists (once minimized — see systemic pattern #1) and dashboard aggregates, rider approve (#25) for routine identity-verification-already-passed cases. **Not** writes to compliance/override routes, **not** HTAF PII, **not** system flags. |
| **finance** | Accounting/reconciliation staff | Read access to fare/payout data currently embedded in rides/metrics routes; the future dedicated payout/refund surface defaults here. **Not** PII-heavy routes beyond what's needed to reconcile a specific transaction, **not** writes to ride/driver state. |
| **compliance** | Trust & safety / legal staff | Contact-verification override (#22), compliance override (#23 — generalizing the existing `requireElevatedAdmin` precedent), audit logs (#26), deletion requests list/approve/reject (#33–#35), compliance audit (#36). This is the role that watches every other role, so it should itself require the strongest authentication of the six non-super_admin roles. |

Every route not explicitly listed for a role is denied to it by
default — the table above is a grant list, not an exclusion list.

## Elevated/re-authentication candidates (beyond the existing precedent)

`requireElevatedAdmin` (token-method-only, no ordinary
password/session login) already exists and already gates driver
compliance override (#23) — the one real precedent to generalize from,
not reinvent. Candidates to bring into that same tier or a
freshly-designed "step-up" tier, in priority order:

1. Deletion-request approval (#34) — irreversible, destroys user data.
2. `rider_auth_ui_enabled` flag flip (#31/#32) — gates the entire
   rider-auth security rollout this whole program depends on; flipping
   it carelessly could either expose the pre-auth vulnerability pattern
   again or break login for every rider depending on flag state.
3. Bulk HTAF export (#7) — already reason-gated and audited; elevation
   would be an additional layer, not a replacement for that.
4. System-wide dispatch pause/resume (#27/#28) — platform-wide
   operational blast radius.
5. Contact-verification override (#22) — bypasses a real verification
   step, same family as the already-elevated compliance override.

This list is a starting point for the next design conversation, not a
final decision — deliberately left open rather than picking exact
mechanics (step-up MFA vs. a second admin's co-sign vs. the existing
token-vs-password distinction) before that conversation happens.

## Enforcement principle: server-side, deny-by-default, not UI-gated

None of the above is meaningful if enforced only by hiding buttons in
`admin-dashboard.html`/`admin-htaf.html`. The design constraint for
whenever this is implemented:

- Every `/api/admin/*` route checks the caller's granted permissions
  against an explicit, server-side list **before** touching Supabase —
  the same shape as today's `requireAdmin`/`requireElevatedAdmin`
  middleware, but parameterized by which permission the specific route
  needs, not a single flat pass/fail.
- No route should ever compute "is this allowed" by trusting a role
  claim the client sends (a `role` field in a request body/header, for
  example) — the server's own record of the authenticated principal's
  role is the only source of truth, mirroring the lesson already
  applied throughout the rider-auth program (never trust a
  client-supplied identity claim).
- A missing or unrecognized permission denies by default; there is no
  "unknown role, allow anyway" fallback anywhere in the design.

## Migration/rollout strategy (so the current administrator is never locked out)

1. **Add role infrastructure without removing the flat model yet.**
   Introduce a `role` column/table for admin principals, defaulting
   every existing admin credential (the current `ADMIN_EMAIL`/
   `ADMIN_PASSWORD`/`ADMIN_API_TOKEN`) to `super_admin`. At this stage
   nothing behaviorally changes — `requireAdmin` still grants
   everything, because the one admin identity that exists is
   `super_admin`, which is granted everything by definition.
2. **Introduce the permission-check layer as a strictly additive,
   parallel check, run in shadow/log-only mode first.** For each
   route, compute what the new permission check *would* decide,
   log any case where it would have denied a request that
   `requireAdmin` allowed, but do not actually enforce it yet. This
   surfaces any route the audit above got wrong (missing from a role's
   grant list) before it can lock out real usage.
3. **Create the additional roles (htaf_caseworker, dispatcher, support,
   finance, compliance) but do not require using them yet.** The
   existing `super_admin` credential keeps working exactly as before
   through this whole phase.
4. **Flip enforcement on per-route-group, starting with the
   lowest-blast-radius group** (e.g. HTAF, already hardened in the
   prior three PRs) **and ending with system flags / audit logs /
   deletion requests** (the routes where a lockout would be most
   damaging to recover from). Each flip is its own small PR with the
   shadow-mode log data from step 2 as evidence nothing regresses.
5. **Only after every route group is enforced and stable**, retire the
   flat `requireAdmin`-grants-everything fallback entirely — at this
   point `super_admin` is a real, explicit grant rather than an
   implicit default, and the platform has no code path left that
   trusts a request without checking a specific permission.
6. **Rollback lever at every stage**: since step 4 is per-route-group,
   any single group's enforcement can be reverted independently
   (re-enable the old `requireAdmin` fallback for just that group)
   without touching the others — avoids an all-or-nothing cutover.

## Explicit scope note

This document does not implement roles, does not add a migration, and
does not change any route's middleware. It is the input to a design
review. Recommend deciding, before any code is written: (a) whether the
critical `drivers`/`riders` `select("*")` finding gets its own
immediate PR ahead of or in parallel with the RBAC rollout, and (b)
the exact mechanics of the "elevated/step-up" tier for the five
candidates listed above.
