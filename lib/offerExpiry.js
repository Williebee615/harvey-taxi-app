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

module.exports = { sweepExpiredOffers };
