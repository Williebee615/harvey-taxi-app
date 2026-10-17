// Merchant application screening: review flags for staff (owner decision
// 2026-10-17). Flags are computed when the admin list is read and never
// change an application: no automatic rejection, no status change, nothing
// stored (docs/agent-action-rules.md, rules 1 and 7). A flag means "look
// closer", not "suspicious person". Staff decide.

// Throwaway-inbox services. Not exhaustive; a miss just means no flag.
const DISPOSABLE_EMAIL_DOMAINS = Object.freeze(new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "temp-mail.org", "tempmail.com", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com"
]));

// The Nashville pilot area's ZIP codes start 370, 371 or 372 (Middle
// Tennessee). A ZIP elsewhere in Tennessee is allowed by the form but is
// outside the pilot, so staff should check it.
const PILOT_ZIP = /^37[0-2]\d{2}$/;
const PLACEHOLDER_NAME = /^(test|testing|asdf|qwerty|xxx+|aaa+|n\/?a|none|sample|demo)\b/i;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

const LABELS = Object.freeze({
  disposable_email: "Contact email uses a throwaway-inbox service",
  zip_outside_pilot: "ZIP code is outside the Nashville pilot area (370–372)",
  zip_missing: "No ZIP code given",
  address_no_number: "Street address has no street number",
  placeholder_name: "Business name looks like a placeholder",
  shared_phone: "Same phone number as another application",
  shared_address: "Same street address as another application",
  previously_rejected: "Same email or phone as a rejected application",
  rapid_repeat: "Another application with the same email, phone or address within 24 hours"
});

const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const emailDomain = (email) => norm(email).split("@")[1] || "";
// "100 Main Street" and "100 main st." are the same address.
const STREET_WORDS = Object.freeze({ street: "st", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd", suite: "ste", lane: "ln", pike: "pk" });
const addressKey = (m) => {
  const line = norm(m.address_line).replace(/[.,#]/g, "").replace(/\b[a-z]+\b/g, (w) => STREET_WORDS[w] || w);
  return line ? `${line}|${norm(m.city)}` : "";
};
const time = (m) => Date.parse(m.created_at) || 0;

// rows: merchant applications as the admin list reads them.
// Returns { [id]: [{ code, label }] }; an application with no flags gets [].
function screenMerchants(rows = []) {
  const list = (rows || []).filter((m) => m && m.id);
  const byPhone = new Map();
  const byAddress = new Map();
  const byEmail = new Map();
  const add = (map, key, m) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  };
  for (const m of list) {
    add(byPhone, norm(m.contact_phone), m);
    add(byAddress, addressKey(m), m);
    add(byEmail, norm(m.contact_email), m);
  }
  const others = (map, key, m) => (key && map.has(key) ? map.get(key).filter((o) => o.id !== m.id) : []);

  const result = {};
  for (const m of list) {
    const codes = [];
    if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain(m.contact_email))) codes.push("disposable_email");
    const zip = String(m.postal_code || "").trim();
    if (!zip) codes.push("zip_missing");
    else if (!PILOT_ZIP.test(zip)) codes.push("zip_outside_pilot");
    if (m.address_line && !/\d/.test(m.address_line)) codes.push("address_no_number");
    if (PLACEHOLDER_NAME.test(String(m.business_name || "").trim())) codes.push("placeholder_name");

    const samePhone = others(byPhone, norm(m.contact_phone), m);
    const sameAddress = others(byAddress, addressKey(m), m);
    const sameEmail = others(byEmail, norm(m.contact_email), m);
    if (samePhone.length) codes.push("shared_phone");
    if (sameAddress.length) codes.push("shared_address");
    if ([...samePhone, ...sameEmail].some((o) => o.status === "rejected")) codes.push("previously_rejected");
    const near = (o) => Math.abs(time(o) - time(m)) <= REPEAT_WINDOW_MS;
    if ([...samePhone, ...sameEmail, ...sameAddress].some(near)) codes.push("rapid_repeat");

    result[m.id] = codes.map((code) => ({ code, label: LABELS[code] }));
  }
  return result;
}

module.exports = { screenMerchants, LABELS, DISPOSABLE_EMAIL_DOMAINS };
