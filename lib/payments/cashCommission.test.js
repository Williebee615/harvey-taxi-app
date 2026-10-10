// Sandbox tests: cash trips with a driver commission ledger, settled through
// the market's provider before the next shift. No network, no real wallets.
// Commission rates and unpaid limits here are TEST VALUES ONLY; every market
// has none set and cash is disabled everywhere.
const markets = require("../markets");
const { createCashCommissionLedger } = require("./cashCommission");
const { createSandboxEcocash } = require("./sandboxEcocash");

const TEST_RATE = { rate: 0.15 }; // test value only
const DRIVER = "drv-1";
const WALLET = "0771111111"; // Paynow test number: paid after 5 s

function setup(overrides = {}) {
  let t = Date.UTC(2026, 9, 10, 6);
  const provider = createSandboxEcocash();
  const ledger = createCashCommissionLedger({ market_id: "zw-harare", sandbox: true, provider, test_commission: TEST_RATE, test_unpaid_limit_minor: 500, now: () => t, ...overrides });
  const settle = async (key, phone = WALLET, wait = 5) => {
    const { settlement } = await ledger.startSettlement({ driver_id: DRIVER, phone, idempotency_key: key });
    const updates = provider.advance(wait);
    return { settlement, results: updates.map((u) => ledger.applySettlementUpdate(u, { verified: true })), updates };
  };
  const trip = (id, fare = 1000, extra = {}) => ledger.recordCompletedTrip({ trip_id: id, driver_id: DRIVER, fare_minor: fare, booking_fee_minor: 50, payment_method: "cash", status: "completed", ...extra });
  return { ledger, provider, settle, trip, tick: (ms) => { t += ms; } };
}

describe("per-market configuration", () => {
  test("cash and cash commission are disabled in every market; the US has no cash option and is unchanged", () => {
    for (const id of ["zw-harare", "ng-lagos", "gh-accra"]) {
      const m = markets.getMarket(id);
      expect(m.cash_commission).toMatchObject({ enabled: false, approved: false, unpaid_limit_minor: null, settle_before_next_shift: true });
      expect(m.cash_commission.settlement_provider.confirmed).toBe(false);
      expect(m.cash_bookings).toBe(false);
      expect(markets.paymentMethodAllowed(id, "cash")).toBe(false);
      expect(m.pricing.commission).toEqual({ rate: null, approved: false });
    }
    expect(markets.getMarket("zw-harare").cash_commission.settlement_provider.id).toBe("paynow_ecocash");
    expect(markets.getMarket("ng-lagos").cash_commission.settlement_provider.id).toBeNull();
    expect(markets.getMarket("gh-accra").cash_commission.settlement_provider.id).toBeNull();
    const us = markets.getMarket("us-nashville");
    expect(us.cash_commission).toBeUndefined();
    expect(us.payments).toEqual([{ method: "card", provider: "stripe", enabled: true }]);
    expect(() => createCashCommissionLedger({ market_id: "us-nashville", sandbox: true, provider: createSandboxEcocash() })).toThrow("not available");
  });

  test("there is no live mode: without sandbox the ledger refuses; with no test rate, the unset rate refuses", () => {
    expect(() => createCashCommissionLedger({ market_id: "zw-harare", provider: createSandboxEcocash() })).toThrow("disabled in Harare pending owner approval");
    expect(() => createCashCommissionLedger({ market_id: "zw-harare", sandbox: true, provider: { live: true } })).toThrow("sandbox provider");
    const noRate = createCashCommissionLedger({ market_id: "zw-harare", sandbox: true, provider: createSandboxEcocash() });
    expect(() => noRate.recordCompletedTrip({ trip_id: "t", driver_id: DRIVER, fare_minor: 1000, payment_method: "cash", status: "completed" })).toThrow("commission rate not set");
    expect(noRate.canReceiveCashOffer({ driver_id: DRIVER })).toEqual({ allowed: false, reason: "unpaid_limit_not_set" });
  });

  test("Nigeria and Ghana use the same model in their own currency when tested", () => {
    for (const id of ["ng-lagos", "gh-accra"]) {
      const l = createCashCommissionLedger({ market_id: id, sandbox: true, provider: createSandboxEcocash(), test_commission: TEST_RATE, test_unpaid_limit_minor: 100000 });
      const { receipt } = l.recordCompletedTrip({ trip_id: `${id}-1`, driver_id: DRIVER, fare_minor: 250000, payment_method: "cash", status: "completed" });
      expect(receipt.currency).toBe(markets.getMarket(id).cash_commission.settlement_currency);
      expect(receipt.number).toMatch(id === "ng-lagos" ? /^HT-NG-/ : /^HT-GH-/);
    }
  });
});

