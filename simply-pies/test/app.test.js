'use strict';

const request = require('supertest');
const config = require('../config');
const { createApp } = require('../app');
const { OrderStore } = require('../lib/orderStore');

const quietLogger = { error: () => {}, warn: () => {}, log: () => {} };
const PIE = config.menu[0];

function build(overrides = {}) {
  const store = new OrderStore();
  const app = createApp({
    config,
    store,
    kitchenPasscode: 'letmein',
    sessionSecret: 'test-secret',
    logger: quietLogger,
    ...overrides,
  });
  return { app, store };
}

function fakeStripe() {
  const sessions = new Map();
  return {
    sessions,
    checkout: {
      sessions: {
        create: jest.fn(async (params) => {
          const session = {
            id: `cs_test_${sessions.size + 1}`,
            url: `https://checkout.stripe.test/${sessions.size + 1}`,
            metadata: params.metadata,
            amount_total: params.line_items.reduce((s, l) => s + l.quantity * l.price_data.unit_amount, 0),
            currency: params.line_items[0].price_data.currency,
            payment_status: 'unpaid',
            payment_intent: null,
          };
          sessions.set(session.id, session);
          return session;
        }),
        retrieve: jest.fn(async (id) => sessions.get(id)),
      },
    },
    webhooks: {
      constructEvent: jest.fn((body, signature) => {
        if (signature !== 'valid') throw new Error('bad signature');
        return JSON.parse(body.toString());
      }),
    },
  };
}

const customer = { name: 'Jane Doe', phone: '(615) 555-0100', vehicle: 'Blue Civic' };

async function kitchenAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/kitchen/login').send({ passcode: 'letmein' }).expect(200);
  return agent;
}

describe('checkout', () => {
  test('is disabled when no payment provider is configured', async () => {
    const { app } = build();
    const res = await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer });
    expect(res.status).toBe(503);
  });

  test('prices the order on the server and ignores client prices', async () => {
    const stripe = fakeStripe();
    const { app, store } = build({ stripe });
    const res = await request(app)
      .post('/api/checkout')
      .send({ items: [{ id: PIE.id, qty: 2, priceCents: 1 }], customer });
    expect(res.status).toBe(201);
    expect(res.body.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [order] = store.orders.values();
    expect(order.totalCents).toBe(PIE.priceCents * 2);
    expect(order.status).toBe('pending_payment');
    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: PIE.priceCents } });
    expect(params.metadata.orderId).toBe(order.id);
  });

  test.each([
    [{ items: [], customer }, /empty/],
    [{ items: [{ id: 'nope', qty: 1 }], customer }, /no longer available/],
    [{ items: [{ id: PIE.id, qty: 0 }], customer }, /quantity/],
    [{ items: [{ id: PIE.id, qty: 1.5 }], customer }, /quantity/],
    [{ items: [{ id: PIE.id, qty: config.limits.maxQuantityPerItem + 1 }], customer }, /at most/],
    [{ items: [{ id: PIE.id, qty: 1 }], customer: { ...customer, name: '' } }, /name/],
    [{ items: [{ id: PIE.id, qty: 1 }], customer: { ...customer, phone: '12' } }, /phone/],
  ])('rejects invalid carts (%#)', async (body, message) => {
    const { app, store } = build({ demoPayments: true });
    const res = await request(app).post('/api/checkout').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(store.orders.size).toBe(0);
  });

  test('demo mode accepts the order without payment', async () => {
    const { app, store } = build({ demoPayments: true });
    const res = await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer });
    expect(res.status).toBe(201);
    expect(res.body.demo).toBe(true);
    const [order] = store.orders.values();
    expect(order.status).toBe('paid');
    expect(res.body.redirectUrl).toContain(`/order?id=${order.id}&t=${order.token}`);
  });
});

describe('payment confirmation', () => {
  async function startCheckout() {
    const stripe = fakeStripe();
    const { app, store } = build({ stripe, stripeWebhookSecret: 'whsec_test' });
    await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 3 }], customer }).expect(201);
    const [order] = store.orders.values();
    const session = stripe.sessions.get(order.stripeSessionId);
    return { stripe, app, store, order, session };
  }

  test('webhook marks the order paid only with a valid signature', async () => {
    const { app, order, session } = await startCheckout();
    const event = { type: 'checkout.session.completed', data: { object: { ...session, payment_status: 'paid' } } };
    await request(app).post('/api/stripe/webhook').set('stripe-signature', 'forged')
      .set('Content-Type', 'application/json').send(JSON.stringify(event)).expect(400);
    expect(order.status).toBe('pending_payment');
    await request(app).post('/api/stripe/webhook').set('stripe-signature', 'valid')
      .set('Content-Type', 'application/json').send(JSON.stringify(event)).expect(200);
    expect(order.status).toBe('paid');
  });

  test('webhook refuses a session whose amount does not match', async () => {
    const { app, order, session } = await startCheckout();
    const event = { type: 'checkout.session.completed', data: { object: { ...session, payment_status: 'paid', amount_total: 1 } } };
    await request(app).post('/api/stripe/webhook').set('stripe-signature', 'valid')
      .set('Content-Type', 'application/json').send(JSON.stringify(event)).expect(200);
    expect(order.status).toBe('pending_payment');
  });

  test('order page falls back to checking Stripe directly', async () => {
    const { app, order, session } = await startCheckout();
    const res1 = await request(app).get(`/api/orders/${order.id}?t=${order.token}`).expect(200);
    expect(res1.body.order.status).toBe('pending_payment');
    session.payment_status = 'paid';
    const res2 = await request(app).get(`/api/orders/${order.id}?t=${order.token}`).expect(200);
    expect(res2.body.order.status).toBe('paid');
    expect(res2.body.order).not.toHaveProperty('customer');
    expect(res2.body.order.firstName).toBe('Jane');
  });

  test('expired sessions are marked expired', async () => {
    const { app, order, session } = await startCheckout();
    const event = { type: 'checkout.session.expired', data: { object: session } };
    await request(app).post('/api/stripe/webhook').set('stripe-signature', 'valid')
      .set('Content-Type', 'application/json').send(JSON.stringify(event)).expect(200);
    expect(order.status).toBe('expired');
  });
});

