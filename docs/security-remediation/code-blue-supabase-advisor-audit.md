# CODE BLUE — Supabase Security Advisor Audit (separate workstream from PR #130)

Status: **read-only audit only. Nothing applied to production or staging.
No fixes merged anywhere.** This is its own workstream, explicitly kept
separate from PR #130 (`code-blue/dispatch-integrity-phase-1`) per
instruction — PR #130 gets no advisor fixes added to it, and this
workstream carries none of PR #130's own migrations.

Audited: `mcp__Supabase__get_advisors(type="security")` against
`orgahzncmzptljapqffj` ("harvey-taxi-app", the only Supabase project on
this account — confirmed production), 2026-09-27, plus direct read-only
`information_schema`/`pg_catalog` queries to fill in what the advisor
summary doesn't itself carry (owner, grants, policies, trigger usage,
extension dependency). Counts match exactly what was asked to be
verified: **1 error, 16 warnings, 39 informational findings.**

---

## 1. Complete advisor findings table

### ERROR (1)

| Severity | Advisor rule | Schema.object | App or extension owned | Actual exposure | Recommended remediation | Migration-fixable? | Compatibility/downtime risk | Owner-level action needed? |
|---|---|---|---|---|---|---|---|---|
| ERROR | `rls_disabled_in_public` | `public.spatial_ref_sys` | **Extension-owned** (PostGIS reference table; `owner = supabase_admin`, confirmed via `pg_class.relowner`, depends on the `postgis` extension via `pg_depend`) | Table holds only public SRID/coordinate-reference-system metadata (no app or user data). RLS is off, and — separately, at the GRANT layer — `anon`/`authenticated`/`PUBLIC` hold `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` in addition to `SELECT` (confirmed via `information_schema.role_table_grants`), left over from PostGIS's own default table-creation grants. **Write access is the real exposure; read access must stay public** — `nearest_drivers()` needs `SELECT` on SRID 4326 for every caller that can invoke it, verified live in a prior session (`docs/security-remediation/pr-04-rls-hardening.md`). | Revoke `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` from `PUBLIC`/`anon`/`authenticated`, preserve `SELECT`. Do **not** enable RLS on this table (extension-managed; risks PostGIS upgrade conflicts) and do not `ALTER OWNER`. | **No** — already attempted and confirmed a silent no-op (see §2). | Revoking writes: none (nothing in this app writes to `spatial_ref_sys`, confirmed by grep). Enabling RLS: not attempted, not recommended. | **Yes** — table owned by `supabase_admin`; this project's `postgres` role holds no grant option on `supabase_admin`'s grants (`pg_auth_members` confirmed `postgres` is not a member of `supabase_admin`). Supabase Support or dashboard-owner action required. |

### WARN (16, across 4 rule types)

