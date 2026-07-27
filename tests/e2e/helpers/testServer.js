// Spins up a disposable Express server serving the real public/ static
// files plus mocked API routes, so the rider-dashboard e2e suite can
// exercise real frontend code (rider-dashboard.html, the wizard overlay,
// the server-side legacy redirects) without touching real Supabase,
// Stripe, or Google Maps. Each test gets its own server + port so tests
// can run with independent mock responses.

const path = require("path");
const express = require("express");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "public");
const { LEGACY_RIDER_REQUEST_ROUTES, buildLegacyRedirectTarget } =
  require("../../../lib/riderRequestRedirects");

function defaultReadiness(req, res) {
  res.json({
    ok: true,
    rider: {
      id: req.params.id,
      approved: true,
      verified: true,
      status: "active"
    }
  });
}

/**
 * @param {object} overrides - optional map of route -> handler to replace
 *   specific mocked endpoints for a given test (e.g. a non-approved rider).
 */
async function startTestServer(overrides = {}) {
  const app = express();

  app.get("/api/maps-key", overrides.mapsKey || ((req, res) => res.json({ ok: true, key: "" })));
  app.get("/api/stripe-key", overrides.stripeKey || ((req, res) => res.json({ ok: true, key: "" })));
  app.get("/api/riders/:id/readiness", overrides.readiness || defaultReadiness);
  app.get("/api/rider/rides", overrides.rides || ((req, res) => res.json({ ok: true, rides: [] })));
  app.get("/api/rider/deliveries", overrides.deliveries || ((req, res) => res.json({ ok: true, deliveries: [] })));
  app.get("/api/rider/saved-places", overrides.savedPlaces || ((req, res) => res.json({ ok: true, places: [] })));
  app.get("/api/rider/payment-methods", overrides.paymentMethods || ((req, res) => res.json({ ok: true, payment_methods: [] })));
  app.get("/api/foundation/applications/by-email", overrides.htafStatus || ((req, res) => res.json({ ok: false })));
  app.get("/api/push/vapid-public-key", overrides.vapidKey || ((req, res) => res.json({ ok: true, key: "" })));
  app.post("/api/rides/estimate", overrides.estimate || ((req, res) => res.json({ ok: false })));
  app.post("/api/rides/request", overrides.requestRide || ((req, res) => res.json({ ok: false })));
  app.get("/api/rides/:id/status", overrides.rideStatus || ((req, res) => res.json({
    ok: true,
    ride: { id: req.params.id, status: "assigned", driver: { name: "Test Driver", verified: true } }
  })));

  // Server-side legacy redirects — the exact logic server.js registers,
  // so these e2e tests exercise the real behavior end-to-end via HTTP
  // (complementing lib/riderRequestRedirects.test.js's pure-function
  // coverage of the same module).
  for (const { path: legacyPath, mode } of LEGACY_RIDER_REQUEST_ROUTES) {
    app.get(legacyPath, (req, res) =>
      res.redirect(301, buildLegacyRedirectTarget(mode, req.query))
    );
  }

  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { startTestServer };
