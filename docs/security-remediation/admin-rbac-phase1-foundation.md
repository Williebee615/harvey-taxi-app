# Admin RBAC Phase 1: additive foundation

## Status

Phase 1 of the six-phase no-lockout rollout in
`admin-rbac-architecture-audit.md` (the approved architecture, PR #108).
This PR adds role/permission infrastructure and nothing else. Per
instruction, it stops here for review before Phase 2 (shadow-mode
authorization logging).

**No route's authorization behavior changes in this PR.** Every
`/api/admin/*` route still authorizes exclusively through
`requireAdmin()`/`requireElevatedAdmin()` in `server.js`, exactly as
before. `server.js` has zero changes in this diff — confirmed by `git
diff --stat` before opening this PR.

## What this PR adds

### 1. `lib/adminRbac.js` — capabilities, roles, and a deny-by-default resolver

**Capabilities, not route names.** Each permission is a capability
string describing what it grants (`htaf.applications.read`,
`rides.dispatch`, `drivers.compliance.override`, `finance.export`,
`audit.read`, etc.), not the literal route it currently guards. A
future route covering the same resource needs the same capability
string, not a new one — the six-role model doesn't need to change
shape as the API surface grows. The full list (`ADMIN_CAPABILITIES`,
24 capabilities) is grouped by domain (HTAF, rides, drivers, riders,
finance, compliance/audit/deletion-requests, cross-cutting
admin/system) and maps directly onto the 36-route inventory in
`admin-rbac-architecture-audit.md`.

**Six roles (`ADMIN_ROLES`)**: `super_admin`, `htaf_caseworker`,
`dispatcher`, `support`, `finance`, `compliance` — the exact set from
the approved architecture's role matrix. `ROLE_CAPABILITIES` maps each
non-`super_admin` role to its grant list, transcribed directly from
that matrix (e.g. `dispatcher` gets `rides.read`/`rides.dispatch`/
`drivers.read`/`drivers.approve`/`drivers.reject`/
`admin.dashboard.read` and nothing else). `super_admin`'s grant list is
`[...ADMIN_CAPABILITIES]` — derived from the master list, not
hand-duplicated, so it can never silently drift out of sync with it.

**`hasCapability(role, capability)`** is the resolver, and it is
strictly deny-by-default:
- an unrecognized role → deny
- a capability string not in `ADMIN_CAPABILITIES` → deny, even if it
  happens to appear in some role's grant list (guards against a typo'd
  capability being added to a grant list without also being added to
  the master list — that capability would never resolve `true` for
  anyone)
- a recognized capability not in the role's grant list → deny
- only a recognized capability present in the role's grant list → allow

There is no "unknown input, allow anyway" branch anywhere in the
function. No client-supplied role claim is ever involved in this
resolution — `hasCapability()` takes a role string the caller already
resolved server-side, never a request body/header field.

**`resolveAdminRole(admin)`** maps today's `requireAdmin()` output
(`{ id, email, method }`, `method` one of `admin_token` /
`admin_password` / `admin_session`) to a role. All three of today's
methods resolve to `super_admin` — this is the entire "preserve the
existing administrator as super_admin" guarantee for this phase, since
every admin identity that exists today authenticates through one of
them. An unrecognized method (there isn't one today, but a
hypothetical future one added without updating this function) resolves
to `null`, the same deny-by-default posture as `hasCapability()`. A
would-be client-supplied `role` field bolted onto the `admin` object is
never consulted — only `method`, which the server itself set during
authentication, decides the result (covered explicitly in
`lib/adminRbac.test.js`).

This function does **not** query the `admin_roles` table added below —
that lookup is Phase 2+'s job, once enforcement exists for it to
inform. Keeping this phase's role resolution entirely code-based, with
no database dependency, is what makes it structurally impossible for
this phase to introduce a lockout: there is no row that could be
missing, malformed, or out of sync, because nothing reads one yet.

### 2. `supabase/migrations/20260807190000_add_admin_roles_table.sql`

Adds an `admin_roles` table (`id`, `email`, `role` with a `CHECK`
constraint restricting it to the six role names, `created_at`,
`updated_at`), a unique index on `lower(email)`, and RLS enabled with
no policies (service-role-only access, matching the pattern already
used for other admin-only tables in this codebase — nothing in
`public/` or any anon/authenticated context ever touches this table).

**Backfill**: seeds exactly one row — the real admin email confirmed in
`admin-drivers-riders-exposure-review.md`'s audit-log review
(`williebee@harveytaxiservice.com`) — with `role = 'super_admin'`,
`ON CONFLICT (lower(email)) DO NOTHING` for idempotency. Applied to the
live database via `mcp__Supabase__apply_migration` and verified with a
direct read-only query:

```
select id, email, role, created_at from admin_roles;
-> williebee@harveytaxiservice.com | super_admin | 2026-08-07 18:37:44+00
```

**This table is not consulted by any code path yet.** It exists so
Phase 2+ has a real, persistent place to look up a specific admin's
granted role once enforcement begins, instead of inventing that lookup
at the same moment enforcement is flipped on. Today there is exactly
one admin identity and it is entirely env-var-based
(`ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_API_TOKEN`) — this table is
forward-looking infrastructure for when that changes, not something
this phase's (nonexistent) enforcement reads from.

