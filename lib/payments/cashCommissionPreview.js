"use strict";
// Admin sandbox preview of cash trips with a driver commission ledger: one
// scripted driver day run through the real ledger and the sandbox provider.
// Nothing is stored, no wallet is charged, nothing is sent. The 15% rate and
// the unpaid limit are DEMONSTRATION VALUES, not rates the owner has
// approved; no market has a rate or limit set.

const markets = require("../markets");
const { createCashCommissionLedger } = require("./cashCommission");
const { createSandboxEcocash } = require("./sandboxEcocash");
const { splitFare } = require("./marketplaceLedger");

const DEMO_COMMISSION = { rate: 0.15 }; // demonstration rate, not an approved rate
const TEST_FARES = { "zw-harare": [800, 1250, 600], "ng-lagos": [350000, 520000, 180000], "gh-accra": [4500, 6200, 2500] };

async function runCashCommissionPreview(market_id) {
  const market = markets.getMarket(market_id);
  if (!market || !market.cash_commission) throw new Error("No cash commission preview for that market.");
  const fares = TEST_FARES[market_id];
  const bookingFee = Math.round(market.pricing.booking_fee * 100);
  // Test limit: the commission on the first two trips, so the third reaches it.
  const limit = fares.slice(0, 2).reduce((a, f) => a + splitFare({ total_minor: f, booking_fee_minor: bookingFee, commission: DEMO_COMMISSION }).commission_minor, 0);
  let clock = Date.UTC(2026, 9, 12, 5, 0);
  const provider = createSandboxEcocash();
  const ledger = createCashCommissionLedger({ market_id, sandbox: true, provider, test_commission: DEMO_COMMISSION, test_unpaid_limit_minor: limit, now: () => clock });
  const D = "sandbox-driver";
  const steps = [];
  const add = (title, detail) => steps.push({ at: new Date(clock).toISOString(), title, detail, balance: ledger.balance(D) });

  fares.forEach((fare, i) => {
    clock += 50 * 60000;
    const r = ledger.recordCompletedTrip({ trip_id: `sbx-trip-${i + 1}`, driver_id: D, fare_minor: fare, booking_fee_minor: bookingFee, payment_method: "cash", status: "completed" });
    add(`Cash trip ${i + 1} completed`, { receipt: r.receipt.number, fare_collected_minor: fare, driver_earnings_minor: r.trip.driver_earnings_minor, commission_owed_minor: r.trip.commission_minor });
  });
  clock += 20 * 60000;
  const direct = ledger.recordCompletedTrip({ trip_id: "sbx-trip-direct", driver_id: D, fare_minor: fares[2], booking_fee_minor: bookingFee, payment_method: "direct_to_driver", status: "completed" });
  add("Rider paid the driver's own EcoCash", { receipt: direct.receipt.number, fare_collected_minor: fares[2], driver_earnings_minor: direct.trip.driver_earnings_minor, commission_owed_minor: direct.trip.commission_minor, note: "Paid to the driver directly, so commission is owed like cash." });
  clock += 20 * 60000;
  const inApp = ledger.recordCompletedTrip({ trip_id: "sbx-trip-in-app", driver_id: D, fare_minor: fares[0], booking_fee_minor: bookingFee, payment_method: "in_app", status: "completed", commission_collection: { verified: true, provider_ref: "sbx-col-demo", state: "collected" } });
  add("In-app EcoCash trip, collection verified", { charged: inApp.charged, note: "Harvey's collection of the commission is verified, so it isn't charged again." });
  clock += 10 * 60000;
  ledger.openDispute({ trip_id: "sbx-trip-3", driver_id: D, reason: "Rider says they paid less" });
  add("Driver disputes trip 3", { note: "The disputed amount still counts toward the unpaid limit; with no dispute allowances set, it is still due before the next shift.", disputes: ledger.disputesExempt(D).reason });
  add("New cash trip offers", ledger.canReceiveCashOffer({ driver_id: D }));
  add("Driver mid-trip", { ...ledger.canStartShift({ driver_id: D, has_accepted_or_active_trip: true }), note: "An accepted or active trip is never interrupted." });
  clock += 8 * 3600000;
  add("Next shift: driver tries to go online", ledger.canStartShift({ driver_id: D }));
  ledger.resolveDispute({ dispute_id: "dsp-sbx-trip-3", outcome: "rejected", actor: "admin:sandbox-reviewer" });
  add("Reviewer rejects the dispute", { note: "Trip 3's commission is owed again; the driver can't dispute it a second time." });

  const sandboxWallet = "0771111111"; // the sandbox's test number (every market)
  const { settlement } = await ledger.startSettlement({ driver_id: D, phone: sandboxWallet, idempotency_key: "sbx-key-1" });
  add("Driver pays commission (sandbox; provider unconfirmed)", { amount_minor: settlement.amount_minor, provider_ref: settlement.provider_ref });
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
    test_values: { commission_rate: DEMO_COMMISSION.rate, unpaid_limit_minor: limit, note: "Demonstration values only, not approved rates. No commission rate, unpaid limit or dispute allowance is set for this market." },
    steps,
    receipts: ledger.receipts(D),
    audit: ledger.audit()
  };
}

module.exports = { runCashCommissionPreview };
