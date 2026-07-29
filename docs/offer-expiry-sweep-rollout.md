# `offer_expiry_sweep_enabled` — Rollout Procedure (prepared, not executed)

Status: **prepared only — the flag remains disabled in production.** This
document is the exact procedure to follow when a separate, explicit
instruction authorizes enabling it. Nothing in this document has been run.
It is intentionally independent of the ETA-persistence rollout
(`docs/eta-persistence-plan.md` §9) — these protect different parts of the
dispatch pipeline, so enabling one must never be read as authorization for
the other.

## What this flag controls

`sweepExpiredOffers()` (`lib/offerExpiry.js`, PR #65) — enforces
`driver_offers.expires_at`: an offer nobody accepted or declined in time is
atomically marked `expired` and the ride is automatically redispatched to
the next eligible driver, respecting `MAX_DISPATCH_ATTEMPTS`. Runs on a
15-second interval but does nothing while the flag is off.

`sweepStuckRedispatches()` (`lib/offerExpiry.js`, PR #66) — recovers rides
left stuck in `dispatch_status = "redispatching"` if the `dispatchRide()`
call that should have followed a claim failed (process crash, transient
Supabase error). This one is **not** gated by this flag — it ships
unconditionally, since it also protects the pre-existing
decline-triggered redispatch path, not just the new sweep. It is already
running in production today regardless of this flag's state.

## Enable SQL

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'offer_expiry_sweep_enabled',
  'true',
  'Enable automatic redispatch of unanswered/expired driver offers',
  now()
)
on conflict (key) do update
  set value = 'true',
      reason = excluded.reason,
      updated_at = now();
```

## Disable / rollback SQL (instant, no deploy)

```sql
insert into system_flags (key, value, reason, updated_at)
values (
  'offer_expiry_sweep_enabled',
  'false',
  'Rollback: disable offer-expiry sweep',
  now()
)
on conflict (key) do update
  set value = 'false',
      reason = excluded.reason,
      updated_at = now();
```

## Pre-enable checks (all must pass before running the enable SQL)

1. **Deployment health**: the deploy carrying PRs #65 and #66 (and any
   later dispatch-path changes) shows a clean boot log — schema checks
   `ok`, server online, no elevated error rate in the minutes after boot.
2. **Both sweeps already running unconditionally in logs**: confirm via
   `get_logs` (Supabase `api`/postgres logs or Render logs) that the
   15-second offer-expiry check and the 30-second stuck-redispatch check
   are executing on schedule with `200`s and no errors, even while the
   flag is off (the offer-expiry sweep should be a fast no-op each tick;
   the stuck-redispatch sweep runs regardless of this flag).
3. **No currently-stuck rides**: query for rides already wedged before the
   flag is ever turned on, so a pre-existing backlog isn't mistaken for
   sweep-caused churn once it's enabled:
   ```sql
   select id, status, dispatch_status, dispatch_attempts, updated_at
   from rides
   where dispatch_status in ('offer_sent', 'redispatching')
     and updated_at < now() - interval '10 minutes';
   ```
4. **Verify the seven correctness properties** flagged before this
   sequence began (accept/decline atomic guards, concurrency safety,
   `MAX_DISPATCH_ATTEMPTS` respected, and the stuck-ride recovery path)
   remain covered by `lib/offerExpiry.test.js`'s current 14 tests — run
   `npx jest lib/offerExpiry.test.js` and confirm all pass immediately
   before enabling.

## Recommended activation window

Low-traffic hours (late night / early morning local time), consistent with
every prior rollout in this sequence — not a peak-demand window, so a
misbehaving sweep affects the fewest live rides possible before it's
noticed.

## Observation queries (run periodically during the observation window)

```sql
-- Sweep activity — are offers actually expiring and rides redispatching?
select dispatch_status, count(*)
from rides
where updated_at > now() - interval '1 hour'
group by dispatch_status;

-- Expired-offer volume, to sanity-check it's not abnormally high (would
-- suggest a driver-side notification or timeout-length problem, not a
-- sweep bug).
select count(*) from driver_offers
where status = 'expired' and updated_at > now() - interval '1 hour';

-- Rides that hit MAX_DISPATCH_ATTEMPTS — should be rare.
select id, dispatch_attempts, updated_at from rides
where dispatch_status = 'max_attempts_reached'
  and updated_at > now() - interval '1 hour';

-- Anything still stuck despite both sweeps running.
select id, status, dispatch_status, dispatch_claimed_at, updated_at
from rides
where dispatch_status = 'redispatching'
  and dispatch_claimed_at < now() - interval '5 minutes';
```

Application logs: watch for the `⏱️ sweepExpiredOffers`,
`🔁 sweepStuckRedispatches` (or equivalent) log lines, and any
`⚠️ sweepExpiredOffers`/`⚠️ sweepStuckRedispatches` warning lines — the
warnings should be rare/absent; a sustained stream indicates a real
problem, not normal operation.

## Success thresholds

- Expired-offer sweeps result in redispatch (or `max_attempts_reached`
  when attempts are exhausted) with no ride left stuck in `offer_sent`
  past its `expires_at` plus one sweep interval (15s).
- The last observation query above (stuck `redispatching` rides) returns
  zero rows on every check.
- No increase in `max_attempts_reached` rate compared to the pre-flag
  baseline (a spike would suggest driver-side offer delivery/notification
  problems, a separate issue from this sweep).
- No error-rate or latency regression on the accept/decline routes.

## Rollback triggers

Any of the following → run the disable SQL immediately:
- A ride observed stuck in `redispatching` past the stuck-recovery lease
  (90 seconds) despite `sweepStuckRedispatches()` running.
- A ride redispatched to a driver who already declined/received it (would
  indicate the exclusion-list or atomic-claim logic failing in production
  in a way tests didn't catch).
- A sustained stream of `⚠️` warnings from either sweep function.
- Any measurable increase in accept/decline route error rate or latency.

Because both sweeps use the same atomic-claim pattern as every other
concurrency-sensitive path in this codebase, and because
`sweepStuckRedispatches()` keeps running regardless of this flag,
disabling `offer_expiry_sweep_enabled` stops new automatic redispatch
immediately without leaving the accept/decline hardening or the stuck-ride
recovery path disabled — those are unconditional.
