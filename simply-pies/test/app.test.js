'use strict';

const request = require('supertest');
const config = require('../config');
const { createApp } = require('../app');
const { MemoryOrderStore } = require('../lib/orderStore');
const { PgOrderStore } = require('../lib/pgOrderStore');

const quietLogger = { error: () => {}, warn: () => {}, log: () => {} };
const PIE = config.menu[0];
const customer = { name: 'Jane Doe', phone: '(615) 555-0100', vehicle: 'Blue Civic' };

// The API suite runs against the in-memory store, and also against real
// Postgres when SIMPLY_PIES_TEST_DATABASE_URL is set.
const backends = [['memory', async () => new MemoryOrderStore()]];
const pgUrl = process.env.SIMPLY_PIES_TEST_DATABASE_URL;
let pool;
if (pgUrl) {
  backends.push(['postgres', async () => {
    const { Pool } = require('pg');
    pool = pool || new Pool({ connectionString: pgUrl });
    await pool.query('drop table if exists simply_pies_orders, simply_pies_login_attempts; drop sequence if exists simply_pies_order_number;');
    return new PgOrderStore(pool);
  }]);
}
afterAll(async () => { if (pool) await pool.end(); });

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

describe.each(backends)('API with %s store', (_name, makeStore) => {
  let store;

  beforeEach(async () => { store = await makeStore(); });

  function build(overrides = {}) {
    return createApp({
      config,
      store,
      kitchenPasscode: 'letmein',
      sessionSecret: 'test-secret',
      logger: quietLogger,
      ...overrides,
    });
  }

  async function kitchenAgent(app) {
    const agent = request.agent(app);
    await agent.post('/api/kitchen/login').send({ passcode: 'letmein' }).expect(200);
    return agent;
  }

  // Places an order through the API and returns the stored order.
  async function placeOrder(app, stripe, qty = 1) {
    const res = await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty }], customer }).expect(201);
    if (stripe) {
      const { orderId } = stripe.checkout.sessions.create.mock.calls.at(-1)[0].metadata;
      return store.get(orderId);
    }
    return store.get(new URL(res.body.redirectUrl).searchParams.get('id'));
  }

  describe('checkout', () => {
    test('is disabled when no payment provider is configured', async () => {
      const res = await request(build()).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer });
      expect(res.status).toBe(503);
    });

    test('is refused when the deployment is misconfigured', async () => {
      const app = build({ demoPayments: true, setupProblems: ['SESSION_SECRET is required'] });
      await request(app).post('/api/checkout').send({ items: [{ id: PIE.id, qty: 1 }], customer }).expect(503);
    });

    test('prices the order on the server and ignores client prices', async () => {
      const stripe = fakeStripe();
      const app = build({ stripe });
      const res = await request(app)
        .post('/api/checkout')
        .send({ items: [{ id: PIE.id, qty: 2, priceCents: 1 }], customer });
      expect(res.status).toBe(201);
      expect(res.body.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      const params = stripe.checkout.sessions.create.mock.calls[0][0];
      const order = await store.get(params.metadata.orderId);
      expect(order.totalCents).toBe(PIE.priceCents * 2);
      expect(order.status).toBe('pending_payment');
      expect(order.stripeSessionId).toBe('cs_test_1');
      expect(params.line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: PIE.priceCents } });
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
      const res = await request(build({ demoPayments: true })).post('/api/checkout').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });

    test('demo mode accepts the order without payment', async () => {
      const app = build({ demoPayments: true });
      const order = await placeOrder(app);
      expect(order.status).toBe('paid');
      expect(order.number).toBeGreaterThanOrEqual(101);
    });

    test('order numbers increase', async () => {
      const app = build({ demoPayments: true });
      const a = await placeOrder(app);
      const b = await placeOrder(app);
      expect(b.number).toBe(a.number + 1);
    });
  });

  describe('payment confirmation', () => {
    async function startCheckout() {
      const stripe = fakeStripe();
      const app = build({ stripe, stripeWebhookSecret: 'whsec_test' });
      const order = await placeOrder(app, stripe, 3);
      return { stripe, app, order, session: stripe.sessions.get(order.stripeSessionId) };
    }

    function sendEvent(app, event, signature = 'valid') {
      return request(app).post('/api/stripe/webhook').set('stripe-signature', signature)
        .set('Content-Type', 'application/json').send(JSON.stringify(event));
    }

    test('webhook marks the order paid only with a valid signature', async () => {
      const { app, order, session } = await startCheckout();
      const event = { type: 'checkout.session.completed', data: { object: { ...session, payment_status: 'paid', payment_intent: 'pi_1' } } };
      await sendEvent(app, event, 'forged').expect(400);
      expect((await store.get(order.id)).status).toBe('pending_payment');
      await sendEvent(app, event).expect(200);
      const paid = await store.get(order.id);
      expect(paid.status).toBe('paid');
      expect(paid.paidAt).toBeTruthy();
      expect(paid.paymentIntentId).toBe('pi_1');
      await sendEvent(app, event).expect(200); // redelivery is harmless
    });

    test('webhook refuses a session whose amount does not match', async () => {
      const { app, order, session } = await startCheckout();
      const event = { type: 'checkout.session.completed', data: { object: { ...session, payment_status: 'paid', amount_total: 1 } } };
      await sendEvent(app, event).expect(200);
      expect((await store.get(order.id)).status).toBe('pending_payment');
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
      await sendEvent(app, { type: 'checkout.session.expired', data: { object: session } }).expect(200);
      expect((await store.get(order.id)).status).toBe('expired');
    });
  });

  describe('customer order access and arrival', () => {
    test('requires the order token', async () => {
      const app = build({ demoPayments: true });
      const order = await placeOrder(app);
      await request(app).get(`/api/orders/${order.id}`).expect(404);
      await request(app).get(`/api/orders/${order.id}?t=wrong`).expect(404);
      await request(app).get('/api/orders/not-a-uuid?t=x').expect(404);
      await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: 'wrong' }).expect(404);
    });

    test('"I\'ve Arrived" records the arrival once', async () => {
      const app = build({ demoPayments: true });
      const order = await placeOrder(app);
      const res = await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token, note: 'Bay 2' }).expect(200);
      expect(res.body.order.arrivedAt).toBeTruthy();
      await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token, note: 'Other' }).expect(200);
      const stored = await store.get(order.id);
      expect(stored.arrivedAt).toBe(res.body.order.arrivedAt);
      expect(stored.arrivalNote).toBe('Bay 2');
    });

    test('cannot check in for a finished order', async () => {
      const app = build({ demoPayments: true });
      const order = await placeOrder(app);
      await store.setStatus(order.id, 'completed');
      await request(app).post(`/api/orders/${order.id}/arrived`).send({ t: order.token }).expect(409);
    });
  });

  describe('kitchen dashboard', () => {
    test('is disabled without a passcode', async () => {
      const app = build({ kitchenPasscode: null });
      await request(app).get('/api/kitchen/orders').expect(503);
      await request(app).post('/api/kitchen/login').send({ passcode: 'x' }).expect(503);
    });

    test('requires sign-in and rejects wrong or forged credentials', async () => {
      const app = build();
      await request(app).get('/api/kitchen/orders').expect(401);
      await request(app).post('/api/kitchen/login').send({ passcode: 'wrong' }).expect(401);
      await request(app).get('/api/kitchen/orders').set('Cookie', `sp_kitchen=${Date.now() + 100000}.forged`).expect(401);
    });

    test('rate limits passcode attempts', async () => {
      const app = build();
      for (let i = 0; i < 8; i++) await request(app).post('/api/kitchen/login').send({ passcode: 'wrong' }).expect(401);
      await request(app).post('/api/kitchen/login').send({ passcode: 'letmein' }).expect(429);
    });

    test('lists paid orders only and moves them through the workflow', async () => {
      const stripe = fakeStripe();
      const app = build({ stripe });
      const order = await placeOrder(app, stripe);
      const kitchen = await kitchenAgent(app);

      let res = await kitchen.get('/api/kitchen/orders').expect(200);
      expect(res.body.orders).toHaveLength(0);
      await kitchen.post(`/api/kitchen/orders/${order.id}/status`).send({ status: 'ready' }).expect(409);

      await store.setStatus(order.id, 'paid');
      res = await kitchen.get('/api/kitchen/orders').expect(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].customer.phone).toBe(customer.phone);
      expect(res.body.orders[0]).not.toHaveProperty('token');

      const move = (status) => kitchen.post(`/api/kitchen/orders/${order.id}/status`).send({ status });
      await move('preparing').expect(200);
      await move('paid').expect(400);
      await move('ready').expect(200);
      await move('completed').expect(200);
      await move('ready').expect(409);
      expect((await store.get(order.id)).status).toBe('completed');

      res = await kitchen.get('/api/kitchen/orders').expect(200);
      expect(res.body.orders.map((o) => o.status)).toEqual(['completed']);
    });
  });
});

describe('pages', () => {
  const app = createApp({ config, store: new MemoryOrderStore(), logger: quietLogger });

  test.each(['/', '/order', '/kitchen'])('serves %s', async (path) => {
    const res = await request(app).get(path).expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  test('config exposes the five required pies', async () => {
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.menu.map((p) => p.name)).toEqual([
      'Pepper Steak', 'Steak and Cheese', 'Burger Pie', 'Chicken Peri Peri', 'Chicken, Leek and Mushroom',
    ]);
    expect(res.body.paymentsReady).toBe(false);
  });
});