describe('customer order access and arrival', () => {
  async function paidOrder() {
    const ctx = build({ demoPayments: true });
    await request(ctx.app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer }).expect(201);
    const [order] = ctx.store.orders.values();
    return { ...ctx, order };
  }

  test('requires the order token', async () => {
    const { app, order } = await paidOrder();
    await request(app).get(`/api/orders/${order.id}`).expect(404);
    await request(app).get(`/api/orders/${order.id}?t=wrong`).expect(404);
    await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: 'wrong' }).expect(404);
  });

  test('"I\'ve Arrived" records the arrival once', async () => {
    const { app, order } = await paidOrder();
    const res = await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token, note: 'Bay 2' }).expect(200);
    expect(res.body.order.arrivedAt).toBeTruthy();
    const first = order.arrivedAt;
    await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token, note: 'Other' }).expect(200);
    expect(order.arrivedAt).toBe(first);
    expect(order.arrivalNote).toBe('Bay 2');
  });

  test('cannot check in for an unpaid or finished order', async () => {
    const { app, store, order } = await paidOrder();
    store.setStatus(order.id, 'completed');
    await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token }).expect(409);
  });
});

describe('kitchen dashboard', () => {
  test('is disabled without a passcode', async () => {
    const { app } = build({ kitchenPasscode: null });
    await request(app).get('/api/kitchen/orders').expect(503);
    await request(app).post('/api/kitchen/login').send({ passcode: 'x' }).expect(503);
  });

  test('requires sign-in and rejects wrong or forged credentials', async () => {
    const { app } = build();
    await request(app).get('/api/kitchen/orders').expect(401);
    await request(app).post('/api/kitchen/login').send({ passcode: 'wrong' }).expect(401);
    await request(app).get('/api/kitchen/orders').set('Cookie', `sp_kitchen=${Date.now() + 100000}.forged`).expect(401);
  });

  test('rate limits passcode attempts', async () => {
    const { app } = build();
    for (let i = 0; i < 8; i++) await request(app).post('/api/kitchen/login').send({ passcode: 'wrong' }).expect(401);
    await request(app).post('/api/kitchen/login').send({ passcode: 'letmein' }).expect(429);
  });

  test('lists paid orders only and moves them through the workflow', async () => {
    const stripe = fakeStripe();
    const { app, store } = build({ stripe });
    await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer }).expect(201);
    const [unpaid] = store.orders.values();
    const kitchen = await kitchenAgent(app);

    let res = await kitchen.get('/api/kitchen/orders').expect(200);
    expect(res.body.orders).toHaveLength(0);

    store.setStatus(unpaid.id, 'paid');
    res = await kitchen.get('/api/kitchen/orders').expect(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].customer.phone).toBe(customer.phone);
    expect(res.body.orders[0]).not.toHaveProperty('token');

    await kitchen.post(`/api/kitchen/orders/${unpaid.id}/status`).send({ status: 'preparing' }).expect(200);
    await kitchen.post(`/api/kitchen/orders/${unpaid.id}/status`).send({ status: 'paid' }).expect(400);
    await kitchen.post(`/api/kitchen/orders/${unpaid.id}/status`).send({ status: 'ready' }).expect(200);
    await kitchen.post(`/api/kitchen/orders/${unpaid.id}/status`).send({ status: 'completed' }).expect(200);
    await kitchen.post(`/api/kitchen/orders/${unpaid.id}/status`).send({ status: 'ready' }).expect(409);
    expect(unpaid.status).toBe('completed');
  });

  test('cannot act on unpaid orders', async () => {
    const stripe = fakeStripe();
    const { app, store } = build({ stripe });
    await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer }).expect(201);
    const [order] = store.orders.values();
    const kitchen = await kitchenAgent(app);
    await kitchen.post(`/api/kitchen/orders/${order.id}/status`).send({ status: 'ready' }).expect(409);
  });
});

describe('pages', () => {
  test.each(['/', '/order', '/kitchen'])('serves %s', async (path) => {
    const { app } = build();
    const res = await request(app).get(path).expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  test('config exposes the five required pies', async () => {
    const { app } = build();
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.menu.map((p) => p.name)).toEqual([
      'Pepper Steak', 'Steak and Cheese', 'Burger Pie', 'Chicken Peri Peri', 'Chicken, Leek and Mushroom',
    ]);
    expect(res.body.paymentsReady).toBe(false);
  });
});
