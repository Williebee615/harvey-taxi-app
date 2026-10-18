// Merchant portal, phase 3a: order rules. Pure functions; server.js owns
// the database and Stripe calls. Design: docs/merchant-portal-phase3-orders.md
// (owner decisions D1-D7, 2026-10-18).
//
// Money is whole cents. Commission and the grocery buffer come from
// lib/refundEngine.js so there is one copy of each rule.

const { itemAuthorizationCents } = require("./refundEngine");

const STORE_RESPONSE_MS = 8 * 60 * 1000; // D1: a store has 8 minutes to accept
const PAYMENT_WINDOW_MS = 15 * 60 * 1000; // unconfirmed card authorizations are abandoned after 15 minutes
const PREP_MINUTES = Object.freeze({ min: 5, max: 90 });
const MAX_LINES = 50;
const MAX_QUANTITY = 20;
const MAX_TIP_CENTS = 50000; // the same $500 cap rides use
const SUBSTITUTION_CHOICES = Object.freeze(["contact", "best_match", "refund"]);

const STATUSES = Object.freeze([
  "pending_payment",
  "placed",
  "accepted",
  "ready",
  "picked_up",
  "delivered",
  "completed",
  "rejected",
  "expired",
  "payment_abandoned",
  "cancelled_by_rider",
  "cancelled_by_store",
  "cancelled_by_staff"
]);

// Who may move an order from which state to which. Pickup, delivery and
// completion arrive with the driver integration (3c / phase 4).
const TRANSITIONS = Object.freeze({
  system: { pending_payment: ["placed", "payment_abandoned"], placed: ["expired"] },
  // D2: free until the store marks the order ready; after that, support.
  rider: { pending_payment: ["cancelled_by_rider"], placed: ["cancelled_by_rider"], accepted: ["cancelled_by_rider"] },
  merchant: { placed: ["accepted", "rejected"], accepted: ["ready", "cancelled_by_store"], ready: ["cancelled_by_store"] },
  admin: {
    pending_payment: ["cancelled_by_staff"],
    placed: ["cancelled_by_staff"],
    accepted: ["cancelled_by_staff"],
    ready: ["cancelled_by_staff"]
  }
});

// Ending in one of these releases the card authorization in full.
const RELEASES_AUTHORIZATION = Object.freeze(["rejected", "expired", "payment_abandoned", "cancelled_by_rider", "cancelled_by_store", "cancelled_by_staff"]);
const NEEDS_REASON = Object.freeze(["rejected", "cancelled_by_store", "cancelled_by_staff"]);
const OPEN = Object.freeze(["pending_payment", "placed", "accepted", "ready", "picked_up", "delivered"]);

function canTransition(actor, from, to) {
  return Boolean(TRANSITIONS[actor] && (TRANSITIONS[actor][from] || []).includes(to));
}

// Restaurants are food orders; grocery and convenience stores are grocery
// orders, which carry the 15% authorization buffer (term 5).
function orderTypeFor(merchantCategory) {
  return merchantCategory === "restaurant" ? "food" : "grocery";
}

const isCents = (n) => Number.isSafeInteger(n) && n >= 0;
const taxOn = (cents, rateBps) => Math.round((cents * rateBps) / 10000);

// cart: [{ catalog_item_id, quantity, substitution_choice }] from the rider.
// catalogById: Map of the store's live catalog rows. Prices, names and
// availability always come from the catalog, never from the cart.
// Returns { ok, lines } or { ok: false, error }.
function buildLines(cart, catalogById) {
  if (!Array.isArray(cart) || cart.length === 0) return { ok: false, error: "Your cart is empty." };
  if (cart.length > MAX_LINES) return { ok: false, error: `An order can have up to ${MAX_LINES} different items.` };
  const seen = new Set();
  const lines = [];
  for (const entry of cart) {
    const id = entry && typeof entry.catalog_item_id === "string" ? entry.catalog_item_id : "";
    const item = catalogById.get(id);
    if (!item || item.review_status !== "listed" || item.archived_at) return { ok: false, error: "An item in your cart is no longer available. Please review your cart." };
    if (!item.available) return { ok: false, error: `${item.name} is out of stock.` };
    if (seen.has(id)) return { ok: false, error: `${item.name} appears twice in your cart.` };
    seen.add(id);
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, error: `Choose a quantity from 1 to ${MAX_QUANTITY} for ${item.name}.` };
    // Only items the store marked substitutable offer a choice; others are
    // refunded if out of stock (term 5).
    const choice = item.substitutable && SUBSTITUTION_CHOICES.includes(entry.substitution_choice) ? entry.substitution_choice : "refund";
    lines.push({ catalog_item_id: id, name: item.name, unit_price_cents: item.price_cents, quantity, substitution_choice: choice });
  }
  return { ok: true, lines };
}

