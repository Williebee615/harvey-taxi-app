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
// A ride paid in-app is excluded ONLY when Harvey Taxi's collection of its
// commission is verified (lib/payments/marketplaceLedger.js reached a
// collected state on a verified provider confirmation). Any other payment
// the driver received directly (cash, EcoCash to the driver's own wallet,
// or an in-app payment not yet verified) records commission owed here. If an
// in-app collection is verified later, its entry is reversed (or credited if
// already paid), so a driver is never charged twice for one ride.
//
// Disputes can't be used to skip payment: disputed commission always counts
// toward the unpaid limit, each trip can be disputed once, and a dispute
// only exempts its amount from the pre-shift requirement within allowances
// the owner sets (none are set, so today every disputed amount must be
// settled or resolved first). An admin may grant a time-limited, audited
// override; it never clears what is owed.

const markets = require("../markets");
const { splitFare } = require("./marketplaceLedger");

// In-app ride payment states (marketplaceLedger.STATES) in which Harvey's
// commission has been collected.
const COLLECTED_STATES = ["collected", "payable", "payout_pending", "paid_out"];
const PAYMENT_METHODS = ["cash", "direct_to_driver", "in_app"];
const OVERRIDE_SCOPES = ["next_shift", "cash_offers"];
const OVERRIDE_MAX_HOURS = 24;

