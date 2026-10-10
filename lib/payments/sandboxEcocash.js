"use strict";
// Sandbox EcoCash provider for tests and simulations. It never makes a
// network call (no http, https, net or fetch), never touches a real wallet,
// and accepts only test numbers. Its numbers follow Paynow's published
// test mode for EcoCash express checkout (developers.paynow.co.zw):
//   0771111111  paid ("success after 5 seconds")
//   0772222222  paid after a delay ("success after 30 seconds")
//   0773333333  failed ("user cancelled")
// Payouts and refunds are NOT documented by Paynow's public test mode; the
// behaviour here is our assumption for tests, not the provider's.
//
// Time is simulated: `advance(seconds)` moves the clock and emits the status
// updates that would have arrived by then.

const TEST_NUMBERS = Object.freeze({
  "0771111111": { status: "paid", after_s: 5 },
  "0772222222": { status: "paid", after_s: 30 },
  "0773333333": { status: "failed", after_s: 30 }
});

// Sandbox fee: a parameter, never a published or agreed rate. Tests pass it.
function createSandboxEcocash({ collection_fee_bps = 0, payout_fee_minor = 0 } = {}) {
  let clock = 0;
  let seq = 0;
  const pending = [];
  const transactions = new Map();
  const updates = [];

  function normalise(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    const local = digits.startsWith("263") ? `0${digits.slice(3)}` : digits;
    if (!TEST_NUMBERS[local]) throw new Error("sandbox accepts only Paynow test numbers (0771111111, 0772222222, 0773333333)");
    return local;
  }

  function schedule(kind, ref, amount_minor, phone) {
    const rule = TEST_NUMBERS[phone];
    const fee = kind === "collection" ? Math.round((amount_minor * collection_fee_bps) / 10000) : payout_fee_minor;
    pending.push({ due: clock + rule.after_s, update: { update_id: `upd-${++seq}`, provider_ref: ref, status: rule.status, amount_minor, fee_minor: rule.status === "paid" ? fee : 0 } });
  }

  return {
    live: false,
    name: "sandbox-ecocash",
    async initiateCollection({ reference, amount_minor, phone }) {
      const local = normalise(phone);
      const provider_ref = `sbx-col-${++seq}`;
      transactions.set(provider_ref, { kind: "collection", reference, amount_minor, phone: local, refunded_minor: 0 });
      schedule("collection", provider_ref, amount_minor, local);
      return { provider_ref, instructions: "Sandbox: no USSD prompt is sent." };
    },
    async initiatePayout({ reference, amount_minor, phone }) {
      const local = normalise(phone);
      const provider_ref = `sbx-pay-${++seq}`;
      transactions.set(provider_ref, { kind: "payout", reference, amount_minor, phone: local });
      schedule("payout", provider_ref, amount_minor, local);
      return { provider_ref };
    },
    async refund({ provider_ref, amount_minor }) {
      const t = transactions.get(provider_ref);
      if (!t || t.kind !== "collection") return { status: "not_found" };
      if (t.refunded_minor + amount_minor > t.amount_minor) return { status: "rejected" };
      t.refunded_minor += amount_minor;
      return { status: "refunded" };
    },
    // Moves simulated time and returns the updates now due (oldest first).
    advance(seconds) {
      clock += seconds;
      const due = pending.filter((p) => p.due <= clock).sort((a, b) => a.due - b.due);
      for (const d of due) pending.splice(pending.indexOf(d), 1);
      const out = due.map((d) => d.update);
      updates.push(...out);
      return out;
    },
    // All updates delivered so far (to replay duplicates in tests).
    delivered() {
      return updates.slice();
    }
  };
}

module.exports = { createSandboxEcocash, TEST_NUMBERS };
