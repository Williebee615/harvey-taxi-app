# Admin RBAC Phase 2: shadow-mode authorization logging

## Status

Phase 2 of the six-phase rollout in `admin-rbac-architecture-audit.md`,
building on Phase 1 (`admin-rbac-phase1-foundation.md`, merged in PR
#112). This PR adds shadow-mode logging only. Per instruction, it stops
after this representative-mix instrumentation for review before
expanding to the rest of the admin surface.

**This PR never denies, blocks, redirects, or changes the response of
any admin request.** `requireAdmin()`/`requireElevatedAdmin()` remain
the sole actual authority on every instrumented route, exactly as
before. Every shadow check is fire-and-forget
(`logAdminRbacShadowCheck(...).catch(() => {})`), the same pattern this
codebase already uses for `auditLog()` calls, so a slow or failing
shadow check can never affect a real request.

## Important operational note: the migration could not be applied in this session

`supabase/migrations/20260807200000_add_admin_rbac_shadow_log_table.sql`
is written and committed, but the Supabase MCP tool required an
approval this session could not grant (every call, including read-only
ones like `list_tables`, returned `MCP error -32003: MCP tool call
requires approval` -- this affected the tool broadly, not just DDL).
**The `admin_rbac_shadow_log` table has not been confirmed live as of
this PR.** Because every call site uses
`.catch(() => {})`, a missing table fails the insert silently with zero
effect on any admin response -- the safety guarantee above holds either
way -- but no shadow data will actually be recorded until the migration
is applied. Please run it (via the Supabase dashboard, CLI, or by
re-approving the MCP tool) before expecting to see any rows.

## Round 2 fix: case-insensitive `admin_roles` email lookup

The original version of this PR queried `admin_roles` with
`.eq("email", email)` after normalizing the *lookup* email
(trim + lowercase). Phase 1's migration only guarantees a unique index
on `lower(email)` -- it never guarantees every **stored** `email`
value is itself lowercase. A future row written as
`CaseWorker@HarveyTaxiService.com` would never match an exact-case
lookup of `caseworker@harveytaxiservice.com`, even though the unique
index already treats those as one identity -- silently producing a
`missing_row_*` shadow result for a real, existing role assignment.

Fixed by fetching all `admin_roles` rows (`select("email, role")`, no
filter -- the table stays small, one row per admin identity) and
matching case-insensitively in JS via the new
`findAdminRoleRow(rows, email)` (`lib/adminRbacShadow.js`), rather than
pushing the case-fold into a database-level filter that would need its
own wildcard-escaping to stay an exact match. Covered by 5 new tests in
`lib/adminRbacShadow.test.js`, including the exact case from review:
`CaseWorker@HarveyTaxiService.com` and
`caseworker@harveytaxiservice.com` resolve to the same row regardless
of which side is mixed-case.

## What this PR adds

### Representative route selection (7 routes, 6 capability areas)

Per instruction to start with a representative mix rather than all 36
routes. "HTAF read/write" was interpreted as covering both a read and a
write route, since no single HTAF route does both:

| Route | Capability | Represents |
|---|---|---|
| `GET /api/admin/foundation/applications` | `htaf.applications.read` | HTAF read |
| `PATCH /api/admin/foundation/applications/:id` | `htaf.applications.update` | HTAF write |
| `POST /api/admin/rides/:id/assign-driver` | `rides.dispatch` | Ride dispatch |
| `PATCH /api/admin/drivers/:id/approve` | `drivers.approve` | Driver approval |
| `PATCH /api/admin/drivers/:id/compliance-override` | `drivers.compliance.override` | Compliance override |
| `GET /api/admin/audit-logs` | `audit.read` | Audit read |
| `POST /api/admin/system/enable-rider-auth-ui` | `admin.system.flags.manage` | System flag |

If 7 routes across 6 areas overshoots what "one HTAF read/write route"
meant, the HTAF write instrumentation is the one to drop -- easy to
remove in a follow-up, not load-bearing for anything else in this PR.

The compliance-override route's real gate is `requireElevatedAdmin`
(already stricter than plain `requireAdmin` -- token-method only, per
`lib/driverCompliance.js`); the shadow check there is purely
observational and doesn't change that route's actual, unchanged
authority.

### `lib/adminRbacShadow.js` (pure logic, no I/O)

- **`ROUTE_CAPABILITIES`**: the route → capability map above.
- **`resolveShadowRole({ dbLookupFailed, roleRow, isLegacyAdmin })`** --
  the Phase-2-specific role resolution path, **deliberately not**
  Phase 1's `resolveAdminRole()`. That function maps every one of
  today's three legacy auth methods straight to `super_admin`, which is
  correct for Phase 1's no-lockout guarantee but would make every
  shadow check here trivially `would_allow: true` and produce no
  evidence about whether the proposed role/capability model actually
  matches real usage -- exactly the failure mode flagged before this
  phase started. Behavior:
  - A successful DB lookup that finds a row → uses that row's role,
    **even for the legacy admin** (a real row always wins over the
    fallback; the fallback only covers the lookup itself failing to
    produce an answer).
  - A DB lookup error → falls back to `super_admin` **only** if the
    authenticated email matches the legacy `ADMIN_EMAIL`; otherwise
    `null` (deny). Source: `db_error_legacy_fallback` /
    `db_error_no_fallback`.
  - A successful lookup that finds no row → same legacy-only fallback,
    but with **distinct** source labels
    (`missing_row_legacy_fallback` / `missing_row_no_fallback`) so a
    real outage is never confused with a real, intentional access gap
    in the analysis data -- this is the explicit "DB lookup error must
    be distinguishable from an actual RBAC denial" requirement.
- **`computeWouldAllow(role, capability)`**: thin wrapper over Phase
  1's `hasCapability()`; a `null` role (either fallback-denied case)
  always resolves `false`.
- **`buildShadowLogEntry(...)`**: builds the exact, explicit-allow-list
  row written to `admin_rbac_shadow_log` --
  `actor_email, auth_method, route, http_method, required_capability,
  resolved_role, resolution_source, would_allow, created_at`. Nothing
  else, regardless of what's on the input objects (tested with an
  adversarial input carrying a fake password/HTAF-application/
  request-body payload to prove none of it leaks into the output).