### 3. `lib/adminRbac.test.js`

Unit tests covering:
- Data integrity: exactly the six roles, no duplicate roles/capabilities,
  every grant-list entry is a recognized capability (no typos), every
  role has a grant list.
- `super_admin`'s grant list is exactly `ADMIN_CAPABILITIES`, and it
  passes `hasCapability()` for every one of them.
- The exact grant map for every one of the five non-`super_admin`
  roles, both what's granted and what's explicitly denied (e.g.
  `dispatcher` is proven to lack `drivers.compliance.override`,
  `htaf_caseworker` is proven to lack `rides.dispatch` despite having
  `htaf.rides.create`).
- Deny-by-default: unrecognized role, unrecognized capability (for
  every role including `super_admin`), null/undefined/empty-string
  inputs, and no fuzzy/case-insensitive/prefix matching on capability
  strings.
- `resolveAdminRole()`: all three current auth methods resolve to
  `super_admin`; an unrecognized/missing method, non-object input, and
  null/undefined all resolve to `null` without throwing; a
  client-supplied `role` field on the input object is never consulted,
  including the adversarial case where an unrecognized method carries
  a `role: "super_admin"` field that must still be denied.

## Rollback

Nothing in this PR is referenced by any other code. Rollback is a
complete, ordinary git revert of this PR with no follow-up cleanup
required in `server.js` (there is nothing there to un-wire) and no data
migration to reverse in application logic (the `admin_roles` table can
be dropped or simply left in place — an unreferenced table with one row
carries no behavioral risk either way). If the migration itself needs
reverting: `DROP TABLE IF EXISTS admin_roles;` is safe and complete,
since no foreign key or other object depends on it.

## Lockout recovery

**This phase introduces no lockout risk of its own** — there is no
enforcement to lock anyone out of. `requireAdmin()` continues to grant
full access on any of the three existing credentials exactly as it did
before this PR, unconditionally, regardless of anything in
`admin_roles` or `lib/adminRbac.js`.

The recovery plan that matters is for **future phases**, once
enforcement exists, and is inherited directly from
`admin-rbac-architecture-audit.md`'s migration/rollout strategy:

1. Phase 4 (per-route-group enforcement) is deliberately staged
   per-route-group, not all at once, specifically so a bad enforcement
   decision on one group can be reverted independently without
   affecting any other group or requiring a full rollback.
2. The lowest-blast-radius groups are enforced first (HTAF, already
   hardened in PRs #105-#107) and the highest-blast-radius groups last
   (system flags, audit logs, deletion requests) — the routes where a
   lockout would be hardest to recover from are the ones with the most
   shadow-mode evidence (Phase 2) behind them before enforcement ever
   flips on for them.
3. `super_admin` is never enforcement-eligible to lose access to
   anything, since it is defined as "granted every capability" — a
   correctly-implemented enforcement layer cannot lock out the one role
   that has every permission by construction. The actual failure mode
   to guard against in later phases is a *misconfigured* enforcement
   check (e.g. checking the wrong capability string, or a bug in the
   route middleware itself) rather than the role model producing a
   correct-but-unwanted denial for `super_admin` — Phase 4's PRs should
   each include a manual verification step (successfully call the
   route as the existing admin credential) before merging, in addition
   to the shadow-mode log evidence from Phase 2.
4. If a future phase's enforcement does lock out real usage: the
   existing `ADMIN_API_TOKEN`/`ADMIN_PASSWORD` env vars remain the
   actual authentication mechanism through every phase up to and
   including Phase 5 (the flat `requireAdmin` fallback is only retired
   in Phase 5, the last phase, and only "after every route group is
   enforced and stable") — recovery in the interim is reverting that
   one route group's enforcement PR, not touching credentials at all.

## What Phase 1 deliberately does not do

- No route's middleware changes. No route calls `hasCapability()` or
  `resolveAdminRole()` anywhere.
- No shadow-mode logging yet (that's Phase 2, explicitly the next step,
  not started here).
- No removal of `requireAdmin`'s flat token/password/session model.
- No UI changes — no admin page references roles or capabilities.
- No lookup against the new `admin_roles` table from any request path.

## Testing

- `lib/adminRbac.test.js`: 20 tests, all passing — see enumeration
  above.
- Full suite: `npx jest` — 16 suites, 436 tests, all passing.
- `node -c server.js` — syntax check passes (server.js is unchanged by
  this PR, included for completeness of the verification record).
- Live migration applied and verified via
  `mcp__Supabase__execute_sql` (see backfill query/result above).

## Next step (not started, per instruction)

Phase 2: shadow-mode authorization logging. The RBAC engine
(`hasCapability`/`resolveAdminRole`) computes what it *would* allow or
deny for each admin request, logs any case where it would have denied
something `requireAdmin` currently allows, but `requireAdmin` remains
the sole actual authority — nothing is blocked. This produces
production evidence that the role/capability grants above are complete
and correct before enforcement is ever allowed to affect a real
request, per the architecture doc's step 2.
