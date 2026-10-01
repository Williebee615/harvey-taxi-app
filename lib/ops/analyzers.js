// Case reasoning: turns a report (intake.js) and the evidence
// (evidence.js) into, for each issue type:
//   facts       -- verified by a platform record, with its source
//   missing     -- information the records do not contain
//   hypotheses  -- possible explanations, labelled as unverified
//   conflicts   -- where the person's account and the records disagree
//   proposals   -- actions that could resolve it (policy-checked later)
//   escalate    -- set when staff must decide
// Deterministic. No confidence percentages are produced: a statement is
// either backed by a named record or explicitly marked unverified.

const { CATEGORY, CATEGORY_LABELS } = require("./intake");
const { policyRef } = require("./policies");

const ARRIVAL_TOLERANCE_MILES = 0.25;
const STALE_LOCATION_SECONDS = 180;
const LOCAL_TZ = "America/Chicago";

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : null;
}

function localTime(isoValue) {
  const t = Date.parse(isoValue || "");
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TZ, hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(t));
}

function localClock(isoValue) {
  const t = Date.parse(isoValue || "");
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LOCAL_TZ, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(t));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get("hour") % 24, minute: get("minute") };
}

function find(timeline, kind) {
  return timeline.find((e) => e.kind === kind) || null;
}

function arrivalAudit(evidence) {
  return evidence.timeline.find((e) => e.kind === "audit_driver_arrived" && e.metadata && Number.isFinite(e.metadata.distance_to_pickup_miles)) || null;
}

function result(category) {
  return { category, title: CATEGORY_LABELS[category], facts: [], missing: [], hypotheses: [], conflicts: [], proposals: [], escalate: null, policies: [] };
}

function rideStatusFact(r, evidence) {
  r.facts.push({ text: `Ride ${evidence.ride.id} is currently "${evidence.ride.status}".`, source: "rides.status" });
}

function analyzeMissedPickup(evidence, claims) {
  const r = result(CATEGORY.MISSED_PICKUP);
  const { ride, timeline } = evidence;
  rideStatusFact(r, evidence);
  const arrived = find(timeline, "driver_arrived");
  const accepted = find(timeline, "driver_accepted") || find(timeline, "driver_assigned");
  if (accepted) r.facts.push({ text: `${evidence.assignedDriverLabel || "A driver"} accepted at ${localTime(accepted.at)}.`, source: accepted.source });
  if (arrived) {
    r.facts.push({ text: `The driver marked "arrived" at ${localTime(arrived.at)}.`, source: arrived.source });
    if (claims.app_showed_arrived) r.facts.push({ text: "The rider's statement that the app showed the driver as arrived matches the record.", source: arrived.source });
  } else {
    r.facts.push({ text: "The driver never marked \"arrived\" for this ride.", source: "rides.arrived_at / rides.driver_arrived_at (empty)" });
  }
  const snap = arrivalAudit(evidence);
  if (arrived && snap) {
    const d = snap.metadata.distance_to_pickup_miles;
    const age = snap.metadata.location_age_seconds;
    r.facts.push({ text: `When marking arrived, the driver's last reported location was ${d} mi from the pickup point${Number.isFinite(age) ? ` (reported ${age} s earlier)` : ""}.`, source: "audit_logs driver_arrived (location snapshot)" });
    if (claims.driver_did_not_arrive && d > ARRIVAL_TOLERANCE_MILES) {
      r.conflicts.push({
        claim: "The rider says the driver never arrived.",
        evidence: `The app shows "arrived", but the driver's reported location was ${d} mi from the pickup point at that moment.`,
        source: "audit_logs driver_arrived",
        reading: "The records support the rider: the arrival was marked away from the pickup point."
      });
      r.hypotheses.push({ text: "The driver may have marked arrived before reaching the pickup point.", basis: `Location ${d} mi away at the time of marking.` });
    } else if (claims.driver_did_not_arrive && d <= ARRIVAL_TOLERANCE_MILES) {
      r.conflicts.push({
        claim: "The rider says the driver never arrived.",
        evidence: `The driver's reported location was ${d} mi from the pickup point when marking arrived.`,
        source: "audit_logs driver_arrived",
        reading: "The records place the driver at the pickup point; rider and driver may not have found each other."
      });
      r.hypotheses.push({ text: "Rider and driver were near each other but did not meet (for example, different entrance).", basis: "Driver location within the arrival tolerance." });
    }
    if (Number.isFinite(age) && age > STALE_LOCATION_SECONDS) {
      r.missing.push({ text: "An up-to-date driver location at arrival.", why: `The location used was ${age} s old, so it may not reflect where the driver really was.` });
    }
  } else if (arrived) {
    r.missing.push({ text: "Where the driver was when they marked arrived.", why: "This ride predates location snapshots on status changes (or none was recorded)." });
  }
  if (Number.isFinite(claims.waited_minutes)) {
    r.missing.push({ text: `Confirmation of the rider's ${claims.waited_minutes}-minute wait.`, why: "Rider wait time is not recorded by the platform." });
  }
  const cancelled = find(timeline, "ride_cancelled");
  if (cancelled) r.facts.push({ text: `The ride was cancelled at ${localTime(cancelled.at)}${ride.cancelled_by_type ? ` by the ${ride.cancelled_by_type}` : ""}.`, source: cancelled.source });

  if (["driver_assigned", "driver_enroute", "arrived"].includes(ride.status)) {
    r.proposals.push({ action: "cancel_ride_no_fee", reason: "The trip has not started; the rider can cancel without a fee.", policy: "POL-CANCEL-NO-FEE" });
  }
  if (r.conflicts.length) {
    r.proposals.push({ action: "escalate_to_human", reason: "Records conflict with the rider's account; driver conduct is reviewed by staff.", policy: "POL-HUMAN-ONLY" });
  }
  r.policies.push(policyRef("POL-CANCEL-NO-FEE"), policyRef("POL-DRIVER-CONTROL"));
  return r;
}

