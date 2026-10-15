// Assistant pilot: the two organizations. They share this code but nothing
// else: each has its own knowledge index, flags, support contacts, tool
// list and gap log. The organization of a request is decided by the
// server from the host it arrived on, never by the message or the body
// (docs/assistant-platform-architecture.md, "Organization separation").

const ORGS = Object.freeze({
  harvey_taxi: Object.freeze({
    id: "harvey_taxi",
    name: "Harvey Taxi",
    enabledFlag: "assistant_pilot_harvey_taxi_enabled",
    modelFlag: "assistant_pilot_harvey_taxi_model_enabled",
    vectorsFlag: "assistant_pilot_harvey_taxi_vectors_enabled",
    support: Object.freeze({ label: "Harvey Taxi Support page", href: "/support.html" }),
    starters: Object.freeze(["How do I contact Harvey Taxi support?", "What does the Privacy Policy say about location?", "What are the Terms of Service?"])
  }),
  htaf: Object.freeze({
    id: "htaf",
    name: "Harvey Transportation Assistance Foundation (HTAF)",
    enabledFlag: "assistant_pilot_htaf_enabled",
    modelFlag: "assistant_pilot_htaf_model_enabled",
    vectorsFlag: "assistant_pilot_htaf_vectors_enabled",
    support: Object.freeze({ label: "HTAF contact page", href: "/contact.html" }),
    starters: Object.freeze(["How do I apply to HTAF?", "What programs does HTAF offer?", "How can I contact HTAF?"])
  })
});

const ORG_IDS = Object.freeze(Object.keys(ORGS));

// Host decides the organization. Anything not on the foundation's hosts is
// Harvey Taxi.
function orgForHost(hostname, foundationHosts) {
  return foundationHosts && foundationHosts.has(String(hostname || "").toLowerCase()) ? "htaf" : "harvey_taxi";
}

module.exports = { ORGS, ORG_IDS, orgForHost };
