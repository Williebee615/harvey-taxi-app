// Investigation tools: authorized, read-only evidence about one ride.
//
// Only sources the platform actually writes are used: the ride row and
// its timestamps, driver_offers (dispatch attempts), the driver's current
// location freshness, the payment record, the ride's audit_logs entries
// (including the location snapshot taken at each driver status change,
// see transitionLocationEvidence) and emergency alerts. Tables that exist
// but are never written (trip_events, driver_locations, support_cases,
// incident_reports, notification_logs) are not consulted; see
// docs/agent-operations.md.
//
// Access: an admin may investigate any ride; a rider only a ride whose
// rider_id is theirs; a driver only a ride they are assigned to or were
// offered. Anything else is reported as not found.

const { distanceMiles } = require("../agent/recommender");

const RIDE_EVIDENCE_COLUMNS = [
  "id", "rider_id", "rider_name", "driver_id", "driver_name", "driver_vehicle", "status", "dispatch_status",
  "ride_type", "pickup_address", "dropoff_address", "pickup_lat", "pickup_lng", "dropoff_lat", "dropoff_lng",
  "scheduled_time", "requested_at", "created_at", "updated_at", "search_started_at", "accepted_at",
  "driver_accepted_at", "assigned_at", "en_route_at", "enroute_at", "arrived_at", "driver_arrived_at",
  "started_at", "trip_started_at", "completed_at", "trip_completed_at", "cancelled_at", "canceled_at",
  "cancelled_by_type", "cancellation_reason", "cancel_reason", "dispatch_attempts", "last_dispatch_at",
  "estimated_fare", "fare_total", "final_fare", "tip_amount", "payment_id", "payment_status", "payment_captured",
  "payment_capture_attempted_at", "payment_capture_error", "cancellation_payment_status",
  "delivery_stage", "delivered_at", "merchant_name", "item_count", "delivery_handoff", "delivery_proof_url",
  "is_review_ride", "assigned_by_admin"
].join(",");

const TIMESTAMP_EVENTS = [
  ["created_at", "ride_created", "Ride requested"],
  ["scheduled_time", "scheduled_pickup", "Scheduled pickup time"],
  ["search_started_at", "search_started", "Driver search started"],
  ["assigned_at", "driver_assigned", "Driver assigned"],
  ["accepted_at", "driver_accepted", "Driver accepted the ride"],
  ["driver_accepted_at", "driver_accepted", "Driver accepted the ride"],
  ["en_route_at", "driver_enroute", "Driver marked en route"],
  ["enroute_at", "driver_enroute", "Driver marked en route"],
  ["arrived_at", "driver_arrived", "Driver marked arrived"],
  ["driver_arrived_at", "driver_arrived", "Driver marked arrived"],
  ["started_at", "trip_started", "Trip started"],
  ["trip_started_at", "trip_started", "Trip started"],
  ["delivered_at", "delivered", "Order marked delivered"],
  ["completed_at", "trip_completed", "Trip completed"],
  ["trip_completed_at", "trip_completed", "Trip completed"],
  ["payment_capture_attempted_at", "payment_capture_attempted", "Payment capture attempted"],
  ["cancelled_at", "ride_cancelled", "Ride cancelled"],
  ["canceled_at", "ride_cancelled", "Ride cancelled"]
];

const AUDIT_LABELS = {
  driver_enroute: "Driver marked en route",
  driver_arrived: "Driver marked arrived",
  driver_started_trip: "Trip started",
  driver_completed_trip: "Trip completed",
  ride_cancelled: "Ride cancelled",
  ride_payment_authorized: "Payment authorized",
  ride_payment_captured: "Payment captured",
  "agent.action_executed": "Agent action executed",
  "agent.shadow_decision": "Agent shadow decision (not executed)"
};

