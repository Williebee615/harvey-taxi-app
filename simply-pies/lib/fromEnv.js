'use strict';

const path = require('path');
const config = require('../config');
const { createApp } = require('../app');
const { MemoryOrderStore } = require('./orderStore');
const { PgOrderStore } = require('./pgOrderStore');

// Builds the app from environment variables. Shared by the local server
// (server.js) and the Vercel function (api/index.js).
function buildFromEnv(env = process.env) {
  const isProduction = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  const stripe = env.STRIPE_SECRET_KEY ? require('stripe')(env.STRIPE_SECRET_KEY) : null;
  const demoPayments = !stripe && env.DEMO_PAYMENTS === 'true';
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || null;
  const problems = [];

  if (isProduction && demoPayments) problems.push('DEMO_PAYMENTS cannot be enabled in production. Set STRIPE_SECRET_KEY instead.');
  if (isProduction && !env.SESSION_SECRET) problems.push('SESSION_SECRET is required in production.');
  if (env.VERCEL && !databaseUrl) problems.push('DATABASE_URL is required on Vercel (connect a Postgres database to the project).');

  let store;
  if (databaseUrl) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1|host=\/|@\/|%2F/.test(databaseUrl);
    store = new PgOrderStore(new Pool({
      connectionString: databaseUrl,
      max: env.VERCEL ? 3 : 10,
      ssl: local ? false : { rejectUnauthorized: env.PGSSL_ALLOW_SELF_SIGNED !== 'true' },
    }));
  } else {
    store = new MemoryOrderStore({
      filePath: path.resolve(env.SIMPLY_PIES_DATA_DIR || path.join(__dirname, '..', 'data'), 'orders.json'),
    });
  }

  const app = createApp({
    config,
    store,
    stripe,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    demoPayments,
    kitchenPasscode: env.KITCHEN_PASSCODE || null,
    sessionSecret: env.SESSION_SECRET,
    baseUrl: env.PUBLIC_BASE_URL || null,
    setupProblems: problems,
  });

  const warnings = [];
  if (!stripe) {
    warnings.push(demoPayments
      ? 'DEMO MODE: orders are accepted without taking payment.'
      : 'STRIPE_SECRET_KEY is not set: checkout is disabled.');
  } else if (!env.STRIPE_WEBHOOK_SECRET) {
    warnings.push('STRIPE_WEBHOOK_SECRET is not set: relying on the order-page payment check only.');
  }
  if (!env.KITCHEN_PASSCODE) warnings.push('KITCHEN_PASSCODE is not set: the kitchen dashboard is disabled.');
  if (!databaseUrl) warnings.push('DATABASE_URL is not set: using the local orders.json file.');
  const missing = config.missingLaunchItems();
  if (missing.length) warnings.push(`Before launch, fill in config.js: ${missing.join(', ')}`);

  return { app, store, problems, warnings };
}

module.exports = { buildFromEnv };
