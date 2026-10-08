// HTAF Information Assistant: Harvey Transportation Assistance
// Foundation's own information assistant (approved content only; no AI
// model) (docs/htaf-assistant.md). Separate from the Harvey Taxi
// assistant in knowledge, wording and records:
//   - answers only by quoting HTAF's published pages (foundation, apply,
//     contact, privacy, terms, service providers) -- never Harvey Taxi's;
//   - when those pages don't answer, says so, offers HTAF support and
//     reports the gap (a short redacted excerpt, for staff to add an
//     approved answer);
//   - never decides or predicts eligibility, never promises assistance,
//     never approves anything;
//   - takes no actions: it can't book rides, send texts, change or withdraw
//     applications, or make funding decisions;
//   - never discusses a specific application: status is private; HTAF has
//     no applicant sign-in or online status check, so it points to HTAF
//     support (the contact page's own wording).
// Reuses the Harvey Taxi assistant's search engine and redaction (same
// safeguards), with its own index. No model, no network, no database.

const fs = require("fs");
const path = require("path");
const { buildIndex, loadSources, search, excerpt, htmlToText } = require("./knowledge/search");
const { classifyEscalation, redactForLog, sanitizeUserMessage } = require("./agent/escalation");

const HTAF_SOURCES = Object.freeze([
  { id: "htaf-foundation", file: "foundation.html", url: "/", title: "HTAF home page", audience: ["htaf"], datePattern: null },
  { id: "htaf-apply", file: "htaf-application.html", url: "/htaf-application.html", title: "HTAF application page", audience: ["htaf"], datePattern: null },
  { id: "htaf-contact", file: "contact.html", url: "/contact.html", title: "HTAF contact page", audience: ["htaf"], datePattern: null },
  { id: "htaf-privacy", file: "htaf-privacy.html", url: "/privacy.html", title: "HTAF Privacy Policy", audience: ["htaf"], datePattern: null },
  { id: "htaf-terms", file: "htaf-terms.html", url: "/terms.html", title: "HTAF Terms of Use", audience: ["htaf"], datePattern: null },
  { id: "htaf-providers", file: "htaf-service-providers.html", url: "/service-providers.html", title: "HTAF Service Providers page", audience: ["htaf"], datePattern: null }
]);

// Sections that are page furniture, never quoted.
const EXCLUDED_HEADINGS = new Set([
  "Application Dashboard",
  "Removing transportation barriers for Tennesseans in need.",
  "Apply for transportation assistance through HTAF."
]);

// Internal draft labels ("... pending counsel review") are not part of the
// approved text and are never quoted.
function stripDraftLabels(html) {
  return String(html).replace(/<div class="review-note">[\s\S]*?<\/div>/gi, " ");
}

