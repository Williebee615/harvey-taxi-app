// Stateful stand-in for the Stripe PaymentIntents API, used by the
// isolated suite when no Stripe TEST key is available. It models only what
// the card flow relies on: manual-capture intents, confirmation with a
// test card (pm_card_visa succeeds, pm_card_chargeDeclined is declined),
// metadata updates, and idempotent cancellation of uncaptured intents.
// It is NOT a substitute for the real test-mode run -- it lets the
// database, dispatch and concurrency paths be exercised end to end.

const crypto = require("crypto");

const CANCELLABLE = new Set(["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"]);

function stripeError(type, code, message) {
  const err = new Error(message);
  err.type = type;
  err.code = code;
  err.raw = { type, code, message };
  return err;
}

function createStripeSimulator() {
  const intents = new Map();
  const idempotent = new Map();
  const createKeys = new Map();
  const failCancelFor = new Set();
  let seq = 0;
  const copy = (pi) => JSON.parse(JSON.stringify(pi));
  const tick = () => new Promise((r) => setImmediate(r));

  function get(id) {
    const pi = intents.get(id);
    if (!pi) throw stripeError("invalid_request_error", "resource_missing", `No such payment_intent: '${id}'`);
    return pi;
  }

  const paymentIntents = {
    async create(params = {}, options = {}) {
      await tick();
      // Stripe idempotency: the same key returns the same intent.
      const key = options && options.idempotencyKey;
      if (key && createKeys.has(key)) return copy(intents.get(createKeys.get(key)));
      const id = `pi_sim_${crypto.randomBytes(8).toString("hex")}`;
      if (key) createKeys.set(key, id);
      const pi = {
        id,
        object: "payment_intent",
        amount: params.amount,
        amount_capturable: 0,
        currency: params.currency || "usd",
        capture_method: params.capture_method || "automatic",
        payment_method_types: params.payment_method_types || ["card"],
        metadata: { ...(params.metadata || {}) },
        status: "requires_payment_method",
        client_secret: `${id}_secret_${crypto.randomBytes(8).toString("hex")}`,
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        _seq: ++seq
      };
      intents.set(id, pi);
      return copy(pi);
    },
    async confirm(id, { payment_method: pm } = {}) {
      await tick();
      const pi = get(id);
      if (pm === "pm_card_chargeDeclined") {
        pi.status = "requires_payment_method";
        pi.last_payment_error = { code: "card_declined", decline_code: "generic_decline" };
        throw stripeError("card_error", "card_declined", "Your card was declined.");
      }
      pi.status = pi.capture_method === "manual" ? "requires_capture" : "succeeded";
      pi.amount_capturable = pi.status === "requires_capture" ? pi.amount : 0;
      pi.payment_method = "pm_sim_visa";
      return copy(pi);
    },
    async retrieve(id) {
      await tick();
      return copy(get(id));
    },
    async update(id, params = {}) {
      await tick();
      const pi = get(id);
      if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata };
      return copy(pi);
    },
    async cancel(id, params = {}, options = {}) {
      await tick();
      const key = options && options.idempotencyKey;
      if (key && idempotent.has(key)) return copy(idempotent.get(key));
      const pi = get(id);
      if (failCancelFor.has(id) || failCancelFor.has("*")) {
        throw stripeError("api_error", "simulated_outage", "Simulated Stripe outage.");
      }
      if (!CANCELLABLE.has(pi.status)) {
        throw stripeError("invalid_request_error", "payment_intent_unexpected_state", `This PaymentIntent's status is ${pi.status}.`);
      }
      pi.status = "canceled";
      pi.amount_capturable = 0;
      pi.cancellation_reason = params.cancellation_reason || null;
      if (key) idempotent.set(key, copy(pi));
      return copy(pi);
    },
    // Newest first, like Stripe; starting_after continues to older ones.
    async list({ created = {}, limit = 10, starting_after: startingAfter } = {}) {
      await tick();
      let all = [...intents.values()]
        .filter((pi) => (created.lte === undefined || pi.created <= created.lte) && (created.gte === undefined || pi.created >= created.gte))
        .sort((a, b) => b.created - a.created || b._seq - a._seq);
      if (startingAfter) {
        const idx = all.findIndex((pi) => pi.id === startingAfter);
        all = idx >= 0 ? all.slice(idx + 1) : [];
      }
      const page = all.slice(0, limit);
      return { object: "list", data: page.map(copy), has_more: all.length > limit };
    },
    async capture() {
      throw stripeError("invalid_request_error", "not_simulated", "Capture is not part of this suite.");
    }
  };

  return {
    paymentIntents,
    _intents: intents,
    // Test controls (not part of Stripe's API).
    _age(id, seconds) {
      get(id).created -= seconds;
    },
    _failCancel(id, on = true) {
      if (on) failCancelFor.add(id);
      else failCancelFor.delete(id);
    }
  };
}

module.exports = { createStripeSimulator };