| Severity | Advisor rule | Schema.object | App or extension owned | Actual exposure | Recommended remediation | Migration-fixable? | Compat/downtime risk | Owner action? |
|---|---|---|---|---|---|---|---|---|
| WARN ×9 | `function_search_path_mutable` | `public.set_updated_at`, `drivers_sync_geog`, `nearest_drivers`, `dispatch_ride_atomic`, `increment_usage_counter`, `apply_driver_contact_verification_override`, `apply_driver_compliance_override`, `increment_rider_session_version`, `create_htaf_ride_atomic` | **All application-owned** (confirmed: `pg_depend` shows no owning extension for any of the 9; all `prosecdef = false`, i.e. `SECURITY INVOKER`, confirmed via direct query — none is `SECURITY DEFINER`, so this is not a privilege-escalation vector, only an unqualified-name-resolution risk) | Low as-is (INVOKER means a caller can only ever act with their own privileges, and every function's underlying table already has correct `deny_all_*` RLS for `anon`/`authenticated` where relevant — verified for `riders`/`drivers` this session). Still worth closing: an unpinned `search_path` means the function resolves unqualified identifiers against whatever `search_path` the calling session has, which is a correctness/defense-in-depth gap even without direct exploitation today. | `ALTER FUNCTION ... SET search_path = public, pg_catalog` on each. **`nearest_drivers` and `dispatch_ride_atomic` are already being fixed this way inside PR #130's `dispatch_functions_hardening.sql`** — excluded from this workstream's own migration to avoid a duplicate/conflicting `CREATE OR REPLACE` touching the same functions from two branches. The other 7 are this workstream's to fix. | Yes, trivial, same pattern already used in PR #130. | None — pinning `search_path` doesn't change function behavior for any caller resolving names the intended way. | No. |
| WARN ×1 | `extension_in_public` | `postgis` extension | Extension itself | The advisor's generic recommendation (move to a dedicated schema) is high-effort and genuinely risky here: this app calls unqualified PostGIS types/functions (`geography`, `ST_Distance`, `ST_DWithin`, `ST_SetSRID`, `ST_MakePoint`, etc.) throughout `nearest_drivers()`/`dispatch_ride_atomic()` and the `drivers.geog` column type itself. Relocating the extension needs every one of those call sites re-qualified or `search_path` adjusted app-wide, and Supabase's own guidance generally treats this as safe-to-defer for an existing project already built on `public`-schema PostGIS. | **Recommend: do not move it.** Document as an accepted, deferred WARN — not "resolved," not silently dismissed either (see §6). | Technically yes, practically high-risk. | **High** — a botched relocation breaks every geography-dependent code path (dispatch matching, nearest-driver lookup) app-wide; far higher severity than the WARN it fixes. | No, but effectively requires a full compatibility re-audit before ever attempting it — out of scope for this workstream. |
| WARN ×3 | `anon_security_definer_function_executable` | `public.st_estimatedextent(text,text)`, `(text,text,text)`, `(text,text,text,boolean)` | **Extension-owned** (all 3 overloads confirmed via `pg_depend`: owned by the `postgis` extension; `prosecdef = true`, i.e. genuinely `SECURITY DEFINER`, unlike the app's own 9 functions above) | These are PostGIS's own built-in statistics-estimation helpers, not application code (confirmed: zero references anywhere in `server.js` or any migration in this repo — the app never calls them). `SECURITY DEFINER` + reachable by `anon` over `/rest/v1/rpc/st_estimatedextent` is the advisor's real concern, but the function only reads table statistics (`pg_statistic`-derived bounding-box estimates), not row data — low actual sensitivity, though still an unnecessary public surface. | **Narrow, not structural**: revoke `EXECUTE` from `anon`/`authenticated`/`PUBLIC` specifically (leave `postgres`/`service_role`), without touching the extension itself. Do not `ALTER FUNCTION` on an extension-owned object beyond a plain `REVOKE`/`GRANT` (those are not extension-versioned state and are safe to change independent of the extension's own definition). | Yes, but **document the caveat**: a future `ALTER EXTENSION postgis UPDATE` can re-grant PostGIS's own default privileges on its functions, silently undoing this revoke — re-verify after any PostGIS version bump. | Low — app doesn't call these, confirmed by grep. | No — plain `REVOKE EXECUTE` on an extension function's grants doesn't require owning or altering the extension. |
| WARN ×3 | `authenticated_security_definer_function_executable` | Same 3 `st_estimatedextent` overloads | Same | Same | Same fix, same `REVOKE` statement covers both roles at once. | Yes | Low | No |

### INFO (39, all one rule)

| Severity | Advisor rule | Count | App or extension owned |
|---|---|---|---|
| INFO | `rls_enabled_no_policy` | 39 tables | All application-owned |

**Every one of these 39 already defaults to zero rows/zero writes for
`anon` and `authenticated`** — Postgres RLS enabled with no matching
policy is deny-by-default for every command, and neither role is the
table owner or holds `BYPASSRLS`. So none of these is an active,
exploitable gap today. What differs per table is what's sitting *above*
that RLS deny-all, at the GRANT layer — split into two real subgroups,
confirmed via `information_schema.role_table_grants` for all 39, not
assumed uniform:

**Group A — 17 tables where `anon`/`authenticated` ALSO hold full
`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`
grants** (legacy default grants from when these tables were created,
before this project's newer migrations started scoping grants
explicitly): `admin_rbac_shadow_log`, `admin_roles`, `audit_logs`,
`autonomous_pilot_events`, `autonomous_pilot_zones`,
`autonomous_provider_reservations`, `deliveries`, `delivery_order_items`,
`delivery_orders`, `delivery_status_events`, `driver_offers`,
`emergency_alerts`, `push_subscriptions`, `safety_reports`,
`saved_places`, `system_flags`, `verification_codes`. RLS is the *only*
thing currently blocking `anon`/`authenticated` here — safe today, but
one accidental permissive policy or one RLS-disable away from the full
breadth of those grants becoming live. **Ranked: recommended** (revoke
the unnecessary grants; belt-and-suspenders shouldn't depend on the belt
alone).

**Group B — 22 tables with NO `anon`/`authenticated` grants at all**
(doubly protected: blocked at the GRANT layer before RLS is even
evaluated): `admin_logs`, `driver_earnings`, `driver_email_verifications`,
`driver_locations`, `driver_payouts`, `driver_sessions`,
`driver_sms_verifications`, `driver_wallets`, `events`, `fleet_units`,
`incident_reports`, `notification_logs`, `payment_authorizations`,
`payouts`, `ride_chat`, `rider_verifications`, `support_cases`, `tips`,
`trip_events`, `trip_timelines`, `dispatch_offers`, `dispatch_queue`.
**Ranked: not applicable** — there is nothing to close; the GRANT layer
already fully denies `anon`/`authenticated` regardless of policy state.

No app table in this list is confirmed accessed by any client-side
Supabase SDK — this session re-confirmed the standing finding (used
throughout this repo's `security-remediation/` docs) that `server.js`'s
service-role client is the only caller anywhere in this codebase.

---

## 2. `public.spatial_ref_sys` — full detail

Confirmed this session, read-only, before touching anything:

- **Owner**: `supabase_admin` (not `postgres`, not this project's own
  migration-running role).
- **RLS**: disabled, not forced (`relrowsecurity = false`,
  `relforcerowsecurity = false`).
- **Policies**: none (`pg_policies` returns zero rows for this table).
- **Dependency**: owned by the `postgis` extension (`pg_depend`,
  `deptype = 'e'`) — genuinely extension-managed, not an app table that
  happens to share a name.
- **Grants**: `PUBLIC`/`anon`/`authenticated`/`postgres`/`service_role`
  all hold `SELECT`; `anon`/`authenticated`/`PUBLIC` (but not
  `service_role`/`postgres`'s *own* grant chain — see below) additionally
  hold `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`.
- **Existing repo record**: `supabase/migrations/20260804210200_spatial_ref_sys_privilege_hardening_OWNER_ACTION_REQUIRED_NOT_APPLIED.sql`
  and `docs/security-remediation/pr-04-rls-hardening.md` already document
  this exact finding in full, including a **prior real attempt**: the
  revoke was actually executed against production on 2026-08-04, the
  tool reported success, but `pg_class.relacl` re-verification immediately
  after (and again after PR #98 merged) confirmed it was a silent no-op —
  `postgres` holds no grant option on `supabase_admin`'s grants, and
  `SET ROLE supabase_admin` returns "permission denied to set role."
  Nothing has changed since; re-confirmed this session.

**This session's instructions, followed exactly:**
- Not dropped, recreated, moved, truncated.
- Extension ownership not altered; no `ALTER OWNER`.
- PostGIS extension itself not modified.
- RLS not force-enabled (and not enabled at all — the existing repo
  decision to leave RLS off this table, since it's extension-managed
  reference data with no app-sensitive content, stands; the real defect
  is the write grants, not the missing RLS itself).
- Not marked resolved, not suppressed, not ignored — left explicitly
  **open** (§6).

**Would removing public write access break anything?** No — confirmed
by grep, nothing in this app writes to `spatial_ref_sys`. Public `SELECT`
must stay, confirmed live in the prior session's rollback-tested check
(`SET LOCAL ROLE anon; select srtext is not null from spatial_ref_sys
where srid=4326;` → `true`), since `nearest_drivers()` depends on it for
every caller able to invoke that RPC. **Not applied** — this is a
finding, not an action; see §5 for the Support request needed to close
it.

---

## 3. P0/P1/P2 remediation plan

**P0 (none).** Nothing in this advisor set is an active, currently
exploitable vulnerability, confirmed per-finding above — every real
write/read path is independently blocked by RLS (spatial_ref_sys's
write grants) or by the underlying table's own `deny_all_*` RLS
(the 9 function EXECUTE grants) or by the app never calling the
function at all (`st_estimatedextent`) or by GRANT-layer denial already
covering the gap (Group B of the 39). This audit found no P0.

**P1 (defense-in-depth, low-risk, migration-ready):**
1. Pin `search_path` on the 7 application functions PR #130 doesn't
   already cover (§4, Migration A).
2. Revoke unnecessary `anon`/`authenticated` grants on the 17 Group-A
   tables (§4, Migration B).
3. Narrow `st_estimatedextent`'s `anon`/`authenticated` EXECUTE (§4,
   Migration C).
4. Submit the Supabase Support request for `spatial_ref_sys`'s write
   grants (§5) — not a migration, but the only path to actually closing
   the one ERROR-level finding.

**P2 (documented, deliberately not acted on):**
1. `extension_in_public` (postgis) — accepted risk, not attempted; see
   §1's WARN table for why relocating it is higher-risk than the WARN it
   would close.
2. Optional explicit deny-all RLS *policies* on the 17 Group-A tables,
   on top of the grant revoke — genuinely redundant once Migration B
   ships (a role with zero table grants can't reach RLS evaluation at
   all), so ranked optional/documentation-only, not required.

---

## 4. Proposed staging-only migrations (not applied anywhere — drafts only)

Three migrations, one per risk group, kept out of PR #130 entirely and
out of each other where the grouping differs for a reason:

### Migration A — pin `search_path` on the 7 remaining application functions

```sql
-- supabase/migrations/PROPOSED_advisor_search_path_pinning.sql (STAGING ONLY, NOT APPLIED)
-- Closes function_search_path_mutable for the 7 app functions not
-- already covered by PR #130's dispatch_functions_hardening.sql
-- (nearest_drivers, dispatch_ride_atomic deliberately excluded here to
-- avoid a duplicate CREATE OR REPLACE racing that migration).
-- All 7 confirmed SECURITY INVOKER (prosecdef=false) and
-- application-owned (no owning extension) -- read-only verified this
-- session, not assumed.

alter function public.set_updated_at() set search_path = public, pg_catalog;
alter function public.drivers_sync_geog() set search_path = public, pg_catalog;
alter function public.increment_usage_counter(text, integer) set search_path = public, pg_catalog; -- verify exact signature in staging before applying; see test plan
alter function public.apply_driver_contact_verification_override(text, text, text) set search_path = public, pg_catalog; -- verify exact signature in staging
alter function public.apply_driver_compliance_override(text, text, text) set search_path = public, pg_catalog; -- verify exact signature in staging
alter function public.increment_rider_session_version(text) set search_path = public, pg_catalog; -- verify exact signature in staging
alter function public.create_htaf_ride_atomic(text, text, text, text, text) set search_path = public, pg_catalog; -- verify exact signature in staging
```

**Note honestly:** the exact argument lists for
`increment_usage_counter`/`apply_driver_contact_verification_override`/
`apply_driver_compliance_override`/`increment_rider_session_version`/
`create_htaf_ride_atomic` were not individually re-verified via
`pg_get_function_identity_arguments` in this pass (only confirmed for
`set_updated_at`/`drivers_sync_geog`, which are trigger functions with no
args). **Before ever applying this in staging**, re-run
`pg_get_function_identity_arguments` for all 5 remaining functions and
correct each `ALTER FUNCTION` signature to match exactly — `ALTER
FUNCTION` requires the exact argument-type list, and a wrong one simply
errors (safe failure, not a silent no-op), but should be gotten right
before the first attempt rather than relying on that.

Reversible: `alter function ... reset search_path;` restores prior
(mutable) behavior instantly, no data changes involved.

### Migration B — revoke unnecessary grants on the 17 Group-A tables

```sql
-- supabase/migrations/PROPOSED_advisor_revoke_group_a_grants.sql (STAGING ONLY, NOT APPLIED)
-- Group A tables (see audit doc) carry full anon/authenticated CRUD
-- grants left over from table creation, sitting above an RLS
-- enabled-no-policy deny-all. Confirmed by grep: no client-side code in
-- this repo ever uses a Supabase SDK directly -- server.js's
-- service_role client is the only legitimate caller for every one of
-- these tables. service_role is untouched below.

revoke insert, update, delete, truncate, references, trigger, select
  on public.admin_rbac_shadow_log, public.admin_roles, public.audit_logs,
     public.autonomous_pilot_events, public.autonomous_pilot_zones,
     public.autonomous_provider_reservations, public.deliveries,
     public.delivery_order_items, public.delivery_orders,
     public.delivery_status_events, public.driver_offers,
     public.emergency_alerts, public.push_subscriptions,
     public.safety_reports, public.saved_places, public.system_flags,
     public.verification_codes
  from public, anon, authenticated;
```

Reversible: re-run the original (implicit, PostgREST-default) `grant
all on <table> to anon, authenticated;` per table if this is ever found
to have broken something — but per the compatibility basis above, it
shouldn't, since RLS was already blocking all of this traffic; the
revoke only removes a now-provably-unused grant.

### Migration C — narrow `st_estimatedextent` EXECUTE

```sql
-- supabase/migrations/PROPOSED_advisor_st_estimatedextent_execute.sql (STAGING ONLY, NOT APPLIED)
-- st_estimatedextent is a PostGIS-extension-owned SECURITY DEFINER
-- function, confirmed unused anywhere in this app (grep, zero hits).
-- Plain REVOKE on an extension function's grants is not an extension
-- modification -- safe independent of postgis's own versioned state,
-- though a future `ALTER EXTENSION postgis UPDATE` can re-grant
-- PostGIS's own defaults and should be re-checked after any such
-- upgrade.

revoke execute on function public.st_estimatedextent(text, text)
  from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean)
  from public, anon, authenticated;
```

Reversible: `grant execute ... to public, anon, authenticated;` restores
prior state exactly.

**None of these three migrations touch `spatial_ref_sys`, `postgis`, or
anything requiring owner-level action** — those stay open per §2/§5/§6,
by design, not oversight.

---

## 5. Draft Supabase Support message (spatial_ref_sys, owner-action required)

Reusing and updating the message already drafted in
`docs/security-remediation/pr-04-rls-hardening.md` (§"Supabase support
request") rather than drafting a second, inconsistent one — this session
re-confirmed every fact in it is still accurate:

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
> by geography-type distance calculations in a `SECURITY INVOKER`
> function our app calls, `nearest_drivers()`).
>
> We attempted `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
> public.spatial_ref_sys FROM PUBLIC, anon, authenticated;` ourselves
> (most recently re-confirmed 2026-09-27) and confirmed via
> `pg_class.relacl` that it has no effect: the table is owned by
> `supabase_admin`, our `postgres` role holds no grant option on
> `supabase_admin`'s grants, and `SET ROLE supabase_admin` returns
> "permission denied to set role" (confirmed via `pg_auth_members` that
> `postgres` is not a member of `supabase_admin`). Could you perform this
> revoke (or grant our project's `postgres` role the necessary privilege
> to do so ourselves)?
>
> This is currently flagged as the sole ERROR-level finding
> (`rls_disabled_in_public`) in our project's Security Advisor.

Still needs a human to actually submit it via
dashboard.supabase.com → this project → Support — no tool in this
session opens Supabase support tickets.

---

## 6. Findings that can close vs. must stay open

**Can close once the 3 staging migrations above are tested and
(separately, with approval) applied to production:**
- All 9 `function_search_path_mutable` findings (2 via PR #130, 7 via
  Migration A).
- All 6 SECURITY DEFINER EXECUTE findings (`st_estimatedextent` ×3 ×2
  roles) via Migration C.
- The Group-A portion (17 of 39) of `rls_enabled_no_policy`, in the
  sense that the underlying grant breadth causing them to be worth
  watching goes away — the advisor may still list them as INFO
  afterward purely because RLS-enabled-no-policy remains true by
  design (no policy is still the correct state for pure
  service-role-only tables); that's expected, not a failure to close.

**Must stay open, not closeable from this session:**
- The 1 ERROR (`spatial_ref_sys` RLS-disabled / write-grants) — blocked
  on Supabase Support or an owner-level action neither this session nor
  any prior one could perform.
- `extension_in_public` (postgis) — open by deliberate decision, not
  capability; relocating it is assessed higher-risk than the finding
  itself given this app's current unqualified PostGIS usage.
- The Group-B portion (22 of 39) of `rls_enabled_no_policy` — nothing to
  close; already fully denied at the grant layer, "no policy" is simply
  the correct/expected state for a table with zero non-service-role
  grants.

---

## 4a. Test plan for Migrations A/B/C (staging, before any production application)

All of these run against `harvey-taxi-staging` once it exists, the same
project PR #130's own migrations are waiting on. None of this has been
executed yet — this is the plan, not results.

**Grants (Migration B):**
1. Before: confirm all 17 Group-A tables currently show the full grant
   set for `anon`/`authenticated` in staging (should match production's
   drift-state once staging is rebuilt from committed migrations —
   flag as a missing-prerequisite discrepancy if it doesn't, per the
   standing "stop and report" instruction).
2. Apply Migration B.
3. After: re-query `information_schema.role_table_grants` for all 17 —
   expect zero rows for `anon`/`authenticated`, `service_role` unchanged.
4. `SET LOCAL ROLE anon;` / `SET LOCAL ROLE authenticated;` (rolled back,
   never committed) attempt a `select`/`insert` against 2-3 sample tables
   from the 17 (e.g. `system_flags`, `audit_logs`) — expect a permission
   error now raised at the GRANT layer itself (previously it was RLS
   silently returning zero rows; after this migration it's a hard
   permission denial, a strictly stronger guarantee).
5. `service_role` (the identity `server.js` actually runs as):
   full read/write against the same sample tables still succeeds,
   unchanged — proves the app itself is unaffected.

**Function search_path (Migration A):**
1. Confirm exact argument signatures for the 5 unverified functions via
   `pg_get_function_identity_arguments` before writing the final
   `ALTER FUNCTION` statements (per the caveat in §4).
2. Apply Migration A.
3. Re-query `pg_proc.proconfig` for all 7 — expect
   `search_path=public, pg_catalog` present.
4. Application-compatibility check: exercise each function through its
   real caller path in staging —
   `set_updated_at`/`drivers_sync_geog` via an ordinary `UPDATE` on a row
   in a table they trigger on (confirms trigger firing is unaffected by
   the grant/search_path change, consistent with Postgres not gating
   trigger execution on the firing role's `EXECUTE` privilege);
   `increment_usage_counter`/`increment_rider_session_version`/
   `apply_driver_compliance_override`/
   `apply_driver_contact_verification_override`/`create_htaf_ride_atomic`
   via whatever `server.js` route calls each (grep each name in
   `server.js` first to find the exact call site), confirming identical
   output before/after.

**RPC access (Migration C):**
1. `SET LOCAL ROLE anon;` (rolled back) call
   `select st_estimatedextent('public','spatial_ref_sys','the_geom')` (or
   whatever real args are needed — confirm the actual expected call
   shape first) — before Migration C, succeeds; after, expect a
   permission-denied error.
2. Confirm `service_role`/`postgres` retain `EXECUTE` (PostGIS's own
   internal use of this function, if any, runs as the table
   owner/extension context, not as `anon`, so this should be unaffected
   — verify by confirming any `ANALYZE`/statistics-refresh operation on
   spatial tables still works in staging after the revoke).

**Application compatibility (all three migrations together):**
1. Run the existing Jest suite against staging-pointed environment
   variables where feasible (most of this repo's tests use the fake
   Supabase mock and won't exercise real grants — flag this limitation
   explicitly rather than claim coverage that doesn't exist; only a
   handful of true integration paths would actually touch a live
   staging DB).
2. Full manual smoke pass of the core rider/driver/admin flows against
   staging afterward, since none of these three migrations should change
   any app-visible behavior at all (that's the point — they only remove
   privilege that was never legitimately used) — any observed behavior
   change is itself a signal to stop and investigate before considering
   production application.

## What this workstream deliberately did not do

- No production changes.
- No advisor findings dismissed/suppressed/marked resolved without a
  real fix.
- No secrets read, logged, or exposed (every query above was schema/grant
  metadata, never table contents beyond `spatial_ref_sys`'s own public
  SRID reference data).
- No Supabase plan upgrade.
- Nothing merged into PR #130, and no PR #130 migration duplicated here.
- No staging application of Migrations A/B/C yet — pending the same
  `harvey-taxi-staging` project this session is already waiting on for
  PR #130's own migrations, and pending your approval to apply even
  there.
