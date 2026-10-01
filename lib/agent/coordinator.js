// Harvey Taxi AI Agent Manager -- operational coordination (pure).
//
// Decides, for the current snapshot of open rides, what the agent would do
// about stalled rides and which alerts the command center should show.
// It never executes anything. server.js runs the plan:
//   - mode "shadow": every planned redispatch is only logged as
//     "would_redispatch" (no ride, offer or driver row is touched);
//   - mode "automation" (feature-flagged OFF in this release): a planned
//     redispatch is executed only through the existing dispatchRide(),
//     after an optimistic-concurrency claim on the ride row.
// A ride that has used up its automatic attempts goes to a human instead.

const { DEFAULT_RULES } = require("./policy");
const { isStalledRide } = require("./recommender");

function planStalledRides({ rides, offers, rules = DEFAULT_RULES, now = Date.now(), lastAgentRedispatchAt = new Map() }) {
  const merged = { ...DEFAULT_RULES, ...(rules || {}) };
  const pendingOfferRideIds = new Set(
    (offers || [])
      .filter((o) => o.status === "pending" && (!o.expires_at || Date.parse(o.expires_at) > now))
      .map((o) => String(o.ride_id))
  );
  const plan = [];
  for (const ride of rides || []) {
    if (!isStalledRide(ride, { pendingOfferRideIds, rules: merged, now })) continue;
    const attempts = Number(ride.dispatch_attempts) || 0;
    if (attempts >= merged.max_auto_redispatch_attempts) {
      plan.push({ ride_id: String(ride.id), decision: "escalate", reason: "max_auto_redispatch_attempts_reached", attempts });
      continue;
    }
    const last = lastAgentRedispatchAt.get(String(ride.id));
    if (last && (now - last) / 1000 < merged.redispatch_cooldown_seconds) {
      plan.push({ ride_id: String(ride.id), decision: "wait", reason: "cooldown", attempts });
      continue;
    }
    plan.push({ ride_id: String(ride.id), decision: "redispatch", reason: "stalled_without_live_offer", attempts, observed_updated_at: ride.updated_at || null });
  }
  return plan;
}

function buildAlerts({ rides, drivers, busyDriverIds = [], offers = [], rules = DEFAULT_RULES, now = Date.now(), dispatchPaused = false, modelStatus = null }) {
  const merged = { ...DEFAULT_RULES, ...(rules || {}) };
  const alerts = [];
  const online = (drivers || []).filter((d) => (d.online === true || d.is_online === true) && !d.is_review_account);
  const busy = new Set((busyDriverIds || []).map(String));
  const free = online.filter((d) => !busy.has(String(d.id)));

  if (dispatchPaused) {
    alerts.push({ level: "warning", code: "dispatch_paused", message: "Dispatch is paused by an administrator. New paid rides wait until it resumes." });
  }
  const realOpen = (rides || []).filter((r) => !r.is_review_ride);
  if (realOpen.length && !free.length) {
    alerts.push({ level: "critical", code: "no_free_drivers", message: `${realOpen.length} open ride(s) and no free online drivers.` });
  }
  const stalled = planStalledRides({ rides, offers, rules: merged, now });
  if (stalled.length) {
    alerts.push({ level: "warning", code: "stalled_rides", message: `${stalled.length} paid ride(s) waiting longer than ${merged.stalled_ride_minutes} min with no live driver offer.` });
  }
  const staleCutoff = now - merged.max_location_age_minutes * 60000;
  const stale = online.filter((d) => {
    const t = Date.parse(d.last_location_at || d.last_seen_at || "");
    return Number.isFinite(t) && t < staleCutoff;
  });
  if (stale.length) {
    alerts.push({ level: "info", code: "stale_driver_locations", message: `${stale.length} online driver(s) have not reported a location in over ${merged.max_location_age_minutes} min.` });
  }
  if (modelStatus && modelStatus.configured && (modelStatus.circuit_open || modelStatus.last_error)) {
    alerts.push({ level: "info", code: "model_degraded", message: "The conversational model is unreachable; assistance is using rule-based answers." });
  }
  return { alerts, counts: { open_rides: (rides || []).length, online_drivers: online.length, free_drivers: free.length, busy_drivers: busy.size, stalled_rides: stalled.length } };
}

module.exports = { planStalledRides, buildAlerts };
