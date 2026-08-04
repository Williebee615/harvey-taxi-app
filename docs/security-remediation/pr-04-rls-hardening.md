# P0 Remediation — PR 4: RLS Hardening (riders, usage_counters, preferred_drivers, spatial_ref_sys)

**Merged:** GitHub PR #98, 2026-08-04 21:21 UTC (merge commit `6c6bfd43`).
CI (`node -c server.js`, `npm test`) passed on the merge commit. See
"Post-merge verification" below for what was re-confirmed against
production after merge.

Status — this PR does **not** resolve every database privilege finding
in scope; it resolves four of five, with the fifth explicitly tracked as
open:

| Item | Status |
|---|---|
| `riders` PUBLIC policy | **FIXED and verified** |
| `usage_counters` RLS | **FIXED and verified** |
| `preferred_drivers` RLS | **FIXED and verified** |
| Associated RPC grants (`increment_usage_counter`) | **FIXED and verified** |
| `spatial_ref_sys` write privileges (INSERT/UPDATE/DELETE/TRUNCATE) | **OPEN / BLOCKED — owner-level remediation required** |

Nothing in this PR was tested on a Supabase branch first: branch
creation (`list_branches`) failed reproducibly in this environment
(`InternalServerErrorException: Project reference is missing when
validating permissions`), confirmed twice. Per explicit approval, each
migration was instead applied directly to production, one at a time,
with before-state capture, a syntax-checked rollback prepared first,
immediate post-apply verification, and a stop-and-report on the first
unexpected result. That stop-and-report is exactly what happened on the
fifth item — see "Residual risk: spatial_ref_sys" below.

## Trigger

A Supabase automated security-advisory email (03 Aug 2026) flagged
`rls_disabled_in_public` (CRITICAL, "Table publicly accessible") for
this project. The advisor linter listed 2 tables; a direct
`pg_class.relrowsecurity` query found a 3rd (`preferred_drivers`) the
linter cache had missed. All three were already-tracked baseline
findings from `docs/production-hardening-phase1-audit.md`, not new.
Investigation found the riders-table issue (separately already
identified as P0-8 in the remediation plan) is the only one with real
data exposure; the other three are empty or non-sensitive reference
data. Scope was expanded per owner instruction to fold all four into
one RLS-hardening PR, riders as the primary P0 change and the other
three as a lower-risk subsection, explicitly not to be treated
identically to each other (application tables vs. PostGIS system
table).

## Migration 1 — riders (P0, primary): DROP the mis-scoped PUBLIC policy

**File:** `supabase/migrations/20260804210000_fix_riders_public_policy.sql`

The bug: `riders` had 3 RLS policies — `deny_all_riders`
(roles={public}, cmd=ALL, `USING (false)`), `service_role_riders`
(roles={service_role}, cmd=ALL, `USING (true)`, correctly scoped), and
`"Allow service role full access"` (roles={public}, cmd=ALL,
`USING (true) WITH CHECK (true)`) — mis-scoped despite its name: `public`
in `pg_policies.roles` means *every* role, not just `service_role`.
Because RLS permissive policies are OR'd together, this one policy alone
granted every role, including `anon`/`authenticated`, unconditional
read/write access to every rider row, overriding `deny_all_riders`.

**Before state** (captured 2026-08-04 21:02:23 UTC):

| policy | roles | cmd | qual |
|---|---|---|---|
| `Allow service role full access` | `{public}` | ALL | `true` |
| `deny_all_riders` | `{public}` | ALL | `false` |
| `service_role_riders` | `{service_role}` | ALL | `true` |

Table grants: only `postgres`/`service_role` hold table-level grants on
`riders` — `anon`/`authenticated` have none. (The exposure was purely
the RLS policy; not compounded by table-grant misconfiguration.)

**Applied:** 21:03:25 UTC. `drop policy if exists "Allow service role full access" on public.riders;`

**After state:** only `deny_all_riders` and `service_role_riders` remain.

**Verification (live, role-switched via `SET LOCAL ROLE`, all in
rolled-back transactions):**

| Test | Result |
|---|---|
| `anon` SELECT | `permission denied for table riders` (denied at both the table-grant layer and RLS) |
| `anon` INSERT | `permission denied for table riders` |
| `authenticated` SELECT | `permission denied for table riders` |
| `service_role` SELECT | succeeds, returns real data (11 rows) — backend unaffected |

