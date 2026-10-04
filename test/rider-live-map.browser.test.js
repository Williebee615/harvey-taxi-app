// Browser check of the rider page's live map (docs/live-map-tracking.md):
// with a public map token configured, a ride with a driver on the way
// shows a map with the driver, pickup and destination; the rider can turn
// on location sharing, which posts their position to the server (where
// the driver app reads it) and adds their own marker; turning it off
// deletes it. The Mapbox library is replaced by a small stand-in, so no
// network is used.
//
// Needs Playwright and Chromium; skips without them (CI has no browser).
//   NODE_PATH="$(npm root -g)" npx jest test/rider-live-map.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.MAPBOX_PUBLIC_TOKEN = "pk.test-web-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide } = require("./rideTestHelpers");
const { signRideTrackingToken, deriveTrackingSecret } = require("../lib/rideAccess");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(90000);

const HOST = "harveytaxiservice.test";
const token = signRideTrackingToken("RIDE_MAP", deriveTrackingSecret({ quoteSecret: process.env.RIDE_QUOTE_SECRET }));

// Records what the page asks the map to draw.
function fakeMapbox() {
  window.__map = { created: 0, token: null, markers: {}, fits: 0 };
  class Marker {
    constructor({ element }) {
      this.el = element;
    }
    setLngLat(ll) {
      this.ll = ll;
      window.__map.markers[this.el.title] = ll;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      delete window.__map.markers[this.el.title];
    }
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  class Map {
    constructor() {
      window.__map.created += 1;
      window.__map.token = window.mapboxgl.accessToken;
    }
    on() {}
    fitBounds() {
      window.__map.fits += 1;
    }
    easeTo() {}
    remove() {}
  }
  window.mapboxgl = { Map, Marker, LngLatBounds, accessToken: null };
}

// The phone's position. (Real geolocation needs https; production is.)
function fakeGeolocation() {
  window.__geo = { watching: 0, cleared: 0 };
  const geo = {
    watchPosition(success) {
      window.__geo.watching += 1;
      setTimeout(() => success({ coords: { latitude: 36.1612, longitude: -86.7811, accuracy: 9 } }), 50);
      return 7;
    },
    clearWatch() {
      window.__geo.cleared += 1;
    },
    getCurrentPosition(success, failure) {
      if (failure) failure({ code: 2, message: "unavailable in test" });
    }
  };
  Object.defineProperty(navigator, "geolocation", { configurable: true, get: () => geo });
}

describeWithBrowser("rider page: live map and location sharing", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider({ id: "RIDER_1" })],
      drivers: [makeDriver({ id: "DRIVER_1", current_lat: 36.17, current_lng: -86.79, last_seen_at: new Date().toISOString() })],
      rides: [
        makeRide({
          id: "RIDE_MAP",
          status: "driver_enroute",
          rider_id: "RIDER_1",
          driver_id: "DRIVER_1",
          driver_name: "Morgan",
          pickup_lat: 36.16,
          pickup_lng: -86.78,
          dropoff_lat: 36.12,
          dropoff_lng: -86.68
        })
      ],
      system_flags: [],
      audit_logs: []
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test("map shows driver, pickup and destination; sharing adds and removes the rider", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addInitScript((t) => {
      localStorage.setItem("harvey_ride_tracking_tokens", JSON.stringify({ RIDE_MAP: t }));
    }, token);
    await context.addInitScript(fakeMapbox);
    await context.addInitScript(fakeGeolocation);
    const page = await context.newPage();
    await page.goto(`${base}/rider-dashboard.html?screen=track&ride_id=RIDE_MAP`);

    await page.waitForFunction(() => window.__map && Object.keys(window.__map.markers).length >= 3, null, { timeout: 15000 });
    expect(await page.evaluate(() => window.__map.token)).toBe("pk.test-web-token");
    expect(await page.evaluate(() => window.__map.markers)).toEqual({
      "Your driver": [-86.79, 36.17],
      Pickup: [-86.78, 36.16],
      Destination: [-86.68, 36.12]
    });
    expect(await page.isVisible("#liveMapCard")).toBe(true);
    expect(await page.isVisible("#riderShareBtn")).toBe(true);
    expect((await page.textContent("#riderShareBtn")).trim()).toBe("Share my location with my driver");

    await page.click("#riderShareBtn");
    await page.waitForFunction(() => window.__map.markers.You, null, { timeout: 15000 });
    expect(await page.evaluate(() => window.__map.markers.You)).toEqual([-86.7811, 36.1612]);
    const stored = () => mockSupabaseClient._state.rides.find((r) => r.id === "RIDE_MAP");
    for (let i = 0; i < 50 && stored().rider_live_lat == null; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(100);
    }
    expect(stored()).toMatchObject({ rider_live_lat: 36.1612, rider_live_lng: -86.7811, rider_live_accuracy_m: 9 });
    expect((await page.textContent("#riderShareBtn")).trim()).toBe("Stop sharing my location");

    await page.click("#riderShareBtn");
    for (let i = 0; i < 50 && stored().rider_live_lat != null; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(100);
    }
    expect(stored()).toMatchObject({ rider_live_lat: null, rider_live_at: null });
    await page.waitForFunction(() => !window.__map.markers.You, null, { timeout: 5000 });
    expect((await page.textContent("#riderShareBtn")).trim()).toBe("Share my location with my driver");
    await context.close();
  });
});
