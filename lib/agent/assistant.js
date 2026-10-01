// Harvey Taxi AI Agent Manager -- rider and driver assistance.
//
// Flow for every message:
//   1. sanitize the untrusted text and check the decision boundaries
//      (emergency / fraud / dispute / refund / account / screening). Those
//      get a fixed answer and a human-review case; the model is never used.
//   2. pick one fixed intent and run only the scoped, role-checked tools
//      that intent needs (lib/agent/tools.js).
//   3. the rules engine writes the full answer ("draft") from those facts.
//   4. optionally, the self-hosted model rephrases the draft; the guard in
//      grounding.js discards the rephrase if it adds anything.
//
// The assistant itself never changes platform state. Anything that would
// (booking, cancelling, changing a paid service) is returned as a
// *proposed action* that the user must confirm in the existing app screen,
// which calls the existing, separately authenticated route.

const { classifyEscalation, classifyIntent, sanitizeUserMessage } = require("./escalation");
const { buildGroundedMessages, guardModelOutput } = require("./grounding");
const { RIDE_STATUS } = require("../rideDispatch");

const STATUS_LABELS = Object.freeze({
  [RIDE_STATUS.PAYMENT_REQUIRED]: "waiting for payment authorization",
  [RIDE_STATUS.PAYMENT_AUTHORIZED]: "paid and waiting to be offered to a driver",
  [RIDE_STATUS.AWAITING_DRIVER]: "being offered to nearby drivers",
  [RIDE_STATUS.DRIVER_ASSIGNED]: "accepted by your driver",
  [RIDE_STATUS.DRIVER_ENROUTE]: "on the way to pickup",
  [RIDE_STATUS.ARRIVED]: "at the pickup point",
  [RIDE_STATUS.IN_PROGRESS]: "in progress"
});

const DRIVER_NEXT_STEP = Object.freeze({
  [RIDE_STATUS.DRIVER_ASSIGNED]: "When you set off, tap \"En route\" in your dashboard.",
  [RIDE_STATUS.DRIVER_ENROUTE]: "When you reach the pickup point, tap \"Arrived\".",
  [RIDE_STATUS.ARRIVED]: "Once the rider is on board, tap \"Start trip\".",
  [RIDE_STATUS.IN_PROGRESS]: "At the drop-off, tap \"Complete trip\"."
});

// screen=book opens the separate booking screen (PR #152); mode=driver
// keeps the link working on the earlier dashboard, which opens on ?mode=.
const BOOKING_HREF = "/rider-dashboard.html?screen=book&mode=driver";
const DASHBOARD_HREF = "/rider-dashboard.html";
const DRIVER_DASHBOARD_HREF = "/driver-dashboard.html";

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : null;
}

function signInNeeded() {
  return {
    draft:
      "To look up or change your own rides, please sign in to your Harvey Taxi rider account. You can still book a new ride from the booking screen.",
    actions: [{ type: "open_booking", label: "Book a ride", href: BOOKING_HREF, requires_confirmation: true }]
  };
}