function analyzeWrongLocation(evidence, claims, answers) {
  const r = result(CATEGORY.WRONG_LOCATION);
  const { ride } = evidence;
  rideStatusFact(r, evidence);
  if (ride.pickup_address) r.facts.push({ text: `The booked pickup address is "${ride.pickup_address}".`, source: "rides.pickup_address" });
  const hasPin = Number.isFinite(Number(ride.pickup_lat)) && Number.isFinite(Number(ride.pickup_lng));
  r.facts.push({ text: hasPin ? "The booking has a pickup pin (map coordinates)." : "The booking has no pickup pin.", source: "rides.pickup_lat / pickup_lng" });
  const snap = arrivalAudit(evidence);
  if (snap) r.facts.push({ text: `The driver marked arrived ${snap.metadata.distance_to_pickup_miles} mi from that pin.`, source: "audit_logs driver_arrived (location snapshot)" });
  if (answers && answers.where_were_you) {
    r.facts.push({ text: `The rider says they were waiting at: "${answers.where_were_you}".`, source: "rider statement (not verified)" });
    r.missing.push({ text: "Whether that place matches the booked pin.", why: "The assistant does not geocode free text; staff or the rider can compare it on the map." });
  } else {
    r.missing.push({ text: "Where the rider was actually waiting.", why: "Not recorded; asked as a follow-up question." });
  }
  r.hypotheses.push({ text: "The pickup pin or address may not match where the rider waited.", basis: "Rider reports a location problem; not yet verified against the map." });
  if (["driver_assigned", "driver_enroute", "arrived"].includes(ride.status)) {
    r.proposals.push({ action: "cancel_ride_no_fee", reason: "If the pickup point is wrong, the rider can cancel without a fee and rebook with the right pin.", policy: "POL-CANCEL-NO-FEE" });
  }
  r.policies.push(policyRef("POL-RIDER-CONFIRMS"));
  return r;
}

