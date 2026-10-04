# Supabase upgrade: Pro plan and Micro compute (approved 2026-10-04)

The owner approved upgrading the Supabase organization to the Pro plan and the production project to Micro compute. Larger compute is only to be considered after real CPU, memory and disk measurements.

**This upgrade is not a confirmed fix for the 2026-10-04 outage; its cause is still unknown.** It adds capacity and puts the project on a paid plan with paid support. It does not explain the outage.

## Current state (checked 2026-10-04, 19:02 UTC)

| Item | Value | How it was checked |
|---|---|---|
| Organization | "Harvey Taxi Service LLC", **Free** plan | Supabase management API (`get_organization`) |
| Projects in the organization | **2**: `harvey-taxi-app` (production, `orgahzncmzptljapqffj`) and `harvey-taxi-staging-pr130` (`yryfdobxhvklanmbotfu`, created 2026-09-28 for PR #130 testing) | `list_projects` |
| Production status | `ACTIVE_HEALTHY`, Postgres 17.6, us-east-1 | `get_project` |
| Production compute size | **Not visible to the tools here.** Free-plan projects run on Nano compute. `shared_buffers` is 224 MB. Confirm the size in Dashboard → Project Settings → Compute and Disk. | SQL (`pg_settings`) |
| Database size | 25 MB | `pg_database_size` |
| Connections | 17 in use of 60 | `pg_stat_activity` |
| Cache hit rate | 100% | `pg_stat_database` |
| Long-running queries (> 30 s) | 0 | `pg_stat_activity` |
| Postgres log lines with ERROR, FATAL, PANIC or out of memory (last 24 h) | 0 of 384 lines | Log query |
| CPU and memory use | **Not available to the tools here.** Read them from Dashboard → Observability, or Reports → Database. | — |

## Estimated monthly cost (from Supabase's published pricing, read 2026-10-04)

Pricing source: the Supabase docs pages "Manage Compute usage" and "Your monthly invoice".
- Pro plan: **$25** a month for the organization.
- Paid plans include **$10** of compute credit a month, enough for one project on Micro.
- Micro compute is about $10 a month per project. Nano projects on a paid plan are billed at the Micro price.
- **Every project in the organization is billed for compute**, so the staging project adds its own charge.

| Scenario | Estimate per month |
|---|---|
| Pro, production on Micro, staging project **left in the organization** | $25 + $10 + $10 − $10 credit = **about $35** |
| Pro, production on Micro, staging **moved to a separate Free organization or deleted** | $25 + $10 − $10 credit = **about $25** |

- **Extra charges:** usage beyond the Pro quotas could add more. The spend cap is on by default for usage-based items, but it does not cover compute hours.
- **Current usage** is far below the quotas (25 MB of database).
- **Actual bill:** check it on Dashboard → Organization → Billing (upcoming invoice). That page is not reachable from the tools here, so these figures are **estimates**.

**Decision needed from the owner:** keep the staging project (about $10 a month extra), move it to a Free organization, or delete it. Nothing has been changed.

## Upgrade steps (owner, in the Supabase dashboard)

The tools available here can't change the plan or the compute size. Both are dashboard actions.

1. **Organization → Billing → Change plan → Pro.** Confirm the payment method.
2. **Production project → Project Settings → Compute and Disk → Micro → Confirm.**
   - **The database restarts for a few minutes**; Supabase doesn't upgrade compute automatically because of this downtime.
   - Booking and the driver app will see errors during the restart, so pick a quiet time.
3. Tell Claude when each step is done, so the checks below can run.

## Checks after the upgrade (Claude runs them; all read-only)

1. Project status `ACTIVE_HEALTHY`, and the same SQL measurements as above. Compare connections and errors.
2. Postgres logs since the upgrade: no ERROR, FATAL or out-of-memory messages.
3. Production endpoints:
   - `/health` returns 200;
   - the rider dashboard loads;
   - the assistant status is available;
   - the driver endpoint refuses unauthenticated calls.

   The script is in the session scratchpad and makes no changes.
4. **Booking:** recent rides are readable, no rides are stuck in an open state, and audit writes are current.
5. **Driver status:** the online drivers and open driver sessions match each other (driver-hours enforcement depends on them).
6. **Device check by the owner:**
   - book a ride on a test account;
   - put a test driver online;
   - check the driver gets the offer.

   The tools here can't do this end to end without creating real rides.

## Pre-upgrade baseline (2026-10-04, 19:03 UTC)

| Check | Result |
|---|---|
| `/health` | 200, "healthy", production |
| Rider dashboard | 200 |
| Assistant status | 200, available, rules only |
| Driver endpoint without sign-in | 401 (expected) |
| Drivers online, open driver sessions | 1, 1 |
| Rides in the last 24 h, open rides | 3, 0 (last ride 17:13 UTC) |
| Last audit write | 19:03 UTC (current) |
