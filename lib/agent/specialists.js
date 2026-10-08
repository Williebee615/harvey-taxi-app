// Harvey Taxi AI Agent Manager -- specialist agents (docs/ai-agent-manager.md,
// "Agent hierarchy").
//
// The original agents stay the chiefs of command. Each specialist answers a
// narrow set of questions on behalf of one chief, with the same rules:
//   - every specialist is off unless its own system flag is "true", its
//     chief is running (assistance on; for HTAF, htaf_assist_enabled on)
//     and the master stop switch (agent_kill_switch) is off;
//   - specialists use rules or approved published content only, never an
//     AI model, and say so;
//   - identity comes from the signed-in session; data comes only through
//     the role-checked tools in tools.js (the signed-in account's own rows);
//   - nothing changes platform state here. Booking, cancelling and
//     sending a support request are buttons the user confirms in the app,
//     which call the existing authenticated routes;
//   - emergencies, fraud, disputes, refunds, account actions and screening
//     are checked first and stay with the original Escalation agent.
// With every specialist off, routeSpecialist() returns null and the chiefs
// answer exactly as before.

const { classifyEscalation, classifyIntent, sanitizeUserMessage } = require("./escalation");
const { RIDE_STATUS } = require("../rideDispatch");

const ENGINES = Object.freeze({ RULES: "rules", APPROVED_CONTENT: "approved_content" });
const ENGINE_LABELS = Object.freeze({
  [ENGINES.RULES]: "Rules-based (no AI model)",
  [ENGINES.APPROVED_CONTENT]: "Approved published content only (no AI model)"
});

// The original agents, unchanged. `engine` describes what each already
// uses today; it is shown to admins, not enforced here.
const CHIEFS = Object.freeze([
  { id: "harvey_assistant_rider", name: "Harvey Assistant (Rider)", engine: "Rules-based; Claude Haiku 4.5 only for accounts on the model test list", runs_when: "agent_assist_enabled" },
  { id: "harvey_assistant_driver", name: "Harvey Assistant (Driver)", engine: "Rules-based; Claude Haiku 4.5 only for accounts on the model test list", runs_when: "agent_assist_enabled" },
  { id: "escalation", name: "Escalation", engine: "Rules-based (never an AI model)", runs_when: "agent_assist_enabled" },
  { id: "support_handoff", name: "Support Handoff", engine: "Rules-based; sends only the summary the user approves", runs_when: "agent_assist_enabled" },
  { id: "dispatch_recommender", name: "Dispatch Recommender", engine: "Rules-based; advice only, never changes a ride", runs_when: "always (off with the stop switch)" },
  { id: "ride_coordinator", name: "Ride Coordinator", engine: "Rules-based; automatic redispatch needs its own flags", runs_when: "agent_automation_enabled + agent_auto_redispatch_enabled" },
  { id: "htaf_information_assistant", name: "HTAF Information Assistant", engine: "Approved published content only (no AI model)", runs_when: "htaf_assist_enabled" }
]);

const SPECIALIST_FLAGS = Object.freeze({
  RIDE_BOOKING: "agent_specialist_ride_booking_enabled",
  DELIVERY: "agent_specialist_delivery_enabled",
  DRIVER_ONBOARDING: "agent_specialist_driver_onboarding_enabled",
  CUSTOMER_SUPPORT: "agent_specialist_customer_support_enabled",
  SAFETY: "agent_specialist_safety_enabled",
  HTAF: "agent_specialist_htaf_enabled"
});