function analyzeStalledDispatch(evidence, claims, answers, context) {
  const r = result(CATEGORY.STALLED_DISPATCH);
  const { ride, offers } = evidence;
  rideStatusFact(r, evidence);
  const pending = offers.filter((o) => o.status === "pending" && Date.parse(o.expires_at || 0) > (context.now || Date.now()));
  const declined = offers.filter((o) => o.status === "declined").length;
  const expired = offers.filter((o) => o.status === "expired").length;
  r.facts.push({ text: `${offers.length} driver offer(s) so far: ${declined} declined, ${expired} expired, ${pending.length} waiting for an answer.`, source: "driver_offers" });
  r.facts.push({ text: `Dispatch attempts recorded: ${Number(ride.dispatch_attempts) || 0}.`, source: "rides.dispatch_attempts" });
  if (evidence.dispatchPaused) r.facts.push({ text: "Dispatch is currently paused by an administrator.", source: "system_flags.dispatch_paused" });
  if (ride.scheduled_time && Date.parse(ride.scheduled_time) > (context.now || Date.now())) {
    r.facts.push({ text: `This is a scheduled ride for ${localTime(ride.scheduled_time)}; it is dispatched at that time.`, source: "rides.scheduled_time" });
    r.proposals.push({ action: "explain_only", reason: "Nothing is stalled: scheduled rides wait for their time.", policy: "POL-SCHEDULED-DISPATCH" });
    r.policies.push(policyRef("POL-SCHEDULED-DISPATCH"));
    return r;
  }
  if (context.freeDriverCount !== undefined) {
    r.facts.push({ text: `${context.freeDriverCount} eligible driver(s) are online and free right now.`, source: "drivers (eligibility rules)" });
  }
  if (ride.status !== "payment_authorized" && ride.status !== "awaiting_driver_acceptance") {
    r.facts.push({ text: "The ride is not waiting for a driver, so there is nothing to redispatch.", source: "rides.status" });
  } else if (evidence.dispatchPaused) {
    r.proposals.push({ action: "escalate_to_human", reason: "Dispatch is paused by an administrator; only staff can resume it.", policy: "POL-DISPATCH-RULES" });
  } else if (pending.length) {
    r.facts.push({ text: "A driver is currently being offered this ride.", source: "driver_offers (pending)" });
  } else if ((Number(ride.dispatch_attempts) || 0) >= 3) {
    r.proposals.push({ action: "escalate_to_human", reason: "The ride has used its automatic attempts; a dispatcher should place it.", policy: "POL-DISPATCH-RULES" });
  } else {
    r.proposals.push({ action: "redispatch_ride", reason: "Paid ride with no live offer: send it to the next eligible driver through normal dispatch.", policy: "POL-DISPATCH-RULES" });
    if (context.freeDriverCount === 0) {
      r.hypotheses.push({ text: "Redispatch may not find a driver: none are free right now.", basis: "Current driver availability." });
    }
  }
  r.policies.push(policyRef("POL-DISPATCH-RULES"), policyRef("POL-PAY-BEFORE-DISPATCH"));
  return r;
}

function analyzeScheduling(evidence, claims) {
  const r = result(CATEGORY.SCHEDULING);
  const { ride, timeline } = evidence;
  if (!ride.scheduled_time) {
    r.facts.push({ text: "This ride was booked for immediate pickup, not scheduled.", source: "rides.scheduled_time (empty)" });
  } else {
    r.facts.push({ text: `The ride is scheduled for ${localTime(ride.scheduled_time)}.`, source: "rides.scheduled_time" });
    if (claims.scheduled_clock) {
      const booked = localClock(ride.scheduled_time);
      const diff = Math.abs(booked.hour * 60 + booked.minute - (claims.scheduled_clock.hour * 60 + claims.scheduled_clock.minute));
      if (diff >= 15) {
        r.conflicts.push({
          claim: `The rider says they scheduled ${claims.scheduled_clock.text}.`,
          evidence: `The booking records ${localTime(ride.scheduled_time)}.`,
          source: "rides.scheduled_time",
          reading: "The booked time differs from what the rider expected; the time may have been entered differently at booking."
        });
      } else {
        r.facts.push({ text: `That matches the time the rider describes (${claims.scheduled_clock.text}).`, source: "rides.scheduled_time" });
      }
    }
    const offer = find(timeline, "offer_sent");
    if (offer && Date.parse(offer.at) < Date.parse(ride.scheduled_time) - 30 * 60_000) {
      r.conflicts.push({
        claim: "Scheduled rides should be dispatched at their time.",
        evidence: `A driver offer was sent at ${localTime(offer.at)}, well before the scheduled time.`,
        source: "driver_offers",
        reading: "Dispatched early; this is a platform issue for staff to review."
      });
      r.proposals.push({ action: "escalate_to_human", reason: "Early dispatch contradicts the scheduling rule.", policy: "POL-SCHEDULED-DISPATCH" });
    }
    const arrived = find(timeline, "driver_arrived");
    if (arrived && (claims.driver_early || claims.driver_late)) {
      const minutes = Math.round((Date.parse(arrived.at) - Date.parse(ride.scheduled_time)) / 60000);
      r.facts.push({ text: `The driver marked arrived ${Math.abs(minutes)} min ${minutes < 0 ? "before" : "after"} the scheduled time.`, source: arrived.source });
    }
  }
  if (!r.conflicts.length && ["payment_authorized", "driver_assigned", "driver_enroute"].includes(ride.status)) {
    r.proposals.push({ action: "cancel_ride_no_fee", reason: "If the time is wrong, cancel without a fee and book the right time.", policy: "POL-CANCEL-NO-FEE" });
  }
  r.policies.push(policyRef("POL-SCHEDULED-DISPATCH"));
  return r;
}

