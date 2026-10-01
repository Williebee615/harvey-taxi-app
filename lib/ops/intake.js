// Understanding a rider's or driver's report (rules-based, no model).
//
// A report often mixes several problems ("the driver never came, the app
// said he arrived, and I was charged $45"). Intake splits it into issue
// categories, the specific claims the person makes (which the
// investigation then checks against platform records), the entities it
// mentions, and the follow-up questions still needed. The text itself is
// untrusted: it can only select categories and supply claims to verify;
// it never selects tools, rides the person doesn't own, or actions.

const { sanitizeUserMessage, classifyEscalation } = require("../agent/escalation");

const CATEGORY = Object.freeze({
  MISSED_PICKUP: "missed_pickup",
  WRONG_LOCATION: "wrong_location",
  STALLED_DISPATCH: "stalled_dispatch",
  SCHEDULING: "scheduling_conflict",
  PAYMENT: "payment_discrepancy",
  DELIVERY: "delivery_problem"
});

const CATEGORY_LABELS = Object.freeze({
  missed_pickup: "Missed pickup",
  wrong_location: "Incorrect location",
  stalled_dispatch: "Stalled dispatch",
  scheduling_conflict: "Scheduling conflict",
  payment_discrepancy: "Payment discrepancy",
  delivery_problem: "Delivery problem"
});