function minor(n, what) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a whole number of minor units`);
  return n;
}

// sandbox: true is required (there is no live mode). In sandbox the
// commission rate and the unpaid limit are passed in as TEST values, because
// the markets have none set; the market's own settings are used otherwise.
function createCashCommissionLedger({ market_id, sandbox, provider, test_commission, test_unpaid_limit_minor, test_dispute_policy, now = () => Date.now() }) {
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
  // Dispute allowances: owner-set per market. Unset (null) means no
  // exemption at all; tests may pass demonstration values.
  const disputePolicy = { max_open_disputes: null, max_disputed_minor: null, max_rejected_disputes: null, ...(cfg.dispute_policy || {}), ...(test_dispute_policy || {}) };
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
    if (!drivers.has(id)) drivers.set(id, { credit_minor: 0, open_settlement: null, rejected_disputes: 0, overrides: [] });
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

  // Whether this driver's open disputes may be set aside before the next
  // shift. Every allowance must be set and met; otherwise disputed amounts
  // are due like any other.
  function disputesExempt(driver_id) {
    if (cfg.disputed_blocks_shift) return { exempt: false, reason: "market_requires_settlement" };
    const p = disputePolicy;
    if (p.max_open_disputes == null || p.max_disputed_minor == null || p.max_rejected_disputes == null) return { exempt: false, reason: "dispute_allowances_not_set" };
    const open = [...disputes.values()].filter((x) => x.driver_id === driver_id && x.status === "open").length;
    const b = balance(driver_id);
    if (open > p.max_open_disputes) return { exempt: false, reason: "too_many_open_disputes" };
    if (b.disputed_minor > p.max_disputed_minor) return { exempt: false, reason: "disputed_amount_over_allowance" };
    if (driver(driver_id).rejected_disputes >= p.max_rejected_disputes) return { exempt: false, reason: "repeated_rejected_disputes" };
    return { exempt: true };
  }

  // What must be settled before the next shift.
  function dueBeforeShift(driver_id) {
    const b = balance(driver_id);
    const disputed = disputesExempt(driver_id).exempt ? 0 : b.disputed_minor;
    return Math.max(0, b.outstanding_minor + disputed - b.credit_minor);
  }

  // A live (unexpired, unused) admin override for this driver and scope.
  function activeOverride(driver_id, scope) {
    return driver(driver_id).overrides.find((o) => o.scope === scope && !o.used && now() < o.expires_at) || null;
  }

  return {
    market_id,
    sandbox: true,
    config: cfg,

    // After each completed trip.
    //   cash             rider paid the driver in cash
    //   direct_to_driver rider paid the driver directly (e.g. EcoCash to the
    //                    driver's own wallet): same as cash
    //   in_app           rider paid Harvey Taxi in the app; excluded only with
    //                    commission_collection = { verified: true, provider_ref,
    //                    state in COLLECTED_STATES }
    recordCompletedTrip({ trip_id, driver_id, fare_minor, booking_fee_minor = 0, payment_method, status, commission_collection }) {
      if (trips.has(trip_id)) return { duplicate: true, trip: trips.get(trip_id) };
      if (status !== "completed") throw new Error("only completed trips are recorded");
      if (!PAYMENT_METHODS.includes(payment_method)) throw new Error(`payment method must be one of ${PAYMENT_METHODS.join(", ")}`);
      const cc = commission_collection;
      const verified = payment_method === "in_app" && cc && cc.verified === true && typeof cc.provider_ref === "string" && cc.provider_ref !== "" && COLLECTED_STATES.includes(cc.state);
      if (verified) {
        log("trip_not_charged", { trip_id, driver_id, payment_method, provider_ref: cc.provider_ref, collection_state: cc.state, reason: "commission collected in app (verified)" });
        return { charged: false, reason: "commission_collected_in_app" };
      }
      minor(fare_minor, "fare");
      const split = splitFare({ total_minor: fare_minor, booking_fee_minor, commission });
      const source = payment_method === "in_app" ? "in_app_unverified" : payment_method;
      const trip = { trip_id, driver_id, fare_minor, driver_earnings_minor: split.driver_share_minor, commission_minor: split.commission_minor, state: "owed", source, recorded_at: new Date(now()).toISOString() };
      trips.set(trip_id, trip);
      const r = receipt("cash_trip", driver_id, { trip_id, payment: source, fare_collected_minor: fare_minor, driver_earnings_minor: trip.driver_earnings_minor, commission_owed_minor: trip.commission_minor });
      log("cash_trip_recorded", { trip_id, driver_id, payment: source, fare_minor, commission_minor: trip.commission_minor, receipt: r.number, balance_after: balance(driver_id) });
      return { charged: true, trip, receipt: r };
    },

    // An in-app collection recorded as unverified is later verified: the
    // entry is reversed (credited if the driver already paid it).
    confirmInAppCollection({ trip_id, commission_collection }) {
      const t = trips.get(trip_id);
      if (!t || t.source !== "in_app_unverified") throw new Error("no unverified in-app trip");
      const cc = commission_collection;
      if (!(cc && cc.verified === true && cc.provider_ref && COLLECTED_STATES.includes(cc.state))) throw new Error("collection not verified");
      if (t.state === "voided") return { duplicate: true };
      const prev = t.state;
      if (prev === "disputed") throw new Error("resolve the dispute first");
      if (prev === "settled") driver(t.driver_id).credit_minor += t.commission_minor;
      t.state = "voided";
      log("in_app_collection_verified", { trip_id, driver_id: t.driver_id, provider_ref: cc.provider_ref, previous_state: prev, commission_minor: t.commission_minor, balance_after: balance(t.driver_id) });
      return { reversed_minor: t.commission_minor, credited: prev === "settled" };
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
      // One dispute per trip: a resolved dispute can't be reopened.
      if (disputes.has(id)) throw new Error("this trip has already been disputed");
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
      if (outcome === "rejected") {
        t.state = "owed";
        driver(d.driver_id).rejected_disputes += 1;
      }
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
    disputesExempt,

    // Admin override: lets a driver start ONE next shift, or receive cash
    // offers over the limit, for up to 24 hours. Needs a named admin and a
    // reason; audited; never reduces what is owed.
    grantOverride({ driver_id, scope, actor, reason, hours = 12 }) {
      if (!OVERRIDE_SCOPES.includes(scope)) throw new Error(`scope must be one of ${OVERRIDE_SCOPES.join(", ")}`);
      if (!actor || !String(actor).startsWith("admin:")) throw new Error("a named admin is required");
      if (!reason || String(reason).trim().length < 10) throw new Error("a reason of at least 10 characters is required");
      if (!(hours > 0 && hours <= OVERRIDE_MAX_HOURS)) throw new Error(`an override lasts at most ${OVERRIDE_MAX_HOURS} hours`);
      const o = { id: `ovr-${seq + 1}`, driver_id, scope, actor, reason: String(reason).trim(), granted_at: now(), expires_at: now() + hours * 3600000, used: false };
      driver(driver_id).overrides.push(o);
      log("override_granted", { override_id: o.id, driver_id, scope, actor, reason: o.reason, expires_at: new Date(o.expires_at).toISOString(), balance_at_grant: balance(driver_id) });
      return { ...o };
    },

    // Shift gate: settle before the NEXT shift. A driver with an accepted or
    // active trip is never stopped mid-trip. Pass start: true when the driver
    // actually goes online, so a next-shift override is used up.
    canStartShift({ driver_id, has_accepted_or_active_trip = false, start = false }) {
      if (has_accepted_or_active_trip) return { allowed: true, reason: "accepted_or_active_trip_never_interrupted" };
      const due = dueBeforeShift(driver_id);
      if (!(cfg.settle_before_next_shift && due > 0)) return { allowed: true };
      const o = activeOverride(driver_id, "next_shift");
      if (o) {
        if (start) {
          o.used = true;
          log("override_used", { override_id: o.id, driver_id, scope: o.scope, actor: o.actor, due_minor: due });
        }
        return { allowed: true, reason: "admin_override", override_id: o.id, due_minor: due };
      }
      const blocked = { allowed: false, reason: "settle_commission", due_minor: due };
      if (balance(driver_id).disputed_minor > 0) {
        const exempt = disputesExempt(driver_id);
        blocked.disputes = exempt.exempt ? "set_aside" : exempt.reason;
      }
      return blocked;
    },

    // Unpaid-balance limit: at or over it, no NEW cash trip offers. Disputed
    // amounts always count. Trips already accepted or in progress continue;
    // in-app paid offers are not affected.
    canReceiveCashOffer({ driver_id }) {
      if (unpaidLimit === null || unpaidLimit === undefined) return { allowed: false, reason: "unpaid_limit_not_set" };
      const b = balance(driver_id);
      const owed = b.outstanding_minor + b.disputed_minor - b.credit_minor;
      if (owed >= unpaidLimit) {
        const o = activeOverride(driver_id, "cash_offers");
        if (o) return { allowed: true, reason: "admin_override", override_id: o.id, owed_minor: owed, limit_minor: unpaidLimit };
        return { allowed: false, reason: "unpaid_limit_reached", owed_minor: owed, limit_minor: unpaidLimit };
      }
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
