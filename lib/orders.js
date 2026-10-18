// Merchant portal, phase 3a: order rules. Pure functions; server.js owns
// the database and Stripe calls. Design: docs/merchant-portal-phase3-orders.md
// (owner decisions D1-D7, 2026-10-18).
//
// Money is whole cents. Commission and the grocery buffer come from
// lib/refundEngine.js so there is one copy of each rule.

const { itemAuthorizationCents, substitutionOutcome, commission, payoutWeek, COMMISSION_RATE } = require("./refundEngine");

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
  // Step 3c-3: the delivery trip moves the order on: the driver picks it
  // up (only once ready), hands it over, and the card is charged.
  system: { pending_payment: ["placed", "payment_abandoned"], placed: ["expired"], ready: ["picked_up"], picked_up: ["delivered"], delivered: ["completed"] },
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

// Step 3c-2: the store settles each item while preparing (term 5; owner
// decision 2026-10-18). fulfilment is the item's only status:
//   pending -> packed | refunded | substituted, or out_of_stock while a
//   "Contact me first" rider decides (then substituted or refunded).
// "refunded" here means "not charged": capture (3c-3) leaves it out.
const SUBSTITUTION_WAIT_MS = 7 * 60 * 1000; // matches refundEngine SUBSTITUTION_TIMEOUT_MS
const ITEM_ACTIONS = Object.freeze(["packed", "out_of_stock", "substitute"]);

// What the order would cost now, with each item as it stands. An item
// waiting on the rider counts at its substitute's price (the most it can
// cost), so a store can't offer a substitute the hold doesn't cover.
function finalTotals(order, items) {
  const lines = (items || []).map((i) => {
    let unit = 0;
    if (i.fulfilment === "pending" || i.fulfilment === "packed") unit = i.unit_price_cents;
    else if (i.fulfilment === "substituted" || i.fulfilment === "out_of_stock") unit = i.substitute_price_cents || 0;
    const lineCents = unit * i.quantity;
    return { id: i.id, line_cents: lineCents, tax_cents: taxOn(lineCents, order.tax_rate_bps || 0) };
  });
  const itemsCents = lines.reduce((s, l) => s + l.line_cents, 0);
  const taxCents = lines.reduce((s, l) => s + l.tax_cents, 0);
  return { items_cents: itemsCents, tax_cents: taxCents, total_cents: itemsCents + taxCents + (order.delivery_fee_cents || 0) + (order.tip_cents || 0) };
}

