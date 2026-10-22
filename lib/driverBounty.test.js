const b = require("./driverBounty");

test("bounty amount from $3 to $15 in cents, with a reason", () => {
  expect(b.validateBounty({ amount_dollars: 8, reason: "Antioch, 6 min unmatched" })).toEqual({ ok: true, amount_cents: 800, reason: "Antioch, 6 min unmatched" });
  expect(b.validateBounty({ amount_dollars: 2.99, reason: "Hard to fill" }).ok).toBe(false);
  expect(b.validateBounty({ amount_dollars: 15.01, reason: "Hard to fill" }).ok).toBe(false);
  expect(b.validateBounty({ amount_dollars: 5.555, reason: "Hard to fill" }).ok).toBe(false);
  expect(b.validateBounty({ amount_dollars: 5, reason: "x" }).ok).toBe(false);
});

test("nothing can be proposed without a budget; the month's total must fit", () => {
  expect(b.withinBudget({ budgetCents: 0, proposedThisMonthCents: 0, amountCents: 300 })).toBe(false);
  expect(b.withinBudget({ budgetCents: 5000, proposedThisMonthCents: 4500, amountCents: 500 })).toBe(true);
  expect(b.withinBudget({ budgetCents: 5000, proposedThisMonthCents: 4600, amountCents: 500 })).toBe(false);
});