const SPECIALISTS = Object.freeze([
  {
    id: "safety_escalation",
    name: "Safety Escalation",
    chief: "escalation",
    roles: ["rider", "driver"],
    engine: ENGINES.RULES,
    flag: SPECIALIST_FLAGS.SAFETY,
    handles: "Non-emergency safety concerns (harassment, unsafe driving, impairment). Emergencies stay with Escalation.",
    actions: "Call 911 link; a safety report the user reviews before sending"
  },
  {
    id: "htaf_information",
    name: "HTAF Information",
    chief: "htaf_information_assistant",
    roles: ["rider"],
    engine: ENGINES.APPROVED_CONTENT,
    flag: SPECIALIST_FLAGS.HTAF,
    handles: "HTAF questions in Harvey Taxi's assistant, answered only from HTAF's published pages.",
    actions: "Links to the HTAF application and HTAF contact details"
  },
  {
    id: "delivery",
    name: "Food & Grocery Delivery",
    chief: "harvey_assistant_rider",
    roles: ["rider"],
    engine: ENGINES.RULES,
    flag: SPECIALIST_FLAGS.DELIVERY,
    handles: "Delivery status and stage, merchant, the Delivery Center, delivery PIN guidance (the PIN itself is never written in chat).",
    actions: "Open the Delivery Center; cancel a delivery (confirmed by the rider)"
  },
  {
    id: "driver_support_onboarding",
    name: "Driver Support & Onboarding",
    chief: "harvey_assistant_driver",
    roles: ["driver"],
    engine: ENGINES.RULES,
    flag: SPECIALIST_FLAGS.DRIVER_ONBOARDING,
    handles: "The driver's own onboarding checklist and what is still needed. Approval and screening decisions stay with staff.",
    actions: "Open the driver dashboard; a support request the driver reviews before sending"
  },
  {
    id: "customer_support",
    name: "Customer Support",
    chief: "support_handoff",
    roles: ["rider", "driver"],
    engine: ENGINES.RULES,
    flag: SPECIALIST_FLAGS.CUSTOMER_SUPPORT,
    handles: "Requests to reach support, complaints, feedback and app problems. Lost items stay with Support Handoff's lost-item report.",
    actions: "A support request the user reviews and approves before sending; the support page"
  },
  {
    id: "ride_booking_dispatch",
    name: "Ride Booking & Dispatch",
    chief: "harvey_assistant_rider",
    consults: ["dispatch_recommender"],
    roles: ["rider"],
    engine: ENGINES.RULES,
    flag: SPECIALIST_FLAGS.RIDE_BOOKING,
    handles: "Booking help, the rider's own ride status, and why a ride is still waiting for a driver, using Dispatch Recommender's eligibility rules read-only.",
    actions: "Open booking; track the ride; cancel (confirmed by the rider)"
  }
]);

const SPECIALIST_FLAG_KEYS = Object.freeze(SPECIALISTS.map((s) => s.flag));

const DELIVERY_TYPES = Object.freeze(["food", "grocery"]);
const isDeliveryType = (t) => DELIVERY_TYPES.includes(String(t || "").toLowerCase());

