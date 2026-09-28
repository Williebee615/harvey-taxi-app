'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Kitchen-driven status changes. 'arrived' is tracked separately
// (arrivedAt) because a customer can arrive before the order is ready.
const TRANSITIONS = {
  pending_payment: ['paid', 'expired'],
  paid: ['preparing', 'ready', 'completed', 'cancelled'],
  preparing: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
};

const ACTIVE_STATUSES = ['paid', 'preparing', 'ready'];
const FINISHED_VISIBLE_MS = 12 * 60 * 60 * 1000;

function allowedFrom(next) {
  return Object.keys(TRANSITIONS).filter((from) => TRANSITIONS[from].includes(next));
}

function newSecrets() {
  return { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('base64url') };
}

// In-memory order store for local development and tests, optionally
// persisted to a JSON file. Production on Vercel uses PgOrderStore, which
// has the same async interface.
class MemoryOrderStore {
  constructor({ filePath = null, now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.orders = new Map();
    this.loginAttempts = new Map();
    this.nextNumber = 101;
    this.writeChain = Promise.resolve();
    if (filePath) this.load();
  }

  load() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const order of data.orders || []) this.orders.set(order.id, order);
    this.nextNumber = data.nextNumber || this.nextNumber;
  }

  persist() {
    if (!this.filePath) return;
    const snapshot = JSON.stringify({ nextNumber: this.nextNumber, orders: [...this.orders.values()] });
    const target = this.filePath;
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const tmp = `${target}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, snapshot);
        await fs.promises.rename(tmp, target);
      })
      .catch((err) => console.error('[simply-pies] Could not save orders:', err));
  }

  flush() {
    return this.writeChain;
  }

  copy(order) {
    return order ? JSON.parse(JSON.stringify(order)) : null;
  }

  async create({ items, totalPies, totalCents, currency, customer }) {
    const stamp = this.now().toISOString();
    const order = {
      ...newSecrets(),
      number: this.nextNumber++,
      status: 'pending_payment',
      items,
      totalPies,
      totalCents,
      currency,
      customer,
      stripeSessionId: null,
      paymentIntentId: null,
      createdAt: stamp,
      paidAt: null,
      arrivedAt: null,
      arrivalNote: '',
      updatedAt: stamp,
    };
    this.orders.set(order.id, order);
    this.persist();
    return this.copy(order);
  }

  async get(id) {
    return typeof id === 'string' ? this.copy(this.orders.get(id)) : null;
  }

  async setStripeSession(id, sessionId) {
    const order = this.orders.get(id);
    if (!order) return null;
    Object.assign(order, { stripeSessionId: sessionId, updatedAt: this.now().toISOString() });
    this.persist();
    return this.copy(order);
  }

  // Returns the updated order, or null if the order does not exist or
  // cannot move to `next` from its current status.
  async setStatus(id, next, extra = {}) {
    const order = typeof id === 'string' ? this.orders.get(id) : null;
    if (!order || !allowedFrom(next).includes(order.status)) return null;
    const stamp = this.now().toISOString();
    Object.assign(order, extra, { status: next, updatedAt: stamp });
    if (next === 'paid') order.paidAt = stamp;
    this.persist();
    return this.copy(order);
  }

  async markArrived(id, note) {
    const order = typeof id === 'string' ? this.orders.get(id) : null;
    if (!order || !ACTIVE_STATUSES.includes(order.status)) return null;
    if (!order.arrivedAt) {
      const stamp = this.now().toISOString();
      Object.assign(order, { arrivedAt: stamp, arrivalNote: note || '', updatedAt: stamp });
      this.persist();
    }
    return this.copy(order);
  }

  // Paid orders the kitchen should see: all active ones plus orders
  // completed or cancelled in the last 12 hours.
  async kitchenOrders() {
    const cutoff = this.now().getTime() - FINISHED_VISIBLE_MS;
    return [...this.orders.values()]
      .filter((o) => ACTIVE_STATUSES.includes(o.status) ||
        ((o.status === 'completed' || o.status === 'cancelled') && Date.parse(o.updatedAt) >= cutoff))
      .sort((a, b) => a.number - b.number)
      .map((o) => this.copy(o));
  }

  // Records a kitchen sign-in attempt and returns how many attempts this
  // key has made in the current window.
  async recordLoginAttempt(key, windowMs) {
    const now = this.now().getTime();
    const entry = this.loginAttempts.get(key);
    if (!entry || now - entry.start > windowMs) {
      this.loginAttempts.set(key, { start: now, count: 1 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

module.exports = { MemoryOrderStore, TRANSITIONS, ACTIVE_STATUSES, FINISHED_VISIBLE_MS, allowedFrom, newSecrets };
