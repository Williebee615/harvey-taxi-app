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
const knowledge = require("../knowledge/search");
const { resolveQuestion } = require("./followUp");

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

// The driver app (driver-app/) names its buttons differently from the web
// dashboard, and acts in-app instead of linking to the dashboard. Its
// actions carry only ids from the driver's own scoped tool results; the app
// re-checks them against its live state, asks the driver to confirm, and
// then calls the same authenticated driver routes its own buttons use.
const DRIVER_APP_NEXT_STEP = Object.freeze({
  [RIDE_STATUS.DRIVER_ASSIGNED]: "When you set off, tap \"Start driving to pickup\".",
  [RIDE_STATUS.DRIVER_ENROUTE]: "When you reach the pickup point, tap \"I've arrived at pickup\".",
  [RIDE_STATUS.ARRIVED]: "Once the rider is on board, tap \"Start trip\".",
  [RIDE_STATUS.IN_PROGRESS]: "At the drop-off, tap \"Complete trip\"."
});
const NAVIGATE_TO = Object.freeze({
  [RIDE_STATUS.DRIVER_ASSIGNED]: "pickup",
  [RIDE_STATUS.DRIVER_ENROUTE]: "pickup",
  [RIDE_STATUS.ARRIVED]: null,
  [RIDE_STATUS.IN_PROGRESS]: "dropoff"
});

function formatMinutes(ms) {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatClockUtc(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 16) + " UTC";
}

