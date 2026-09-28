'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

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

const ACTIVE_STATUSES = new Set(['paid', 'preparing', 'ready']);

// Small order store: an in-memory map, optionally persisted to a JSON file.
// Writes are serialized and atomic (write temp file, then rename).
class OrderStore extends EventEmitter {
  constructor({ filePath = null, now = () => new Date() } = {}) {
    super();
    this.filePath = filePath;
    this.now = now;
    this.orders = new Map();
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
    if (!this.filePath) return Promise.resolve();
    const snapshot = JSON.stringify({ nextNumber: this.nextNumber, orders: [...this.orders.values()] });
    const target = this.filePath;
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const tmp = `${target}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, snapshot);
        await fs.promises.rename(tmp, target);
      })
      .catch((err) => this.emit('error', err));
    return this.writeChain;
  }

  flush() {
    return this.writeChain;
  }

  create({ items, totalPies, totalCents, currency, customer }) {
    const order = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('base64url'),
      number: this.nextNumber++,
      status: 'pending_payment',
      items,
      totalPies,
      totalCents,
      currency,
      customer,
      stripeSessionId: null,
      paymentIntentId: null,
      createdAt: this.now().toISOString(),
      paidAt: null,
      arrivedAt: null,
      arrivalNote: '',
      updatedAt: this.now().toISOString(),
    };
    this.orders.set(order.id, order);
    this.persist();
    return order;
  }

  get(id) {
    return typeof id === 'string' ? this.orders.get(id) || null : null;
  }

  update(id, changes) {
    const order = this.get(id);
    if (!order) return null;
    Object.assign(order, changes, { updatedAt: this.now().toISOString() });
    this.persist();
    this.emit('change', order);
    return order;
  }

  canTransition(order, next) {
    return (TRANSITIONS[order.status] || []).includes(next);
  }

  setStatus(id, next, extra = {}) {
    const order = this.get(id);
    if (!order || !this.canTransition(order, next)) return null;
    const changes = { ...extra, status: next };
    if (next === 'paid') changes.paidAt = this.now().toISOString();
    return this.update(id, changes);
  }

  markArrived(id, note) {
    const order = this.get(id);
    if (!order || !ACTIVE_STATUSES.has(order.status)) return null;
    if (order.arrivedAt) return order; // idempotent
    return this.update(id, { arrivedAt: this.now().toISOString(), arrivalNote: note || '' });
  }

  // Paid orders the kitchen should see: all active ones plus orders
  // completed or cancelled in the last 12 hours.
  kitchenOrders() {
    const cutoff = this.now().getTime() - 12 * 60 * 60 * 1000;
    return [...this.orders.values()]
      .filter((o) => ACTIVE_STATUSES.has(o.status) ||
        ((o.status === 'completed' || o.status === 'cancelled') && Date.parse(o.updatedAt) >= cutoff))
      .sort((a, b) => a.number - b.number);
  }
}

module.exports = { OrderStore, TRANSITIONS, ACTIVE_STATUSES };
