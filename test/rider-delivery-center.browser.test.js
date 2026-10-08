// Browser check of the Ride Center / Delivery Center split in the rider
// dashboard, the page the Harvey Taxi rider iOS and Android apps show in
// their WebView. Desktop Chromium at phone size: NOT a device test.
//
// One rider account has an active passenger ride AND an active food
// delivery: each shows in its own center with its own card, history and
// labels; the request buttons open the existing booking flow in the right
// mode; cancelling the delivery uses the same free cancellation flow,
// worded for a delivery. All data is test fixtures.
//
// Needs Playwright and a Chromium build; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/rider-delivery-center.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver, makeRide, signTestRiderToken } = require("./rideTestHelpers");

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
jest.setTimeout(120000);

const HOST = "harveytaxiservice.test";
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

function seedRides() {
  return [
    makeRide({
      id: "TEST-RIDE-ACTIVE",
      rider_id: "RIDER_1",
      driver_id: "DRIVER_1",
      status: "driver_enroute",
      ride_type: "standard",
      pickup_address: "TEST 1 Ride St",
      dropoff_address: "TEST Ride Destination",
      payment_id: null,
      created_at: minutesAgo(10)
    }),
    makeRide({
      id: "TEST-DELIVERY-ACTIVE",
      rider_id: "RIDER_1",
      driver_id: "DRIVER_2",
      status: "driver_enroute",
      ride_type: "food",
      delivery_stage: "enroute_merchant",
      delivery_pin: "4321",
      merchant_name: "TEST Kitchen",
      pickup_address: "TEST Kitchen, 5 Food Ave",
      dropoff_address: "TEST Home, 9 Oak St",
      payment_id: null,
      created_at: minutesAgo(8)
    }),
    makeRide({
      id: "TEST-RIDE-OLD",
      rider_id: "RIDER_1",
      status: "completed",
      ride_type: "standard",
      pickup_address: "TEST Old Ride Pickup",
      dropoff_address: "TEST Old Ride Dropoff",
      completed_at: minutesAgo(3000),
      created_at: minutesAgo(3010)
    }),
    makeRide({
      id: "TEST-DELIVERY-OLD",
      rider_id: "RIDER_1",
      status: "completed",
      ride_type: "grocery",
      merchant_name: "TEST Grocer",
      pickup_address: "TEST Old Grocery Pickup",
      dropoff_address: "TEST Old Grocery Dropoff",
      completed_at: minutesAgo(2000),
      created_at: minutesAgo(2010)
    })
  ];
}

