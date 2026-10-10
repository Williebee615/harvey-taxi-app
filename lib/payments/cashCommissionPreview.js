"use strict";
// Admin sandbox preview of cash trips with a driver commission ledger: one
// scripted driver day run through the real ledger and the sandbox provider.
// Nothing is stored, no wallet is charged, nothing is sent. The commission
// rate and unpaid limit are TEST VALUES (no market has either set).

const markets = require("../markets");
const { createCashCommissionLedger } = require("./cashCommission");
const { createSandboxEcocash } = require("./sandboxEcocash");
const { splitFare } = require("./marketplaceLedger");

const TEST_COMMISSION = { rate: 0.15 };
const TEST_FARES = { "zw-harare": [800, 1250, 600], "ng-lagos": [350000, 520000, 180000], "gh-accra": [4500, 6200, 2500] };

async function runCashCommissionPreview(market_id) {
  const market = markets.getMarket(market_id);
  if (!market || !market.cash_commission) throw new Error("No cash commission preview for that market.");
  const fares = TEST_FARES[market_id];
  const bookingFee = Math.round(market.pricing.booking_fee * 100);
  // Test limit: the commission on the first two trips, so the third reaches it.
  const limit = fares.slice(0, 2).reduce((a, f) => a + splitFare({ total_minor: f, booking_fee_minor: bookingFee, commission: TEST_COMMISSION }).commission_minor, 0);
  let clock = Date.UTC(2026, 9, 12, 5, 0);
  const provider = createSandboxEcocash();
  const ledger = createCashCommissionLedger({ market_id, sandbox: true, provider, test_commission: TEST_COMMISSION, test_unpaid_limit_minor: limit, now: () => clock });
  const D = "sandbox-driver";
  const steps = [];
  const add = (title, detail) => steps.push({ at: new Date(clock).toISOString(), title, detail, balance: ledger.balance(D) });

  fares.forEach((fare, i) => {
    clock += 50 * 60000;
    const r = ledger.recordCompletedTrip({ trip_id: `sbx-trip-${i + 1}`, driver_id: D, fare_minor: fare, booking_fee_minor: bookingFee, payment_method: "cash", status: "completed" });
    add(`Cash trip ${i + 1} completed`, { receipt: r.receipt.number, fare_collected_minor: fare, driver_earnings_minor: r.trip.driver_earnings_minor, commission_owed_minor: r.trip.commission_minor });
  });
  clock += 20 * 60000;
  const inApp = ledger.recordCompletedTrip({ trip_id: "sbx-trip-ecocash", driver_id: D, fare_minor: fares[0], booking_fee_minor: bookingFee, payment_method: "ecocash", status: "completed" });
  add("EcoCash-paid trip completed", { charged: inApp.charged, note: "Commission taken when the rider paid in the app; not charged again." });
  add("New cash trip offers", ledger.canReceiveCashOffer({ driver_id: D }));
  add("Driver mid-trip", { ...ledger.canStartShift({ driver_id: D, has_accepted_or_active_trip: true }), note: "An accepted or active trip is never interrupted." });
  clock += 8 * 3600000;
  add("Next shift: driver tries to go online", ledger.canStartShift({ driver_id: D }));

  const sandboxWallet = "0771111111"; // the sandbox's test number (every market)
  const { settlement } = await ledger.startSettlement({ driver_id: D, phone: sandboxWallet, idempotency_key: "sbx-key-1" });
  add(`Driver pays commission (${market.cash_commission.settlement_provider.name}, sandbox)`, { amount_minor: settlement.amount_minor, provider_ref: settlement.provider_ref });
  const again = await ledger.startSettlement({ driver_id: D, phone: sandboxWallet, idempotency_key: "sbx-key-2" });
  add("Driver taps Pay again", { same_settlement: again.existing === true, note: "Duplicate payment prevented: the open settlement is reused." });
  add("Still blocked while pending", ledger.canStartShift({ driver_id: D }));
  clock += 5000;
  const [update] = provider.advance(5);
  add("Unverified provider message", ledger.applySettlementUpdate(update, { verified: false }));
  const confirmed = ledger.applySettlementUpdate(update, { verified: true });
  add("Verified provider confirmation", { status: confirmed.status, receipt: confirmed.receipt.number, amount_paid_minor: confirmed.receipt.amount_paid_minor });
  add("Repeated confirmation", ledger.applySettlementUpdate(update, { verified: true }));
  add("Driver goes online", ledger.canStartShift({ driver_id: D }));

  return {
    market: { id: market.id, name: market.name, currency: market.cash_commission.settlement_currency },
    sandbox: true,
    disabled: { cash_bookings: market.cash_bookings === false, cash_commission_enabled: market.cash_commission.enabled, provider_confirmed: market.cash_commission.settlement_provider.confirmed },
    test_values: { commission_rate: TEST_COMMISSION.rate, unpaid_limit_minor: limit, note: "Test values only. No rate or limit is set for this market." },
    steps,
    receipts: ledger.receipts(D),
    audit: ledger.audit()
  };
}

module.exports = { runCashCommissionPreview };
