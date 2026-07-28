// Enforces driver_offers.expires_at, which server.js writes on every offer
// but — before this module existed — never read again. A driver who
// neither accepted nor declined left the ride stuck in
// dispatch_status "offer_sent" indefinitely; the rider had no automatic
// recovery. See docs/production-incidents.md for the full incident.
//
// Same dependency-injected orchestrator shape as sweepScheduledRides()
// in lib/rideDispatch.js: the actual Supabase calls are injected so the
// claim/redispatch/max-attempts decision logic — the part with the
// actual reliability requirements — is unit-testable without a
// database. server.js wires the real Supabase-backed
// findExpiredPendingOffers/claimExpiredOffer/etc. via the interval near
// startup.
//
// Concurrency safety: claimExpiredOffer(offerId) must perform an atomic
// conditional update (UPDATE driver_offers SET status='expired' WHERE
// id=? AND status='pending', returning the row only if it matched) so
// that when two server instances' sweep ticks race on the same expired
// offer, or a sweep tick races against a driver tapping accept/decline
// at nearly the same moment, only one caller ever sees a non-null
// result and proceeds to redispatch. Everyone else sees null and skips
// — this is what prevents two instances from redispatching the same
// ride, and what makes accept/decline "fail safely" once an offer has
// expired (their own equivalent conditional updates use the same
// pattern; see the accept/decline routes in server.js).
//
// findExpiredOffers(nowDate) -> offer[]
//   Offers still "pending" whose expires_at has already passed.
// claimExpiredOffer(offerId) -> offer | null
//   Atomically flips one offer to "expired", but only if it was still
//   "pending" at the moment of the update. Returns null if a
//   concurrent accept/decline/sweep already changed its status first.
// getRide(rideId) -> ride | null
// markRideRedispatching(rideId, nextAttempt) -> void
// markRideMaxAttemptsReached(rideId) -> void
// dispatchRide(ride) -> dispatch result
async function sweepExpiredOffers({
  findExpiredOffers,
  claimExpiredOffer,
  getRide,
  markRideRedispatching,
  markRideMaxAttemptsReached,
  dispatchRide,
  maxAttempts,
  now = () => new Date(),
  log = console.log,
  logError = console.error
}) {
  const nowDate = now();
  const result = { expired: [], redispatched: [], maxedOut: [], skipped: [], failed: [] };

  let dueOffers;

  try {
    dueOffers = await findExpiredOffers(nowDate);
  } catch (err) {
    logError("⚠️ sweepExpiredOffers query failed:", err.message);
    return result;
  }

  for (const offer of dueOffers || []) {
    let claimed;

    try {
      claimed = await claimExpiredOffer(offer.id);
    } catch (err) {
      logError(`⚠️ sweepExpiredOffers claim failed for offer ${offer.id}:`, err.message);
      result.skipped.push(offer.id);
      continue;
    }

    if (!claimed) {
      // Already accepted, declined, or expired-and-claimed by a
      // concurrent request or another server instance's sweep tick
      // between the query above and this claim attempt.
      result.skipped.push(offer.id);
      continue;
    }

    result.expired.push(claimed.id);
    log(`⏱️ sweepExpiredOffers: offer ${claimed.id} for ride ${claimed.ride_id} expired unanswered.`);

    try {
      const ride = await getRide(claimed.ride_id);

      if (!ride) {
        result.skipped.push(claimed.id);
        continue;
      }

      const attempts = Number(ride.dispatch_attempts || 0);

      if (attempts >= maxAttempts) {
        await markRideMaxAttemptsReached(ride.id);
        result.maxedOut.push(ride.id);
        continue;
      }

      await markRideRedispatching(ride.id, attempts + 1);
      await dispatchRide({ ...ride, dispatch_attempts: attempts + 1 });
      result.redispatched.push(ride.id);
    } catch (err) {
      logError(
        `⚠️ sweepExpiredOffers redispatch failed for ride tied to offer ${claimed.id}:`,
        err.message
      );
      result.failed.push(claimed.id);
    }
  }

  return result;
}

