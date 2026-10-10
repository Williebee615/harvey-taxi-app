// Sandbox tests for Zimbabwe EcoCash marketplace payments. No network, no
// real wallets, no live provider: lib/payments/sandboxEcocash.js only.
// Commission rates below are TEST VALUES ONLY, not proposed rates; the real
// Zimbabwe rate stays unset until the owner approves one.
const fs = require("fs");
const path = require("path");
const markets = require("../markets");
const { splitFare, allocateFee, RidePayment, STATES } = require("./marketplaceLedger");
const { createSandboxEcocash } = require("./sandboxEcocash");

const TEST_RATE = { rate: 0.2 }; // test value only
const DAY = 86400000;

function setup({ fee_bearer = "platform", collection_fee_bps = 250, payout_fee_minor = 0, rider = "0771111111", total = 750, booking_fee = 50 } = {}) {
  let t = Date.UTC(2026, 9, 10, 12);
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const provider = createSandboxEcocash({ collection_fee_bps, payout_fee_minor });
  const config = { market_id: "zw-harare", currency: "USD", commission: TEST_RATE, fee_bearer, settlement_days: 1, payout_min_minor: 100 };
  const pay = new RidePayment({ ride_id: "r1", driver_id: "d1", rider_phone: rider, total_minor: total, booking_fee_minor: booking_fee, config, provider, now: clock.now });
  const deliver = (updates, fn) => updates.map((u) => pay[fn](u));
  return { pay, provider, clock, deliver };
}

describe("Zimbabwe plan: EcoCash only, commission not set", () => {
  test("no cash bookings; EcoCash is the only method, still disabled", () => {
    const zw = markets.getMarket("zw-harare");
    expect(zw.payments.map((p) => p.method)).toEqual(["ecocash"]);
    expect(zw.payments[0].enabled).toBe(false);
    expect(zw.cash_bookings).toBe(false);
    expect(markets.paymentMethodAllowed("zw-harare", "cash")).toBe(false);
    expect(markets.paymentMethodAllowed("zw-harare", "ecocash")).toBe(true);
    // Nashville unchanged.
    expect(markets.getMarket("us-nashville").payments).toEqual([{ method: "card", provider: "stripe", enabled: true }]);
  });

  test("no commission rate is set, so quotes show no split and the ledger refuses to compute one", () => {
    const zw = markets.getMarket("zw-harare");
    expect(zw.pricing.commission).toEqual({ rate: null, approved: false });
    const q = markets.estimateForMarket("zw-harare", { km: 10, minutes: 20 });
    expect(q).toMatchObject({ total: 7.5, driver_payout: null, platform_fee: null, commission_set: false });
    expect(markets.marketSummary("zw-harare", {}).unconfirmed).toContain("commission rate (owner to set)");
    expect(() => splitFare({ total_minor: 750, booking_fee_minor: 50, commission: zw.pricing.commission })).toThrow("commission rate not set");
    const provider = createSandboxEcocash();
    expect(() => new RidePayment({ ride_id: "x", driver_id: "d", rider_phone: "0771111111", total_minor: 750, config: { commission: zw.pricing.commission, fee_bearer: "platform", settlement_days: 1 }, provider })).toThrow("commission rate not set");
  });
});

describe("fare split and fees", () => {
  test("Harvey keeps the booking fee plus the rate of the rest; parts always add up", () => {
    expect(splitFare({ total_minor: 750, booking_fee_minor: 50, commission: TEST_RATE })).toEqual({ commission_minor: 50 + 140, driver_share_minor: 560 });
    for (let total = 1; total < 3000; total += 37) {
      const s = splitFare({ total_minor: total, booking_fee_minor: Math.min(50, total), commission: { rate: 0.17 } });
      expect(s.commission_minor + s.driver_share_minor).toBe(total);
    }
    expect(() => splitFare({ total_minor: 7.5, commission: TEST_RATE })).toThrow("whole number of cents");
    expect(() => splitFare({ total_minor: 100, commission: { rate: 1 } })).toThrow("below 1");
  });

  test("who carries the provider fee is a setting with no default", () => {
    expect(allocateFee({ fee_minor: 19, bearer: "platform", driver_share_minor: 560 })).toEqual({ platform_fee_minor: 19, driver_fee_minor: 0 });
    expect(allocateFee({ fee_minor: 19, bearer: "driver", driver_share_minor: 560 })).toEqual({ platform_fee_minor: 0, driver_fee_minor: 19 });
    expect(allocateFee({ fee_minor: 19, bearer: "shared", driver_share_minor: 560 })).toEqual({ platform_fee_minor: 10, driver_fee_minor: 9 });
    expect(allocateFee({ fee_minor: 30, bearer: "driver", driver_share_minor: 20 })).toEqual({ platform_fee_minor: 10, driver_fee_minor: 20 });
    expect(() => allocateFee({ fee_minor: 1, bearer: undefined, driver_share_minor: 1 })).toThrow("fee bearer");
  });
});