### `server.js`: `logAdminRbacShadowCheck(req, route, capability)`

The only change to `server.js` beyond the 7 one-line call sites and one
`require`. For each call:
1. Reads `req.admin` (already resolved by `requireAdmin`/
   `requireElevatedAdmin` -- never anything from the request body,
   headers, query string, or a client-supplied role field).
2. Normalizes the email (trim + lowercase) and determines
   `isLegacyAdmin` by comparing it to the `ADMIN_EMAIL` env var --
   never accepted from the client.
3. Queries `admin_roles` by that normalized email (`.maybeSingle()`),
   catching any error into `dbLookupFailed` rather than throwing.
4. Calls `resolveShadowRole()` / `computeShadowWouldAllow()` (the pure
   functions above) to get the shadow decision.
5. Inserts the metadata-only row via `buildShadowLogEntry()`.

Every call site is `logAdminRbacShadowCheck(req, route, capability).catch(() => {})`,
placed as the first statement inside the route handler, before any
business logic -- matching the existing `auditLog(...).catch(() => {})`
convention used throughout this codebase for the same
never-block-the-response guarantee.

### `supabase/migrations/20260807200000_add_admin_rbac_shadow_log_table.sql`

Adds `admin_rbac_shadow_log` (RLS enabled, no policies -- service-role
only, same posture as `admin_roles` from Phase 1) with exactly the
metadata-only columns `buildShadowLogEntry()` produces, plus two
indexes for the analysis queries this data exists to support
(`created_at DESC`, and a partial index on `would_allow = false` for
quickly finding disagreements between the proposed model and today's
flat access). **Not yet confirmed applied to the live database** -- see
the operational note above.

### `lib/adminRbacShadow.test.js`

19 tests: the exact route/capability map for the representative mix,
`findAdminRoleRow()`'s case-insensitive matching (including the exact
mixed-case-vs-lowercase scenario from round-2 review), every branch of
`resolveShadowRole()` (DB row found for both legacy and non-legacy
admins, DB error with/without legacy fallback, missing row with/without
legacy fallback, malformed row treated as missing -- never as a crash
or a silent allow), proof that DB-error and missing-row sources are
always distinguishable from each other, `computeWouldAllow()`
deny-on-null and delegation to `hasCapability()`, and
`buildShadowLogEntry()`'s explicit allow-list (including the
adversarial-input test proving fake password/HTAF/request-body content
never reaches the output).

## What this PR deliberately does not do

- No route's actual authorization decision changes -- confirmed by
  every shadow check being independently fire-and-forget.
- No expansion beyond the 7 representative routes.
- No use of Phase 1's `resolveAdminRole()` for shadow decisions (see
  above for why).
- No shadow log field beyond the explicit metadata allow-list -- no
  request body, no HTAF application contents, no rider/driver record
  fields, no payment data, no secrets.
- No UI changes.

## Testing

- `lib/adminRbacShadow.test.js`: 19 tests, all passing.
- Full suite: `npx jest` -- 17 suites, 455 tests, all passing.
- `node -c server.js` -- syntax check passes.
- Migration written and committed; **live application pending** (see
  operational note above).

## Next step (not started, per instruction)

Once this batch produces sane evidence (shadow log rows showing
`would_allow`/`resolution_source` that look plausible against known
admin activity), expand `ROUTE_CAPABILITIES` to cover the rest of the
36-route inventory in `admin-rbac-architecture-audit.md`. Enforcement
(Phase 4) remains explicitly out of scope until Phase 3 (creating the
additional roles for real use, without requiring them) is also done and
reviewed.
