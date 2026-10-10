"use strict";
// Marketplace ride payments, provider-neutral: Harvey Taxi collects the
// rider's fare, records its commission, and owes the driver the rest until a
// payout is confirmed. Design: docs/markets/zimbabwe-payments.md.
//
// SANDBOX ONLY. Nothing here talks to a payment provider; a provider is
// passed in (lib/payments/sandboxEcocash.js in tests). No live provider
// adapter exists, and none should be written until the provider confirms in
// writing that this arrangement (collect for drivers, pay out their share)
// is allowed on the account.
//
// Money is integer minor units (cents). Every event appends balanced ledger
// entries (they sum to zero), so the books can be checked at any time.

const STATES = Object.freeze({
  CREATED: "created",
  COLLECTION_PENDING: "collection_pending",
  COLLECTED: "collected", // rider paid; ride not yet completed
  COLLECTION_FAILED: "collection_failed",
  PAYABLE: "payable", // ride completed; driver's share owed
  PAYOUT_PENDING: "payout_pending",
  PAID_OUT: "paid_out",
  REFUNDED: "refunded" // fully refunded before payout
});

const FEE_BEARERS = ["platform", "driver", "shared"];

function assertMinor(n, what) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a whole number of cents`);
}

// The commission rate comes only from the market's configuration. An unset
// rate (null) stops here: no split is ever computed with a guessed rate.
function assertRate(commission) {
  if (!commission || typeof commission.rate !== "number") throw new Error("commission rate not set for this market");
  if (!(commission.rate >= 0 && commission.rate < 1)) throw new Error("commission rate must be at least 0 and below 1");
}

// Fare split. Harvey Taxi keeps the booking fee plus `rate` of the rest;
// the driver gets the remainder. Rounding goes to the driver's side so the
// two parts always add up to the total exactly.
function splitFare({ total_minor, booking_fee_minor = 0, commission }) {
  assertMinor(total_minor, "total");
  assertMinor(booking_fee_minor, "booking fee");
  assertRate(commission);
  if (booking_fee_minor > total_minor) throw new Error("booking fee exceeds total");
  const eligible = total_minor - booking_fee_minor;
  const commissionMinor = booking_fee_minor + Math.floor(eligible * commission.rate);
  return { commission_minor: commissionMinor, driver_share_minor: total_minor - commissionMinor };
}

// Provider's collection fee, and who carries it (an owner decision, so it
// has no default).
function allocateFee({ fee_minor, bearer, driver_share_minor }) {
  assertMinor(fee_minor, "provider fee");
  if (!FEE_BEARERS.includes(bearer)) throw new Error(`fee bearer must be one of ${FEE_BEARERS.join(", ")}`);
  if (bearer === "platform") return { platform_fee_minor: fee_minor, driver_fee_minor: 0 };
  if (bearer === "driver") {
    const driverPart = Math.min(fee_minor, driver_share_minor);
    return { platform_fee_minor: fee_minor - driverPart, driver_fee_minor: driverPart };
  }
  const driverPart = Math.min(Math.floor(fee_minor / 2), driver_share_minor);
  return { platform_fee_minor: fee_minor - driverPart, driver_fee_minor: driverPart };
}

class RidePayment {
  // config: { market_id, currency, commission: {rate}, fee_bearer,
  //           settlement_days, payout_min_minor }
  constructor({ ride_id, driver_id, rider_phone, total_minor, booking_fee_minor = 0, config, provider, now = () => Date.now() }) {
    if (!provider || provider.live !== false) throw new Error("a sandbox provider is required (live providers are not supported)");
    assertMinor(total_minor, "total");
    const split = splitFare({ total_minor, booking_fee_minor, commission: config.commission });
    if (!FEE_BEARERS.includes(config.fee_bearer)) throw new Error("fee bearer not set for this market");
    this.ride_id = ride_id;
    this.driver_id = driver_id;
    this.rider_phone = rider_phone;
    this.config = config;
    this.provider = provider;
    this.now = now;
    this.total_minor = total_minor;
    this.split = split;
    this.state = STATES.CREATED;
    this.collected_at = null;
    this.provider_ref = null;
    this.seen_updates = new Set();
    this.refunded_minor = 0;
    this.driver_payable_minor = 0;
    this.driver_recovery_minor = 0; // owed back by the driver after a refund made post-payout
    this.entries = [];
    this.events = [];
  }

  post(event, lines) {
    const sum = lines.reduce((a, [, amt]) => a + amt, 0);
    if (sum !== 0) throw new Error(`unbalanced ledger entry for ${event}: ${sum}`);
    for (const [account, amount_minor] of lines) if (amount_minor !== 0) this.entries.push({ event, account, amount_minor });
  }

  record(type, detail = {}) {
    this.events.push({ type, at: new Date(this.now()).toISOString(), ...detail });
  }

  balance(account) {
    return this.entries.filter((e) => e.account === account).reduce((a, e) => a + e.amount_minor, 0);
  }

  // 1. Ask the rider's EcoCash wallet for the fare (USSD/PIN prompt).
  async startCollection() {
    if (this.state !== STATES.CREATED && this.state !== STATES.COLLECTION_FAILED) throw new Error(`cannot collect from state ${this.state}`);
    const res = await this.provider.initiateCollection({ reference: `ride-${this.ride_id}`, amount_minor: this.total_minor, phone: this.rider_phone });
    this.provider_ref = res.provider_ref;
    this.state = STATES.COLLECTION_PENDING;
    this.record("collection_started", { provider_ref: res.provider_ref });
    return res;
  }

  // 2. Provider status update (callback or poll). Idempotent per update id;
  // an amount that doesn't match holds the payment for review.
  applyCollectionUpdate(update) {
    if (this.seen_updates.has(update.update_id)) return { ignored: "duplicate" };
    this.seen_updates.add(update.update_id);
    if (update.provider_ref !== this.provider_ref) return { ignored: "other_transaction" };
    if (this.state !== STATES.COLLECTION_PENDING) return { ignored: `state_${this.state}` };
    if (update.status === "paid") {
      if (update.amount_minor !== this.total_minor) {
        this.record("amount_mismatch", { expected: this.total_minor, got: update.amount_minor });
        return { held: "amount_mismatch" };
      }
      const fee = allocateFee({ fee_minor: update.fee_minor || 0, bearer: this.config.fee_bearer, driver_share_minor: this.split.driver_share_minor });
      this.fee = fee;
      // Cash at the provider (net of its fee) against what is owed: Harvey's
      // commission less its part of the fee, and the driver's share less
      // theirs. The driver's share is held (not yet payable) until the ride
      // is completed.
      this.post("collected", [
        ["provider_clearing", this.total_minor - (update.fee_minor || 0)],
        ["provider_fees", update.fee_minor || 0],
        ["platform_commission", -this.split.commission_minor],
        ["driver_held", -this.split.driver_share_minor]
      ]);
      this.post("fee_allocated", [
        ["provider_fees", -(update.fee_minor || 0)],
        ["platform_commission", fee.platform_fee_minor],
        ["driver_held", fee.driver_fee_minor]
      ]);
      this.collected_at = this.now();
      this.state = STATES.COLLECTED;
      this.record("collected", { fee_minor: update.fee_minor || 0 });
      return { state: this.state };
    }
    this.state = STATES.COLLECTION_FAILED;
    this.record("collection_failed", { status: update.status });
    return { state: this.state };
  }

  // 3. Ride completed: the driver's held share becomes payable.
  completeRide() {
    if (this.state !== STATES.COLLECTED) throw new Error(`cannot complete from state ${this.state}`);
    const held = -this.balance("driver_held");
    this.post("ride_completed", [["driver_held", held], [`driver_payable:${this.driver_id}`, -held]]);
    this.driver_payable_minor = held;
    this.state = STATES.PAYABLE;
    this.record("ride_completed", { driver_payable_minor: held });
  }

  // 4. Payout of the driver's share, only once the provider has settled the
  // collected funds (settlement_days) and above the minimum.
  payoutEligible() {
    if (this.state !== STATES.PAYABLE) return { eligible: false, reason: `state_${this.state}` };
    const settledAt = this.collected_at + this.config.settlement_days * 86400000;
    if (this.now() < settledAt) return { eligible: false, reason: "not_settled" };
    if (this.driver_payable_minor < (this.config.payout_min_minor || 0)) return { eligible: false, reason: "below_minimum" };
    return { eligible: true };
  }

  async startPayout({ driver_wallet, wallet_verified }) {
    const check = this.payoutEligible();
    if (!check.eligible) throw new Error(`payout not allowed: ${check.reason}`);
    if (!wallet_verified) throw new Error("payout not allowed: driver wallet not verified");
    const res = await this.provider.initiatePayout({ reference: `payout-${this.ride_id}`, amount_minor: this.driver_payable_minor, phone: driver_wallet });
    this.payout_ref = res.provider_ref;
    this.state = STATES.PAYOUT_PENDING;
    this.record("payout_started", { provider_ref: res.provider_ref, amount_minor: this.driver_payable_minor });
    return res;
  }

  applyPayoutUpdate(update) {
    if (this.seen_updates.has(update.update_id)) return { ignored: "duplicate" };
    this.seen_updates.add(update.update_id);
    if (update.provider_ref !== this.payout_ref || this.state !== STATES.PAYOUT_PENDING) return { ignored: "not_pending" };
    if (update.status === "paid") {
      const amt = this.driver_payable_minor;
      this.post("payout_sent", [
        [`driver_payable:${this.driver_id}`, amt],
        ["provider_clearing", -amt - (update.fee_minor || 0)],
        ["platform_commission", update.fee_minor || 0] // payout fee: Harvey's cost (owner to confirm)
      ]);
      this.driver_payable_minor = 0;
      this.state = STATES.PAID_OUT;
      this.record("paid_out", { amount_minor: amt, fee_minor: update.fee_minor || 0 });
    } else {
      this.state = STATES.PAYABLE; // stays owed; can be retried
      this.record("payout_failed", { status: update.status });
    }
    return { state: this.state };
  }

  // Refund to the rider (full or partial). Before payout the driver's and
  // Harvey's parts shrink in proportion; after payout Harvey refunds from its
  // own funds and records what the driver owes back (policy to be approved).
  async refund({ amount_minor, reason }) {
    assertMinor(amount_minor, "refund");
    if (![STATES.COLLECTED, STATES.PAYABLE, STATES.PAID_OUT].includes(this.state)) throw new Error(`cannot refund from state ${this.state}`);
    if (amount_minor === 0 || amount_minor > this.total_minor - this.refunded_minor) throw new Error("refund exceeds what was paid");
    const res = await this.provider.refund({ provider_ref: this.provider_ref, amount_minor });
    if (res.status !== "refunded") {
      this.record("refund_failed", { amount_minor, status: res.status });
      return { state: this.state, refunded: false };
    }
    // In proportion to the driver's net share (after their part of the
    // collection fee). The provider's fee isn't returned on a refund, so
    // Harvey Taxi carries it: a full refund leaves the driver at zero.
    const driverNet = this.split.driver_share_minor - this.fee.driver_fee_minor;
    const driverPart = Math.round((amount_minor * driverNet) / this.total_minor);
    const platformPart = amount_minor - driverPart;
    if (this.state === STATES.PAID_OUT) {
      this.post("refund_after_payout", [["provider_clearing", -amount_minor], ["platform_commission", platformPart], [`driver_recovery:${this.driver_id}`, driverPart]]);
      this.driver_recovery_minor += driverPart;
    } else {
      const account = this.state === STATES.COLLECTED ? "driver_held" : `driver_payable:${this.driver_id}`;
      this.post("refund", [["provider_clearing", -amount_minor], ["platform_commission", platformPart], [account, driverPart]]);
      if (this.state === STATES.PAYABLE) this.driver_payable_minor -= driverPart;
    }
    this.refunded_minor += amount_minor;
    if (this.refunded_minor === this.total_minor && this.state !== STATES.PAID_OUT) this.state = STATES.REFUNDED;
    this.record("refunded", { amount_minor, reason });
    return { state: this.state, refunded: true };
  }

  totals() {
    return {
      state: this.state,
      total_minor: this.total_minor,
      commission_minor: this.split.commission_minor,
      driver_share_minor: this.split.driver_share_minor,
      refunded_minor: this.refunded_minor,
      driver_payable_minor: this.driver_payable_minor,
      driver_recovery_minor: this.driver_recovery_minor,
      provider_clearing_minor: this.balance("provider_clearing"),
      platform_commission_minor: -this.balance("platform_commission"),
      ledger_sum: this.entries.reduce((a, e) => a + e.amount_minor, 0)
    };
  }
}

module.exports = { STATES, FEE_BEARERS, splitFare, allocateFee, RidePayment };