// Answers to the questions people ask most, assembled only from sentences
// that appear word for word on HTAF's published pages. At startup each
// piece is checked against the page's visible text; a topic whose text no
// longer appears (the page changed) is dropped rather than answered from a
// stale copy.
const TOPICS = Object.freeze([
  {
    id: "programs",
    pattern: /\b(programs?|categor(y|ies)|kinds? of (help|assistance|trips?|rides?)|types? of (help|assistance|trips?|rides?)|what (do|does) (you|htaf) (help|cover|offer|provide)|what (help|assistance) (do|does|is))\b|\b(veterans?|seniors?|older (adults|tennesseans|people)|disabilit(y|ies))\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Programs",
    url: "/#programs",
    pieces: [
      "HTAF reviews transportation-assistance requests across the following categories.",
      ["Medical Transportation", "Doctor appointments, treatment, rehabilitation, counseling, and pharmacy access."],
      ["Employment Access", "Interviews, onboarding, workforce training, and employment transportation."],
      ["Education Access", "School transportation, certification programs, and workforce education."],
      ["Senior Assistance", "Transportation support for older Tennesseans maintaining independence."],
      ["Disability Assistance", "Accessible transportation for residents with disabilities."],
      ["Veteran Assistance", "Transportation support for Tennessee veterans."]
    ]
  },
  {
    id: "documents",
    pattern: /\b(documents?|documentation|paperwork|records?|proof|upload|attach|id card|identification)\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Frequently Asked Questions",
    url: "/#faq",
    pieces: [
      "HTAF may request supporting records, such as an appointment confirmation, after reviewing an application. Do not upload documents through the online application. If supporting documentation is needed, HTAF will contact you with instructions for submitting it securely."
    ]
  },
  {
    id: "who_can_apply",
    pattern: /\b(who (can|may|is able to) apply|eligib(le|ility)|qualif(y|ications?)|requirements?|criteria|for someone else|on (their|his|her|my \w+'?s?) behalf|caregiver|case ?worker|guardian|parent)\b|\bapply for (my|a|an|our) (mother|mom|father|dad|parent|child|son|daughter|client|patient|relative|family member|friend|neighbor)\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Frequently Asked Questions",
    url: "/#faq",
    pieces: [
      "Tennessee residents seeking transportation support for essential needs, or a parent, guardian, caregiver, or case worker applying on their behalf.",
      "Every application is reviewed individually against program eligibility, supporting documentation, and available funding — submitting an application is not a guarantee of assistance, but every request receives real review."
    ]
  },
  {
    id: "how_to_apply",
    pattern: /\b(how (do|can|to) (i |we )?(apply|sign up|request|get (help|assistance|a ride))|apply|application (process|steps)|steps|process|request (help|assistance|a ride|transportation)|what happens (next|after))\b/i,
    file: "htaf-application.html",
    title: "HTAF application page",
    section: "Application Review Process",
    url: "/htaf-application.html",
    pieces: [
      "Prepare transportation details, appointment information, and destination addresses.",
      "Step 1 Submit transportation assistance request.",
      "Step 2 HTAF reviews eligibility and documentation.",
      "Step 3 Additional verification may be requested.",
      "Step 4 Approved requests move to scheduling."
    ]
  },
  {
    id: "guarantee",
    pattern: /\b(guarantee[sd]?|promise[sd]?|definitely|for sure|will i get|will (htaf|you) (pay|cover|fund))\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Frequently Asked Questions",
    url: "/#faq",
    pieces: [
      "No. Applying does not guarantee approval, funding, transportation, or scheduling. Assistance depends on eligibility, documentation, transportation availability, and funding resources."
    ]
  },
  {
    id: "service_area",
    pattern: /\b(service area|where do you (serve|operate|work)|which (cities|counties|areas)|(serve|cover|help)( people)? in|outside (of )?tennessee|statewide|county|counties|city)\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Legal Identity",
    url: "/",
    pieces: [["Service Area", "Tennessee, statewide"]]
  },
  {
    id: "harvey_taxi",
    pattern: /\b(harvey taxi|taxi company|same (company|organization)|related|affiliated|owned by)\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Legal Identity",
    url: "/",
    pieces: [
      "HTAF is a separate 501(c)(3) charitable organization and is not the same legal entity as Harvey Taxi Service LLC, a separate for-profit transportation company."
    ]
  },
  {
    id: "nonprofit",
    pattern: /\b(nonprofit|non-profit|charity|501|ein|tax[- ]deductible|irs|donat(e|ion|ions|ing))\b/i,
    file: "foundation.html",
    title: "HTAF home page",
    section: "Nonprofit Status",
    url: "/",
    pieces: [
      "Harvey Transportation Assistance Foundation is recognized by the IRS as a 501(c)(3) public charity (EIN 41-5115030). Donations to HTAF may be tax-deductible to the extent allowed by law. Consult a tax advisor regarding your specific circumstances."
    ]
  },
  {
    // Used for application-status questions (never matched on its own):
    // the contact page's own wording on how to ask about a status.
    id: "status_contact",
    pattern: /(?!)/,
    file: "contact.html",
    title: "HTAF contact page",
    section: "Application Status",
    url: "/contact.html",
    pieces: [
      "Already submitted a transportation assistance application? To ask about its status, email WillieHtaf@harveytransportationfoundation.com or call 615-636-6201, and include the application code provided at submission (format HTAF-XXXXXXXX-XXXX). An online status check is not available."
    ]
  },
  {
    id: "contact",
    pattern: /\b(contact|reach (you|htaf|someone|a person)|(your|htaf'?s|the foundation'?s) (email|e-mail|phone( number)?|number|address|office)|how (do|can) i (email|call|reach|write to)|talk to (someone|a person|staff|htaf)|speak (to|with) (someone|a person|staff|htaf)|support|help ?desk)\b/i,
    file: "contact.html",
    title: "HTAF contact page",
    section: "Foundation Contact",
    url: "/contact.html",
    pieces: [
      ["Email", "WillieHtaf@harveytransportationfoundation.com"],
      ["Phone", "615-636-6201"],
      ["Mailing Address", "1617 Lebanon Pike, Nashville, TN 37210"]
    ]
  }
]);

function visiblePageText(html) {
  // Tag stripping leaves a space before punctuation that follows a link.
  return htmlToText(stripDraftLabels(html)).replace(/\s+/g, " ").replace(/ ([.,;:])/g, "$1");
}

// Topic answers whose every piece is on the page today.
function loadTopics({ publicDir = path.join(__dirname, "..", "public"), readFile = fs.readFileSync } = {}) {
  const pages = new Map();
  const ready = [];
  const dropped = [];
  for (const topic of TOPICS) {
    if (!pages.has(topic.file)) {
      let text = "";
      try {
        text = visiblePageText(readFile(path.join(publicDir, topic.file), "utf8"));
      } catch (err) {
        text = "";
      }
      pages.set(topic.file, text);
    }
    const page = pages.get(topic.file);
    const present = topic.pieces.every((piece) => (Array.isArray(piece) ? piece.every((p) => page.includes(p)) : page.includes(piece)));
    if (!present) {
      dropped.push(topic.id);
      continue;
    }
    const lines = topic.pieces.map((piece) => (Array.isArray(piece) ? `${piece[0]}: ${piece[1]}` : piece));
    ready.push({ ...topic, answer: lines.join(" ") });
  }
  return { topics: ready, dropped };
}

const SUPPORT = Object.freeze({
  email: "WillieHtaf@harveytransportationfoundation.com",
  phone: "615-636-6201",
  url: "/contact.html"
});

const SUPPORT_ACTIONS = Object.freeze([
  { type: "link", label: "Contact HTAF", href: SUPPORT.url },
  { type: "link", label: `Email ${SUPPORT.email}`, href: `mailto:${SUPPORT.email}` },
  { type: "link", label: `Call ${SUPPORT.phone}`, href: "tel:+16156366201" }
]);
const APPLY_ACTION = Object.freeze({ type: "link", label: "Open the application", href: "/htaf-application.html" });

const REPLIES = Object.freeze({
  emergency:
    "If anyone is in danger or needs urgent medical help, call 911 now. HTAF is not an emergency service and this assistant can't send help.",
  // Used only if the contact page's status wording is no longer on the page.
  status:
    "Application status is private, so I can't look up or discuss a specific application here. Please contact HTAF support using the details below.",
  statusPrefix: "Application status is private, so I can't look up or discuss a specific application here.",
  action:
    "I can't do that from this chat. I can only explain HTAF's published information: I can't book rides, send texts, change or withdraw applications, or make funding or approval decisions. HTAF support can help with your request.",
  decision:
    "I can't tell whether someone is eligible or will be approved. HTAF staff review every application individually, and applying doesn't guarantee assistance.",
  gap:
    "I don't have approved HTAF information that answers that, so I won't guess. You can contact HTAF support below, and I've noted your question so the team can add an approved answer.",
  empty: "Ask me about HTAF's transportation-assistance programs, who can apply, how to apply, documents, or how to contact HTAF."
});

// Questions about one application's progress or outcome.
const STATUS_PATTERN =
  /\b(status|update)\b.*\b(application|request|case)\b|\b(my|our|her|his|their)\s+(application|request|case)\b|\b(application|request)\s+(code|number)\b|\bHTAF-[A-Z0-9]{4,}/i;
// Requests to act, not explain.
const ACTION_PATTERN =
  /\b(book|schedule|reserve|order|send)\b.*\b(ride|trip|car|taxi|pickup|text|sms)\b|\b(text|sms|message)\s+me\b|\b(change|update|edit|cancel|withdraw|delete|approve|deny|fund|pay)\s+(my|the|this|our)\s+(application|request|ride|trip)\b|\b(approve|fund)\s+me\b|\bsend (me )?(money|funds|a voucher)\b|\b(take|drive|pick up|pickup) (me|us|my \w+)\b|\bpick (me|us) up\b/i;
// Specific rules HTAF hasn't published (limits, amounts, timelines,
// costs): always a gap, never a nearby sentence that might read as a rule.
const UNPUBLISHED_RULE_PATTERN =
  /\b(income (limit|cap|requirement|threshold|maximum)|(how much|maximum|max|limit|cap) (money|income|funding|assistance)|how many (rides|trips|times)|ride limit|mileage|miles|how far|age (limit|requirement)|how old|how long|how soon|when will|turnaround|wait(ing)? time|cost|price|fee|fees|pay for|charge)\b/i;
// Asking for an eligibility or approval decision.
const DECISION_PATTERN =
  /\b(am i|are we|is (she|he|my \w+)|will (i|we|my \w+))\b.*\b(eligible|qualif(y|ied)|approved|accepted|get (help|assistance|a ride|funding))\b|\b(do|would|will) (i|we) qualify\b|\bguarantee(d)?\b/i;

function loadHtafIndex({ publicDir, readFile = fs.readFileSync } = {}) {
  const read = (file, enc) => stripDraftLabels(readFile(file, enc));
  const { sections, loaded } = loadSources({ sources: HTAF_SOURCES, readFile: read, ...(publicDir ? { publicDir } : {}) });
  const kept = sections.filter((sec) => !EXCLUDED_HEADINGS.has(sec.heading));
  const { topics, dropped } = loadTopics({ readFile, ...(publicDir ? { publicDir } : {}) });
  const index = buildIndex(kept);
  index.topics = topics;
  return { index, loaded, sections: kept.length, topics: topics.map((t) => t.id), dropped_topics: dropped };
}

function topicAnswer(index, text) {
  for (const topic of index.topics || []) {
    if (topic.pattern.test(text)) {
      return { reply: `From the ${topic.title} ("${topic.section}"): ${topic.answer}`, sources: [{ title: topic.title, section: topic.section, url: topic.url }], topic: topic.id };
    }
  }
  return null;
}

function quoteAnswer(index, question) {
  const hits = search(index, question, { role: "htaf", limit: 2 });
  if (!hits.length) return null;
  const top = hits[0];
  const quote = excerpt(top.section, question);
  const sources = [];
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.section.url}#${h.section.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ title: h.section.title, section: h.section.heading, url: h.section.url });
  }
  return { reply: `From the ${top.section.title} ("${top.section.heading}"): ${quote}`, sources };
}

