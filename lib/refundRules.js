// Delivery money rules: missing-item refunds, merchant disputes, payout
// weeks, commission and grocery substitution holds. Merchant terms are the
// owner decisions of 2026-10-17 (docs/merchant-portal-plan.md section 4).
//
// Pure functions with whole cents. Nothing here calls Stripe or the
// database. Under docs/agent-action-rules.md rule 8, a refund this module
// plans is only a proposal ("stage_refund"); a person approves it before
// any money moves. Orders arrive in phase 3, which will call these
// functions.

const COMMISSION_RATE = 0.12; // term 1: 12% of the item subtotal, completed orders only
const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000; // term 4: 48-hour merchant dispute window
const GROCERY_AUTH_BUFFER = 0.15; // term 5: grocery authorization buffer
const SUBSTITUTION_TIMEOUT_MS = 7 * 60 * 1000; // term 5: no answer in 7 minutes -> refund the item
const PAYOUT_TIME_ZONE = "America/Chicago"; // term 7: Monday-to-Sunday weeks, Nashville time

const cents = (n) => Math.round(Number(n) || 0);
const isCents = (n) => Number.isSafeInteger(n) && n >= 0;

// Term 1. Commission is 12% of the item subtotal, before tax, excluding tip
// and delivery fee, and only for completed orders.
function commission({ itemSubtotalCents, status }) {
  if (!isCents(itemSubtotalCents)) throw new Error("itemSubtotalCents must be whole, non-negative cents");
  return status === "completed" ? cents(itemSubtotalCents * COMMISSION_RATE) : 0;
}

// Term 5. Grocery orders authorize the item subtotal plus 15%; other orders
// authorize the subtotal. Tax, fees and tip are added by the caller.
function itemAuthorizationCents({ itemSubtotalCents, category }) {
  if (!isCents(itemSubtotalCents)) throw new Error("itemSubtotalCents must be whole, non-negative cents");
  return category === "grocery" ? cents(itemSubtotalCents * (1 + GROCERY_AUTH_BUFFER)) : itemSubtotalCents;
}

// Term 5. A substitution question the customer hasn't answered within 7
// minutes resolves to a refund of that item.
function substitutionOutcome({ askedAt, answeredAt = null, answer = null, now = new Date() }) {
  const asked = Date.parse(askedAt);
  if (!Number.isFinite(asked)) throw new Error("askedAt must be a date");
  const answered = answeredAt ? Date.parse(answeredAt) : null;
  if (answered !== null && answered - asked <= SUBSTITUTION_TIMEOUT_MS && ["substitute", "refund"].includes(answer)) return answer;
  return new Date(now).getTime() - asked >= SUBSTITUTION_TIMEOUT_MS ? "refund" : "waiting";
}

// Term 4. Plans a missing-item refund for one claim.
//   order: { id, status, tax_rate (e.g. 0.0925), items: [{ id, unit_price_cents, quantity, refunded_quantity }] }
//   claim: [{ item_id, quantity }]
//   customerClaimsThisMonth: earlier missing-item claims by this customer this calendar month
//   abuseLimit: claims per customer per month before manual review (owner to set; null -> always review)
// Returns { decision: "stage_refund" | "manual_review" | "refuse", reasons, lines, refund_cents, ... }.
// "stage_refund" is a proposal for a person to approve, never a payment.
function planMissingItemRefund({ order, claim, customerClaimsThisMonth = 0, abuseLimit = null }) {
  const reasons = [];
  const refuse = (reason) => ({ decision: "refuse", reasons: [reason], lines: [], refund_cents: 0, item_cents: 0, tax_cents: 0, merchant_deduction_cents: 0, commission_reversed_cents: 0 });
  if (!order || !Array.isArray(order.items)) return refuse("order_not_found");
  if (order.status !== "completed") return refuse("order_not_completed");
  if (!Array.isArray(claim) || !claim.length) return refuse("no_items_claimed");

  const byId = new Map(order.items.map((i) => [i.id, i]));
  const wanted = new Map();
  for (const c of claim) {
    const qty = Number(c && c.quantity);
    if (!byId.has(c && c.item_id)) return refuse("item_not_in_order");
    if (!Number.isSafeInteger(qty) || qty < 1) return refuse("invalid_quantity");
    wanted.set(c.item_id, (wanted.get(c.item_id) || 0) + qty);
  }

  const lines = [];
  for (const [itemId, qty] of wanted) {
    const item = byId.get(itemId);
    if (!isCents(item.unit_price_cents)) return refuse("invalid_item_price");
    const left = (item.quantity || 0) - (item.refunded_quantity || 0);
    if (qty > left) return refuse("quantity_exceeds_unrefunded");
    lines.push({ item_id: itemId, quantity: qty, item_cents: item.unit_price_cents * qty });
  }

  const itemCents = lines.reduce((s, l) => s + l.item_cents, 0);
  const rate = Number(order.tax_rate) || 0;
  if (rate < 0 || rate > 0.2) return refuse("invalid_tax_rate");
  const taxCents = cents(itemCents * rate);

  // Abuse limit: above it, a person reviews before anything is staged.
  if (abuseLimit === null || abuseLimit === undefined) reasons.push("abuse_limit_not_set");
  else if (customerClaimsThisMonth >= abuseLimit) reasons.push("over_monthly_claim_limit");

  return {
    decision: reasons.length ? "manual_review" : "stage_refund",
    reasons,
    lines,
    item_cents: itemCents,
    tax_cents: taxCents,
    // The customer gets the items and their sales tax back. The tip and the
    // delivery fee are not part of a missing-item refund.
    refund_cents: itemCents + taxCents,
    // The merchant gives back what it was paid for those items (the price
    // less the 12% commission), and Harvey Taxi gives up its commission on
    // them, consistent with term 1 (a fully refunded order pays nothing).
    // Unless the merchant wins a dispute. Who bears the refunded sales tax
    // waits on the accountant's marketplace-facilitator answer.
    merchant_deduction_cents: itemCents - cents(itemCents * COMMISSION_RATE),
    commission_reversed_cents: cents(itemCents * COMMISSION_RATE)
  };
}

