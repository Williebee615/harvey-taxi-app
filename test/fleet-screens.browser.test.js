// Fleet screens (fleet management phase 1): the admin Fleets card and the
// driver dashboard Fleet section. Synthetic drivers, fake database,
// desktop Chromium.
//   NODE_PATH="$(npm root -g)" npx jest test/fleet-screens.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, signTestDriverToken } = require("./rideTestHelpers");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(150000);

function adminSession(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}
const OWNER = makeDriver({ id: "DRV-OWNER", first_name: "Olivia", phone: "+16155550201", online: false });
const MEMBER = makeDriver({ id: "DRV-MEMBER", first_name: "Sam", phone: "+16155550202", email: "sam@example.test", online: false });

describeWithBrowser("fleet screens", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockClient = createFakeSupabase({
      drivers: [OWNER, MEMBER].map((d) => ({ ...d })),
      riders: [], rides: [], driver_earnings: [], driver_offers: [], audit_logs: [], push_subscriptions: [], merchants: [], htaf_applications: [],
      fleets: [], fleet_vehicles: [], fleet_vehicle_documents: [], fleet_memberships: [], vehicle_assignments: [],
      system_flags: [{ key: "fleet_management_enabled", value: "true" }]
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  async function driverPage(driver) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const token = signTestDriverToken(driver.id);
    await context.addInitScript(([id, tk]) => {
      window.localStorage.setItem("harvey_driver_id", id);
      window.localStorage.setItem("harvey_driver_token", tk);
    }, [driver.id, token]);
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/driver.html`, { waitUntil: "load" });
    return { context, page };
  }

  async function adminPage() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
    await context.addCookies([{ name: "htaf_admin_session", value: adminSession("owner@harvey.example"), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/admin-dashboard.html`, { waitUntil: "load" });
    return { context, page };
  }

  test("owner applies; staff approve, verify documents and activate; owner invites; driver accepts with the disclosure; owner assigns", async () => {
    // Owner applies from the driver dashboard.
    let { context, page } = await driverPage(OWNER);
    await page.locator("#fleetCard").waitFor({ state: "visible" });
    await page.fill("#fleetName", "Music City Cars");
    await page.click("#fleetApplyBtn");
    await page.waitForFunction(() => /waiting for Harvey Taxi review/.test(document.getElementById("fleetBody").innerText));
    await context.close();

    // Staff approve.
    ({ context, page } = await adminPage());
    await page.locator("#fleetsList").locator("text=Music City Cars").waitFor();
    expect(await page.locator("#fleetsList").innerText()).toMatch(/OFF|ON/);
    page.once("dialog", (d) => d.accept());
    await page.click('button[data-fleet-decision="approve"]');
    await page.waitForFunction(() => !document.querySelector('button[data-fleet-decision="approve"]'));
    expect(mockClient._state.fleets[0]).toMatchObject({ status: "active", reviewed_by: "owner@harvey.example" });
    await context.close();

    // Owner adds a vehicle and enters document dates (unverified).
    ({ context, page } = await driverPage(OWNER));
    await page.locator("#vAddBtn").waitFor();
    await page.fill("#vYear", "2022");
    await page.fill("#vMake", "Toyota");
    await page.fill("#vModel", "Camry");
    await page.fill("#vColor", "Blue");
    await page.fill("#vPlate", "ABC123");
    await page.fill("#vState", "TN");
    await page.fill("#vVin", "A1B2C3");
    await page.click("#vAddBtn");
    await page.waitForFunction(() => /2022 Toyota Camry/.test(document.getElementById("fleetBody").innerText));
    expect(await page.locator("#fleetBody").innerText()).toMatch(/Not ready/);
    await context.close();

    // Staff verify both documents from the document and activate.
    ({ context, page } = await adminPage());
    await page.locator('button[data-vehicle-doc="insurance"]').waitFor();
    page.once("dialog", (d) => d.accept("2027-06-30"));
    await page.click('button[data-vehicle-doc="insurance"]');
    await page.waitForFunction(() => /Document verified/.test(document.body.innerText));
    page.once("dialog", (d) => d.accept("2027-06-30"));
    await page.click('button[data-vehicle-doc="registration"]');
    await page.waitForFunction(() => /registration until 2027-06-30 \(staff verified\)/.test(document.getElementById("fleetsList").innerText));
    await page.click('button[data-vehicle-status="active"]');
    await page.waitForFunction(() => /Vehicle activated/.test(document.body.innerText));
    expect(mockClient._state.fleet_vehicles[0].status).toBe("active");
    await context.close();

    // Owner invites Sam at 20%.
    ({ context, page } = await driverPage(OWNER));
    await page.locator("#invSendBtn").waitFor();
    expect(await page.locator("#fleetBody").innerText()).toMatch(/Ready for riders/);
    await page.fill("#invPhone", "(615) 555-0202");
    await page.fill("#invShare", "20");
    await page.click("#invSendBtn");
    await page.waitForFunction(() => /Sam • invited/.test(document.getElementById("fleetBody").innerText));
    await context.close();

    // Sam sees the share and what the owner can see, and accepts.
    ({ context, page } = await driverPage(MEMBER));
    await page.locator('button[data-respond][data-accept="true"]').waitFor();
    const invite = await page.locator("#fleetBody").innerText();
    expect(invite).toMatch(/20%/);
    expect(invite).toMatch(/don't see your phone, email, documents, background check or location/);
    await page.click('button[data-respond][data-accept="true"]');
    await page.waitForFunction(() => /You drive for Music City Cars/.test(document.getElementById("fleetBody").innerText));
    await context.close();

    // Owner assigns the vehicle; the owner's view has no contact details.
    ({ context, page } = await driverPage(OWNER));
    await page.locator("button[data-assign]").waitFor();
    await page.click("button[data-assign]");
    await page.waitForFunction(() => /Driving 2022 Toyota Camry/.test(document.getElementById("fleetBody").innerText));
    const ownerView = await page.locator("#fleetBody").innerText();
    expect(ownerView).not.toMatch(/sam@example\.test|555-0202/);
    expect(mockClient._state.drivers.find((d) => d.id === "DRV-MEMBER")).toMatchObject({ vehicle_make: "Toyota", vehicle_model: "Camry" });
    await context.close();
  });

  test("with the switch off, the driver page shows no Fleet section", async () => {
    mockClient._state.system_flags = [];
    const { context, page } = await driverPage(OWNER);
    await page.waitForTimeout(2000);
    expect(await page.locator("#fleetCard").isVisible()).toBe(false);
    await context.close();
    mockClient._state.system_flags = [{ key: "fleet_management_enabled", value: "true" }];
  });
});
