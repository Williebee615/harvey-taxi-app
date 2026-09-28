'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { CartError, cleanText, priceCart, validateCustomer } = require('./lib/cart');

const KITCHEN_COOKIE = 'sp_kitchen';
const KITCHEN_SESSION_MS = 16 * 60 * 60 * 1000; // one long shift
const KITCHEN_STATUSES = new Set(['preparing', 'ready', 'completed', 'cancelled']);
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function customerView(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    items: order.items,
    totalPies: order.totalPies,
    totalCents: order.totalCents,
    currency: order.currency,
    firstName: order.customer.name.split(' ')[0],
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    arrivedAt: order.arrivedAt,
  };
}

function kitchenView(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    items: order.items,
    totalPies: order.totalPies,
    totalCents: order.totalCents,
    currency: order.currency,
    customer: order.customer,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    arrivedAt: order.arrivedAt,
    arrivalNote: order.arrivalNote,
    updatedAt: order.updatedAt,
  };
}

// Express 4 does not catch rejected promises from async handlers.
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function createApp(options) {
  const {
    config,
    store,
    stripe = null,
    stripeWebhookSecret = null,
    demoPayments = false,
    kitchenPasscode = null,
    sessionSecret = crypto.randomBytes(32).toString('hex'),
    baseUrl = null,
    setupProblems = [],
    logger = console,
  } = options;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  function sign(value) {
    return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  }

  function kitchenAuthed(req) {
    const cookie = parseCookies(req.headers.cookie)[KITCHEN_COOKIE];
    if (!cookie) return false;
    const [expires, signature] = cookie.split('.');
    if (!expires || !signature || !safeEqual(signature, sign(`kitchen:${expires}`))) return false;
    return Number(expires) > Date.now();
  }

  function requireKitchen(req, res, next) {
    if (!kitchenPasscode) return res.status(503).json({ error: 'Kitchen dashboard is not configured.' });
    if (!kitchenAuthed(req)) return res.status(401).json({ error: 'Please sign in.' });
    return next();
  }

  async function findCustomerOrder(req) {
    const token = req.query.t || (req.body && req.body.t);
    if (typeof token !== 'string') return null;
    const order = await store.get(req.params.id);
    if (!order || !safeEqual(token, order.token)) return null;
    return order;
  }

  function originFor(req) {
    return (baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  }

  function orderUrl(req, order) {
    return `${originFor(req)}/order?id=${order.id}&t=${order.token}`;
  }

  // Confirms a Stripe Checkout Session really paid for this order.
  async function applyPaidSession(session) {
    const orderId = session && session.metadata && session.metadata.orderId;
    const order = await store.get(orderId);
    if (!order || order.status !== 'pending_payment') return order;
    if (session.payment_status !== 'paid') return order;
    if (session.amount_total !== order.totalCents || session.currency !== order.currency) {
      logger.error(`[simply-pies] Amount mismatch on order ${order.number}; not marking paid.`);
      return order;
    }
    const paid = await store.setStatus(order.id, 'paid', {
      stripeSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    });
    return paid || (await store.get(order.id));
  }

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  // A misconfigured production deployment refuses API calls rather than
  // running unsafely (for example, taking orders without payment).
  if (setupProblems.length) {
    app.use('/api', (req, res) => res.status(503).json({ error: 'Online ordering is temporarily unavailable.' }));
  }

  // Stripe needs the raw body to verify the signature, so this route is
  // registered before the JSON body parser.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
    if (!stripe || !stripeWebhookSecret) return res.status(503).send('Webhook not configured');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send('Invalid signature');
    }
    const session = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await applyPaidSession(session);
    } else if (event.type === 'checkout.session.expired') {
      const orderId = session.metadata && session.metadata.orderId;
      if (orderId) await store.setStatus(orderId, 'expired');
    }
    return res.json({ received: true });
  }));

  app.use(express.json({ limit: '20kb' }));

  app.get('/api/config', (req, res) => {
    res.json({
      business: config.business,
      menu: config.menu,
      signature: config.signature,
      limits: config.limits,
      demoPayments,
      paymentsReady: Boolean(stripe) || demoPayments,
    });
  });

  app.post('/api/checkout', wrap(async (req, res) => {
    let priced;
    let customer;
    try {
      priced = priceCart(req.body && req.body.items, config.menu, config.limits);
      customer = validateCustomer(req.body && req.body.customer);
    } catch (err) {
      if (err instanceof CartError) return res.status(400).json({ error: err.message });
      throw err;
    }

    if (!stripe && !demoPayments) {
      return res.status(503).json({ error: 'Online ordering is not available yet. Please check back soon.' });
    }

    const order = await store.create({ ...priced, currency: config.business.currency, customer });

    if (!stripe) {
      await store.setStatus(order.id, 'paid');
      return res.status(201).json({ redirectUrl: orderUrl(req, order), demo: true });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: priced.items.map((item) => ({
          quantity: item.qty,
          price_data: {
            currency: config.business.currency,
            unit_amount: item.unitCents,
            product_data: { name: `${item.name} Pie` },
          },
        })),
        metadata: { orderId: order.id, orderNumber: String(order.number) },
        payment_intent_data: { metadata: { orderId: order.id, orderNumber: String(order.number) } },
        success_url: `${orderUrl(req, order)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${originFor(req)}/?cancelled=1`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      }, { idempotencyKey: `checkout-${order.id}` });
    } catch (err) {
      logger.error('[simply-pies] Stripe checkout failed:', err.message);
      await store.setStatus(order.id, 'expired');
      return res.status(502).json({ error: 'We could not start checkout. Please try again.' });
    }
    await store.setStripeSession(order.id, session.id);
    return res.status(201).json({ redirectUrl: session.url });
  }));

  // The order page polls this every few seconds.
  app.get('/api/orders/:id', wrap(async (req, res) => {
    let order = await findCustomerOrder(req);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    // Fallback in case the webhook is delayed: check the session directly.
    if (order.status === 'pending_payment' && stripe && order.stripeSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        order = (await applyPaidSession(session)) || order;
      } catch (err) {
        logger.error('[simply-pies] Stripe session lookup failed:', err.message);
      }
    }
    return res.json({ order: customerView(order) });
  }));

  app.post('/api/orders/:id/arrived', wrap(async (req, res) => {
    const order = await findCustomerOrder(req);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    let note;
    try {
      note = cleanText(req.body && req.body.note, 120);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const updated = await store.markArrived(order.id, note);
    if (!updated) return res.status(409).json({ error: 'This order is not ready for check-in.' });
    return res.json({ order: customerView(updated) });
  }));

  app.post('/api/kitchen/login', wrap(async (req, res) => {
    if (!kitchenPasscode) return res.status(503).json({ error: 'Kitchen dashboard is not configured.' });
    const attempts = await store.recordLoginAttempt(`kitchen:${req.ip}`, LOGIN_WINDOW_MS);
    if (attempts > LOGIN_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
    const passcode = req.body && req.body.passcode;
    if (typeof passcode !== 'string' || !safeEqual(passcode, kitchenPasscode)) {
      return res.status(401).json({ error: 'Incorrect passcode.' });
    }
    const expires = String(Date.now() + KITCHEN_SESSION_MS);
    res.cookie(KITCHEN_COOKIE, `${expires}.${sign(`kitchen:${expires}`)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: KITCHEN_SESSION_MS,
      path: '/',
    });
    return res.json({ ok: true });
  }));

  app.post('/api/kitchen/logout', (req, res) => {
    res.clearCookie(KITCHEN_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // The kitchen dashboard polls this every few seconds.
  app.get('/api/kitchen/orders', requireKitchen, wrap(async (req, res) => {
    const orders = await store.kitchenOrders();
    res.json({ orders: orders.map(kitchenView), serverTime: new Date().toISOString() });
  }));

  app.post('/api/kitchen/orders/:id/status', requireKitchen, wrap(async (req, res) => {
    const next = req.body && req.body.status;
    if (!KITCHEN_STATUSES.has(next)) return res.status(400).json({ error: 'Unknown status.' });
    const order = await store.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const updated = await store.setStatus(order.id, next);
    if (!updated) return res.status(409).json({ error: `Cannot move a ${order.status} order to ${next}.` });
    return res.json({ order: kitchenView(updated) });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Local development only; on Vercel the CDN serves public/ directly.
  const publicDir = path.join(__dirname, 'public');
  app.get('/order', (req, res) => res.sendFile(path.join(publicDir, 'order.html')));
  app.get('/kitchen', (req, res) => {
    res.set('X-Robots-Tag', 'noindex');
    res.sendFile(path.join(publicDir, 'kitchen.html'));
  });
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    logger.error('[simply-pies] Unhandled error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp, customerView, kitchenView };
