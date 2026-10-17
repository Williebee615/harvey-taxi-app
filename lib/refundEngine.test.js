const r = require("./refundEngine");

const order = (over) => ({
  id: "O1", status: "completed", tax_rate: 0.0925, completed_at: "2026-10-17T18:00:00Z",
  items: [
    { id: "milk", unit_price_cents: 449, quantity: 2, refunded_quantity: 0 },
    { id: "bread", unit_price_cents: 399, quantity: 1, refunded_quantity: 0 }
  ],
  // The store's pickup photos show 1 of 2 milks and no bread packed.
  pickup_checklist: [
    { item_id: "milk", photo_id: "ph_milk", packed_quantity: 1 },
    { item_id: "bread", photo_id: "ph_bread", packed_quantity: 0 }
  ],
  ...over
});
// Claims default to two hours after completion.
const plan = (args) => r.planMissingItemRefund({ claimedAt: "2026-10-17T20:00:00Z", ...args });

describe("commission (term 1)", () => {
  test("12% of the item subtotal on completed orders only", () => {
    expect(r.commission({ itemSubtotalCents: 2500, status: "completed" })).toBe(300);
    expect(r.commission({ itemSubtotalCents: 2500, status: "cancelled" })).toBe(0);
    expect(() => r.commission({ itemSubtotalCents: 12.5, status: "completed" })).toThrow();
  });
});

describe("grocery authorization and substitutions (term 5)", () => {
  test("grocery holds the subtotal plus 15%; restaurants hold the subtotal", () => {
    expect(r.itemAuthorizationCents({ itemSubtotalCents: 4000, category: "grocery" })).toBe(4600);
    expect(r.itemAuthorizationCents({ itemSubtotalCents: 4000, category: "restaurant" })).toBe(4000);
  });
  test("an answer within 7 minutes counts; silence for 7 minutes refunds the item", () => {
    const askedAt = "2026-10-17T18:00:00Z";
    expect(r.substitutionOutcome({ askedAt, answeredAt: "2026-10-17T18:06:59Z", answer: "substitute" })).toBe("substitute");
    expect(r.substitutionOutcome({ askedAt, now: "2026-10-17T18:03:00Z" })).toBe("waiting");
    expect(r.substitutionOutcome({ askedAt, now: "2026-10-17T18:07:00Z" })).toBe("refund");
    expect(r.substitutionOutcome({ askedAt, answeredAt: "2026-10-17T18:08:00Z", answer: "substitute", now: "2026-10-17T18:08:00Z" })).toBe("refund");
  });
});

describe("missing-item refunds (term 4)", () => {
  test("items plus their sales tax; the merchant returns its share and Harvey Taxi gives up its commission", () => {
    const p = plan({ order: order(), claim: [{ item_id: "milk", quantity: 1 }], customerClaimsThisMonth: 0, abuseLimit: 3 });
    expect(p).toMatchObject({ decision: "stage_refund", item_cents: 449, tax_cents: 42, refund_cents: 491, merchant_deduction_cents: 395, commission_reversed_cents: 54 });
    expect(p.merchant_deduction_cents + p.commission_reversed_cents).toBe(p.item_cents);
  });
  test("repeated lines for one item are combined and can't exceed what's left unrefunded", () => {
    const o = order({ items: [{ id: "milk", unit_price_cents: 449, quantity: 2, refunded_quantity: 1 }] });
    expect(plan({ order: o, claim: [{ item_id: "milk", quantity: 1 }, { item_id: "milk", quantity: 1 }], abuseLimit: 3 }).reasons).toEqual(["quantity_exceeds_unrefunded"]);
  });
  test.each([
    [{ order: null, claim: [{ item_id: "milk", quantity: 1 }] }, "order_not_found"],
    [{ order: order({ status: "en_route" }), claim: [{ item_id: "milk", quantity: 1 }] }, "order_not_completed"],
    [{ order: order(), claim: [] }, "no_items_claimed"],
    [{ order: order(), claim: [{ item_id: "eggs", quantity: 1 }] }, "item_not_in_order"],
    [{ order: order(), claim: [{ item_id: "milk", quantity: 0 }] }, "invalid_quantity"],
    [{ order: order(), claim: [{ item_id: "milk", quantity: 1.5 }] }, "invalid_quantity"],
    [{ order: order({ tax_rate: 0.5 }), claim: [{ item_id: "milk", quantity: 1 }] }, "invalid_tax_rate"]
  ])("refuses bad claims (%#)", (args, reason) => {
    const p = plan({ abuseLimit: 3, ...args });
    expect(p).toMatchObject({ decision: "refuse", reasons: [reason], refund_cents: 0 });
  });
  test("over the monthly limit, or with no limit set, a person reviews first", () => {
    const claim = [{ item_id: "bread", quantity: 1 }];
    expect(plan({ order: order(), claim, customerClaimsThisMonth: 3, abuseLimit: 3 })).toMatchObject({ decision: "manual_review", reasons: ["over_monthly_claim_limit"], refund_cents: 436 });
    expect(plan({ order: order(), claim, abuseLimit: null })).toMatchObject({ decision: "manual_review", reasons: ["abuse_limit_not_set"] });
  });
  test("the engine never changes the order it is given", () => {
    const o = order();
    const before = JSON.stringify(o);
    plan({ order: o, claim: [{ item_id: "milk", quantity: 2 }], abuseLimit: 3 });
    expect(JSON.stringify(o)).toBe(before);
  });
});