async function riderAnswer({ intent, actor, tools, trace }) {
  const facts = {};
  if (intent === "book_ride") {
    return {
      facts,
      draft:
        "You can book in the Harvey Taxi booking screen. Enter your pickup and drop-off, review the fare our pricing calculates, and confirm. Nothing is charged until you confirm and payment is authorized, and a driver is only dispatched after that.",
      actions: [{ type: "open_booking", label: "Open booking", href: BOOKING_HREF, requires_confirmation: true }]
    };
  }
  if (!actor) {
    if (intent === "fare_info") {
      return {
        facts,
        draft:
          "Fares are calculated by Harvey Taxi's pricing from your actual route. Enter your trip in the booking screen to see the exact fare before you confirm.",
        actions: [{ type: "open_booking", label: "See a fare", href: BOOKING_HREF, requires_confirmation: true }]
      };
    }
    if (intent === "general_help") return { facts, ...generalRiderHelp() };
    return { facts, ...signInNeeded() };
  }

  const rides = await tools.invoke("rider_open_rides", actor, {}, trace);
  const ride = rides[0] || null;
  facts.open_ride_count = rides.length;
  if (ride) {
    facts.ride = {
      status: ride.status,
      ride_type: ride.ride_type || null,
      fare: money(ride.fare_total ?? ride.estimated_fare),
      driver_name: ride.driver_name || null,
      vehicle: ride.driver_vehicle || null,
      eta: ride.driver_eta_to_pickup_text || null
    };
  }

  if (intent === "ride_status") {
    if (!ride) {
      return { facts, draft: "You don't have an open ride right now.", actions: [{ type: "open_booking", label: "Book a ride", href: BOOKING_HREF, requires_confirmation: true }] };
    }
    const parts = [`Your ride is ${STATUS_LABELS[ride.status] || "open"}.`];
    if (ride.driver_name) parts.push(`Driver: ${ride.driver_name}${ride.driver_vehicle ? ` (${ride.driver_vehicle})` : ""}.`);
    if (ride.driver_eta_to_pickup_text) parts.push(`Estimated pickup: ${ride.driver_eta_to_pickup_text}.`);
    return {
      facts,
      draft: parts.join(" "),
      actions: [{ type: "open_tracking", label: "Track ride", href: `${DASHBOARD_HREF}?screen=track&ride_id=${encodeURIComponent(ride.id)}` }]
    };
  }

  if (intent === "fare_info") {
    const fare = ride ? money(ride.fare_total ?? ride.estimated_fare) : null;
    return {
      facts,
      draft: fare
        ? `The fare quoted for your current ride is ${fare}. That is the validated fare from booking; the assistant cannot change it.`
        : "Fares are calculated by Harvey Taxi's pricing from your actual route. Enter your trip in the booking screen to see the exact fare before you confirm.",
      actions: fare ? [] : [{ type: "open_booking", label: "See a fare", href: BOOKING_HREF, requires_confirmation: true }]
    };
  }

  if (intent === "cancel_ride" || intent === "change_service") {
    if (!ride) return { facts, draft: "You don't have an open ride to change or cancel.", actions: [] };
    if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      return {
        facts,
        draft: "Your trip is already in progress, so it can't be cancelled or changed in the app. If you feel unsafe, call 911.",
        actions: []
      };
    }
    const cancel = {
      type: "cancel_ride",
      label: "Cancel this ride",
      ride_id: ride.id,
      method: "POST",
      endpoint: `/api/rides/${encodeURIComponent(ride.id)}/cancel`,
      requires_confirmation: true,
      confirm_text: "Cancel this ride? There is no cancellation fee in the current phase.",
      fee: "none"
    };
    if (intent === "cancel_ride") {
      return {
        facts,
        draft: "You can cancel your open ride. There is no cancellation fee in the current phase. Please confirm below; nothing is cancelled until you do.",
        actions: [cancel]
      };
    }
    return {
      facts,
      draft:
        "A paid ride's service type can't be changed in place. To switch, cancel this ride (no cancellation fee in the current phase) and book the new service; you'll see the new fare and confirm it before any charge.",
      actions: [cancel, { type: "open_booking", label: "Book new service", href: BOOKING_HREF, requires_confirmation: true }]
    };
  }

  return { facts, ...generalRiderHelp() };
}

function generalRiderHelp() {
  return {
    draft:
      "I can help you book a ride, check your ride's status, explain your fare, or cancel an open ride. For an emergency, call 911.",
    actions: [{ type: "open_booking", label: "Book a ride", href: BOOKING_HREF, requires_confirmation: true }]
  };
}

async function driverAnswer({ intent, actor, tools, trace }) {
  const facts = {};
  const openDashboard = { type: "open_dashboard", label: "Open driver dashboard", href: DRIVER_DASHBOARD_HREF };
  if (intent === "driver_offers") {
    const offers = await tools.invoke("driver_pending_offers", actor, {}, trace);
    facts.pending_offers = offers.length;
    return {
      facts,
      draft: offers.length
        ? `You have ${offers.length} ride offer${offers.length === 1 ? "" : "s"} waiting. Accepting or declining is always your choice; use your dashboard to respond before the offer expires.`
        : "You have no ride offers waiting right now. Offers appear in your dashboard while you're online.",
      actions: [openDashboard]
    };
  }
  if (intent === "driver_active_ride") {
    const rides = await tools.invoke("driver_active_ride", actor, {}, trace);
    const ride = rides[0];
    if (!ride) return { facts: { active_ride: false }, draft: "You don't have an active ride right now.", actions: [openDashboard] };
    facts.active_ride = { status: ride.status, pickup: ride.pickup_address || null, dropoff: ride.dropoff_address || null };
    return {
      facts,
      draft: `Your current ride is ${STATUS_LABELS[ride.status] || ride.status}. ${DRIVER_NEXT_STEP[ride.status] || ""} The assistant never changes trip status for you.`.trim(),
      actions: [openDashboard]
    };
  }
  if (intent === "driver_earnings") {
    const [summary] = await tools.invoke("driver_earnings_summary", actor, {}, trace);
    facts.earnings = summary;
    return {
      facts,
      draft: `Recorded earnings: $${summary.earnings_last_7_days.toFixed(2)} from ${summary.trips_last_7_days} trip${summary.trips_last_7_days === 1 ? "" : "s"} in the last 7 days, and $${summary.earnings_total.toFixed(2)} from ${summary.trips_total} in total. Payout questions are handled by Harvey Taxi staff.`,
      actions: [openDashboard]
    };
  }
  if (intent === "driver_availability") {
    return {
      facts,
      draft:
        "You control your availability with the Online toggle in your dashboard. Going online requires your verification and background checks to be complete; going offline is always allowed.",
      actions: [openDashboard]
    };
  }
  return {
    facts,
    draft: "I can tell you about waiting ride offers, your active ride's next step, or your recorded earnings. For an emergency, call 911.",
    actions: [openDashboard]
  };
}