// HTAF application codes and long numbers (IDs, SSNs) are removed from the
// gap excerpt as well as the Harvey Taxi assistant's redactions.
function redactQuestion(message) {
  return redactForLog(message, 200)
    .replace(/HTAF-[A-Z0-9-]{4,}/gi, "[application code]")
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, "[number]")
    .replace(/\b\d{6,}\b/g, "[number]");
}

// One answer. Returns { reply, intent, sources, actions, knowledge_gap,
// gap_excerpt } -- gap_excerpt only for a knowledge gap, already redacted.
function answerHtafQuestion(index, message) {
  const text = sanitizeUserMessage(String(message || "")).trim();
  const base = { sources: [], knowledge_gap: false, gap_excerpt: null };
  if (!text) return { ...base, intent: "empty", reply: REPLIES.empty, actions: [APPLY_ACTION] };

  const escalation = classifyEscalation(text);
  if (escalation && escalation.category === "emergency") {
    return { ...base, intent: "emergency", reply: REPLIES.emergency, actions: [{ type: "link", label: "Call 911", href: "tel:911" }] };
  }
  if (ACTION_PATTERN.test(text)) {
    return { ...base, intent: "action_request", reply: REPLIES.action, actions: [APPLY_ACTION, ...SUPPORT_ACTIONS] };
  }
  if (STATUS_PATTERN.test(text)) {
    const how = (index.topics || []).find((t) => t.id === "status_contact");
    return {
      ...base,
      intent: "application_status",
      reply: how ? `${REPLIES.statusPrefix} From the ${how.title} ("${how.section}"): ${how.answer}` : REPLIES.status,
      sources: how ? [{ title: how.title, section: how.section, url: how.url }] : [],
      actions: SUPPORT_ACTIONS.slice()
    };
  }
  if (DECISION_PATTERN.test(text)) {
    const info = (index.topics || []).find((t) => t.id === "guarantee")
      ? { reply: `From the HTAF home page ("Frequently Asked Questions"): ${(index.topics || []).find((t) => t.id === "guarantee").answer}`, sources: [{ title: "HTAF home page", section: "Frequently Asked Questions", url: "/#faq" }] }
      : null;
    return {
      ...base,
      intent: "eligibility_decision",
      reply: info ? `${REPLIES.decision} ${info.reply}` : REPLIES.decision,
      sources: info ? info.sources : [],
      actions: [APPLY_ACTION, ...SUPPORT_ACTIONS]
    };
  }

  if (UNPUBLISHED_RULE_PATTERN.test(text)) {
    return { ...base, intent: "knowledge_gap", reply: REPLIES.gap, actions: SUPPORT_ACTIONS.slice(), knowledge_gap: true, gap_excerpt: redactQuestion(text) };
  }
  const topic = topicAnswer(index, text);
  if (topic) {
    return { ...base, intent: `approved_information:${topic.topic}`, reply: topic.reply, sources: topic.sources, actions: [APPLY_ACTION, ...SUPPORT_ACTIONS] };
  }
  const answer = quoteAnswer(index, text);
  if (answer) {
    return { ...base, intent: "approved_information", reply: answer.reply, sources: answer.sources, actions: [APPLY_ACTION] };
  }
  return {
    ...base,
    intent: "knowledge_gap",
    reply: REPLIES.gap,
    actions: SUPPORT_ACTIONS.slice(),
    knowledge_gap: true,
    gap_excerpt: redactQuestion(text)
  };
}

module.exports = {
  HTAF_SOURCES,
  SUPPORT,
  REPLIES,
  loadHtafIndex,
  answerHtafQuestion,
  redactQuestion
};