**Rollback:**
- **Normal rollback (preferred):** none needed. `service_role_riders`
  was never touched by this migration and already provides full backend
  access on its own — there is nothing to restore for the backend path.
- **Last-resort historical reversal (requires separate explicit
  authorization — do NOT run without it):**
  ```sql
  create policy "Allow service role full access" on public.riders
    as permissive for all to public using (true) with check (true);
  ```
  This recreates the P0 exposure. Syntax-checked via dry-run
  (transaction rolled back) before migration 1 was applied.

## Migration 2 — usage_counters + preferred_drivers: enable RLS, service-role-only

**File:** `supabase/migrations/20260804210100_enable_rls_usage_counters_preferred_drivers.sql`

Both are application tables (not PostGIS system tables), both confirmed
empty. Grep across `server.js` and `public/` confirmed: `usage_counters`
is touched only by `increment_usage_counter()`, called from exactly one
site (`server.js:8506`, backend service-role client); `preferred_drivers`
has zero application code references anywhere. The app does not depend
on direct `anon`/`authenticated` REST access to either table.

**Before state** (captured 2026-08-04 21:05:27 UTC):

- `usage_counters`: `relrowsecurity=false`, 0 policies. Table grants:
  `anon`/`authenticated` hold `SELECT`/`INSERT`/`UPDATE`/`DELETE`/
  `TRUNCATE` directly — live-exploitable while RLS was disabled.
- `preferred_drivers`: `relrowsecurity=false`, 0 policies. Table grants:
  only `postgres`/`service_role` — no `anon`/`authenticated` grants
  existed, so this table's gap was defense-in-depth, not a currently
  open hole.
- `increment_usage_counter(text)`: confirmed `SECURITY INVOKER`
  (`pg_proc.prosecdef = false`) — does not bypass RLS. `EXECUTE` held by
  `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role`.

**Applied:** 21:06:06 UTC.
```sql
alter table public.usage_counters enable row level security;
create policy "service_role_usage_counters" on public.usage_counters
  as permissive for all to service_role using (true) with check (true);
create policy "deny_all_usage_counters" on public.usage_counters
  as permissive for all to public using (false);

alter table public.preferred_drivers enable row level security;
create policy "service_role_preferred_drivers" on public.preferred_drivers
  as permissive for all to service_role using (true) with check (true);
create policy "deny_all_preferred_drivers" on public.preferred_drivers
  as permissive for all to public using (false);

revoke execute on function public.increment_usage_counter(text)
  from public, anon, authenticated;
```
The `EXECUTE` revoke was done as a mandatory defense-in-depth step even
though the function is invoker-rights (so RLS alone already blocks a
direct anon/authenticated call) — only the backend ever needs to call
it, and unrestricted `EXECUTE` served no purpose.

**After state:** both tables `relrowsecurity=true` with the
`service_role_X`/`deny_all_X` pair. `increment_usage_counter` `EXECUTE`
held only by `postgres`/`service_role`.

**Verification (live, rolled back):**

| Test | Result |
|---|---|
| `anon` SELECT `usage_counters` | 0 rows (RLS-filtered; table grant untouched, RLS denies) |
| `anon` INSERT `usage_counters` | `new row violates row-level security policy` |
| `anon` EXECUTE `increment_usage_counter()` | `permission denied for function increment_usage_counter` |
| `anon` SELECT `preferred_drivers` | `permission denied for table preferred_drivers` (no grant ever existed) |
| `service_role` SELECT both tables | succeeds (0 rows each — both still empty, unaffected) |
| `service_role` EXECUTE `increment_usage_counter()` | succeeds, returns incremented count |

**Rollback (independent per table):**
```sql
-- usage_counters
drop policy if exists "deny_all_usage_counters" on public.usage_counters;
drop policy if exists "service_role_usage_counters" on public.usage_counters;
alter table public.usage_counters disable row level security;
grant execute on function public.increment_usage_counter(text) to public, anon, authenticated;

-- preferred_drivers
drop policy if exists "deny_all_preferred_drivers" on public.preferred_drivers;
drop policy if exists "service_role_preferred_drivers" on public.preferred_drivers;
alter table public.preferred_drivers disable row level security;
```
Syntax-checked via dry-run (transaction rolled back) before migration 2
was applied.