async function maybeRephrase({ llm, role, draft, facts }) {
  if (!llm) return { text: draft, source: "rules", model_rejected_reason: null };
  const result = await llm.complete(buildGroundedMessages({ role, draft, facts }));
  if (!result || !result.text) {
    return { text: draft, source: "rules", model_rejected_reason: result ? result.error : "no_result" };
  }
  const required = /\b911\b/.test(draft) ? ["911"] : [];
  const guarded = guardModelOutput({ output: result.text, draft, facts, requiredPhrases: required });
  return guarded.accepted
    ? { text: guarded.text, source: "model", model_rejected_reason: null }
    : { text: draft, source: "rules", model_rejected_reason: guarded.reason };
}

// role: "rider" | "driver". actor: { role, id } from server-side auth, or
// null for a sessionless rider. Returns the reply plus a decision record
// for the audit log (no raw message text in it).
async function handleAssist({ role, actor, message, tools, llm = null }) {
  const text = sanitizeUserMessage(message);
  const trace = [];
  const escalation = classifyEscalation(text);
  if (escalation) {
    const actions = [];
    if (escalation.show_911) {
      actions.push({ type: "call_911", label: "Call 911", href: "tel:911" });
      actions.push({ type: "safety_alert", label: "Alert Harvey Taxi safety team", method: "POST", endpoint: "/api/safety/911", requires_confirmation: true });
    }
    return {
      reply: escalation.guidance,
      source: "rules",
      intent: "escalation",
      escalation: { category: escalation.category, severity: escalation.severity },
      actions,
      decision: {
        kind: "escalation",
        policy: `boundary.${escalation.category}`,
        tool_calls: trace,
        outcome: "human_review_case",
        executed: false
      }
    };
  }

  const intent = classifyIntent(text, role);
  let answer;
  try {
    answer = role === "driver"
      ? await driverAnswer({ intent, actor, tools, trace })
      : await riderAnswer({ intent, actor, tools, trace });
  } catch (err) {
    // Data unavailable or not permitted: say so plainly, never guess.
    return {
      reply:
        err && err.status === 403
          ? "That isn't available for your account."
          : "I can't reach ride information right now. Booking still works from the booking screen, and your dashboard shows your live ride status.",
      source: "rules",
      intent,
      escalation: null,
      actions: role === "driver" ? [] : [{ type: "open_booking", label: "Book a ride", href: BOOKING_HREF, requires_confirmation: true }],
      decision: { kind: "assist", policy: `intent.${intent}`, tool_calls: trace, outcome: "data_unavailable", executed: false }
    };
  }

  const phrased = await maybeRephrase({ llm, role, draft: answer.draft, facts: answer.facts });
  return {
    reply: phrased.text,
    source: phrased.source,
    intent,
    escalation: null,
    actions: answer.actions,
    decision: {
      kind: "assist",
      policy: `intent.${intent}`,
      tool_calls: trace,
      outcome: answer.actions.some((a) => a.requires_confirmation) ? "proposed_action_awaiting_confirmation" : "answered",
      executed: false,
      model_used: phrased.source === "model",
      model_rejected_reason: phrased.model_rejected_reason
    }
  };
}

module.exports = {
  STATUS_LABELS,
  BOOKING_HREF,
  handleAssist
};