// Message patterns, checked in SPECIALISTS order (first match wins).
const PATTERNS = Object.freeze({
  safety_escalation:
    /\b(harass(ed|ment|ing)?|inappropriate(ly)?|uncomfortable|creepy|reckless(ly)?|speeding|dangerous(ly)? driv\w*|drunk|impaired|under the influence|road rage|texting while driving|discriminat\w*|racist|yell(ed|ing) at me|touched me|safety (concern|issue|report))\b/i,
  htaf_information:
    /\b(htaf|harvey transportation assistance|transportation assistance foundation|the foundation|assistance program|transportation assistance)\b/i,
  delivery: /\b(deliver(y|ies|ed)?|food order|grocer(y|ies)|restaurant|merchant|delivery pin|my order)\b/i,
  driver_support_onboarding:
    /\b(onboard\w*|get(ting)? started|become a driver|sign(ing)? up to drive|requirements?|documents?|driver'?s licen[cs]e|insurance|vehicle (info|details|information)|ready to drive|can'?t go online|verify my (email|phone)|checklist|what('?s| is) (left|missing|needed))\b/i,
  customer_support:
    /\b(support|customer service|receipt|complain\w*|feedback|talk to (someone|a person|a human|staff)|contact (harvey|someone|staff|you)|report (a |an )?(problem|issue|bug)|(app|it) (isn'?t|is not|not) working|problem with (my )?(trip|ride|order))\b/i,
  ride_booking_dispatch:
    /\b(book|request a ride|need a ride|get a ride|schedule|where('?s| is)|status|eta|how long|arriv\w*|my driver|my ride|track|waiting|no drivers?|find(ing)? a driver|taking (so )?long)\b/i
});

// Questions the chiefs already handle with approved content or a
// dedicated flow: never taken over by a specialist.
const CHIEF_ONLY_INTENTS = Object.freeze(["lost_item", "policy_question"]);

function specialistById(id) {
  return SPECIALISTS.find((s) => s.id === id) || null;
}

function chiefById(id) {
  return CHIEFS.find((c) => c.id === id) || null;
}

// Is this specialist allowed to answer right now?
//   mode: resolveAgentMode() result; flags: resolveAgentFlags() result.
//   htafEnabled: htaf_assist_enabled (the HTAF chief's own switch).
function specialistActive(specialist, { mode, flags, htafEnabled = false }) {
  if (!specialist || !mode || !flags) return false;
  if (mode.kill_switch || !mode.assist_enabled) return false;
  if (flags[specialist.flag] !== true) return false;
  if (specialist.chief === "htaf_information_assistant" && htafEnabled !== true) return false;
  return true;
}

// Which specialist (if any) answers this message. Pure; returns the
// specialist definition or null. `isActive(specialist)` decides on/off.
function routeSpecialist({ role, message, isActive }) {
  const text = sanitizeUserMessage(message);
  if (!text) return null;
  // Emergencies and the other decision boundaries stay with Escalation.
  if (classifyEscalation(text)) return null;
  if (CHIEF_ONLY_INTENTS.includes(classifyIntent(text, role))) return null;
  for (const specialist of SPECIALISTS) {
    if (!specialist.roles.includes(role)) continue;
    if (!PATTERNS[specialist.id].test(text)) continue;
    if (!isActive(specialist)) return null;
    return specialist;
  }
  return null;
}

const STATUS_TEXT = Object.freeze({
  [RIDE_STATUS.PAYMENT_REQUIRED]: "waiting for payment authorization",
  [RIDE_STATUS.PAYMENT_AUTHORIZED]: "paid and waiting to be offered to a driver",
  [RIDE_STATUS.AWAITING_DRIVER]: "being offered to nearby drivers",
  [RIDE_STATUS.DRIVER_ASSIGNED]: "accepted by your driver",
  [RIDE_STATUS.DRIVER_ENROUTE]: "on the way to pickup",
  [RIDE_STATUS.ARRIVED]: "at the pickup point",
  [RIDE_STATUS.IN_PROGRESS]: "in progress"
});

const DELIVERY_STAGE_TEXT = Object.freeze({
  order_accepted: "order accepted",
  enroute_store: "driver on the way to the store",
  arrived_store: "driver at the store",
  waiting_for_order: "driver waiting for your order",
  picked_up: "order picked up",
  enroute_customer: "driver on the way to you",
  arrived_customer: "driver has arrived"
});

// Statuses where the rider can still cancel (same list as the ride card).
const CANCELLABLE = Object.freeze([
  RIDE_STATUS.PAYMENT_REQUIRED,
  RIDE_STATUS.PAYMENT_AUTHORIZED,
  RIDE_STATUS.AWAITING_DRIVER,
  RIDE_STATUS.DRIVER_ASSIGNED,
  RIDE_STATUS.DRIVER_ENROUTE,
  RIDE_STATUS.ARRIVED
]);
const WAITING_FOR_DRIVER = Object.freeze([RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.AWAITING_DRIVER]);

const BOOKING_HREF = "/rider-dashboard.html?screen=book&mode=driver";
const DASHBOARD_HREF = "/rider-dashboard.html";
const DELIVERY_CENTER_HREF = "/rider-dashboard.html?center=delivery";
const DRIVER_DASHBOARD_HREF = "/driver-dashboard.html";

function cancelAction(ride, noun) {
  return {
    type: "cancel_ride",
    label: noun === "delivery" ? "Cancel this delivery" : "Cancel this ride",
    ride_id: ride.id,
    method: "POST",
    endpoint: `/api/rides/${encodeURIComponent(ride.id)}/cancel`,
    requires_confirmation: true,
    confirm_text: `Cancel this ${noun}? There is no cancellation fee in the current phase.`,
    fee: "none"
  };
}

function supportActions(role, client) {
  const app = role === "driver" && client === "driver_app";
  return [
    { type: "support_handoff", label: "Send a request to support", requires_confirmation: true },
    app ? { type: "open_support", label: "Contact support" } : { type: "open_support", label: "Contact support", href: "/support.html" }
  ];
}

async function rideBookingAnswer({ actor, text, tools, trace }) {
  const booking = {
    draft:
      "You can book in the Harvey Taxi booking screen. Enter your pickup and drop-off, review the fare our pricing calculates, and confirm. Nothing is charged until you confirm and payment is authorized, and a driver is only dispatched after that.",
    actions: [{ type: "open_booking", label: "Open booking", href: BOOKING_HREF, requires_confirmation: true }]
  };
  if (!actor) return { ...booking, outcome: "answered" };
  const rides = (await tools.invoke("rider_open_rides", actor, {}, trace)).filter((r) => !isDeliveryType(r.ride_type));
  const ride = rides[0] || null;
  if (!ride) {
    return /\b(book|request|need|get|schedule)\b/i.test(text)
      ? { ...booking, outcome: "answered" }
      : { draft: "You don't have an open ride right now.", actions: booking.actions, outcome: "answered" };
  }
  const parts = [`Your ride is ${STATUS_TEXT[ride.status] || "open"}.`];
  if (ride.driver_name) parts.push(`Driver: ${ride.driver_name}${ride.driver_vehicle ? ` (${ride.driver_vehicle})` : ""}.`);
  if (ride.driver_eta_to_pickup_text) parts.push(`Estimated pickup: ${ride.driver_eta_to_pickup_text}.`);
  if (ride.status === RIDE_STATUS.PAYMENT_REQUIRED) parts.push("Finish payment authorization in the booking screen; no driver is contacted before that.");
  if (WAITING_FOR_DRIVER.includes(ride.status)) {
    // Dispatch Recommender's eligibility rules, read-only: only whether
    // any driver currently qualifies and how many offers this ride has had.
    const [outlook] = await tools.invoke("rider_dispatch_outlook", actor, { rideId: ride.id }, trace);
    if (outlook && outlook.offers_sent > 0) parts.push(`It has been offered to ${outlook.offers_sent} driver${outlook.offers_sent === 1 ? "" : "s"} so far.`);
    if (outlook && outlook.drivers_available === false) {
      parts.push("Right now no available drivers are near your pickup. You can keep waiting, or cancel at no charge.");
    } else if (outlook && outlook.drivers_available === true) {
      parts.push("Available drivers are near your pickup; offers continue automatically.");
    }
  }
  const actions = [{ type: "open_tracking", label: "Track ride", href: `${DASHBOARD_HREF}?screen=track&ride_id=${encodeURIComponent(ride.id)}` }];
  if (CANCELLABLE.includes(ride.status)) actions.push(cancelAction(ride, "ride"));
  return { draft: parts.join(" "), actions, outcome: actions.some((a) => a.requires_confirmation) ? "proposed_action_awaiting_confirmation" : "answered" };
}

async function deliveryAnswer({ actor, text, tools, trace }) {
  const center = { type: "open_dashboard", label: "Open the Delivery Center", href: DELIVERY_CENTER_HREF };
  if (!actor) {
    return {
      draft: "You can request a food or grocery delivery in the Delivery Center. Sign in to your Harvey Taxi rider account to see your own deliveries.",
      actions: [center],
      outcome: "answered"
    };
  }
  const [delivery] = await tools.invoke("rider_open_deliveries", actor, {}, trace);
  if (!delivery) {
    return { draft: "You don't have an active delivery right now. You can request one in the Delivery Center.", actions: [center], outcome: "answered" };
  }
  const kind = String(delivery.ride_type).toLowerCase() === "grocery" ? "grocery" : "food";
  const stage = DELIVERY_STAGE_TEXT[delivery.delivery_stage] || STATUS_TEXT[delivery.status] || "open";
  const parts = [`Your ${kind} delivery${delivery.merchant_name ? ` from ${delivery.merchant_name}` : ""} is ${stage}.`];
  if (delivery.driver_name) parts.push(`Driver: ${delivery.driver_name}.`);
  // The PIN is never written in chat: it stays on the rider's card.
  parts.push("Your delivery PIN is on your Delivery Center card. Give it to the driver only at handoff; Harvey Taxi will never ask for it in chat.");
  const actions = [center];
  if (/\bcancel/i.test(text) && CANCELLABLE.includes(delivery.status)) actions.push(cancelAction(delivery, "delivery"));
  return { draft: parts.join(" "), actions, outcome: actions.some((a) => a.requires_confirmation) ? "proposed_action_awaiting_confirmation" : "answered" };
}

const ONBOARDING_LABELS = Object.freeze({
  email_verified: "Email verified",
  phone_verified: "Phone verified",
  persona_verified: "Identity verification complete",
  checkr_ready: "Background check clear",
  vehicle_present: "Vehicle details on file"
});

async function driverOnboardingAnswer({ actor, tools, trace, client }) {
  const [status] = await tools.invoke("driver_onboarding_status", actor, {}, trace);
  const checks = (status && status.checks) || {};
  const done = Object.keys(ONBOARDING_LABELS).filter((k) => checks[k] === true).map((k) => ONBOARDING_LABELS[k]);
  const missing = Object.keys(ONBOARDING_LABELS).filter((k) => checks[k] === false).map((k) => ONBOARDING_LABELS[k]);
  const draft = missing.length
    ? `Still needed before you can go online: ${missing.join(", ")}.${done.length ? ` Done: ${done.join(", ")}.` : ""} Approval and background-check decisions are made by Harvey Taxi staff; the assistant can't change them.`
    : "All onboarding checks on your account are complete, so you can go online from your dashboard. Approval decisions are made by Harvey Taxi staff.";
  const actions = client === "driver_app"
    ? supportActions("driver", client)
    : [{ type: "open_dashboard", label: "Open your dashboard", href: DRIVER_DASHBOARD_HREF }, ...supportActions("driver", client)];
  return { draft, actions, outcome: "proposed_action_awaiting_confirmation" };
}

function customerSupportAnswer({ role, client }) {
  return {
    draft:
      "I can prepare a request to Harvey Taxi support from this conversation. You can review and edit it, and nothing is sent until you tap Send. For an emergency, call 911.",
    actions: supportActions(role, client),
    outcome: "proposed_action_awaiting_confirmation"
  };
}

function safetyAnswer({ role, client }) {
  return {
    draft:
      "I'm sorry that happened. If anyone is in danger now, call 911. You can report this to Harvey Taxi's safety team: I'll prepare a report for you to review, and nothing is sent until you confirm. The safety team reviews every report; the assistant can't take action on an account.",
    actions: [{ type: "call_911", label: "Call 911", href: "tel:911" }, { ...supportActions(role, client)[0], label: "Report to the safety team" }],
    outcome: "proposed_action_awaiting_confirmation"
  };
}

// HTAF answers come only from the HTAF Information Assistant's approved
// index (lib/htafAssistant.js); actions are its own links.
function htafAnswer({ text, htaf }) {
  const result = htaf.answer(text);
  return {
    draft: result.reply,
    // Same-origin links only (the assistant shows no other links); HTAF's
    // email and phone are in the reply text itself.
    actions: (result.actions || []).filter((a) => a && typeof a.href === "string" && a.href.startsWith("/")).map((a) => ({ type: "open_link", label: a.label, href: a.href })),
    sources: result.sources || [],
    knowledge_gap: result.knowledge_gap === true,
    gap_excerpt: result.gap_excerpt || null,
    htaf_intent: result.intent,
    outcome: result.knowledge_gap ? "knowledge_gap" : "answered_from_approved_content"
  };
}

// Runs one specialist turn. Returns an assistant result in the same shape
// as handleAssist() (lib/agent/assistant.js), plus `specialist`.
async function runSpecialist({ specialist, role, actor, message, tools, client = "web", htaf = null }) {
  const text = sanitizeUserMessage(message);
  const trace = [];
  let answer;
  try {
    if (specialist.id === "ride_booking_dispatch") answer = await rideBookingAnswer({ actor, text, tools, trace });
    else if (specialist.id === "delivery") answer = await deliveryAnswer({ actor, text, tools, trace });
    else if (specialist.id === "driver_support_onboarding") answer = await driverOnboardingAnswer({ actor, tools, trace, client });
    else if (specialist.id === "customer_support") answer = customerSupportAnswer({ role, client });
    else if (specialist.id === "safety_escalation") answer = safetyAnswer({ role, client });
    else if (specialist.id === "htaf_information" && htaf) answer = htafAnswer({ text, htaf });
    else return null;
  } catch (err) {
    answer = {
      draft:
        err && err.status === 403
          ? "That isn't available for your account."
          : "I can't reach that information right now. Your dashboard still shows your live status.",
      actions: [],
      outcome: "data_unavailable"
    };
  }
  const chief = chiefById(specialist.chief);
  return {
    reply: answer.draft,
    source: specialist.engine === ENGINES.APPROVED_CONTENT ? "approved_content" : "rules",
    intent: `specialist.${specialist.id}`,
    escalation: null,
    actions: answer.actions,
    sources: answer.sources || [],
    knowledge_gap: answer.knowledge_gap === true,
    gap_excerpt: answer.gap_excerpt || null,
    used_context: false,
    specialist: {
      id: specialist.id,
      name: specialist.name,
      chief: chief ? chief.name : specialist.chief,
      engine: specialist.engine,
      engine_label: ENGINE_LABELS[specialist.engine]
    },
    decision: {
      kind: "assist",
      policy: `specialist.${specialist.id}`,
      specialist: specialist.id,
      chief: specialist.chief,
      engine: specialist.engine,
      tool_calls: trace,
      outcome: answer.outcome,
      executed: false,
      model_used: false
    }
  };
}

// Admin view: chiefs with their specialists and each specialist's state.
function hierarchy({ mode, flags, htafEnabled = false }) {
  return CHIEFS.map((chief) => ({
    ...chief,
    specialists: SPECIALISTS.filter((s) => s.chief === chief.id).map((s) => ({
      id: s.id,
      name: s.name,
      flag: s.flag,
      engine: s.engine,
      engine_label: ENGINE_LABELS[s.engine],
      consults: (s.consults || []).map((id) => (chiefById(id) || { name: id }).name),
      roles: s.roles,
      handles: s.handles,
      actions: s.actions,
      switched_on: Boolean(flags && flags[s.flag] === true),
      answering: specialistActive(s, { mode, flags, htafEnabled })
    }))
  }));
}

module.exports = {
  ENGINES,
  ENGINE_LABELS,
  CHIEFS,
  SPECIALISTS,
  SPECIALIST_FLAGS,
  SPECIALIST_FLAG_KEYS,
  PATTERNS,
  specialistById,
  chiefById,
  specialistActive,
  routeSpecialist,
  runSpecialist,
  hierarchy
};
