// Driver bounty: extra pay on a hard-to-fill trip, chosen by staff
// (owner decision 2026-10-22: "Design it, switched off"). Riders' prices
// never change. In this version a bounty is only recorded as proposed:
// drivers don't see it and nothing is paid. Paying anything needs the
// owner's separate approval, a budget and driver terms.

const BOUNTY_FLAG = "driver_bounty_enabled";
const BOUNTY_BUDGET_KEY = "driver_bounty_monthly_budget_cents";
const MIN_BOUNTY_CENTS = 300;
const MAX_BOUNTY_CENTS = 1500;

function validateBounty(body = {}) {
  const dollars = Number(body.amount_dollars);
  const cents = Math.round(dollars * 100);
  const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (!Number.isFinite(dollars) || cents !== dollars * 100 || cents < MIN_BOUNTY_CENTS || cents > MAX_BOUNTY_CENTS) {
    return { ok: false, error: `Enter an amount from $${MIN_BOUNTY_CENTS / 100} to $${MAX_BOUNTY_CENTS / 100}.` };
  }
  if (reason.length < 5) return { ok: false, error: "Add a short reason (at least 5 characters)." };
  return { ok: true, amount_cents: cents, reason };
}

// The month's proposed total plus this one must fit the budget; with no
// budget set (0), nothing can be proposed.
function withinBudget({ budgetCents, proposedThisMonthCents, amountCents }) {
  const budget = Number(budgetCents) || 0;
  return budget > 0 && (Number(proposedThisMonthCents) || 0) + amountCents <= budget;
}

module.exports = { BOUNTY_FLAG, BOUNTY_BUDGET_KEY, MIN_BOUNTY_CENTS, MAX_BOUNTY_CENTS, validateBounty, withinBudget };
