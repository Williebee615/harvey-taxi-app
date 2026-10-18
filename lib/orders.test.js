const o = require("./orders");

const catalog = new Map([
  ["milk", { id: "milk", name: "Whole milk", price_cents: 449, available: true, substitutable: true, review_status: "listed", archived_at: null }],
  ["bread", { id: "bread", name: "Bread", price_cents: 325, available: true, substitutable: false, review_status: "listed", archived_at: null }],
  ["eggs", { id: "eggs", name: "Eggs", price_cents: 399, available: false, substitutable: false, review_status: "listed", archived_at: null }],
  ["beer", { id: "beer", name: "Beer", price_cents: 1299, available: true, substitutable: false, review_status: "held", archived_at: null }],
  ["vodka", { id: "vodka", name: "Vodka", price_cents: 2000, available: true, substitutable: false, review_status: "blocked", archived_at: null }],
  ["gone", { id: "gone", name: "Old", price_cents: 100, available: true, substitutable: false, review_status: "listed", archived_at: "2026-10-01T00:00:00Z" }]
]);

describe("owner decisions are the constants", () => {
  test("D1: 8 minutes to accept; payment window 15 minutes; tip cap matches rides", () => {
    expect(o.STORE_RESPONSE_MS).toBe(8 * 60 * 1000);
    expect(o.PAYMENT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(o.MAX_TIP_CENTS).toBe(50000);
  });
});

describe("transitions", () => {
  test("D2: the rider may cancel until the store marks the order ready, not after", () => {
    expect(o.canTransition("rider", "placed", "cancelled_by_rider")).toBe(true);
    expect(o.canTransition("rider", "accepted", "cancelled_by_rider")).toBe(true);
    expect(o.canTransition("rider", "ready", "cancelled_by_rider")).toBe(false);
  });
  test("the store accepts or rejects a placed order, marks it ready, or cancels before pickup", () => {
    expect(o.canTransition("merchant", "placed", "accepted")).toBe(true);
    expect(o.canTransition("merchant", "placed", "rejected")).toBe(true);
    expect(o.canTransition("merchant", "accepted", "ready")).toBe(true);
    expect(o.canTransition("merchant", "ready", "cancelled_by_store")).toBe(true);
    expect(o.canTransition("merchant", "pending_payment", "accepted")).toBe(false);
    expect(o.canTransition("merchant", "ready", "accepted")).toBe(false);
  });
  test("only the system places, expires or abandons; nobody completes in 3a", () => {
    expect(o.canTransition("system", "pending_payment", "placed")).toBe(true);
    expect(o.canTransition("rider", "pending_payment", "placed")).toBe(false);
    expect(o.canTransition("system", "placed", "expired")).toBe(true);
    for (const actor of ["system", "rider", "merchant", "admin"]) expect(o.canTransition(actor, "ready", "completed")).toBe(false);
  });
  test("staff can cancel any open order before pickup; every cancel or rejection releases the card hold", () => {
    for (const from of ["pending_payment", "placed", "accepted", "ready"]) expect(o.canTransition("admin", from, "cancelled_by_staff")).toBe(true);
    expect(o.canTransition("admin", "picked_up", "cancelled_by_staff")).toBe(false);
    for (const to of ["rejected", "expired", "payment_abandoned", "cancelled_by_rider", "cancelled_by_store", "cancelled_by_staff"]) expect(o.RELEASES_AUTHORIZATION).toContain(to);
    expect(o.TRANSITIONS.unknown).toBeUndefined();
    expect(o.canTransition("unknown", "placed", "accepted")).toBe(false);
  });
});

describe("buildLines: prices and availability come from the catalog", () => {
  test("uses catalog name and price, ignores anything the cart claims", () => {
    const r = o.buildLines([{ catalog_item_id: "milk", quantity: 2, substitution_choice: "best_match", unit_price_cents: 1, name: "x" }], catalog);
    expect(r).toEqual({ ok: true, lines: [{ catalog_item_id: "milk", name: "Whole milk", unit_price_cents: 449, quantity: 2, substitution_choice: "best_match" }] });
  });
  test("items that aren't substitutable are always refund-if-out-of-stock", () => {
    expect(o.buildLines([{ catalog_item_id: "bread", quantity: 1, substitution_choice: "best_match" }], catalog).lines[0].substitution_choice).toBe("refund");
    expect(o.buildLines([{ catalog_item_id: "milk", quantity: 1, substitution_choice: "weird" }], catalog).lines[0].substitution_choice).toBe("refund");
  });
  test.each([
    [[], /empty/],
    [[{ catalog_item_id: "eggs", quantity: 1 }], /Eggs is out of stock/],
    [[{ catalog_item_id: "beer", quantity: 1 }], /no longer available/],
    [[{ catalog_item_id: "vodka", quantity: 1 }], /no longer available/],
    [[{ catalog_item_id: "gone", quantity: 1 }], /no longer available/],
    [[{ catalog_item_id: "nope", quantity: 1 }], /no longer available/],
    [[{ catalog_item_id: "milk", quantity: 0 }], /quantity from 1 to 20/],
    [[{ catalog_item_id: "milk", quantity: 21 }], /quantity from 1 to 20/],
    [[{ catalog_item_id: "milk", quantity: 1.5 }], /quantity/],
    [[{ catalog_item_id: "milk", quantity: 1 }, { catalog_item_id: "milk", quantity: 1 }], /twice/]
  ])("refuses %j", (cart, error) => {
    const r = o.buildLines(cart, catalog);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(error);
  });
  test("held and staff-hidden items can never be ordered (term 3)", () => {
    expect(o.buildLines([{ catalog_item_id: "beer", quantity: 1 }], catalog).ok).toBe(false);
  });
});

describe("computeTotals", () => {
  const lines = [{ unit_price_cents: 449, quantity: 2 }, { unit_price_cents: 325, quantity: 1 }];
  test("food: authorize exactly the total", () => {
    const t = o.computeTotals({ lines, orderType: "food", taxRateBps: 1000, deliveryFeeCents: 1150, tipCents: 300 });
    expect(t).toMatchObject({ items_subtotal_cents: 1223, tax_cents: 90 + 33, delivery_fee_cents: 1150, tip_cents: 300, total_cents: 1223 + 123 + 1150 + 300 });
    expect(t.authorized_cents).toBe(t.total_cents);
  });
  test("grocery: items + 15% and tax on that, plus fee and tip (term 5)", () => {
    const t = o.computeTotals({ lines, orderType: "grocery", taxRateBps: 1000, deliveryFeeCents: 1150, tipCents: 0 });
    expect(t.authorized_cents).toBe(1406 + 141 + 1150);
    expect(t.authorized_cents).toBeGreaterThan(t.total_cents);
  });
  test("zero tax placeholder and no tip", () => {
    const t = o.computeTotals({ lines, orderType: "food", taxRateBps: 0, deliveryFeeCents: 0, tipCents: 0 });
    expect(t).toMatchObject({ tax_cents: 0, total_cents: 1223, authorized_cents: 1223 });
  });
  test("refuses bad money input", () => {
    expect(() => o.computeTotals({ lines, orderType: "food", taxRateBps: 0, deliveryFeeCents: -1, tipCents: 0 })).toThrow();
    expect(() => o.computeTotals({ lines, orderType: "food", taxRateBps: 0, deliveryFeeCents: 0, tipCents: 50001 })).toThrow();
    expect(() => o.computeTotals({ lines, orderType: "food", taxRateBps: 2001, deliveryFeeCents: 0, tipCents: 0 })).toThrow();
  });
});

describe("helpers", () => {
  test("order types: restaurants are food; grocery and convenience carry the buffer", () => {
    expect(o.orderTypeFor("restaurant")).toBe("food");
    expect(o.orderTypeFor("grocery")).toBe("grocery");
    expect(o.orderTypeFor("convenience")).toBe("grocery");
  });
  test("prep time 5-90 minutes", () => {
    expect(o.validPrepMinutes(5)).toBe(5);
    expect(o.validPrepMinutes("20")).toBe(20);
    expect(o.validPrepMinutes(4)).toBeNull();
    expect(o.validPrepMinutes(91)).toBeNull();
    expect(o.validPrepMinutes(10.5)).toBeNull();
  });
  test("order numbers are HT- plus 6 unambiguous characters", () => {
    expect(o.orderNumber(Buffer.from([0, 1, 2, 3, 4, 255]))).toMatch(/^HT-[A-HJ-NP-Z2-9]{6}$/);
  });
  test("sweep: abandon unpaid after 15 minutes; expire unanswered after 8 (D1)", () => {
    const t0 = Date.parse("2026-10-18T12:00:00Z");
    expect(o.sweepAction({ status: "pending_payment", created_at: "2026-10-18T12:00:00Z" }, t0 + 14 * 60000)).toBeNull();
    expect(o.sweepAction({ status: "pending_payment", created_at: "2026-10-18T12:00:00Z" }, t0 + 15 * 60000)).toBe("payment_abandoned");
    expect(o.sweepAction({ status: "placed", created_at: "2026-10-18T11:00:00Z", placed_at: "2026-10-18T12:00:00Z" }, t0 + 7 * 60000)).toBeNull();
    expect(o.sweepAction({ status: "placed", created_at: "2026-10-18T11:00:00Z", placed_at: "2026-10-18T12:00:00Z" }, t0 + 8 * 60000)).toBe("expired");
    expect(o.sweepAction({ status: "accepted", created_at: "2026-10-18T00:00:00Z" }, t0)).toBeNull();
  });
  test("the store view carries a first name and items, never address, phone or email", () => {
    const v = o.storeView({ id: "o1", order_number: "HT-ABCDEF", status: "placed", order_type: "food", placed_at: "2026-10-18T12:00:00Z", items_subtotal_cents: 898, dropoff_address: "1 Secret St", rider_phone: "+1615" }, [{ name: "Whole milk", quantity: 2, unit_price_cents: 449, substitution_choice: "refund" }], "Ana");
    expect(v).toMatchObject({ rider_first_name: "Ana", respond_by: "2026-10-18T12:08:00.000Z" });
    expect(JSON.stringify(v)).not.toMatch(/Secret|\+1615|@/);
  });
});

describe("isOpenAt (Nashville time)", () => {
  const hours = [{ day_of_week: 6, closed: false, opens_at: "09:00:00", closes_at: "21:00:00" }, { day_of_week: 0, closed: true, opens_at: null, closes_at: null }];
  test("open inside the window on that weekday, closed outside it", () => {
    // Saturday 2026-10-17 15:00 UTC = 10:00 in Nashville (CDT).
    expect(o.isOpenAt(hours, new Date("2026-10-17T15:00:00Z"))).toBe(true);
    // Saturday 13:59 UTC = 08:59 Nashville.
    expect(o.isOpenAt(hours, new Date("2026-10-17T13:59:00Z"))).toBe(false);
    // Closing time is exclusive: Saturday 21:00 Nashville = Sunday 02:00 UTC.
    expect(o.isOpenAt(hours, new Date("2026-10-18T02:00:00Z"))).toBe(false);
  });
  test("a day marked closed, or with no saved hours, is closed", () => {
    expect(o.isOpenAt(hours, new Date("2026-10-18T17:00:00Z"))).toBe(false); // Sunday
    expect(o.isOpenAt(hours, new Date("2026-10-19T17:00:00Z"))).toBe(false); // Monday, no row
    expect(o.isOpenAt([], new Date("2026-10-17T15:00:00Z"))).toBe(false);
  });
});
