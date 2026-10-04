// Harvey Taxi AI Agent Manager -- untrusted-input handling, intent routing
// and decision boundaries. Deterministic (keyword rules, no model), so the
// decision about whether a message is an emergency or must go to a human
// never depends on the conversational model being online or behaving.
//
// Every rider/driver message is untrusted input: it is length-capped,
// stripped of control characters, and never interpreted as an instruction
// to the platform. A message can only *select* one of the fixed intents
// below; it can never name a tool, a table, a driver, a price or a status.

const MAX_MESSAGE_LENGTH = 1000;

// Ordered: the first matching category wins, so an emergency is never
// downgraded to, say, a billing question because both words appear.
const ESCALATION_RULES = Object.freeze([
  {
    category: "emergency",
    severity: "critical",
    pattern:
      /\b(911|emergency|ambulance|bleeding|unconscious|not breathing|heart attack|stroke|overdose|crash(ed)?|accident|injur(ed|y)|fire|gun|weapon|knife|assault(ed)?|attack(ed)?|kidnap|threaten(ed|ing)?|rape|sexual(ly)? assault|unsafe|in danger|help me|someone is following)\b/i
  },
  {
    category: "fraud",
    severity: "high",
    pattern: /\b(fraud|scam|stolen card|unauthori[sz]ed (charge|payment|transaction)|identity theft|fake (driver|rider|account)|hack(ed)?|phishing)\b/i
  },
  {
    category: "disputed_charge",
    severity: "high",
    pattern: /\b(dispute|disputed|chargeback|overcharg(ed|e)|wrong (charge|fare|amount)|charged (twice|double|more)|double charg(ed|e)|didn'?t authori[sz]e)\b/i
  },
  {
    category: "refund",
    severity: "medium",
    pattern: /\b(refund|money back|reimburse(ment)?)\b/i
  },
  {
    category: "account_action",
    severity: "high",
    pattern: /\b(suspend(ed|sion)?|deactivat(e|ed|ion)|ban(ned)?|block(ed)? (my|the) account|terminate(d)? (my|the) account|reinstat(e|ement))\b/i
  },
  {
    category: "screening",
    severity: "high",
    pattern: /\b(background check|checkr|persona|identity verification|screening|driving record|mvr|criminal record|approval status|why (was|am) i (rejected|denied))\b/i
  }
]);

const ESCALATION_GUIDANCE = Object.freeze({
  emergency:
    "If anyone is in immediate danger, call 911 now. Then use \"Alert Harvey Taxi safety team\" so our staff can see your ride. Harvey Taxi is not an emergency service and this assistant cannot dispatch emergency responders.",
  fraud:
    "This has been sent to a Harvey Taxi staff member for review. Please don't share card numbers or passwords in chat.",
  disputed_charge:
    "Charge disputes are reviewed by a Harvey Taxi staff member. This assistant cannot change or reverse a charge.",
  refund:
    "Refund requests are reviewed by a Harvey Taxi staff member. This assistant cannot issue refunds.",
  account_action:
    "Account suspension and reactivation decisions are made only by Harvey Taxi staff. Your request has been sent for review.",
  screening:
    "Background-check and identity-verification decisions are made only by Harvey Taxi staff and our screening providers. Your question has been sent for review."
});

const INTENT_RULES = Object.freeze([
  // Questions about rules and policies, answered only from approved
  // published pages (lib/knowledge). Before cancel_ride/fare_info so
  // "what's your cancellation policy" is a question, not a cancellation.
  {
    intent: "policy_question",
    pattern: /\b(polic(y|ies)|terms( of service)?|privacy|rules?|allowed|permitted|requirements?|eligib\w*|accessib\w*|wheelchair|service animals?|pets?|my (data|information)|personal (data|information)|delete (my )?(\w+ )?account|account deletion|retention|retain|insurance|liabilit\w*|refund policy|cancellation fee|service area|coverage|do you (share|sell|keep|store)|who can see)\b/i
  },
  // Live hours for the signed-in driver (docs/driver-hours.md).
  { intent: "driver_hours", pattern: /\b(hours?|rest (period|time)?|shift|how long (have i|can i)|time (left|remaining)|break)\b/i },
  { intent: "cancel_ride", pattern: /\b(cancel|cancell?ation)\b/i },
  { intent: "change_service", pattern: /\b(change|switch|upgrade|downgrade)\b.*\b(service|ride type|vehicle|xl|airport|medical|delivery)\b/i },
  { intent: "book_ride", pattern: /\b(book|request|need|get|schedule|order)\b.*\b(ride|taxi|car|trip|pickup|delivery)\b|\bride to\b/i },
  { intent: "fare_info", pattern: /\b(fare|price|cost|how much|estimate|quote)\b/i },
  { intent: "ride_status", pattern: /\b(where('?s| is)|status|eta|how long|arriv|my driver|my ride|track)\b/i },
  { intent: "driver_offers", pattern: /\b(offer|offers|request(s)? for me|new ride(s)?)\b/i },
  { intent: "driver_earnings", pattern: /\b(earn(ed|ings)?|payout|paid|income)\b/i },
  { intent: "driver_availability", pattern: /\b(go online|go offline|availability|available|online|offline)\b/i },
  // Before driver_active_ride: "navigate to pickup" is a navigation question.
  { intent: "driver_navigation", pattern: /\b(navigat\w*|directions?|route|how do i get|where (do i|am i|should i) (go|going|drive|head)|map)\b/i },
  { intent: "driver_support", pattern: /\b(support|customer service|contact (harvey|someone|staff|you)|talk to (someone|a person|staff|a human)|report (a |an )?(problem|issue|bug)|(app|it) (isn'?t|is not|not) working)\b/i },
  { intent: "driver_active_ride", pattern: /\b(current (ride|trip)|active (ride|trip)|start (the )?(trip|ride)|complete (the )?(trip|ride)|pick ?up)\b/i }
]);

const RIDER_INTENTS = Object.freeze(["policy_question", "book_ride", "cancel_ride", "change_service", "fare_info", "ride_status", "general_help"]);
const DRIVER_INTENTS = Object.freeze([
  "policy_question",
  "driver_hours",
  "driver_offers",
  "driver_active_ride",
  "driver_navigation",
  "driver_earnings",
  "driver_availability",
  "driver_support",
  "general_help"
]);

// Strips control characters and caps length. Returns "" for non-strings.
function sanitizeUserMessage(value) {
  if (typeof value !== "string") return "";
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

// For logs: removes anything that looks like a card number, phone number,
// email address or long token, then truncates. Raw messages are never
// written to the audit log.
function redactForLog(value, maxLength = 160) {
  const text = sanitizeUserMessage(String(value ?? ""));
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .slice(0, maxLength);
}

function classifyEscalation(message) {
  const text = sanitizeUserMessage(message);
  if (!text) return null;
  for (const rule of ESCALATION_RULES) {
    if (rule.pattern.test(text)) {
      return {
        category: rule.category,
        severity: rule.severity,
        guidance: ESCALATION_GUIDANCE[rule.category],
        show_911: rule.category === "emergency"
      };
    }
  }
  return null;
}

function classifyIntent(message, role) {
  const text = sanitizeUserMessage(message);
  const allowed = role === "driver" ? DRIVER_INTENTS : RIDER_INTENTS;
  if (!text) return "general_help";
  for (const rule of INTENT_RULES) {
    if (allowed.includes(rule.intent) && rule.pattern.test(text)) {
      return rule.intent;
    }
  }
  return "general_help";
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  ESCALATION_GUIDANCE,
  RIDER_INTENTS,
  DRIVER_INTENTS,
  sanitizeUserMessage,
  redactForLog,
  classifyEscalation,
  classifyIntent
};