describe("ride payment in the sandbox", () => {
  test("collect → complete → settle → pay out: books balance at every step", async () => {
    const { pay, provider, clock, deliver } = setup();
    await pay.startCollection();
    expect(pay.state).toBe(STATES.COLLECTION_PENDING);
    deliver(provider.advance(5), "applyCollectionUpdate");
    expect(pay.state).toBe(STATES.COLLECTED);
    expect(pay.totals().ledger_sum).toBe(0);

    // Not payable before the ride is completed.
    expect(pay.payoutEligible()).toEqual({ eligible: false, reason: "state_collected" });
    pay.completeRide();
    expect(pay.totals()).toMatchObject({ state: "payable", driver_payable_minor: 560, ledger_sum: 0 });

    // Not before the provider has settled the collected funds.
    expect(pay.payoutEligible()).toEqual({ eligible: false, reason: "not_settled" });
    await expect(pay.startPayout({ driver_wallet: "0771111111", wallet_verified: true })).rejects.toThrow("not_settled");
    clock.add(DAY);
    await expect(pay.startPayout({ driver_wallet: "0771111111", wallet_verified: false })).rejects.toThrow("wallet not verified");
    await pay.startPayout({ driver_wallet: "0771111111", wallet_verified: true });
    deliver(provider.advance(5), "applyPayoutUpdate");

    // 750 collected, sandbox fee 2.5% = 19 (Harvey carries it), 560 paid out.
    expect(pay.totals()).toEqual({
      state: "paid_out", total_minor: 750, commission_minor: 190, driver_share_minor: 560, refunded_minor: 0,
      driver_payable_minor: 0, driver_recovery_minor: 0, provider_clearing_minor: 750 - 19 - 560, platform_commission_minor: 190 - 19, ledger_sum: 0
    });
  });

  test("delayed approval (0772222222) arrives later; cancelled (0773333333) fails and can be retried", async () => {
    const slow = setup({ rider: "0772222222" });
    await slow.pay.startCollection();
    expect(slow.provider.advance(5)).toEqual([]);
    expect(slow.pay.state).toBe(STATES.COLLECTION_PENDING);
    slow.deliver(slow.provider.advance(25), "applyCollectionUpdate");
    expect(slow.pay.state).toBe(STATES.COLLECTED);

    const cancelled = setup({ rider: "0773333333" });
    await cancelled.pay.startCollection();
    cancelled.deliver(cancelled.provider.advance(30), "applyCollectionUpdate");
    expect(cancelled.pay.totals()).toMatchObject({ state: "collection_failed", ledger_sum: 0, provider_clearing_minor: 0 });
    await cancelled.pay.startCollection(); // the rider can try again
    expect(cancelled.pay.state).toBe(STATES.COLLECTION_PENDING);
  });

  test("duplicate status updates are ignored; a wrong amount is held, not booked", async () => {
    const { pay, provider, deliver } = setup();
    await pay.startCollection();
    const [u] = provider.advance(5);
    expect(pay.applyCollectionUpdate(u)).toEqual({ state: "collected" });
    expect(pay.applyCollectionUpdate(u)).toEqual({ ignored: "duplicate" });
    expect(pay.entries.filter((e) => e.event === "collected")).toHaveLength(4);

    const b = setup();
    await b.pay.startCollection();
    const [good] = b.provider.advance(5);
    expect(b.pay.applyCollectionUpdate({ ...good, amount_minor: 1 })).toEqual({ held: "amount_mismatch" });
    expect(b.pay.state).toBe(STATES.COLLECTION_PENDING);
    expect(b.pay.totals().provider_clearing_minor).toBe(0);
    expect(deliver).toBeDefined();
  });

  test("full refund before the ride is completed: rider repaid, driver owed nothing, Harvey carries the fee", async () => {
    const { pay, provider, deliver } = setup({ fee_bearer: "driver" });
    await pay.startCollection();
    deliver(provider.advance(5), "applyCollectionUpdate");
    await pay.refund({ amount_minor: 750, reason: "ride cancelled before pickup" });
    expect(pay.state).toBe(STATES.REFUNDED);
    expect(pay.balance("driver_held")).toBe(0);
    expect(pay.totals()).toMatchObject({ refunded_minor: 750, provider_clearing_minor: -19, platform_commission_minor: -19, ledger_sum: 0 });
    expect(pay.payoutEligible().eligible).toBe(false);
  });

  test("partial refund after completion reduces the driver's payable share", async () => {
    const { pay, provider, deliver } = setup();
    await pay.startCollection();
    deliver(provider.advance(5), "applyCollectionUpdate");
    pay.completeRide();
    await pay.refund({ amount_minor: 150, reason: "route dispute" });
    expect(pay.totals()).toMatchObject({ state: "payable", refunded_minor: 150, driver_payable_minor: 560 - 112, ledger_sum: 0 });
    await expect(pay.refund({ amount_minor: 601, reason: "too much" })).rejects.toThrow("exceeds");
  });

  test("refund after payout: Harvey refunds and records what the driver owes back", async () => {
    const { pay, provider, clock, deliver } = setup();
    await pay.startCollection();
    deliver(provider.advance(5), "applyCollectionUpdate");
    pay.completeRide();
    clock.add(DAY);
    await pay.startPayout({ driver_wallet: "0771111111", wallet_verified: true });
    deliver(provider.advance(5), "applyPayoutUpdate");
    await pay.refund({ amount_minor: 750, reason: "chargeback-style complaint upheld" });
    expect(pay.totals()).toMatchObject({ state: "paid_out", driver_recovery_minor: 560, refunded_minor: 750, ledger_sum: 0 });
  });

  test("a failed payout leaves the share owed and can be retried", async () => {
    const { pay, provider, clock, deliver } = setup();
    await pay.startCollection();
    deliver(provider.advance(5), "applyCollectionUpdate");
    pay.completeRide();
    clock.add(DAY);
    await pay.startPayout({ driver_wallet: "0773333333", wallet_verified: true });
    deliver(provider.advance(30), "applyPayoutUpdate");
    expect(pay.totals()).toMatchObject({ state: "payable", driver_payable_minor: 560, ledger_sum: 0 });
    await pay.startPayout({ driver_wallet: "0771111111", wallet_verified: true });
    deliver(provider.advance(5), "applyPayoutUpdate");
    expect(pay.totals()).toMatchObject({ state: "paid_out", driver_payable_minor: 0, ledger_sum: 0 });
  });
});

describe("sandbox safety", () => {
  test("only Paynow test numbers are accepted; real numbers are refused", async () => {
    const provider = createSandboxEcocash();
    await expect(provider.initiateCollection({ reference: "x", amount_minor: 100, phone: "0779876543" })).rejects.toThrow("only Paynow test numbers");
    await expect(provider.initiateCollection({ reference: "x", amount_minor: 100, phone: "+263 77 111 1111" })).resolves.toHaveProperty("provider_ref");
  });

  test("the ledger refuses any provider that isn't the sandbox", () => {
    const live = { live: true, initiateCollection: async () => ({}) };
    expect(() => new RidePayment({ ride_id: "x", driver_id: "d", rider_phone: "0771111111", total_minor: 100, config: { commission: TEST_RATE, fee_bearer: "platform", settlement_days: 1 }, provider: live })).toThrow("sandbox provider is required");
  });

  test("no payment module can reach the network", () => {
    for (const f of ["marketplaceLedger.js", "sandboxEcocash.js"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/require\(["'](https?|net|tls|axios|node-fetch|paynow)["']\)|\bfetch\(/);
    }
  });
});