function analyzePayment(evidence, claims, answers) {
  const r = result(CATEGORY.PAYMENT);
  const { ride, payment } = evidence;
  const quoted = Number(ride.fare_total ?? ride.estimated_fare);
  if (Number.isFinite(quoted) && quoted > 0) r.facts.push({ text: `The validated fare quoted at booking was ${money(quoted)}.`, source: ride.fare_total != null ? "rides.fare_total" : "rides.estimated_fare" });
  if (ride.final_fare != null) r.facts.push({ text: `The final fare recorded is ${money(ride.final_fare)}${Number(ride.tip_amount) > 0 ? ` plus a ${money(ride.tip_amount)} tip` : ""}.`, source: "rides.final_fare" });
  r.facts.push({ text: `Payment status: ${ride.payment_status || "not recorded"}${ride.payment_captured ? " (captured)" : " (not captured)"}.`, source: "rides.payment_status / payment_captured" });
  if (ride.cancellation_payment_status) r.facts.push({ text: `Cancellation payment status: ${ride.cancellation_payment_status}.`, source: "rides.cancellation_payment_status" });
  if (payment) {
    r.facts.push({ text: `Payment record: ${payment.status}${payment.captured_amount != null ? `, ${money(payment.captured_amount)} captured` : ""}${payment.canceled_at ? ", authorization cancelled" : ""}.`, source: "payments" });
  } else if (ride.payment_id) {
    r.missing.push({ text: "The payment record for this ride.", why: "No payments row exists (see PR #155)." });
  }
  const captured = Boolean(ride.payment_captured) || ["captured", "succeeded"].includes(String(ride.payment_status));
  const claimedAmount = Number.isFinite(claims.charged_amount) ? claims.charged_amount : answers && answers.amount_seen ? Number(String(answers.amount_seen).replace(/[^0-9.]/g, "")) : NaN;
  if (Number.isFinite(claimedAmount)) {
    if (!captured) {
      r.conflicts.push({
        claim: `The rider reports a ${money(claimedAmount)} charge.`,
        evidence: "No payment for this ride has been captured.",
        source: "rides.payment_status / payment_captured",
        reading: "What the rider sees is most likely the temporary authorization hold, not a charge."
      });
      r.hypotheses.push({ text: "The amount is a pending authorization hold that has not been captured.", basis: "Payment not captured; holds appear as pending on statements." });
    } else {
      const charged = Number(ride.final_fare ?? quoted) + (Number(ride.tip_amount) || 0);
      if (Number.isFinite(charged) && Math.abs(charged - claimedAmount) > 0.5) {
        r.conflicts.push({
          claim: `The rider reports a ${money(claimedAmount)} charge.`,
          evidence: `The recorded charge is ${money(charged)}.`,
          source: "rides.final_fare / tip_amount",
          reading: "The amounts differ; staff must reconcile with the payment processor."
        });
      }
    }
  } else {
    r.missing.push({ text: "The amount the rider sees and whether it is pending or posted.", why: "Asked as a follow-up question." });
  }
  if (claims.double_charge) {
    r.missing.push({ text: "Whether a second charge exists at the payment processor.", why: "The platform records one payment per ride; processor records are checked by staff." });
  }
  if (claims.double_charge || (captured && r.conflicts.length)) {
    r.escalate = { reason: "Disputed charge: only staff can investigate processor records and decide on refunds.", policy: "POL-FINANCIAL-LIMIT" };
    r.proposals.push({ action: "escalate_to_human", reason: r.escalate.reason, policy: "POL-FINANCIAL-LIMIT" });
  } else if (!captured && Number.isFinite(claimedAmount)) {
    r.proposals.push({ action: "explain_only", reason: "Explain that this is an uncaptured hold; nothing has been charged.", policy: "POL-PAY-BEFORE-DISPATCH" });
  }
  r.policies.push(policyRef("POL-FINANCIAL-LIMIT"), policyRef("POL-PRICE-AUTHORITY"));
  return r;
}

