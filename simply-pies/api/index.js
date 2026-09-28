'use strict';

// Vercel serverless entry point. vercel.json rewrites /api/* here; static
// pages in public/ are served directly by Vercel's CDN.
const { buildFromEnv } = require('../lib/fromEnv');

const { app, problems, warnings } = buildFromEnv();
for (const problem of problems) console.error(`[simply-pies] ${problem}`);
for (const warning of warnings) console.warn(`[simply-pies] ${warning}`);

module.exports = (req, res) => {
  // Vercel's Node helpers expose req.body as a lazy getter. Replace it with
  // a plain property so Express body parsers (including the raw body the
  // Stripe webhook signature check needs) read the request stream normally.
  // Setting NODEJS_HELPERS=0 in the project disables the helpers entirely.
  const descriptor = Object.getOwnPropertyDescriptor(req, 'body');
  if (descriptor && descriptor.get && descriptor.configurable) {
    Object.defineProperty(req, 'body', { value: undefined, writable: true, configurable: true, enumerable: true });
  }
  return app(req, res);
};