describe("merchant disputes (term 4)", () => {
  const notifiedAt = "2026-10-17T12:00:00Z";
  test("within 48 hours nothing is deducted; after it, the deduction stands", () => {
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, now: "2026-10-19T11:59:00Z" })).toMatchObject({ state: "dispute_window_open", deduction_cents: 0 });
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, now: "2026-10-19T12:00:00Z" })).toMatchObject({ state: "deduct", deduction_cents: 395, confirmed_at: "2026-10-19T12:00:00.000Z" });
  });
  test("a dispute filed in time: pending deducts nothing; merchant wins -> Harvey Taxi absorbs; merchant loses -> deduction", () => {
    const filedAt = "2026-10-18T12:00:00Z";
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, dispute: { filedAt, outcome: "pending" }, now: "2026-10-25T00:00:00Z" })).toMatchObject({ state: "disputed", deduction_cents: 0 });
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, dispute: { filedAt, outcome: "merchant_wins", decidedAt: "2026-10-20T00:00:00Z" } })).toMatchObject({ state: "merchant_won", deduction_cents: 0, absorbed_by_harvey_cents: 395 });
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, dispute: { filedAt, outcome: "merchant_loses", decidedAt: "2026-10-20T00:00:00Z" } })).toMatchObject({ state: "deduct", deduction_cents: 395, confirmed_at: "2026-10-20T00:00:00Z" });
  });
  test("a dispute filed after 48 hours doesn't count", () => {
    expect(r.merchantDeductionStatus({ deductionCents: 395, notifiedAt, dispute: { filedAt: "2026-10-19T12:00:01Z", outcome: "merchant_wins" }, now: "2026-10-20T00:00:00Z" })).toMatchObject({ state: "deduct", deduction_cents: 395 });
  });
});

describe("payout weeks (term 7, Nashville time)", () => {
  test("Monday-to-Sunday weeks paid the following Monday", () => {
    // Sat 17 Oct 2026, 14:00 Central
    expect(r.payoutWeek("2026-10-17T19:00:00Z")).toEqual({ week_start: "2026-10-12", week_end: "2026-10-18", payout_date: "2026-10-19" });
  });
  test("late Sunday night in Nashville is still Sunday, though it is Monday in UTC", () => {
    // Sun 18 Oct 2026, 23:30 Central = Mon 19 Oct 04:30 UTC
    expect(r.payoutWeek("2026-10-19T04:30:00Z").payout_date).toBe("2026-10-19");
    // Mon 19 Oct 2026, 00:30 Central starts the next week
    expect(r.payoutWeek("2026-10-19T05:30:00Z").payout_date).toBe("2026-10-26");
  });
  test("a late-Sunday claim confirmed after Monday's payout comes off the next payout", () => {
    const status = r.merchantDeductionStatus({ deductionCents: 395, notifiedAt: "2026-10-19T04:00:00Z", now: "2026-10-22T00:00:00Z" });
    expect(r.payoutWeek(status.confirmed_at).payout_date).toBe("2026-10-26");
  });
  test("handles the daylight-saving change (1 Nov 2026)", () => {
    expect(r.payoutWeek("2026-11-02T05:30:00Z")).toMatchObject({ week_start: "2026-10-26", payout_date: "2026-11-02" });
    expect(r.payoutWeek("2026-11-02T06:30:00Z")).toMatchObject({ week_start: "2026-11-02", payout_date: "2026-11-09" });
  });
});

