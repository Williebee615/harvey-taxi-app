// Merchant portal, phase 2: catalog item validation, excluded-item
// screening and CSV import parsing. Pure functions; server.js owns the
// database reads and writes.
//
// Screening (merchant term 3) never rejects an item. An item whose text
// suggests an excluded category is held for staff review, and staff decide
// (docs/agent-action-rules.md, rule 7). Matching is by whole words, so
// "ginger ale" isn't "gin"; false alarms (for example "rum cake") are
// expected and are what the review is for.

const MAX_ITEMS_PER_STORE = 1000;
const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_BYTES = 200 * 1024;

const EXCLUDED_PATTERNS = Object.freeze([
  { code: "alcohol", label: "Alcohol", re: /\b(alcohol(ic)?|beer|lager|ipa|stout|wine|champagne|prosecco|liquor|vodka|whiske?y|bourbon|rum|tequila|mezcal|gin|brandy|cognac|sake|hard seltzer|hard cider)s?\b/i },
  { code: "tobacco_vape", label: "Tobacco or vape", re: /\b(tobacco|cigarettes?|cigars?|cigarillos?|vapes?|vaping|e-?cig(arette)?s?|juul|nicotine|hookah|snus)\b/i },
  { code: "cannabis_hemp_cbd", label: "Cannabis, hemp or CBD", re: /\b(cbd|thc|hemp|cannabis|marijuana|weed|delta[- ]?[89]|kratom)\b/i },
  { code: "prescription", label: "Prescription medicine", re: /\b(prescription|rx[- ]only|rx)\b/i },
  { code: "weapons", label: "Weapons or ammunition", re: /\b(guns?|firearms?|pistols?|rifles?|ammo|ammunition|bullets?|pepper spray|stun guns?|tasers?)\b/i },
  { code: "gift_cards_lottery", label: "Gift card, prepaid card or lottery", re: /\b(gift ?cards?|prepaid cards?|visa cards?|lottery|lotto|scratch[- ]?offs?|powerball)\b/i },
  { code: "hazardous", label: "Hazardous material", re: /\b(propane|lighter fluid|gasoline|kerosene|fireworks?|butane)\b/i },
  { code: "live_animals", label: "Live animal", re: /\blive (animals?|fish|pets?|birds?|chickens?)\b/i }
]);

const clean = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

// "$4.99", "4.99", "4" -> 499. Returns null if it isn't a price.
function parsePriceToCents(raw) {
  if (typeof raw === "number") raw = String(raw);
  const s = String(raw || "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function screenItem({ name, section, description }) {
  const text = [name, section, description].filter(Boolean).join(" ");
  return EXCLUDED_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.code);
}

const LABELS = Object.freeze(Object.fromEntries(EXCLUDED_PATTERNS.map((p) => [p.code, p.label])));

// body: { name, section, description, price (dollars) or price_cents, available, substitutable }
// partial: only the fields present are checked (for edits).
// Returns { ok: true, value } or { ok: false, error }.
function validateItem(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has("name")) {
    const name = clean(body.name, 120);
    if (name.length < 2) return { ok: false, error: "Enter the item name." };
    out.name = name;
  }
  if (has("section") && body.section !== undefined) out.section = clean(body.section, 60) || null;
  if (has("description") && body.description !== undefined) out.description = clean(body.description, 500) || null;
  if (has("price") || has("price_cents")) {
    const cents = body.price_cents !== undefined ? body.price_cents : parsePriceToCents(body.price);
    if (!Number.isInteger(cents) || cents < 1 || cents > 100000) return { ok: false, error: "Enter a price between $0.01 and $1,000.00." };
    out.price_cents = cents;
  }
  if (body.available !== undefined) out.available = body.available === true;
  if (body.substitutable !== undefined) out.substitutable = body.substitutable === true;
  if (!partial) {
    if (out.available === undefined) out.available = true;
    if (out.substitutable === undefined) out.substitutable = false;
  }
  return { ok: true, value: out };
}

// Review state after a create or an edit that changes the text: flagged
// text is held; clean text is listed. Staff decisions are kept unless the
// text changes (an edit re-screens it).
function reviewStateFor(flags) {
  return flags.length ? { review_status: "held", review_flags: flags } : { review_status: "listed", review_flags: [] };
}

// Minimal RFC 4180 CSV parser: commas, double quotes, "" escapes, CRLF/LF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const YES = /^(y|yes|true|1)$/i;
const NO = /^(n|no|false|0)$/i;

// CSV with a header row. Columns (any order; name and price required):
// name, price, section, description, available, substitutable.
// Returns { ok: false, error } for a file-level problem, or
// { ok: true, items: [{ line, value }], errors: [{ line, error }] }.
function parseCatalogCsv(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "The file is empty." };
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) return { ok: false, error: "The file is too large (200 KB maximum)." };
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) return { ok: false, error: "Add a header row and at least one item." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col("name") < 0 || col("price") < 0) return { ok: false, error: "The header row needs at least \"name\" and \"price\" columns." };
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: `Import at most ${MAX_IMPORT_ROWS} items at a time.` };
  const items = [];
  const errors = [];
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name) => (col(name) >= 0 ? String(r[col(name)] || "").trim() : undefined);
    const flag = (name, dflt) => {
      const v = get(name);
      if (v === undefined || v === "") return dflt;
      if (YES.test(v)) return true;
      if (NO.test(v)) return false;
      return null;
    };
    const available = flag("available", true);
    const substitutable = flag("substitutable", false);
    if (available === null || substitutable === null) return errors.push({ line, error: "\"available\" and \"substitutable\" must be yes or no." });
    const checked = validateItem({ name: get("name"), price: get("price"), section: get("section"), description: get("description"), available, substitutable });
    if (!checked.ok) return errors.push({ line, error: checked.error });
    const key = checked.value.name.toLowerCase();
    if (seen.has(key)) return errors.push({ line, error: `"${checked.value.name}" appears more than once.` });
    seen.add(key);
    return items.push({ line, value: checked.value });
  });
  return { ok: true, items, errors };
}

module.exports = {
  MAX_ITEMS_PER_STORE,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
  EXCLUDED_PATTERNS,
  LABELS,
  parsePriceToCents,
  screenItem,
  validateItem,
  reviewStateFor,
  parseCsv,
  parseCatalogCsv
};