// Totals for checkout. taxRateBps is a placeholder until the accountant's
// advice (design §8). Grocery authorizes items + 15% (and tax on that) so
// substitutions and weights fit; only the final amount is captured (D7).
function computeTotals({ lines, orderType, taxRateBps, deliveryFeeCents, tipCents }) {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 2000) throw new Error("taxRateBps must be 0-2000");
  if (!isCents(deliveryFeeCents)) throw new Error("deliveryFeeCents must be whole, non-negative cents");
  if (!isCents(tipCents) || tipCents > MAX_TIP_CENTS) throw new Error("tipCents out of range");
  const withTax = lines.map((l) => {
    const lineCents = l.unit_price_cents * l.quantity;
    return { ...l, line_cents: lineCents, tax_cents: taxOn(lineCents, taxRateBps) };
  });
  const itemsSubtotalCents = withTax.reduce((s, l) => s + l.line_cents, 0);
  const taxCents = withTax.reduce((s, l) => s + l.tax_cents, 0);
  const authorizedItems = itemAuthorizationCents({ itemSubtotalCents: itemsSubtotalCents, category: orderType });
  const authorizedTax = taxOn(authorizedItems, taxRateBps);
  return {
    lines: withTax,
    items_subtotal_cents: itemsSubtotalCents,
    tax_cents: taxCents,
    delivery_fee_cents: deliveryFeeCents,
    tip_cents: tipCents,
    total_cents: itemsSubtotalCents + taxCents + deliveryFeeCents + tipCents,
    authorized_cents: authorizedItems + Math.max(authorizedTax, taxCents) + deliveryFeeCents + tipCents
  };
}

function validPrepMinutes(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= PREP_MINUTES.min && n <= PREP_MINUTES.max ? n : null;
}

// HT-XXXXXX: short, readable, no easily confused characters.
const NUMBER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function orderNumber(randomBytes) {
  let s = "";
  for (let i = 0; i < 6; i += 1) s += NUMBER_ALPHABET[randomBytes[i] % NUMBER_ALPHABET.length];
  return `HT-${s}`;
}

// Which open orders a sweep should close, given now.
function sweepAction(order, now = Date.now()) {
  const created = Date.parse(order.created_at);
  const placed = Date.parse(order.placed_at || order.created_at);
  if (order.status === "pending_payment" && now - created >= PAYMENT_WINDOW_MS) return "payment_abandoned";
  if (order.status === "placed" && now - placed >= STORE_RESPONSE_MS) return "expired";
  return null;
}

// What the store may see: first name only; no address, phone or email
// (design §6, §10).
function storeView(order, items, riderFirstName) {
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    rider_first_name: riderFirstName || "Customer",
    rider_notes: order.rider_notes || null,
    prep_minutes: order.prep_minutes,
    placed_at: order.placed_at,
    accepted_at: order.accepted_at,
    ready_at: order.ready_at,
    respond_by: order.status === "placed" ? new Date(Date.parse(order.placed_at || order.created_at) + STORE_RESPONSE_MS).toISOString() : null,
    items_subtotal_cents: order.items_subtotal_cents,
    items: (items || []).map((i) => ({ name: i.name, quantity: i.quantity, unit_price_cents: i.unit_price_cents, substitution_choice: i.substitution_choice }))
  };
}

// Is the store open at `at` (Nashville time)? hours: merchant_hours rows
// (day_of_week 0 = Sunday, opens_at/closes_at "HH:MM[:SS]", closed). A
// store that hasn't saved hours for that day is treated as closed.
const NASHVILLE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function isOpenAt(hours, at = new Date()) {
  const parts = Object.fromEntries(NASHVILLE.formatToParts(at).map((p) => [p.type, p.value]));
  const day = WEEKDAYS.indexOf(parts.weekday);
  const now = `${parts.hour}:${parts.minute}`;
  const today = (hours || []).find((h) => Number(h.day_of_week) === day);
  if (!today || today.closed || !today.opens_at || !today.closes_at) return false;
  return now >= String(today.opens_at).slice(0, 5) && now < String(today.closes_at).slice(0, 5);
}

// Great-circle distance in metres, for checking that a delivery-fee quote
// starts at the store's pickup pin.
function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const PICKUP_TOLERANCE_M = 150;

module.exports = {
  distanceMeters,
  PICKUP_TOLERANCE_M,
  isOpenAt,
  STORE_RESPONSE_MS,
  PAYMENT_WINDOW_MS,
  PREP_MINUTES,
  MAX_LINES,
  MAX_QUANTITY,
  MAX_TIP_CENTS,
  SUBSTITUTION_CHOICES,
  STATUSES,
  TRANSITIONS,
  RELEASES_AUTHORIZATION,
  NEEDS_REASON,
  OPEN,
  canTransition,
  orderTypeFor,
  buildLines,
  computeTotals,
  validPrepMinutes,
  orderNumber,
  sweepAction,
  storeView
};
