'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { CartError, cleanText, priceCart, validateCustomer } = require('./lib/cart');

const KITCHEN_COOKIE = 'sp_kitchen';
const KITCHEN_SESSION_MS = 16 * 60 * 60 * 1000; // one long shift
const KITCHEN_STATUSES = new Set(['preparing', 'ready', 'completed', 'cancelled']);

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

// Fixed-window limiter keyed by IP, for the kitchen passcode form.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

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
    logger = console,
  } = options;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const loginAllowed = createLimiter({ max: 8, windowMs: 10 * 60 * 1000 });
  const customerStreams = new Map(); // orderId -> Set<res>
  const kitchenStreams = new Set();

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

  function findCustomerOrder(req) {
    const order = store.get(req.params.id);
    const token = req.query.t || (req.body && req.body.t);
    if (!order || typeof token !== 'string' || !safeEqual(token, order.token)) return null;
    return order;
  }

  function originFor(req) {
    return (baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  }

  function orderUrl(req, order) {
    return `${originFor(req)}/order?id=${order.id}&t=${order.token}`;
  }

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function openStream(req, res) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => clearInterval(heartbeat));
  }

  store.on('change', (order) => {
    for (const res of customerStreams.get(order.id) || []) send(res, 'order', customerView(order));
    if (order.status !== 'pending_payment' && order.status !== 'expired') {
      for (const res of kitchenStreams) send(res, 'order', kitchenView(order));
    }
  });

  // Confirms a Stripe Checkout Session really paid for this order.
  function applyPaidSession(session) {
    const orderId = session && session.metadata && session.metadata.orderId;
    const order = store.get(orderId);
    if (!order || order.status !== 'pending_payment') return order;
    if (session.payment_status !== 'paid') return order;
    if (session.amount_total !== order.totalCents || session.currency !== order.currency) {
      logger.error(`[simply-pies] Amount mismatch on order ${order.number}; not marking paid.`);
      return order;
    }
    return store.setStatus(order.id, 'paid', {
      stripeSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    });
  }

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });

  // Stripe needs the raw body to verify the signature, so this route is
  // registered before the JSON body parser.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    if (!stripe || !stripeWebhookSecret) return res.status(503).send('Webhook not configured');
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send('Invalid signature');
    }
    const session = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      applyPaidSession(session);
    } else if (event.type === 'checkout.session.expired') {
      const orderId = session.metadata && session.metadata.orderId;
      if (orderId) store.setStatus(orderId, 'expired');
    }
    return res.json({ received: true });
  });

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

  app.post('/api/checkout', async (req, res) => {
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

    const order = store.create({ ...priced, currency: config.business.currency, customer });

    if (!stripe) {
      store.setStatus(order.id, 'paid');
      return res.status(201).json({ redirectUrl: orderUrl(req, order), demo: true });
    }

    try {
      const session = await stripe.checkout.sessions.create({
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
      store.update(order.id, { stripeSessionId: session.id });
      return res.status(201).json({ redirectUrl: session.url });
    } catch (err) {
      logger.error('[simply-pies] Stripe checkout failed:', err.message);
      store.setStatus(order.id, 'expired');
      return res.status(502).json({ error: 'We could not start checkout. Please try again.' });
    }
  });

  app.get('/api/orders/:id', async (req, res) => {
    let order = findCustomerOrder(req);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    // Fallback in case the webhook is delayed: check the session directly.
    if (order.status === 'pending_payment' && stripe && order.stripeSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        order = applyPaidSession(session) || order;
      } catch (err) {
        logger.error('[simply-pies] Stripe session lookup failed:', err.message);
      }
    }
    return res.json({ order: customerView(order) });
  });

  app.get('/api/orders/:id/events', (req, res) => {
    const order = findCustomerOrder(req);
    if (!order) return res.status(404).end();
    openStream(req, res);
    send(res, 'order', customerView(order));
    if (!customerStreams.has(order.id)) customerStreams.set(order.id, new Set());
    customerStreams.get(order.id).add(res);
    req.on('close', () => {
      const set = customerStreams.get(order.id);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) customerStreams.delete(order.id);
    });
  });

  app.post('/api/orders/:id/arrived', (req, res) => {
    const order = findCustomerOrder(req);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    let note;
    try {
      note = cleanText(req.body && req.body.note, 120);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const updated = store.markArrived(order.id, note);
    if (!updated) return res.status(409).json({ error: 'This order is not ready for check-in.' });
    return res.json({ order: customerView(updated) });
  });

  app.post('/api/kitchen/login', (req, res) => {
    if (!kitchenPasscode) return res.status(503).json({ error: 'Kitchen dashboard is not configured.' });
    if (!loginAllowed(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
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
  });

  app.post('/api/kitchen/logout', (req, res) => {
    res.clearCookie(KITCHEN_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/kitchen/orders', requireKitchen, (req, res) => {
    res.json({ orders: store.kitchenOrders().map(kitchenView) });
  });

  app.get('/api/kitchen/events', requireKitchen, (req, res) => {
    openStream(req, res);
    send(res, 'snapshot', store.kitchenOrders().map(kitchenView));
    kitchenStreams.add(res);
    req.on('close', () => kitchenStreams.delete(res));
  });

  app.post('/api/kitchen/orders/:id/status', requireKitchen, (req, res) => {
    const next = req.body && req.body.status;
    if (!KITCHEN_STATUSES.has(next)) return res.status(400).json({ error: 'Unknown status.' });
    const order = store.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const updated = store.setStatus(order.id, next);
    if (!updated) return res.status(409).json({ error: `Cannot move a ${order.status} order to ${next}.` });
    return res.json({ order: kitchenView(updated) });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

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
    return res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp, customerView, kitchenView };