async function driverAnswer({ intent, actor, tools, trace, client }) {
  const app = client === "driver_app";
  const facts = {};
  if (intent === "driver_hours") {
    const [shift] = await tools.invoke("driver_hours_shift", actor, {}, trace);
    const limit = formatMinutes(shift.max_online_ms);
    const rest = formatMinutes(shift.min_rest_ms);
    facts.hours = { worked: formatMinutes(shift.worked_ms), remaining: formatMinutes(shift.remaining_ms), limit, rest };
    let draft;
    if (!shift.can_go_online && shift.rest_until) {
      draft = `You've reached the ${limit} limit. You can go online again after your ${rest} rest, at ${formatClockUtc(shift.rest_until)} (the Drive screen shows it in your local time).`;
    } else if (shift.limit_reached) {
      draft = `You've reached the ${limit} limit. You'll be taken offline when your current trip ends, then a ${rest} rest is required.`;
    } else {
      draft = `You've been online ${facts.hours.worked} this shift, with ${facts.hours.remaining} left of the ${limit} limit. After ${limit} online you must rest ${rest} in a row; any ${rest} offline starts a new shift.`;
    }
    return { facts, draft, actions: [] };
  }
  const openDashboard = { type: "open_dashboard", label: "Open driver dashboard", href: DRIVER_DASHBOARD_HREF };
  const where = app ? "on the Drive screen" : "in your dashboard";
  if (intent === "driver_offers") {
    const offers = await tools.invoke("driver_pending_offers", actor, {}, trace);
    facts.pending_offers = offers.length;
    return {
      facts,
      draft: offers.length
        ? `You have ${offers.length} ride offer${offers.length === 1 ? "" : "s"} waiting. Accepting or declining is always your choice; respond ${where} before the offer expires.`
        : `You have no ride offers waiting right now. Offers appear ${where} while you're online.`,
      actions: app
        ? offers.map((o) => ({ type: "respond_offer", offer_id: o.id, requires_confirmation: true }))
        : [openDashboard]
    };
  }
  if (intent === "driver_active_ride" || intent === "driver_navigation") {
    const rides = await tools.invoke("driver_active_ride", actor, {}, trace);
    const ride = rides[0];
    if (!ride) {
      return {
        facts: { active_ride: false },
        draft: intent === "driver_navigation"
          ? "You don't have an active trip, so there's nowhere to navigate yet. Directions open once you accept a ride."
          : "You don't have an active ride right now.",
        actions: app ? [] : [openDashboard]
      };
    }
    const target = NAVIGATE_TO[ride.status] || null;
    const address = target === "dropoff" ? ride.dropoff_address : target === "pickup" ? ride.pickup_address : null;
    facts.active_ride = { status: ride.status, pickup: ride.pickup_address || null, dropoff: ride.dropoff_address || null };
    const nextStep = (app ? DRIVER_APP_NEXT_STEP : DRIVER_NEXT_STEP)[ride.status] || "";
    const actions = [];
    if (app && target) actions.push({ type: "navigate", ride_id: ride.id, target, address: address || null });
    if (app && intent === "driver_active_ride") actions.push({ type: "trip_step", ride_id: ride.id, status: ride.status, requires_confirmation: true });
    if (!app) actions.push(openDashboard);
    if (intent === "driver_navigation") {
      return {
        facts,
        draft: target
          ? `Head to the ${target === "dropoff" ? "drop-off" : "pickup"}: ${address || "see your trip screen"}. Directions open in your maps app. ${nextStep}`.trim()
          : `You're at the pickup point. ${nextStep}`.trim(),
        actions
      };
    }
    return {
      facts,
      draft: `Your current ride is ${STATUS_LABELS[ride.status] || ride.status}. ${nextStep} The assistant never changes trip status for you.`.trim(),
      actions
    };
  }
  if (intent === "driver_earnings") {
    const [summary] = await tools.invoke("driver_earnings_summary", actor, {}, trace);
    facts.earnings = summary;
    return {
      facts,
      draft: `Recorded earnings: $${summary.earnings_last_7_days.toFixed(2)} from ${summary.trips_last_7_days} trip${summary.trips_last_7_days === 1 ? "" : "s"} in the last 7 days, and $${summary.earnings_total.toFixed(2)} from ${summary.trips_total} in total. Payout questions are handled by Harvey Taxi staff.`,
      actions: app ? [{ type: "open_screen", screen: "earnings", label: "Open Earnings" }] : [openDashboard]
    };
  }
  if (intent === "driver_availability") {
    return {
      facts,
      draft: app
        ? "You control your availability with the Go online and Go offline buttons on the Drive screen. Going online requires your verification and background checks to be complete; going offline is always allowed."
        : "You control your availability with the Online toggle in your dashboard. Going online requires your verification and background checks to be complete; going offline is always allowed.",
      actions: app ? [{ type: "toggle_availability", requires_confirmation: true }] : [openDashboard]
    };
  }
  if (intent === "driver_support") {
    return {
      facts,
      draft:
        "Harvey Taxi support can help with your account, a trip or the app. Open the support page to contact the team. For an emergency, call 911.",
      actions: app ? [{ type: "open_support", label: "Contact support" }] : [{ type: "open_support", label: "Contact support", href: "/support.html" }]
    };
  }
  return {
    facts,
    draft: app
      ? "I can help with going online, ride offers, your trip's next step, directions, earnings and support. For an emergency, call 911."
      : "I can tell you about waiting ride offers, your active ride's next step, or your recorded earnings. For an emergency, call 911.",
    actions: app ? [] : [openDashboard]
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
async function handleAssist({ role, actor, message, tools, llm = null, client = "web", knowledgeIndex = null, context = [] }) {
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

  // A short follow-up ("what about drivers?") is read together with the
  // previous question from the device's own history. Safety boundaries
  // above were checked on the new message alone.
  const resolved = resolveQuestion(text, context);
  const question = resolved.text;
  const intent = classifyIntent(question, role);

  // Policy questions (and anything unrouted) are answered only by quoting
  // approved published pages, with the source and its date. No match:
  // say so, never guess.
  if (intent === "policy_question" || intent === "general_help") {
    const index = knowledgeIndex || knowledge.defaultIndex().index;
    const found = knowledge.answerFromKnowledge(index, question, { role });
    if (found.found || intent === "policy_question") {
      const supportAction =
        role === "driver" && client === "driver_app"
          ? { type: "open_support", label: "Contact support" }
          : { type: "open_support", label: "Contact support", href: "/support.html" };
      const reply = found.found
        ? found.draft
        : "I don't have approved Harvey Taxi information that answers that, so I won't guess. Harvey Taxi support can answer it, and I've noted the question so the team can add it.";
      return {
        reply,
        source: "knowledge",
        intent,
        escalation: null,
        actions: [supportAction],
        sources: found.sources,
        knowledge_gap: !found.found,
        used_context: resolved.used_context,
        decision: {
          kind: "assist",
          policy: `intent.${intent}`,
          tool_calls: trace,
          outcome: found.found ? "answered_from_knowledge" : "knowledge_gap",
          executed: false,
          knowledge_sources: found.sources.map((src) => `${src.url}#${src.section}`),
          knowledge_score: found.top_score || null
        }
      };
    }
  }

  let answer;
  try {
    answer = role === "driver"
      ? await driverAnswer({ intent, actor, tools, trace, client })
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
    sources: [],
    knowledge_gap: false,
    used_context: resolved.used_context,
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
