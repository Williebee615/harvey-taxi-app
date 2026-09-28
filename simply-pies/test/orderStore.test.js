'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { OrderStore } = require('../lib/orderStore');

const sample = {
  items: [{ id: 'pepper-steak', name: 'Pepper Steak', qty: 1, unitCents: 900, lineCents: 900 }],
  totalPies: 1,
  totalCents: 900,
  currency: 'usd',
  customer: { name: 'Sam', phone: '6155550100', vehicle: '', notes: '' },
};

test('persists orders and order numbers across restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-pies-'));
  const filePath = path.join(dir, 'orders.json');
  const first = new OrderStore({ filePath });
  const a = first.create(sample);
  first.setStatus(a.id, 'paid');
  await first.flush();

  const second = new OrderStore({ filePath });
  expect(second.get(a.id).status).toBe('paid');
  const b = second.create(sample);
  expect(b.number).toBe(a.number + 1);
  await second.flush();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kitchen list hides unpaid orders and old finished ones', () => {
  let now = new Date('2026-09-28T12:00:00Z');
  const store = new OrderStore({ now: () => now });
  const unpaid = store.create(sample);
  const paid = store.create(sample);
  store.setStatus(paid.id, 'paid');
  const old = store.create(sample);
  store.setStatus(old.id, 'paid');
  store.setStatus(old.id, 'completed');
  now = new Date('2026-09-29T06:00:00Z');
  const ids = store.kitchenOrders().map((o) => o.id);
  expect(ids).toEqual([paid.id]);
  expect(ids).not.toContain(unpaid.id);
});

test('emits change events for live updates', () => {
  const store = new OrderStore();
  const seen = [];
  store.on('change', (o) => seen.push(o.status));
  const order = store.create(sample);
  store.setStatus(order.id, 'paid');
  store.markArrived(order.id, 'Front');
  expect(seen).toEqual(['paid', 'paid']);
  expect(store.get(order.id).arrivedAt).toBeTruthy();
});