function analyzeDelivery(evidence, claims) {
  const r = result(CATEGORY.DELIVERY);
  const { ride, timeline } = evidence;
  if (!["food", "grocery"].includes(String(ride.ride_type))) {
    r.facts.push({ text: "This ride is not a delivery order.", source: "rides.ride_type" });
    return r;
  }
  if (ride.merchant_name) r.facts.push({ text: `Order from ${ride.merchant_name}${ride.item_count ? ` (${ride.item_count} item(s))` : ""}.`, source: "rides.merchant_name / item_count" });
  r.facts.push({ text: `Delivery stage: ${ride.delivery_stage || "not recorded"}.`, source: "rides.delivery_stage" });
  const delivered = find(timeline, "delivered");
  if (delivered) r.facts.push({ text: `Marked delivered at ${localTime(delivered.at)}${ride.delivery_handoff ? ` (${ride.delivery_handoff})` : ""}.`, source: delivered.source });
  r.facts.push({ text: ride.delivery_proof_url ? "A delivery photo was recorded." : "No delivery photo was recorded.", source: "rides.delivery_proof_url" });
  if (claims.not_delivered && delivered) {
    r.conflicts.push({
      claim: "The customer says the order never arrived.",
      evidence: `The order was marked delivered at ${localTime(delivered.at)}${ride.delivery_proof_url ? " with a photo" : " without a photo"}.`,
      source: "rides.delivered_at",
      reading: ride.delivery_proof_url ? "Staff should compare the delivery photo with the customer's address." : "There is no photo to confirm the handoff."
    });
  }
  if (claims.items_issue) r.missing.push({ text: "Which items were missing or wrong.", why: "Item-level contents are not recorded by the platform." });
  r.escalate = { reason: "Delivery problems involving items or refunds are decided by staff.", policy: "POL-FINANCIAL-LIMIT" };
  r.proposals.push({ action: "escalate_to_human", reason: r.escalate.reason, policy: "POL-FINANCIAL-LIMIT" });
  r.policies.push(policyRef("POL-FINANCIAL-LIMIT"));
  return r;
}

const ANALYZERS = {
  [CATEGORY.MISSED_PICKUP]: analyzeMissedPickup,
  [CATEGORY.WRONG_LOCATION]: analyzeWrongLocation,
  [CATEGORY.STALLED_DISPATCH]: analyzeStalledDispatch,
  [CATEGORY.SCHEDULING]: analyzeScheduling,
  [CATEGORY.PAYMENT]: analyzePayment,
  [CATEGORY.DELIVERY]: analyzeDelivery
};

function analyzeCase({ understanding, evidence, answers = {}, context = {} }) {
  const categories = understanding.categories.length ? understanding.categories : [];
  const findings = categories.map((c) => ANALYZERS[c](evidence, understanding.claims, answers, context));
  return findings;
}

module.exports = { analyzeCase, ARRIVAL_TOLERANCE_MILES, STALE_LOCATION_SECONDS, localTime };