test("rule 8: the rules engine can't move money or write records itself", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "refundEngine.js"), "utf8");
  expect(src).not.toMatch(/require\(["'](stripe|@supabase\/supabase-js|node-fetch|axios)["']\)|\bfetch\(|\.refunds\.create|\.from\(/);
});

describe("claim window (owner decision: 48 hours from completion)", () => {
  test("a claim at 47:59 is accepted; at 48:01, or before completion, it is refused", () => {
    const claim = [{ item_id: "bread", quantity: 1 }];
    expect(plan({ order: order(), claim, abuseLimit: 3, claimedAt: "2026-10-19T17:59:00Z" }).decision).toBe("stage_refund");
    expect(plan({ order: order(), claim, abuseLimit: 3, claimedAt: "2026-10-19T18:01:00Z" })).toMatchObject({ decision: "refuse", reasons: ["claim_window_closed"] });
    expect(plan({ order: order(), claim, abuseLimit: 3, claimedAt: "2026-10-17T17:00:00Z" })).toMatchObject({ decision: "refuse", reasons: ["claim_before_completion"] });
    expect(plan({ order: order({ completed_at: null }), claim, abuseLimit: 3 })).toMatchObject({ decision: "refuse", reasons: ["missing_dates"] });
  });
});

describe("pickup checklist photos", () => {
  test("a claim the photos support is staged, citing the photo", () => {
    const p = plan({ order: order(), claim: [{ item_id: "milk", quantity: 1 }], abuseLimit: 3 });
    expect(p.decision).toBe("stage_refund");
    expect(p.lines[0].checklist_photo_id).toBe("ph_milk");
  });
  test("a claim the photos contradict, or with no photo, goes to a person, never refused or paid automatically", () => {
    // Photos show 1 milk packed; claiming both milks contradicts that.
    expect(plan({ order: order(), claim: [{ item_id: "milk", quantity: 2 }], abuseLimit: 3 })).toMatchObject({ decision: "manual_review", reasons: ["checklist_shows_packed"] });
    expect(plan({ order: order({ pickup_checklist: [] }), claim: [{ item_id: "bread", quantity: 1 }], abuseLimit: 3 })).toMatchObject({ decision: "manual_review", reasons: ["no_checklist_photo"] });
  });
  test("the deduction never exceeds the item's purchase value", () => {
    const p = plan({ order: order(), claim: [{ item_id: "milk", quantity: 2 }], abuseLimit: 3 });
    expect(p.merchant_deduction_cents).toBeLessThanOrEqual(2 * 449);
    expect(plan({ order: order(), claim: [{ item_id: "milk", quantity: 3 }], abuseLimit: 3 }).decision).toBe("refuse");
  });
});

describe("refund proposal for human review (rule 8)", () => {
  const ids = { orderId: "O1", merchantId: "M1", customerId: "R1", claimedAt: "2026-10-17T20:00:00Z", createdAt: "2026-10-17T20:00:01Z" };
  const staged = () => plan({ order: order(), claim: [{ item_id: "milk", quantity: 1 }], abuseLimit: 3 });

  test("is always pending review, needs a person, and carries the amounts and photo", () => {
    const prop = r.buildRefundProposal({ ...ids, plan: staged() });
    expect(prop).toMatchObject({
      type: "missing_item_refund", status: "pending_review", requires_human_approval: true, review_priority: "routine",
      amounts: { customer_refund_cents: 491, merchant_deduction_cents: 395, commission_reversed_cents: 54 },
      merchant_deduction: { state: "awaiting_dispute_window" }
    });
    expect(prop.lines[0]).toMatchObject({ item_id: "milk", checklist_photo_id: "ph_milk" });
  });
  test("is frozen: it can't be edited on the way to approval", () => {
    const prop = r.buildRefundProposal({ ...ids, plan: staged() });
    expect(Object.isFrozen(prop) && Object.isFrozen(prop.amounts) && Object.isFrozen(prop.lines[0])).toBe(true);
    expect(() => { "use strict"; prop.amounts.customer_refund_cents = 99999; }).toThrow();
    expect(prop.amounts.customer_refund_cents).toBe(491);
  });
  test("the same claim always gets the same key, so it can't be paid twice; a different claim gets a different key", () => {
    const a = r.buildRefundProposal({ ...ids, plan: staged() });
    const b = r.buildRefundProposal({ ...ids, plan: staged(), createdAt: "2026-10-18T00:00:00Z" });
    const c = r.buildRefundProposal({ ...ids, plan: plan({ order: order(), claim: [{ item_id: "bread", quantity: 1 }], abuseLimit: 3 }) });
    expect(a.idempotency_key).toBe(b.idempotency_key);
    expect(a.idempotency_key).not.toBe(c.idempotency_key);
  });
  test("a review case is marked for a closer look; a refused claim can't become a proposal", () => {
    const review = plan({ order: order(), claim: [{ item_id: "bread", quantity: 1 }], abuseLimit: null });
    expect(r.buildRefundProposal({ ...ids, plan: review })).toMatchObject({ review_priority: "check_reasons", reasons: ["abuse_limit_not_set"] });
    const refused = plan({ order: order(), claim: [{ item_id: "eggs", quantity: 1 }], abuseLimit: 3 });
    expect(() => r.buildRefundProposal({ ...ids, plan: refused })).toThrow();
  });
});

describe("monthly claim limit (owner decision: 3 per customer per calendar month)", () => {
  test("claims 1-3 are staged; the 4th and later go to manual review, using the default limit", () => {
    expect(r.MONTHLY_CLAIM_LIMIT).toBe(3);
    const claim = [{ item_id: "bread", quantity: 1 }];
    const run = (earlier) => r.planMissingItemRefund({ order: order(), claim, claimedAt: "2026-10-17T20:00:00Z", customerClaimsThisMonth: earlier });
    expect([0, 1, 2].map((n) => run(n).decision)).toEqual(["stage_refund", "stage_refund", "stage_refund"]);
    expect(run(3)).toMatchObject({ decision: "manual_review", reasons: ["over_monthly_claim_limit"] });
  });
});