describeWithBrowser("Ride Center / Delivery Center in the rider dashboard (rider apps' WebView)", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider()],
      drivers: [makeDriver(), makeDriver({ id: "DRIVER_2", email: "d2@example.test", phone: "+16155550299", first_name: "Dana" })],
      rides: seedRides(),
      driver_offers: [],
      audit_logs: [],
      ride_contact_attempts: [],
      push_subscriptions: [],
      system_flags: [{ key: "rider_history_enabled", value: "true" }]
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

  beforeEach(() => {
    mockSupabaseClient._state.rides = seedRides();
  });

  async function openDashboard(query = "") {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/rider-dashboard.html${query}`);
    return { context, page, errors };
  }

  const visible = (page, sel) => page.isVisible(sel);
  const text = (page, sel) => page.$eval(sel, (n) => n.innerText.replace(/\s+/g, " ").trim());

  test("an account with an active ride and an active delivery: each in its own center, labelled, with its own history", async () => {
    const { context, page, errors } = await openDashboard();

    // Ride Center by default: the ride card, ride history, no delivery items.
    await page.waitForSelector("#activeRequestSection", { state: "visible", timeout: 20000 });
    expect(await page.getAttribute("[data-center-tab=ride]", "aria-pressed")).toBe("true");
    expect(await text(page, "#activeRequestSection")).toMatch(/TEST 1 Ride St/);
    expect(await text(page, "#activeRequestSection")).not.toMatch(/TEST Kitchen|4321/);
    expect(await visible(page, "#activeDeliverySection")).toBe(false);
    expect(await visible(page, "#deliverySupportSection")).toBe(false);
    expect(await text(page, "#activityHeading")).toBe("Ride history");
    await page.waitForFunction(() => /TEST Old Ride Pickup/.test(document.getElementById("activityList").innerText));
    const rideHistory = await text(page, "#activityList");
    expect(rideHistory).not.toMatch(/TEST Old Grocery|TEST Kitchen/);

    // Delivery Center: the delivery card (PIN shown to the rider, labelled
    // for handoff), delivery history and delivery support; no ride items.
    await page.click("[data-center-tab=delivery]");
    await page.waitForSelector("#activeDeliverySection", { state: "visible" });
    expect(await page.getAttribute("[data-center-tab=delivery]", "aria-pressed")).toBe("true");
    const deliveryCard = await text(page, "#activeDeliverySection");
    expect(deliveryCard).toMatch(/Active delivery/);
    expect(deliveryCard).toMatch(/Food delivery/);
    expect(deliveryCard).toMatch(/TEST Kitchen, 5 Food Ave/);
    expect(deliveryCard).toMatch(/Delivery PIN \(give it to the driver only at handoff\) 4321/i);
    expect(deliveryCard).not.toMatch(/TEST 1 Ride St/);
    expect(await visible(page, "#activeRequestSection")).toBe(false);
    expect(await visible(page, "#deliverySupportSection")).toBe(true);
    expect(await visible(page, "#requestFoodDeliveryBtn")).toBe(true);
    expect(await text(page, "#activityHeading")).toBe("Delivery history");
    await page.waitForFunction(() => /TEST Old Grocery Pickup/.test(document.getElementById("activityList").innerText));
    expect(await text(page, "#activityList")).not.toMatch(/TEST Old Ride/);

    // The chosen center is remembered on this device.
    await page.reload();
    await page.waitForSelector("#activeDeliverySection", { state: "visible", timeout: 20000 });
    expect(await page.getAttribute("[data-center-tab=delivery]", "aria-pressed")).toBe("true");

    // Back to the Ride Center.
    await page.click("[data-center-tab=ride]");
    await page.waitForSelector("#activeRequestSection", { state: "visible" });
    expect(await visible(page, "#activeDeliverySection")).toBe(false);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("request buttons open the existing booking flow in the right mode", async () => {
    for (const [query, selector, title] of [
      ["?center=delivery", "#requestFoodDeliveryBtn", /Request Food Delivery/],
      ["?center=delivery", "#requestGroceryDeliveryBtn", /Request Groceries/],
      ["?center=ride", "#heroRequestRideBtn", /Request|Ride/]
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { context, page, errors } = await openDashboard(query);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForSelector(selector, { state: "visible", timeout: 20000 });
      // eslint-disable-next-line no-await-in-loop
      await page.click(selector);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForSelector("#rideWizardOverlay:not([hidden])");
      // eslint-disable-next-line no-await-in-loop
      expect([selector, await text(page, "#wizardHeroTitle")]).toEqual([selector, expect.stringMatching(title)]);
      if (selector === "#heroRequestRideBtn") {
        // eslint-disable-next-line no-await-in-loop
        expect(await text(page, "#wizardHeroTitle")).not.toMatch(/Deliver|Groceries/);
      }
      expect(errors).toEqual([]);
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  });

  test("cancelling the delivery uses the same free flow, worded for a delivery; the ride is untouched", async () => {
    const { context, page, errors } = await openDashboard("?center=delivery");
    await page.waitForSelector("#cancelActiveDeliveryBtn:not([hidden])", { timeout: 20000 });
    const dialogs = [];
    page.once("dialog", (d) => {
      dialogs.push(d.message());
      d.accept();
    });
    await page.click("#cancelActiveDeliveryBtn");
    await page.waitForSelector("#cancelledRideNotice:not([hidden])");
    expect(dialogs[0]).toMatch(/^Cancel this delivery\?\n\nCancellation fee: \$0\.00/);
    expect(await text(page, "#cancelActiveRideNote")).toBe("Your delivery was cancelled. Cancellation fee: $0.00.");
    const rides = mockSupabaseClient._state.rides;
    expect(rides.find((r) => r.id === "TEST-DELIVERY-ACTIVE")).toMatchObject({ status: "cancelled", cancellation_fee_cents: 0 });
    expect(rides.find((r) => r.id === "TEST-RIDE-ACTIVE").status).toBe("driver_enroute");
    expect(errors).toEqual([]);
    await context.close();
  });
});