function iso(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function round(n, places = 2) {
  return Number.isFinite(n) ? Number(n.toFixed(places)) : null;
}

// Location snapshot recorded with each driver status change. Distance
// rather than raw coordinates keeps the audit log free of location data
// while still answering "where was the driver when they marked arrived?".
function transitionLocationEvidence({ driver, ride, target = "pickup", now = Date.now() }) {
  const lat = Number(driver && (driver.current_lat ?? driver.latitude));
  const lng = Number(driver && (driver.current_lng ?? driver.longitude));
  const tLat = Number(target === "dropoff" ? ride && ride.dropoff_lat : ride && ride.pickup_lat);
  const tLng = Number(target === "dropoff" ? ride && ride.dropoff_lng : ride && ride.pickup_lng);
  const seen = Date.parse((driver && (driver.last_location_at || driver.last_seen_at)) || "");
  const known = [lat, lng, tLat, tLng].every(Number.isFinite) && !(lat === 0 && lng === 0);
  return {
    location_known: known,
    [`distance_to_${target}_miles`]: known ? round(distanceMiles(lat, lng, tLat, tLng)) : null,
    location_age_seconds: Number.isFinite(seen) ? Math.max(0, Math.round((now - seen) / 1000)) : null
  };
}

function firstName(full) {
  return String(full || "").trim().split(/\s+/)[0] || null;
}

function driverLabel(driver, fallback) {
  if (driver) {
    const first = String(driver.first_name || "").trim();
    const last = String(driver.last_name || "").trim();
    if (first) return last ? `${first} ${last[0]}.` : first;
  }
  return fallback ? firstName(fallback) : "the driver";
}

function buildTimeline({ ride, offers = [], audits = [], alerts = [], driverLabels = {} }) {
  const entries = [];
  const seenKeys = new Set();
  const push = (entry) => {
    const key = `${entry.kind}|${entry.at}`;
    if (!entry.at || seenKeys.has(key)) return;
    seenKeys.add(key);
    entries.push(entry);
  };
  for (const [column, kind, label] of TIMESTAMP_EVENTS) {
    const at = iso(ride[column]);
    if (at) push({ at, kind, label, source: `rides.${column}`, verified: true });
  }
  for (const offer of offers) {
    const who = driverLabels[offer.driver_id] || "a driver";
    const sent = iso(offer.created_at || offer.offered_at);
    if (sent) push({ at: sent, kind: "offer_sent", label: `Offer ${offer.attempt ? `#${offer.attempt} ` : ""}sent to ${who}`, source: "driver_offers", verified: true });
    const answered = iso(offer.responded_at);
    if (answered && offer.status) {
      push({ at: answered, kind: `offer_${offer.status}`, label: `Offer ${offer.status} by ${who}${offer.decline_reason ? ` (${String(offer.decline_reason).slice(0, 60)})` : ""}`, source: "driver_offers", verified: true });
    } else if (offer.status === "expired" && iso(offer.expires_at)) {
      push({ at: iso(offer.expires_at), kind: "offer_expired", label: `Offer to ${who} expired without an answer`, source: "driver_offers", verified: true });
    }
  }
  for (const a of audits) {
    const at = iso(a.created_at);
    const label = AUDIT_LABELS[a.action];
    if (!at || !label) continue;
    const m = a.metadata || {};
    const details = [];
    if (Number.isFinite(m.distance_to_pickup_miles)) details.push(`${m.distance_to_pickup_miles} mi from pickup`);
    if (Number.isFinite(m.distance_to_dropoff_miles)) details.push(`${m.distance_to_dropoff_miles} mi from drop-off`);
    if (Number.isFinite(m.location_age_seconds)) details.push(`location ${m.location_age_seconds} s old`);
    push({ at, kind: `audit_${a.action}`, label: details.length ? `${label} (${details.join(", ")})` : label, source: "audit_logs", verified: true, metadata: m });
  }
  for (const alert of alerts) {
    const at = iso(alert.created_at);
    if (at) push({ at, kind: "emergency_alert", label: "Emergency alert raised", source: "emergency_alerts", verified: true });
  }
  return entries.sort((x, y) => x.at.localeCompare(y.at));
}

class EvidenceAccessError extends Error {
  constructor() {
    super("Ride not found.");
    this.status = 404;
  }
}

function canSee(actor, ride, offers) {
  if (!actor || !ride) return false;
  if (actor.role === "admin") return true;
  if (actor.role === "rider") return String(ride.rider_id || "") === String(actor.id);
  if (actor.role === "driver") {
    return String(ride.driver_id || "") === String(actor.id) || offers.some((o) => String(o.driver_id) === String(actor.id));
  }
  return false;
}

function unwrap(result) {
  if (result.error) {
    const err = new Error("Platform data is temporarily unavailable.");
    err.status = 503;
    throw err;
  }
  return result.data;
}

// Collects everything an investigation may use for one ride, for this actor.
async function collectRideEvidence({ supabase, actor, rideId, now = Date.now(), trace = [] }) {
  const started = now;
  const ride = unwrap(await supabase.from("rides").select(RIDE_EVIDENCE_COLUMNS).eq("id", String(rideId)).maybeSingle());
  trace.push({ tool: "ride_record", ok: Boolean(ride) });
  if (!ride) throw new EvidenceAccessError();
  const offers = unwrap(
    await supabase.from("driver_offers").select("id,driver_id,status,attempt,created_at,responded_at,expires_at,decline_reason").eq("ride_id", ride.id).limit(50)
  ) || [];
  trace.push({ tool: "dispatch_attempts", ok: true, rows: offers.length });
  if (!canSee(actor, ride, offers)) throw new EvidenceAccessError();

  const driverIds = [...new Set([ride.driver_id, ...offers.map((o) => o.driver_id)].filter(Boolean).map(String))];
  const [drivers, payment, audits, alerts, pausedFlag] = await Promise.all([
    driverIds.length
      ? supabase.from("drivers").select("id,first_name,last_name,online,current_lat,current_lng,last_location_at,last_seen_at,location_accuracy_meters").in("id", driverIds).then(unwrap)
      : Promise.resolve([]),
    ride.payment_id
      ? supabase.from("payments").select("id,status,amount,captured_amount,canceled_at,cancel_reason,stripe_latest_status").eq("id", ride.payment_id).maybeSingle().then(unwrap)
      : Promise.resolve(null),
    supabase.from("audit_logs").select("action,actor_type,created_at,metadata").eq("entity_type", "ride").eq("entity_id", ride.id).limit(200).then(unwrap),
    supabase.from("emergency_alerts").select("id,created_at,status").eq("ride_id", ride.id).limit(20).then(unwrap),
    supabase.from("system_flags").select("key,value").eq("key", "dispatch_paused").maybeSingle().then(unwrap)
  ]);
  trace.push({ tool: "driver_heartbeat", ok: true, rows: (drivers || []).length });
  trace.push({ tool: "payment_record", ok: true, rows: payment ? 1 : 0 });
  trace.push({ tool: "ride_audit_events", ok: true, rows: (audits || []).length });
  trace.push({ tool: "support_and_safety_history", ok: true, rows: (alerts || []).length });

  const driverLabels = {};
  for (const d of drivers || []) driverLabels[String(d.id)] = driverLabel(d);
  const assigned = (drivers || []).find((d) => String(d.id) === String(ride.driver_id)) || null;
  const heartbeat = assigned
    ? {
        online: assigned.online === true,
        location_age_seconds: Number.isFinite(Date.parse(assigned.last_location_at || assigned.last_seen_at || ""))
          ? Math.round((now - Date.parse(assigned.last_location_at || assigned.last_seen_at)) / 1000)
          : null,
        current_distance_to_pickup_miles: transitionLocationEvidence({ driver: assigned, ride, now })["distance_to_pickup_miles"]
      }
    : null;

  return {
    ride,
    offers,
    driverLabels,
    assignedDriverLabel: assigned ? driverLabels[String(assigned.id)] : ride.driver_name ? driverLabel(null, ride.driver_name) : null,
    riderLabel: firstName(ride.rider_name),
    heartbeat,
    payment: payment || null,
    audits: audits || [],
    alerts: alerts || [],
    dispatchPaused: Boolean(pausedFlag && pausedFlag.value === "true"),
    timeline: buildTimeline({ ride, offers, audits: audits || [], alerts: alerts || [], driverLabels }),
    collected_ms: Date.now() - started
  };
}

module.exports = {
  RIDE_EVIDENCE_COLUMNS,
  EvidenceAccessError,
  transitionLocationEvidence,
  buildTimeline,
  collectRideEvidence,
  driverLabel
};