describe("recording completed trips", () => {
  test("each completed cash trip records fare collected, driver earnings and commission owed, with a receipt", () => {
    const { ledger, trip } = setup();
    const { trip: rec, receipt } = trip("t1", 1000);
    // booking fee 50 + 15% of 950 = 142 (floor) → commission 192, earnings 808
    expect(rec).toMatchObject({ fare_minor: 1000, commission_minor: 192, driver_earnings_minor: 808, state: "owed" });
    expect(receipt).toMatchObject({ number: "HT-ZW-000001", kind: "cash_trip", fare_collected_minor: 1000, driver_earnings_minor: 808, commission_owed_minor: 192, currency: "USD" });
    expect(ledger.balance(DRIVER)).toEqual({ outstanding_minor: 192, disputed_minor: 0, credit_minor: 0, pending_settlement_minor: 0 });
  });

  test("EcoCash-paid (in-app) trips are never charged commission here; the same trip can't be recorded twice", () => {
    const { ledger, trip } = setup();
    expect(trip("t1", 1000, { payment_method: "ecocash" })).toEqual({ charged: false, reason: "paid_in_app" });
    expect(ledger.balance(DRIVER).outstanding_minor).toBe(0);
    trip("t2", 1000);
    expect(trip("t2", 1000).duplicate).toBe(true);
    expect(ledger.balance(DRIVER).outstanding_minor).toBe(192);
    expect(() => trip("t3", 1000, { status: "accepted" })).toThrow("only completed trips");
  });

  test("cancellations: a cancelled trip owes nothing; a voided trip's commission is reversed, or credited if already settled", async () => {
    const { ledger, trip, settle } = setup();
    expect(ledger.cancelTrip({ trip_id: "never-completed", driver_id: DRIVER, reason: "rider cancelled" })).toEqual({ commission_minor: 0 });
    trip("t1");
    expect(ledger.cancelTrip({ trip_id: "t1", reason: "completed by mistake", actor: "admin:ops" })).toEqual({ reversed_minor: 192, credited: false });
    expect(ledger.balance(DRIVER).outstanding_minor).toBe(0);
    trip("t2");
    await settle("k1");
    expect(ledger.cancelTrip({ trip_id: "t2", reason: "fraud review", actor: "admin:ops" })).toEqual({ reversed_minor: 192, credited: true });
    expect(ledger.balance(DRIVER).credit_minor).toBe(192);
    // Credit is used against the next commission.
    trip("t3");
    expect(ledger.dueBeforeShift(DRIVER)).toBe(0);
    expect(await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k2" })).toEqual({ nothing_due: true });
    expect(ledger.trip("t3").state).toBe("settled");
    expect(ledger.balance(DRIVER).credit_minor).toBe(0);
  });
});

describe("settle before the next shift, never mid-trip", () => {
  test("outstanding commission blocks the next shift until a verified provider confirmation clears it", async () => {
    const { ledger, trip, provider } = setup();
    trip("t1");
    trip("t2", 2000); // 50 + floor(1950*0.15)=292 → 342
    expect(ledger.canStartShift({ driver_id: DRIVER })).toEqual({ allowed: false, reason: "settle_commission", due_minor: 534 });

    const { settlement } = await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k1" });
    expect(settlement.amount_minor).toBe(534);
    // Pending is not paid: still blocked.
    expect(ledger.canStartShift({ driver_id: DRIVER }).allowed).toBe(false);
    const [u] = provider.advance(5);
    // An unverified update never clears the balance.
    expect(ledger.applySettlementUpdate(u, { verified: false })).toEqual({ ignored: "unverified" });
    expect(ledger.canStartShift({ driver_id: DRIVER }).allowed).toBe(false);
    const res = ledger.applySettlementUpdate(u, { verified: true });
    expect(res.receipt).toMatchObject({ kind: "commission_settlement", amount_paid_minor: 534, trips: ["t1", "t2"] });
    expect(ledger.canStartShift({ driver_id: DRIVER })).toEqual({ allowed: true });
  });

  test("a driver with an accepted or active trip is never interrupted, whatever they owe", () => {
    const { ledger, trip } = setup();
    for (let i = 0; i < 5; i += 1) trip(`t${i}`);
    expect(ledger.canStartShift({ driver_id: DRIVER, has_accepted_or_active_trip: true })).toEqual({ allowed: true, reason: "accepted_or_active_trip_never_interrupted" });
  });

  test("unpaid-balance limit: no new cash offers at or over it; the current trip carries on; settling restores offers", async () => {
    const { ledger, trip, settle } = setup();
    trip("t1");
    trip("t2");
    expect(ledger.canReceiveCashOffer({ driver_id: DRIVER })).toEqual({ allowed: true });
    trip("t3"); // 576 owed ≥ 500 limit
    expect(ledger.canReceiveCashOffer({ driver_id: DRIVER })).toEqual({ allowed: false, reason: "unpaid_limit_reached", owed_minor: 576, limit_minor: 500 });
    // A trip already in progress completes and is recorded normally.
    expect(trip("t4-already-active").charged).toBe(true);
    await settle("k1");
    expect(ledger.canReceiveCashOffer({ driver_id: DRIVER })).toEqual({ allowed: true });
  });

  test("a failed EcoCash payment leaves the balance owed; the driver can retry", async () => {
    const { ledger, trip, settle } = setup();
    trip("t1");
    const { results } = await settle("k1", "0773333333", 30);
    expect(results).toEqual([{ status: "failed" }]);
    expect(ledger.dueBeforeShift(DRIVER)).toBe(192);
    await settle("k2");
    expect(ledger.dueBeforeShift(DRIVER)).toBe(0);
  });
});

describe("duplicate-payment protection", () => {
  test("same idempotency key or a second tap returns the open settlement; a repeated confirmation is ignored", async () => {
    const { ledger, trip, provider } = setup();
    trip("t1");
    const a = await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k1" });
    const b = await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k1" });
    const c = await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k2" });
    expect(b).toEqual({ existing: true, settlement: a.settlement });
    expect(c).toEqual({ existing: true, settlement: a.settlement });
    const [u] = provider.advance(5);
    expect(provider.advance(60)).toEqual([]); // only one collection was started
    expect(ledger.applySettlementUpdate(u, { verified: true }).status).toBe("paid");
    expect(ledger.applySettlementUpdate(u, { verified: true })).toEqual({ ignored: "duplicate" });
    expect(ledger.applySettlementUpdate({ ...u, update_id: "replayed" }, { verified: true })).toEqual({ ignored: "already_paid" });
    expect(ledger.receipts(DRIVER).filter((r) => r.kind === "commission_settlement")).toHaveLength(1);
    expect(ledger.balance(DRIVER).credit_minor).toBe(0);
  });

  test("a wrong amount or unknown reference never clears; a late payment for a closed settlement becomes credit", async () => {
    const { ledger, trip, provider } = setup();
    trip("t1");
    const { settlement } = await ledger.startSettlement({ driver_id: DRIVER, phone: WALLET, idempotency_key: "k1" });
    const [u] = provider.advance(5);
    expect(ledger.applySettlementUpdate({ ...u, amount_minor: 1 }, { verified: true })).toEqual({ held: "amount_mismatch" });
    expect(ledger.applySettlementUpdate({ ...u, update_id: "x", provider_ref: "nope" }, { verified: true })).toEqual({ ignored: "unknown_reference" });
    // Provider first says failed, then a late "paid" arrives for the same reference.
    ledger.applySettlementUpdate({ ...u, update_id: "f1", status: "failed" }, { verified: true });
    expect(ledger.applySettlementUpdate({ ...u, update_id: "late" }, { verified: true })).toEqual({ credited: settlement.amount_minor });
    expect(ledger.balance(DRIVER)).toMatchObject({ outstanding_minor: 192, credit_minor: 192 });
    expect(ledger.dueBeforeShift(DRIVER)).toBe(0); // credit covers it; not charged twice
  });
});

describe("disputes and audit", () => {
  test("a disputed trip is set aside (shift not blocked by it, by default); upheld removes or reduces it; rejected restores it", () => {
    const { ledger, trip } = setup();
    trip("t1");
    trip("t2");
    const d1 = ledger.openDispute({ trip_id: "t1", driver_id: DRIVER, reason: "rider didn't pay" });
    expect(ledger.balance(DRIVER)).toMatchObject({ outstanding_minor: 192, disputed_minor: 192 });
    expect(ledger.dueBeforeShift(DRIVER)).toBe(192);
    expect(() => ledger.resolveDispute({ dispute_id: d1.id, outcome: "upheld" })).toThrow("reviewer");
    expect(ledger.resolveDispute({ dispute_id: d1.id, outcome: "upheld", actor: "admin:ops" }).status).toBe("upheld");
    expect(ledger.trip("t1").state).toBe("voided");
    const d2 = ledger.openDispute({ trip_id: "t2", driver_id: DRIVER, reason: "fare was lower" });
    expect(ledger.resolveDispute({ dispute_id: d2.id, outcome: "upheld", adjusted_commission_minor: 100, actor: "admin:ops" }).commission_minor).toBe(100);
    trip("t3");
    const d3 = ledger.openDispute({ trip_id: "t3", driver_id: DRIVER, reason: "test" });
    ledger.resolveDispute({ dispute_id: d3.id, outcome: "rejected", actor: "admin:ops" });
    expect(ledger.balance(DRIVER)).toMatchObject({ outstanding_minor: 100 + 192, disputed_minor: 0 });
  });

  test("every action is in an append-only audit trail with balances after it", async () => {
    const { ledger, trip, settle } = setup();
    trip("t1");
    trip("t2", 500, { payment_method: "ecocash" });
    await settle("k1");
    const actions = ledger.audit().map((a) => a.action);
    expect(actions).toEqual(["cash_trip_recorded", "trip_not_charged", "settlement_started", "settlement_confirmed"]);
    const last = ledger.audit().pop();
    expect(last.balance_after).toMatchObject({ outstanding_minor: 0 });
    expect(Object.isFrozen(last)).toBe(true);
    expect(ledger.audit().map((a) => a.seq)).toEqual([1, 2, 3, 4]);
  });
});