const RULES = [
  [CATEGORY.MISSED_PICKUP, /\b(never (showed|came|arrived|picked)|didn'?t (show|come|arrive|pick me)|no[- ]?show|missed (my |the )?pickup|left without me|drove (off|away|past)|wasn'?t there)\b/i],
  [CATEGORY.WRONG_LOCATION, /\b(wrong (place|location|address|spot|pin|entrance|side)|incorrect (location|address|pickup|pin)|other side of|couldn'?t find (me|you|the rider|the pickup)|went to the wrong|pin (was|is) (off|wrong)|different address)\b/i],
  [CATEGORY.STALLED_DISPATCH, /\b(no drivers?( available| yet)?|still (searching|looking|finding)|nobody (accepted|took|is coming)|stuck (on|at)? ?(searching|finding|looking)|can'?t (i |we )?(find|get) (a |any )?drivers?|no one (accepted|is coming|took)|waiting for a driver|(isn'?t|is not|hasn'?t|has not) (been )?(assigned|matched))\b/i],
  [CATEGORY.SCHEDULING, /\b(schedul\w*|booked (it )?for|reserved for|wrong time|too early|too late|came (early|late)|pickup time|showed up (early|late)|before my time|after my time)\b/i],
  [CATEGORY.PAYMENT, /\b(charged|charge|overcharg\w*|double[- ]?charg\w*|twice|refund|fare (was|is) (wrong|higher|more|different)|price (changed|was|is)|paid|receipt|pending (charge|amount)|hold on my card|tip)\b/i],
  [CATEGORY.DELIVERY, /\b(my order|food|grocer\w*|delivery|delivered|missing items?|wrong items?|never (got|received) (my|the) (order|food|groceries)|left (it )?at|cold food|spilled)\b/i]
];

const RIDE_ID_PATTERN = /\b((?:TEST-)?RIDE[-_][A-Za-z0-9_-]{1,40})\b/gi;
const AMOUNT_PATTERN = /\$\s?(\d{1,4}(?:\.\d{1,2})?)/g;
const CLOCK_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi;
const DURATION_PATTERN = /\b(\d{1,3})\s?(min|mins|minutes|hours?|hrs?)\b/gi;

function all(pattern, text, map) {
  const out = [];
  pattern.lastIndex = 0;
  let m;
  while ((m = pattern.exec(text))) out.push(map(m));
  return out;
}

function extractEntities(text) {
  return {
    ride_ids: [...new Set(all(RIDE_ID_PATTERN, text, (m) => m[1].toUpperCase()))],
    amounts: all(AMOUNT_PATTERN, text, (m) => Number(m[1])),
    clock_times: all(CLOCK_PATTERN, text, (m) => {
      let h = Number(m[1]) % 12;
      if (m[3].toLowerCase() === "pm") h += 12;
      return { hour: h, minute: Number(m[2] || 0), text: m[0] };
    }),
    durations_minutes: all(DURATION_PATTERN, text, (m) => (/h/i.test(m[2]) ? Number(m[1]) * 60 : Number(m[1])))
  };
}

// The specific statements the investigation will check.
function extractClaims(text, entities) {
  const t = text.toLowerCase();
  const claims = {};
  if (RULES[0][1].test(text)) claims.driver_did_not_arrive = true;
  if (/\b(app|it|the screen|notification)\b[^.]{0,40}\b(said|says|showed|shows|marked)\b[^.]{0,30}\b(arrived|here|outside)\b/i.test(text)) {
    claims.app_showed_arrived = true;
  }
  if (/\b(double[- ]?charg\w*|charged twice|two charges)\b/i.test(text)) claims.double_charge = true;
  const charged = /\b(charged|charge of|took|paid)\b[^$]{0,20}\$\s?(\d{1,4}(?:\.\d{1,2})?)/i.exec(text);
  if (charged) claims.charged_amount = Number(charged[2]);
  const quoted = /\b(quoted|quote|estimate|said it would be|supposed to be|expected)\b[^$]{0,20}\$\s?(\d{1,4}(?:\.\d{1,2})?)/i.exec(text);
  if (quoted) claims.quoted_amount = Number(quoted[2]);
  if (!claims.charged_amount && entities.amounts.length === 1 && /\b(charg|paid|took)/.test(t)) {
    claims.charged_amount = entities.amounts[0];
  }
  const sched = /\b(schedul\w*|booked (it )?for|reserved for|pickup (time )?(was|is|at))\b[^.]{0,25}?\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i.exec(text);
  if (sched) {
    // Groups: 5 = hour, 6 = minutes, 7 = am/pm.
    let h = Number(sched[5]) % 12;
    if (sched[7].toLowerCase() === "pm") h += 12;
    claims.scheduled_clock = { hour: h, minute: Number(sched[6] || 0), text: `${sched[5]}${sched[6] ? `:${sched[6]}` : ""} ${sched[7]}` };
  }
  if (/\b(came|showed up|arrived)\b[^.]{0,15}\b(early|too early)\b/i.test(text)) claims.driver_early = true;
  if (/\b(came|showed up|arrived)\b[^.]{0,15}\b(late|too late)\b/i.test(text)) claims.driver_late = true;
  const waited = /\bwait(ed|ing)?\b[^.]{0,20}?\b(\d{1,3})\s?(min|mins|minutes)\b/i.exec(text);
  if (waited) claims.waited_minutes = Number(waited[2]);
  if (
    /\b(never (got|received)|didn'?t (get|receive))\b[^.]{0,20}\b(order|food|groceries|delivery)\b/i.test(text) ||
    /\b(order|food|groceries|delivery)\b[^.]{0,15}\b(never (arrived|came)|didn'?t (arrive|come))\b/i.test(text)
  ) {
    claims.not_delivered = true;
  }
  if (/\b(missing items?|wrong items?|items? (were|was) missing)\b/i.test(text)) claims.items_issue = true;
  if (/\bno drivers?\b|\bstill (searching|looking)\b|\bnobody accepted\b/i.test(text)) claims.no_driver_found = true;
  return claims;
}

function followUpQuestions({ categories, entities, claims, knownRideId, candidateRides }) {
  const questions = [];
  if (!knownRideId && !entities.ride_ids.length) {
    questions.push({
      id: "which_ride",
      question:
        candidateRides && candidateRides.length > 1
          ? "Which ride is this about? Pick one of your recent rides."
          : "Which ride is this about?",
      options: (candidateRides || []).slice(0, 5).map((r) => ({ ride_id: r.id, label: r.label }))
    });
  }
  if (categories.includes(CATEGORY.PAYMENT) && claims.charged_amount === undefined && !claims.double_charge) {
    questions.push({ id: "amount_seen", question: "What amount do you see on your card or statement, and is it pending or posted?" });
  }
  if (categories.includes(CATEGORY.SCHEDULING) && !claims.scheduled_clock) {
    questions.push({ id: "scheduled_time", question: "What pickup time did you schedule?" });
  }
  if (categories.includes(CATEGORY.WRONG_LOCATION)) {
    questions.push({ id: "where_were_you", question: "Where were you waiting (street, entrance or landmark)?" });
  }
  if (categories.includes(CATEGORY.DELIVERY) && !claims.not_delivered && !claims.items_issue) {
    questions.push({ id: "delivery_what", question: "Was the order not delivered at all, or were items missing or wrong?" });
  }
  return questions;
}

// Returns the structured understanding of one message.
function understandReport(message, { knownRideId = null, candidateRides = [] } = {}) {
  const text = sanitizeUserMessage(message);
  const boundary = classifyEscalation(text);
  const categories = RULES.filter(([, re]) => re.test(text)).map(([c]) => c);
  // "No driver yet" is a dispatch problem, not a missed pickup.
  if (categories.includes(CATEGORY.STALLED_DISPATCH) && categories.includes(CATEGORY.MISSED_PICKUP) && !/arriv|showed|came/i.test(text)) {
    categories.splice(categories.indexOf(CATEGORY.MISSED_PICKUP), 1);
  }
  // "My groceries never arrived" is a delivery problem, not a missed pickup.
  if (categories.includes(CATEGORY.DELIVERY) && categories.includes(CATEGORY.MISSED_PICKUP) && !/\b(driver|pick ?up|picked)\b/i.test(text)) {
    categories.splice(categories.indexOf(CATEGORY.MISSED_PICKUP), 1);
  }
  const entities = extractEntities(text);
  const claims = extractClaims(text, entities);
  return {
    text_length: text.length,
    boundary: boundary ? { category: boundary.category, severity: boundary.severity } : null,
    categories,
    entities,
    claims,
    follow_ups: followUpQuestions({ categories, entities, claims, knownRideId, candidateRides })
  };
}

module.exports = { CATEGORY, CATEGORY_LABELS, understandReport, extractClaims, extractEntities };
