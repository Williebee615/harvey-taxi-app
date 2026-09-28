'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryOrderStore } = require('../lib/orderStore');
const { buildFromEnv } = require('../lib/fromEnv');

const sample = {
  items: [{ id: 'pepper-steak', name: 'Pepper Steak', qty: 1, unitCents: 900, lineCents: 900 }],
  totalPies: 1,
  totalCents: 900,
  currency: 'usd',
  customer: { name: 'Sam', phone: '6155550100', vehicle: '', notes: '' },
};

test('file-backed store persists orders and order numbers across restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-pies-'));
  const filePath = path.join(dir, 'orders.json');
  const first = new MemoryOrderStore({ filePath });
  const a = await first.create(sample);
  await first.setStatus(a.id, 'paid');
  await first.flush();

  const second = new MemoryOrderStore({ filePath });
  expect((await second.get(a.id)).status).toBe('paid');
  const b = await second.create(sample);
  expect(b.number).toBe(a.number + 1);
  await second.flush();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kitchen list hides unpaid orders and old finished ones', async () => {
  let now = new Date('2026-09-28T12:00:00Z');
  const store = new MemoryOrderStore({ now: () => now });
  await store.create(sample);
  const paid = await store.create(sample);
  await store.setStatus(paid.id, 'paid');
  const old = await store.create(sample);
  await store.setStatus(old.id, 'paid');
  await store.setStatus(old.id, 'completed');
  now = new Date('2026-09-29T06:00:00Z');
  expect((await store.kitchenOrders()).map((o) => o.id)).toEqual([paid.id]);
});

test('returned orders are copies, not live references', async () => {
  const store = new MemoryOrderStore();
  const order = await store.create(sample);
  order.status = 'paid';
  expect((await store.get(order.id)).status).toBe('pending_payment');
});

describe('environment checks', () => {
  const base = { STRIPE_SECRET_KEY: '', SIMPLY_PIES_DATA_DIR: os.tmpdir() };

  test('refuses demo payments in production', () => {
    const { problems } = buildFromEnv({ ...base, NODE_ENV: 'production', DEMO_PAYMENTS: 'true', SESSION_SECRET: 'x' });
    expect(problems.join(' ')).toMatch(/DEMO_PAYMENTS/);
  });

  test('requires a session secret in production', () => {
    const { problems } = buildFromEnv({ ...base, VERCEL_ENV: 'production' });
    expect(problems.join(' ')).toMatch(/SESSION_SECRET/);
  });

  test('requires a database on Vercel', () => {
    const { problems } = buildFromEnv({ ...base, VERCEL: '1', SESSION_SECRET: 'x' });
    expect(problems.join(' ')).toMatch(/DATABASE_URL/);
  });

  test('a local preview has no blocking problems', () => {
    const { problems, warnings } = buildFromEnv({ ...base, DEMO_PAYMENTS: 'true' });
    expect(problems).toEqual([]);
    expect(warnings.join(' ')).toMatch(/DEMO MODE/);
  });
});
