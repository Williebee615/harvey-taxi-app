// Approved Harvey Taxi knowledge (docs/ai-knowledge.md).
//
// Phase 1 sources are the pages Harvey Taxi has already published on its
// website. They are the approved text: changing them is a deploy, and the
// assistant always quotes the deployed version. Nothing here is written by
// the assistant or by a model.
//
// Each source names its page, who it applies to, and the date the page
// itself states. A page that states no date is shown as "date not stated"
// rather than given an invented one.

const SOURCES = Object.freeze([
  {
    id: "terms",
    file: "terms.html",
    url: "/terms.html",
    title: "Terms of Service",
    audience: ["rider", "driver"],
    // The page says "Effective Date: April 5, 2026".
    datePattern: /Effective Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/
  },
  {
    id: "privacy",
    file: "privacy-policy.html",
    url: "/privacy-policy.html",
    title: "Privacy Policy",
    audience: ["rider", "driver"],
    datePattern: /Last updated:\s*([A-Z][a-z]+(?: \d{1,2},)? \d{4})/
  },
  {
    id: "support",
    file: "support.html",
    url: "/support.html",
    title: "Support",
    audience: ["rider", "driver"],
    datePattern: null
  }
]);

// Topics people ask about that no approved source covers yet. The
// assistant says so (and logs the gap for staff) instead of answering.
// Listed here so the evaluation can check each one is reported, not
// invented. Remove a topic once an approved source covers it.
const KNOWN_GAPS = Object.freeze([
  "cancellation fee",
  "service area",
  "wheelchair accessible vehicles",
  "pricing rules",
  "driver vehicle requirements"
]);

module.exports = { SOURCES, KNOWN_GAPS };
