'use strict';

const path = require('path');
const config = require('./config');
const { createApp } = require('./app');
const { OrderStore } = require('./lib/orderStore');

const env = process.env;
const port = Number(env.PORT) || 3100;
const isProduction = env.NODE_ENV === 'production';

const stripe = env.STRIPE_SECRET_KEY ? require('stripe')(env.STRIPE_SECRET_KEY) : null;
const demoPayments = !stripe && env.DEMO_PAYMENTS === 'true';

if (isProduction && demoPayments) {
  console.error('[simply-pies] DEMO_PAYMENTS cannot be enabled in production. Set STRIPE_SECRET_KEY instead.');
  process.exit(1);
}
if (isProduction && !env.SESSION_SECRET) {
  console.error('[simply-pies] SESSION_SECRET is required in production.');
  process.exit(1);
}

const store = new OrderStore({
  filePath: path.resolve(env.SIMPLY_PIES_DATA_DIR || path.join(__dirname, 'data'), 'orders.json'),
});
store.on('error', (err) => console.error('[simply-pies] Could not save orders:', err));

const app = createApp({
  config,
  store,
  stripe,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
  demoPayments,
  kitchenPasscode: env.KITCHEN_PASSCODE || null,
  sessionSecret: env.SESSION_SECRET,
  baseUrl: env.PUBLIC_BASE_URL || null,
});

app.listen(port, () => {
  console.log(`[simply-pies] Listening on http://localhost:${port}`);
  if (!stripe) {
    console.warn(demoPayments
      ? '[simply-pies] DEMO MODE: orders are accepted without taking payment.'
      : '[simply-pies] STRIPE_SECRET_KEY is not set: checkout is disabled.');
  } else if (!env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[simply-pies] STRIPE_WEBHOOK_SECRET is not set: relying on the return-page payment check only.');
  }
  if (!env.KITCHEN_PASSCODE) console.warn('[simply-pies] KITCHEN_PASSCODE is not set: the kitchen dashboard is disabled.');
  const missing = config.missingLaunchItems();
  if (missing.length) console.warn(`[simply-pies] Before launch, fill in config.js: ${missing.join(', ')}`);
});