## Residual risk: spatial_ref_sys — OPEN / BLOCKED, owner-level remediation required

**File:** `supabase/migrations/20260804210200_spatial_ref_sys_privilege_hardening_OWNER_ACTION_REQUIRED_NOT_APPLIED.sql`
(renamed post-merge specifically so its filename alone makes clear this
is an intended, owner-required migration that has **not** taken effect
in production — a future auditor should not assume every committed
migration file has already been applied just because it's committed.)

Per explicit decision: do not enable RLS on this table (PostGIS-extension-
owned system table; custom RLS on it risks compatibility/upgrade
problems). The intended fix was privilege-only: keep public `SELECT`
(required — `nearest_drivers()`, `SECURITY INVOKER`, has `EXECUTE`
granted to `anon`/`authenticated` and performs `ST_Distance`/`ST_DWithin`
geography calculations that PostGIS resolves against `spatial_ref_sys`
under the invoking role), and revoke `INSERT`/`UPDATE`/`DELETE`/
`TRUNCATE` from `anon`/`authenticated`/`PUBLIC`, which were left open
from the extension's default table-creation grants.

**Before state** (captured 2026-08-04 21:07:40 UTC): `PUBLIC` had
`SELECT`; `anon`/`authenticated` additionally held `INSERT`/`UPDATE`/
`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` directly.

**Applied (attempted):** 21:08:15 UTC. `apply_migration` reported
`{"success":true}`.

### Known blocker — the migration did not actually take effect

Re-querying `information_schema.table_privileges` immediately after
showed `anon`/`authenticated` **still** holding `INSERT`/`UPDATE`/
`DELETE`/`TRUNCATE` — unchanged from before. Root cause, confirmed via
`pg_class.relacl`:

```
supabase_admin=arwdDxtm/supabase_admin
postgres=arwdDxtm/supabase_admin
anon=arwdDxtm/supabase_admin
authenticated=arwdDxtm/supabase_admin
service_role=arwdDxtm/supabase_admin
=r/supabase_admin
```

`spatial_ref_sys` is owned by `supabase_admin` (`pg_roles.rolsuper =
true`), a role internal to Supabase's managed platform. Every grant on
this table — including `postgres`'s own — was made **by**
`supabase_admin`, with no `WITH GRANT OPTION` (no `*` in the ACL). This
session's DB connection runs as `postgres`, which:
- is not a superuser (`rolsuper = false`, confirmed via `pg_roles`)
- is not a member of `supabase_admin` (confirmed via `pg_auth_members` —
  `postgres` is a member of `pg_monitor`, `pg_signal_backend`,
  `pg_read_all_data`, `pg_create_subscription`, `anon`, `authenticated`,
  `service_role`, `authenticator`, `supabase_realtime_admin`,
  `supabase_privileged_role` — not `supabase_admin`)
- cannot `SET ROLE supabase_admin` (`permission denied to set role
  "supabase_admin"`, confirmed live)

A Postgres `REVOKE` issued by a role that is neither the object owner
nor holds grant option on that privilege **succeeds as a silent no-op
with a warning**, not an error — which is exactly why the tool reported
success while nothing changed. This is a real, structural privilege
boundary in this Supabase project, not a retryable failure.

**Current state:** unchanged from before this PR. `spatial_ref_sys`
still grants `anon`/`authenticated` `INSERT`/`UPDATE`/`DELETE`/
`TRUNCATE` directly. `SELECT` was already public before this migration,
so read behavior is unaffected either way — nothing regressed, but the
write-access gap identified in scoping remains open.

### Decision: no application-level workaround was used

No trigger, wrapper trigger, event trigger, mutation-blocking rule, or
any other application-level mechanism was added to `spatial_ref_sys`,
and none should be. A `BEFORE INSERT/UPDATE/DELETE/TRUNCATE` trigger
rejecting writes from non-privileged roles is technically possible
(`postgres` does hold `TRIGGER` privilege on this table per the ACL
above) — it was deliberately rejected as an approach:

- A trigger only intercepts writes *after* they reach the table; it does
  not correct the underlying privilege model, which remains
  misconfigured regardless. `pg_class.relacl` would still show
  `anon`/`authenticated` holding `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` —
  a future audit or advisor scan would still flag it.
- Privileged or extension-internal operations (PostGIS upgrades,
  `pg_dump`/restore, Supabase's own platform maintenance against this
  table) could behave differently around a custom trigger than around
  native grants, in ways that aren't fully predictable from outside the
  extension's own code.
- `spatial_ref_sys` is owned and managed by `supabase_admin` as part of
  the PostGIS extension. Adding custom behavior to an extension-owned
  system table is a larger, less-understood operational risk than the
  residual issue it would be working around.
- The residual issue itself is bounded: it is a database-integrity
  concern (unauthorized write/truncate of public coordinate-reference
  data), not exposure of Harvey Taxi rider or driver data. `riders`,
  `usage_counters`, and `preferred_drivers` — the tables that actually
  hold or could hold application/PII data — are fully fixed and
  verified in this PR. That should not be held back waiting on an
  extension-owned permission that requires platform-administrator
  intervention.

**Summary of facts for this residual-risk item, as required for
tracking:**

- `spatial_ref_sys` contains public coordinate-reference-system data
  (PostGIS/PROJ definitions), not Harvey Taxi rider or driver data.
- Public `SELECT` is required/expected for PostGIS compatibility —
  confirmed live (`anon` can read the SRID 4326 row) and structurally
  needed by `nearest_drivers()` (see compatibility verification below).
- Unnecessary write grants (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` to
  `anon`/`authenticated`/`PUBLIC`) remain present, unchanged from before
  this PR.
- The current database role (`postgres`, this session's connection)
  cannot revoke them: it is not the table owner and holds no grant
  option on grants made by `supabase_admin`.
- The attempted `REVOKE` (21:08:15 UTC) made **no effective permission
  change** — confirmed by re-querying `table_privileges` immediately
  after and by inspecting `pg_class.relacl` directly.
- No trigger or other workaround was used to compensate.
- Remediation requires either a Supabase support request (asking
  Supabase to perform the revoke as/via the owning `supabase_admin`
  role) or direct execution by a role with sufficient privilege over
  `supabase_admin`-owned objects.

### Supabase support request (drafted, not yet submitted — no tool in this session can open Supabase support tickets)

This needs to be filed by a human via the Supabase dashboard support
form (dashboard.supabase.com → this project → Support), since no MCP
tool available in this session submits support tickets. Suggested text:

> **Subject:** Request to revoke default write grants on
> `public.spatial_ref_sys` (project `harvey-taxi-app`,
> `orgahzncmzptljapqffj`)
>
> Our security review found that `public.spatial_ref_sys` grants
> `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` to the `anon` and
> `authenticated` roles (and `PUBLIC`), left over from the PostGIS
> extension's default table-creation grants. We'd like these write
> privileges removed while **preserving `SELECT` for `PUBLIC`/`anon`/
> `authenticated`**, since our application relies on public read access
> to this table for PostGIS geography compatibility (SRID lookups used
> by geography-type distance calculations).
>
> We attempted `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
> public.spatial_ref_sys FROM PUBLIC, anon, authenticated;` ourselves and
> confirmed via `pg_class.relacl` that it had no effect: the table is
> owned by `supabase_admin`, and our `postgres` role holds no grant
> option on `supabase_admin`'s grants, so the REVOKE silently no-ops.
> Could you perform this revoke (or grant our project's `postgres` role
> the necessary privilege to do so ourselves)?

Tracked as an open follow-up dependency for this PR — not blocking the
two application-table fixes from merging.

## Compatibility verification performed (spatial_ref_sys, independent of the blocker above)

These checks were run to answer "does PostGIS/geospatial need public
SELECT on spatial_ref_sys" regardless of whether the write-side fix
could be applied — the answer is yes, confirmed:

- `nearest_drivers(p_lat, p_lng, p_radius_miles, p_limit)`: `SECURITY
  INVOKER`, `EXECUTE` granted to `PUBLIC`/`anon`/`authenticated`/
  `postgres`/`service_role`. Uses `ST_Distance`/`ST_DWithin`/
  `ST_SetSRID`/`ST_MakePoint` against SRID 4326 on `drivers.geog`
  (`geography` type).
- `drivers` table already has correct RLS (`deny_all_drivers` +
  `service_role_drivers`), so even though `anon` could invoke
  `nearest_drivers()` directly today, the underlying driver read returns
  zero rows for `anon` — no live PII leak via this path regardless of
  the spatial_ref_sys question.
- Live check (rolled back): `anon`, via `SET LOCAL ROLE`, can read
  `spatial_ref_sys` row for SRID 4326 (`srtext is not null` → `true`).
  This confirms the read side must stay public for compatibility, which
  is why RLS-with-deny-all was never on the table for this table in the
  first place — only a write-side fix was ever in scope.

## Separate finding, explicitly out of scope for this PR

`nearest_drivers()` and `increment_usage_counter()` both have `EXECUTE`
granted to `anon`/`authenticated`/`PUBLIC`, broader than the application
needs (only the backend service-role client calls either one — confirmed
by grep). `increment_usage_counter`'s grant was tightened in migration 2
above per the explicit mandatory-check instruction; `nearest_drivers`'s
was not touched. Per the instruction not to combine unrelated
route/function-authorization changes into this PR, `nearest_drivers`'s
`EXECUTE` grant is flagged here as a **follow-up requiring a separate
decision**: is direct anon/browser invocation of this RPC intentionally
required (it currently isn't, per the same zero-client-side-Supabase-
usage grep finding used throughout this remediation program), and if
not, revoke `EXECUTE` from `anon`/`authenticated`/`PUBLIC` there too. Not
applied in this PR.

## Post-merge verification (2026-08-04 21:22 UTC)

**Production deployment health:** CI on the merge commit (`6c6bfd43`)
passed (`node -c server.js`, `npm test` — confirmed via GitHub Actions,
run succeeded). The PR branch's head commit also had a successful Vercel
deployment status ("Deployment has completed") before merge. **This
session could not directly confirm the live production URL is serving
correctly post-merge**: outbound HTTPS from this session to
`harveytaxiservice.com` is blocked by this environment's network egress
policy (`gateway answered 403 to CONNECT (policy denial or upstream
failure)`, confirmed via both a direct `curl` and `WebFetch` — this is
an environment restriction, not an application error). This session also
has no authorized Vercel API access to query deployment status directly
(the Vercel MCP connector requires authorization this session doesn't
have). If you want this checked directly by me in the future, connecting
the Vercel connector would let me query deployment status without
needing raw HTTPS egress to the app domain. In the meantime, the DB-level
checks below (which don't depend on network egress) are the strongest
evidence available from this session that the merge didn't break
anything live.

**Database state re-verified against production, unchanged from
pre-merge (expected — these were direct DB migrations, not deploy-time
changes, so the merge itself doesn't alter them; this confirms nothing
else touched the DB in between):**

| Check | Result |
|---|---|
| `riders` — mis-scoped PUBLIC policy remains absent | Confirmed — `pg_policies` shows only `deny_all_riders` + `service_role_riders` |
| `riders` — `service_role_riders` remains present | Confirmed, `roles={service_role}`, `cmd=ALL`, `qual=true` |
| `usage_counters` — RLS remains enabled | Confirmed, `pg_class.relrowsecurity = true` |
| `preferred_drivers` — RLS remains enabled | Confirmed, `pg_class.relrowsecurity = true` |
| `increment_usage_counter(text)` — executable only by approved backend roles | Confirmed, `EXECUTE` held only by `postgres`/`service_role` |

**Backend smoke test, usage-counter path (rolled back, no data
persisted):**
- `service_role` calling `increment_usage_counter('post-merge-smoke-test')` → succeeds, returns incremented count. Backend path healthy post-merge.
- `anon` calling the same RPC → `permission denied for function increment_usage_counter`. Still correctly denied post-merge.

`spatial_ref_sys` was not re-checked here since its state is already
known and unchanged (see "Residual risk" above) — nothing in this merge
could have changed it.

## What this PR does not touch

Payment methods (P0-2, PR 3), Persona (P0-3, PR 5), push subscriptions
(P0-6, PR 6), safety endpoints (P0-5, PR 7), driver-offer decline
ownership (PR 8), secrets/session hardening (PR 9), and no unrelated
schema cleanup or route-authorization changes, per explicit scope
instruction.
