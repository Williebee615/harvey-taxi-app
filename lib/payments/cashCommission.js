"use strict";
// Cash trips with a driver commission ledger. SANDBOX ONLY.
//
// The rider pays the driver in cash. After each completed cash trip Harvey
// Taxi records the fare the driver collected, the driver's earnings and the
// commission the driver owes. Before the driver's next shift the commission
// must be settled through the market's approved payment provider (Zimbabwe:
// EcoCash via Paynow). Only a verified provider confirmation clears it.
// Nothing here ever interrupts an accepted or active trip.
//
// Per market, from lib/markets.js `cash_commission`; disabled everywhere and
// absent for the US. Design and comparison: docs/markets/cash-commission.md.
//
// Rides paid in-app (EcoCash) are NOT charged here: their commission is kept
// when the fare is collected (lib/payments/marketplaceLedger.js), so a driver
// is never charged twice for one ride.

const markets = require("../markets");
const { splitFare } = require("./marketplaceLedger");

function minor(n, what) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a whole number of minor units`);
  return n;
}

// sandbox: true is required (there is no live mode). In sandbox the
// commission rate and the unpaid limit are passed in as TEST values, because
// the markets have none set; the market's own settings are used otherwise.
function createCashCommissionLedger({ market_id, sandbox, provider, test_commission, test_unpaid_limit_minor, now = () => Date.now() }) {
  const market = markets.getMarket(market_id);
  if (!market) throw new Error(`unknown market ${market_id}`);
  const cfg = market.cash_commission;
  if (!cfg) throw new Error(`cash commission is not available in ${market.name}`);
  if (sandbox !== true) {
    // The live path stays shut until the owner approves this market and its
    // provider, and sets the rate and limit. Nothing below is wired to the
    // server either.
    throw new Error(`cash commission is disabled in ${market.name} pending owner approval`);
  }
  if (!provider || provider.live !== false) throw new Error("a sandbox provider is required");
  const commission = test_commission || market.pricing.commission;
  const unpaidLimit = test_unpaid_limit_minor !== undefined ? test_unpaid_limit_minor : cfg.unpaid_limit_minor;
  const prefix = `HT-${market.country}`;

  const trips = new Map(); // trip_id -> trip record
  const drivers = new Map(); // driver_id -> { credit_minor, open_settlement }
  const settlements = new Map(); // settlement_id -> record
  const settlementByRef = new Map();
  const disputes = new Map();
  const seenUpdates = new Set();
  const receipts = [];
  const audit = [];
  let receiptSeq = 0;
  let seq = 0;

  const driver = (id) => {
    if (!drivers.has(id)) drivers.set(id, { credit_minor: 0, open_settlement: null });
    return drivers.get(id);
  };

  function log(action, detail) {
    const entry = Object.freeze({ seq: ++seq, at: new Date(now()).toISOString(), market_id, action, ...detail });
    audit.push(entry);
    return entry;
  }

  function receipt(kind, driver_id, lines) {
    const r = Object.freeze({ number: `${prefix}-${String(++receiptSeq).padStart(6, "0")}`, kind, driver_id, market_id, currency: cfg.settlement_currency, issued_at: new Date(now()).toISOString(), ...lines });
    receipts.push(r);
    return r;
  }

  // Outstanding, disputed and in-settlement amounts for a driver.
  function balance(driver_id) {
    let outstanding = 0;
    let disputed = 0;
    for (const t of trips.values()) {
      if (t.driver_id !== driver_id) continue;
      if (t.state === "owed") outstanding += t.commission_minor;
      if (t.state === "disputed") disputed += t.commission_minor;
    }
    const d = driver(driver_id);
    const open = d.open_settlement && settlements.get(d.open_settlement);
    return { outstanding_minor: outstanding, disputed_minor: disputed, credit_minor: d.credit_minor, pending_settlement_minor: open ? open.amount_minor : 0 };
  }

  // What must be settled before the next shift (disputed amounts optionally
  // excluded while under review).
  function dueBeforeShift(driver_id) {
    const b = balance(driver_id);
    return Math.max(0, b.outstanding_minor + (cfg.disputed_blocks_shift ? b.disputed_minor : 0) - b.credit_minor);
  }

  return {
    market_id,
    sandbox: true,
    config: cfg,

    // After each completed trip. EcoCash-paid (in-app) trips aren't charged.
    recordCompletedTrip({ trip_id, driver_id, fare_minor, booking_fee_minor = 0, payment_method, status }) {
      if (trips.has(trip_id)) return { duplicate: true, trip: trips.get(trip_id) };
      if (status !== "completed") throw new Error("only completed trips are recorded");
      if (payment_method !== "cash") {
        log("trip_not_charged", { trip_id, driver_id, payment_method, reason: "paid in app; commission taken at collection" });
        return { charged: false, reason: "paid_in_app" };
      }
      minor(fare_minor, "fare");
      const split = splitFare({ total_minor: fare_minor, booking_fee_minor, commission });
      const trip = { trip_id, driver_id, fare_minor, driver_earnings_minor: split.driver_share_minor, commission_minor: split.commission_minor, state: "owed", recorded_at: new Date(now()).toISOString() };
      trips.set(trip_id, trip);
      const r = receipt("cash_trip", driver_id, { trip_id, fare_collected_minor: fare_minor, driver_earnings_minor: trip.driver_earnings_minor, commission_owed_minor: trip.commission_minor });
      log("cash_trip_recorded", { trip_id, driver_id, fare_minor, commission_minor: trip.commission_minor, receipt: r.number, balance_after: balance(driver_id) });
      return { charged: true, trip, receipt: r };
    },

    // A cancelled trip owes nothing. A recorded trip later voided (for
    // example cancelled after a wrongful completion) has its commission
    // reversed, unless it was already settled (then it becomes credit).
    cancelTrip({ trip_id, driver_id, reason, actor = "system" }) {
      const t = trips.get(trip_id);
      if (!t) {
        log("trip_cancelled_no_commission", { trip_id, driver_id, reason, actor });
        return { commission_minor: 0 };
      }
      if (t.state === "voided") return { duplicate: true };
      const prev = t.state;
      if (prev === "settled") driver(t.driver_id).credit_minor += t.commission_minor;
      t.state = "voided";
      log("cash_trip_voided", { trip_id, driver_id: t.driver_id, reason, actor, previous_state: prev, commission_minor: t.commission_minor, balance_after: balance(t.driver_id) });
      return { reversed_minor: t.commission_minor, credited: prev === "settled" };
    },

    openDispute({ trip_id, driver_id, reason }) {
      const t = trips.get(trip_id);
      if (!t || t.driver_id !== driver_id) throw new Error("no such trip for this driver");
      if (t.state !== "owed") throw new Error(`only owed commission can be disputed (state ${t.state})`);
      const id = `dsp-${trip_id}`;
      t.state = "disputed";
      disputes.set(id, { id, trip_id, driver_id, reason, status: "open" });
      log("dispute_opened", { dispute_id: id, trip_id, driver_id, reason, balance_after: balance(driver_id) });
      return disputes.get(id);
    },

    // upheld: commission removed (or reduced to adjusted_commission_minor);
    // rejected: owed again.
    resolveDispute({ dispute_id, outcome, adjusted_commission_minor, actor }) {
      const d = disputes.get(dispute_id);
      if (!d || d.status !== "open") throw new Error("no open dispute");
      if (!actor) throw new Error("a reviewer is required");
      const t = trips.get(d.trip_id);
      if (outcome === "rejected") t.state = "owed";
      else if (outcome === "upheld") {
        if (adjusted_commission_minor === undefined) t.state = "voided";
        else {
          t.commission_minor = minor(Math.min(adjusted_commission_minor, t.commission_minor), "adjusted commission");
          t.driver_earnings_minor = t.fare_minor - t.commission_minor;
          t.state = t.commission_minor === 0 ? "voided" : "owed";
        }
      } else throw new Error("outcome must be upheld or rejected");
      d.status = outcome;
      log("dispute_resolved", { dispute_id, trip_id: d.trip_id, driver_id: d.driver_id, outcome, actor, commission_minor: t.commission_minor, balance_after: balance(d.driver_id) });
      return { ...d, commission_minor: t.commission_minor };
    },

    balance,
    dueBeforeShift,

    // Shift gate: settle before the NEXT shift. A driver with an accepted or
    // active trip is never stopped mid-trip.
    canStartShift({ driver_id, has_accepted_or_active_trip = false }) {
      if (has_accepted_or_active_trip) return { allowed: true, reason: "accepted_or_active_trip_never_interrupted" };
      const due = dueBeforeShift(driver_id);
      if (cfg.settle_before_next_shift && due > 0) return { allowed: false, reason: "settle_commission", due_minor: due };
      return { allowed: true };
    },

    // Unpaid-balance limit: at or over it, no NEW cash trip offers. Trips
    // already accepted or in progress continue; in-app paid offers are not
    // affected.
    canReceiveCashOffer({ driver_id }) {
      if (unpaidLimit === null || unpaidLimit === undefined) return { allowed: false, reason: "unpaid_limit_not_set" };
      const owed = balance(driver_id).outstanding_minor - driver(driver_id).credit_minor;
      if (owed >= unpaidLimit) return { allowed: false, reason: "unpaid_limit_reached", owed_minor: owed, limit_minor: unpaidLimit };
      return { allowed: true };
    },

    // Driver pays what is due through the provider. One open settlement per
    // driver; the same idempotency key returns the same settlement.
    async startSettlement({ driver_id, phone, idempotency_key }) {
      if (!idempotency_key) throw new Error("idempotency key required");
      for (const st of settlements.values()) if (st.idempotency_key === idempotency_key) return { existing: true, settlement: st };
      const d = driver(driver_id);
      if (d.open_settlement) return { existing: true, settlement: settlements.get(d.open_settlement) };
      const due = dueBeforeShift(driver_id);
      const owedTrips = [...trips.values()].filter((t) => t.driver_id === driver_id && t.state === "owed");
      const covers = owedTrips.map((t) => t.trip_id);
      const owedTotal = owedTrips.reduce((a, t) => a + t.commission_minor, 0);
      // Existing credit (an earlier overpayment or a reversed settled trip)
      // is used first.
      const credit_used = Math.min(d.credit_minor, owedTotal);
      if (due <= 0) {
        if (credit_used > 0) {
          d.credit_minor -= credit_used;
          let left = credit_used;
          for (const t of owedTrips) if (left >= t.commission_minor) { t.state = "settled"; left -= t.commission_minor; }
          d.credit_minor += left;
          const r = receipt("credit_applied", driver_id, { amount_applied_minor: credit_used - left, trips: covers });
          log("credit_applied", { driver_id, amount_minor: credit_used - left, receipt: r.number, balance_after: balance(driver_id) });
        }
        return { nothing_due: true };
      }
      const id = `stl-${settlements.size + 1}`;
      const res = await provider.initiateCollection({ reference: `${prefix}-commission-${id}`, amount_minor: due, phone });
      const st = { id, driver_id, idempotency_key, amount_minor: due, credit_used, covers, provider_ref: res.provider_ref, status: "pending" };
      settlements.set(id, st);
      settlementByRef.set(res.provider_ref, id);
      d.open_settlement = id;
      log("settlement_started", { settlement_id: id, driver_id, amount_minor: due, provider_ref: res.provider_ref });
      return { settlement: st };
    },

    // Provider status update. `verified` means the adapter checked the
    // provider's signature/hash (sandbox: the test passes it). Unverified,
    // duplicate, unknown or wrong-amount updates never clear a balance.
    applySettlementUpdate(update, { verified }) {
      if (!verified) {
        log("settlement_update_rejected", { provider_ref: update.provider_ref, reason: "unverified" });
        return { ignored: "unverified" };
      }
      if (seenUpdates.has(update.update_id)) return { ignored: "duplicate" };
      seenUpdates.add(update.update_id);
      const id = settlementByRef.get(update.provider_ref);
      if (!id) {
        log("settlement_update_rejected", { provider_ref: update.provider_ref, reason: "unknown_reference" });
        return { ignored: "unknown_reference" };
      }
      const st = settlements.get(id);
      const d = driver(st.driver_id);
      if (update.status !== "paid") {
        if (st.status === "pending") {
          st.status = "failed";
          d.open_settlement = null;
          log("settlement_failed", { settlement_id: id, driver_id: st.driver_id, status: update.status });
        }
        return { status: st.status };
      }
      if (update.amount_minor !== st.amount_minor) {
        log("settlement_held", { settlement_id: id, reason: "amount_mismatch", expected: st.amount_minor, got: update.amount_minor });
        return { held: "amount_mismatch" };
      }
      if (st.status === "paid") return { ignored: "already_paid" };
      // A payment that arrives after this settlement was closed (failed or
      // superseded) is credit, never a second clearing.
      if (st.status !== "pending") {
        d.credit_minor += update.amount_minor;
        log("payment_credited", { settlement_id: id, driver_id: st.driver_id, amount_minor: update.amount_minor, reason: "payment for a closed settlement" });
        return { credited: update.amount_minor };
      }
      st.status = "paid";
      d.open_settlement = null;
      d.credit_minor -= st.credit_used;
      let left = st.amount_minor + st.credit_used;
      for (const tid of st.covers) {
        const t = trips.get(tid);
        if (t.state === "owed" && left >= t.commission_minor) {
          t.state = "settled";
          left -= t.commission_minor;
        }
      }
      // Anything not applied (a covered trip voided or disputed meanwhile) is
      // kept as credit against the next balance.
      if (left > 0) d.credit_minor += left;
      const r = receipt("commission_settlement", st.driver_id, { settlement_id: id, amount_paid_minor: st.amount_minor, provider_ref: st.provider_ref, trips: st.covers, credit_minor: left });
      log("settlement_confirmed", { settlement_id: id, driver_id: st.driver_id, amount_minor: st.amount_minor, credit_minor: left, receipt: r.number, balance_after: balance(st.driver_id) });
      return { status: "paid", receipt: r };
    },

    receipts: (driver_id) => receipts.filter((r) => !driver_id || r.driver_id === driver_id),
    audit: () => audit.slice(),
    trip: (trip_id) => trips.get(trip_id)
  };
}

module.exports = { createCashCommissionLedger };