// One store action on one item. Returns { ok, patch } (columns to set,
// applied only while the item is still pending) or { ok: false, status, error }.
function planItemAction({ order, items, itemId, action, substituteName, substitutePriceCents, now = new Date() }) {
  if (!order || order.status !== "accepted") return { ok: false, status: 409, error: "Items can be marked only while the order is being prepared." };
  if (!ITEM_ACTIONS.includes(action)) return { ok: false, status: 400, error: "Unknown item action." };
  const item = (items || []).find((i) => i.id === itemId);
  if (!item) return { ok: false, status: 404, error: "Item not found." };
  if (item.fulfilment !== "pending") return { ok: false, status: 409, error: `${item.name} is already marked.` };
  if (action === "packed") return { ok: true, patch: { fulfilment: "packed" } };
  // Out of stock with no substitute: refund it, whatever the rider chose.
  if (action === "out_of_stock") return { ok: true, patch: { fulfilment: "refunded" } };

  if (item.substitution_choice === "refund") return { ok: false, status: 409, error: `The customer asked for ${item.name} to be refunded if it's out of stock.` };
  const name = String(substituteName || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return { ok: false, status: 400, error: "Name the substitute (2 to 120 characters)." };
  const price = Number(substitutePriceCents);
  if (!Number.isInteger(price) || price < 1 || price > 100000) return { ok: false, status: 400, error: "Enter the substitute's price, from $0.01 to $1,000." };
  const trial = (items || []).map((i) => (i.id === item.id ? { ...i, fulfilment: "substituted", substitute_price_cents: price } : i));
  if (finalTotals(order, trial).total_cents > order.authorized_cents) {
    return { ok: false, status: 409, error: `That substitute would cost more than the customer's card hold allows. Mark ${item.name} out of stock instead, or choose a cheaper substitute.` };
  }
  if (item.substitution_choice === "best_match") return { ok: true, patch: { fulfilment: "substituted", substitute_name: name, substitute_price_cents: price } };
  // "Contact me first": the rider decides in the app within 7 minutes.
  const asked = new Date(now);
  return {
    ok: true,
    patch: { fulfilment: "out_of_stock", substitute_name: name, substitute_price_cents: price, substitution_asked_at: asked.toISOString(), substitution_expires_at: new Date(asked.getTime() + SUBSTITUTION_WAIT_MS).toISOString() }
  };
}

// The rider's answer to a "Contact me first" question, or the 7-minute
// default. Returns the patch to apply while the item is still out_of_stock,
// or null if it is still waiting (or already settled).
function settleQuestion(item, { answer = null, now = new Date() } = {}) {
  if (!item || item.fulfilment !== "out_of_stock" || !item.substitution_asked_at) return null;
  const at = new Date(now);
  if (answer) {
    if (!["substitute", "refund"].includes(answer)) return null;
    const outcome = substitutionOutcome({ askedAt: item.substitution_asked_at, answeredAt: at.toISOString(), answer, now: at });
    if (outcome === "waiting") return null;
    if (outcome === "substitute") return { fulfilment: "substituted", substitution_answer: "substitute", substitution_answered_at: at.toISOString() };
    if (answer === "refund") return { fulfilment: "refunded", substitution_answer: "refund", substitution_answered_at: at.toISOString() };
    // Too late to accept: the 7 minutes ran out, so the item is refunded (term 5).
    return { fulfilment: "refunded" };
  }
  return substitutionOutcome({ askedAt: item.substitution_asked_at, now: at }) === "refund" ? { fulfilment: "refunded" } : null;
}

// The store can mark an order ready only once every item is settled.
function readyBlockers(items) {
  return (items || []).filter((i) => i.fulfilment === "pending" || i.fulfilment === "out_of_stock").map((i) => i.name);
}

// Step 3c-3: the delivery trip created when the store accepts. The order
// holds the only card authorization (D4), so the trip has no payment of
// its own (payment_status not_required: ride capture skips it). The
// driver earns the usual share of the delivery fee plus the whole tip
// (owner decision 2026-10-18: 70% via DRIVER_PAYOUT_PERCENT, 100% of tip).
function orderTripFields({ order, store, riderName, riderPhone, items, driverPayoutPercent, deliveryPin, now = new Date() }) {
  const fee = order.delivery_fee_cents / 100;
  const driverPayout = Math.round(order.delivery_fee_cents * driverPayoutPercent) / 100;
  const count = (items || []).reduce((n, i) => n + (i.quantity || 0), 0);
  const at = new Date(now).toISOString();
  return {
    rider_id: order.rider_id,
    rider_name: riderName || null,
    rider_phone: riderPhone || null,
    pickup_address: [store.business_name, store.address_line, store.city].filter(Boolean).join(", "),
    dropoff_address: order.dropoff_address || null,
    pickup_lat: store.pickup_lat,
    pickup_lng: store.pickup_lng,
    dropoff_lat: order.dropoff_lat,
    dropoff_lng: order.dropoff_lng,
    ride_type: order.order_type,
    payment_id: null,
    payment_status: "not_required",
    estimated_fare: fee,
    driver_payout: driverPayout,
    estimated_platform_fee: Math.round((fee - driverPayout) * 100) / 100,
    tip_amount: order.tip_cents ? order.tip_cents / 100 : null,
    merchant_name: store.business_name,
    item_count: count || null,
    pickup_instructions: `Harvey Taxi order ${order.order_number}. Wait for the store to mark it ready.`,
    delivery_pin: deliveryPin,
    delivery_stage: "order_accepted",
    delivery_handoff: "hand_to_customer",
    created_at: at,
    updated_at: at
  };
}

// Dispatch timing (owner decision 2026-10-18): the trip is offered to
// drivers 10 minutes before the store's prep time is up, or as soon as the
// store marks the order ready, whichever is first. Returns the time to
// hold the offer until, or null to offer it now. (Phase 4 can use the
// driver's ETA instead of a fixed lead.)
const ORDER_DISPATCH_LEAD_MINUTES = 10;
function orderDispatchAt(order, now = new Date()) {
  if (!order || order.status !== "accepted" || !order.accepted_at || !order.prep_minutes) return null;
  const at = Date.parse(order.accepted_at) + (order.prep_minutes - ORDER_DISPATCH_LEAD_MINUTES) * 60000;
  return Number.isFinite(at) && at > new Date(now).getTime() ? new Date(at).toISOString() : null;
}

// What to charge at delivery: the delivered items, their tax, the fee and
// the tip, never more than the authorization (D7, §5.3).
function captureAmountCents(order, items) {
  return Math.min(finalTotals(order, items).total_cents, order.authorized_cents);
}

// The completed order's split and its store-ledger credit (term 1: 12% of
// the item subtotal only; term 7: Monday payout weeks, Nashville time).
function completionSplit(order, items, at = new Date()) {
  const t = finalTotals(order, items);
  const commissionCents = commission({ itemSubtotalCents: t.items_cents, status: "completed" });
  const week = payoutWeek(new Date(at).toISOString()).week_start;
  return {
    commission_cents: commissionCents,
    merchant_share_cents: t.items_cents - commissionCents,
    payout_week_start: week,
    ledger: {
      merchant_id: order.merchant_id,
      order_id: order.id,
      market: order.market || "nashville",
      entry_type: "order_credit",
      payout_week_start: week,
      items_cents: t.items_cents,
      tax_cents: t.tax_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      tip_cents: order.tip_cents,
      commission_rate_bps: Math.round(COMMISSION_RATE * 10000),
      commission_cents: commissionCents,
      store_amount_cents: t.items_cents - commissionCents,
      livemode: Boolean(order.livemode),
      created_by: "system:order_capture"
    }
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
    items: (items || []).map((i) => itemView(i))
  };
}

// The item fields the store and the rider both see.
function itemView(i) {
  return {
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    unit_price_cents: i.unit_price_cents,
    substitution_choice: i.substitution_choice,
    fulfilment: i.fulfilment || "pending",
    substitute_name: i.substitute_name || null,
    substitute_price_cents: i.substitute_price_cents || null,
    answer_by: i.fulfilment === "out_of_stock" ? i.substitution_expires_at || null : null
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
// Longest delivery the fee estimate will quote, by road from the store's
// pin (step 3b part 2; a recommendation until the owner sets the area).
const MAX_DELIVERY_MILES = 15;

module.exports = {
  distanceMeters,
  PICKUP_TOLERANCE_M,
  MAX_DELIVERY_MILES,
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
  storeView,
  itemView,
  SUBSTITUTION_WAIT_MS,
  ITEM_ACTIONS,
  finalTotals,
  planItemAction,
  settleQuestion,
  readyBlockers,
  orderTripFields,
  ORDER_DISPATCH_LEAD_MINUTES,
  orderDispatchAt,
  captureAmountCents,
  completionSplit
};