// Recovers a ride left stuck in dispatch_status "redispatching" because
// the dispatchRide() call that was supposed to follow it never
// completed -- either it threw (a transient Supabase error, the "no
// drivers available" path aside, any unexpected exception) or the
// process crashed between markRideRedispatching() and dispatchRide()
// finishing. Without this, sweepExpiredOffers() above (and the
// pre-existing decline-triggered redispatch in server.js, which sets
// the same "redispatching" status the same way) can leave a ride with
// no current offer and no way to ever be picked up again: it's no
// longer "payment_authorized" so sweepScheduledRides() won't find it,
// and there's no pending driver_offers row left for
// sweepExpiredOffers() to find either.
//
// Mirrors sweepScheduledRides()'s lease/reclaim mechanic exactly,
// reusing the same rides.dispatch_claimed_at column both paths already
// stamp when they set dispatch_status to "redispatching" -- a ride
// whose claim is older than the lease is treated as abandoned and
// re-claimed for another attempt.
//
// This is intentionally NOT gated behind offer_expiry_sweep_enabled:
// the decline-triggered redispatch path this also protects is existing,
// always-on production behavior with the same exposure, independent of
// whether the new offer-timeout sweep is turned on. Recovering a ride
// that's already stuck is a pure safety net with no behavior change for
// any ride that isn't already stuck, so it ships unconditionally --
// same reasoning as the accept/decline atomic-guard hardening.
//
// findStuckRides(cutoffDate) -> ride[]
//   Rides with dispatch_status "redispatching" whose dispatch_claimed_at
//   is older than cutoffDate.
// claimStuckRide(rideId, cutoffDate) -> ride | null
//   Atomically bumps dispatch_claimed_at to "now", but only if the ride
//   is still "redispatching" with a claim older than cutoffDate at the
//   moment of the update. Returns null if another process already
//   reclaimed it, or if the ride moved on (e.g. a driver offer from a
//   totally separate path succeeded in the interim).
// dispatchRide(ride) -> dispatch result
async function sweepStuckRedispatches({
  findStuckRides,
  claimStuckRide,
  dispatchRide,
  leaseMs,
  now = () => new Date(),
  log = console.log,
  logError = console.error
}) {
  const cutoffDate = new Date(now().getTime() - leaseMs);
  const result = { recovered: [], skipped: [], failed: [] };

  let stuckRides;

  try {
    stuckRides = await findStuckRides(cutoffDate);
  } catch (err) {
    logError("⚠️ sweepStuckRedispatches query failed:", err.message);
    return result;
  }

  for (const ride of stuckRides || []) {
    let claimed;

    try {
      claimed = await claimStuckRide(ride.id, cutoffDate);
    } catch (err) {
      logError(`⚠️ sweepStuckRedispatches claim failed for ride ${ride.id}:`, err.message);
      result.skipped.push(ride.id);
      continue;
    }

    if (!claimed) {
      // Already reclaimed by another process/tick, or the ride moved on
      // between the query above and this claim attempt.
      result.skipped.push(ride.id);
      continue;
    }

    log(
      `♻️ sweepStuckRedispatches: ride ${claimed.id} was stuck in "redispatching" ` +
      `past its lease — retrying dispatch.`
    );

    try {
      await dispatchRide(claimed);
      result.recovered.push(claimed.id);
    } catch (err) {
      // Deliberately do not reset dispatch_claimed_at any further here.
      // claimStuckRide() already bumped it to "now", so the next sweep
      // tick won't re-claim this ride again until the lease elapses a
      // second time — giving a transient failure room to clear on its
      // own instead of hot-looping retries against a struggling
      // dependency.
      logError(
        `⚠️ sweepStuckRedispatches: dispatchRide failed again for ${claimed.id}, will retry after the next lease window:`,
        err.message
      );
      result.failed.push(claimed.id);
    }
  }

  return result;
}

module.exports = { sweepExpiredOffers, sweepStuckRedispatches };