// Term 4. Where a refund's merchant deduction stands.
//   notifiedAt: when the merchant was told about the claim (starts its 48 hours)
//   dispute: null, or { filedAt, outcome: "pending" | "merchant_wins" | "merchant_loses", decidedAt }
// Returns { state, deduction_cents, absorbed_by_harvey_cents, confirmed_at }.
function merchantDeductionStatus({ deductionCents, notifiedAt, dispute = null, now = new Date() }) {
  if (!isCents(deductionCents)) throw new Error("deductionCents must be whole, non-negative cents");
  const notified = Date.parse(notifiedAt);
  if (!Number.isFinite(notified)) throw new Error("notifiedAt must be a date");
  const windowEnds = notified + DISPUTE_WINDOW_MS;
  const nowMs = new Date(now).getTime();
  const filed = dispute && dispute.filedAt ? Date.parse(dispute.filedAt) : null;
  const disputeCounts = filed !== null && Number.isFinite(filed) && filed <= windowEnds;

  if (disputeCounts) {
    if (dispute.outcome === "merchant_wins") return { state: "merchant_won", deduction_cents: 0, absorbed_by_harvey_cents: deductionCents, confirmed_at: dispute.decidedAt || null };
    if (dispute.outcome === "merchant_loses") return { state: "deduct", deduction_cents: deductionCents, absorbed_by_harvey_cents: 0, confirmed_at: dispute.decidedAt || null };
    return { state: "disputed", deduction_cents: 0, absorbed_by_harvey_cents: 0, confirmed_at: null };
  }
  if (nowMs < windowEnds) return { state: "dispute_window_open", deduction_cents: 0, absorbed_by_harvey_cents: 0, confirmed_at: null };
  return { state: "deduct", deduction_cents: deductionCents, absorbed_by_harvey_cents: 0, confirmed_at: new Date(windowEnds).toISOString() };
}

// Nashville-time calendar date (YYYY-MM-DD) and weekday (0 = Sunday).
function localDay(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: PAYOUT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday };
}
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Term 7. The Monday-to-Sunday week (Nashville time) an event falls in, and
// the Monday its payout is sent. A completed order is paid in the payout for
// its completion week; a confirmed deduction comes off the payout for the
// week it was confirmed in, so a late-Sunday claim confirmed on Tuesday
// comes off the next payout (merchant agreement clause, owner decision
// 2026-10-17).
function payoutWeek(date) {
  if (!Number.isFinite(Date.parse(date))) throw new Error("date must be a date");
  const { ymd, weekday } = localDay(date);
  const weekStart = addDays(ymd, -((weekday + 6) % 7));
  return { week_start: weekStart, week_end: addDays(weekStart, 6), payout_date: addDays(weekStart, 7) };
}

module.exports = {
  COMMISSION_RATE,
  DISPUTE_WINDOW_MS,
  GROCERY_AUTH_BUFFER,
  SUBSTITUTION_TIMEOUT_MS,
  PAYOUT_TIME_ZONE,
  commission,
  itemAuthorizationCents,
  substitutionOutcome,
  planMissingItemRefund,
  merchantDeductionStatus,
  payoutWeek
};
