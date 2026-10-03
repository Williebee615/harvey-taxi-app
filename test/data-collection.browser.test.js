// Browser check for the Data Collection program UI: the driver dashboard
// section stays hidden while the program flag is off, and when on, a
// driver can apply; the admin page (signed-in session cookie) can approve
// the application, preview and import a CSV with a column mapping, and
// move hours through review, at desktop and phone widths.
//
// Needs Playwright and a Chromium build; skips without them (CI does not
// install a browser). Run locally with, for example:
//   NODE_PATH="$(npm root -g)" npx jest test/data-collection.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.MINUTE_ORGANIZATION_CODE = "ORG-BROWSER-1";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, signTestDriverToken } = require("./rideTestHelpers");
const { installDataCollectionRpc } = require("./dataCollectionFakeRpc");

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

function adminSessionValue() {
  const now = Date.now();
  const encoded = Buffer.from(
    JSON.stringify({ sub: "htaf-admin", email: "ops@harveytaxiservice.test", iat: now, exp: now + 3_600_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("Data Collection program UI", () => {
  let server;
  let browser;
  let base;
  const state = () => mockSupabaseClient._state;

  function setFlags(values) {
    state().system_flags = Object.entries(values).map(([k, v]) => ({ key: `data_collection_${k}_enabled`, value: v }));
  }

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      drivers: [makeDriver({ id: "DRIVER_A", first_name: "Morgan", last_name: "Blake" })],
      driver_earnings: [],
      rides: []
    });
    installDataCollectionRpc(mockSupabaseClient);
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
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function driverPage(width = 1280) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    const token = signTestDriverToken("DRIVER_A");
    await context.addInitScript((t) => {
      localStorage.setItem("harvey_driver_token", t);
      localStorage.setItem("harvey_driver_id", "DRIVER_A");
    }, token);
    const page = await context.newPage();
    await page.goto(`${base}/driver-dashboard.html`);
    return { context, page };
  }

  async function adminPage(width = 1360) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "htaf_admin_session", value: adminSessionValue(), url: base }]);
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept(d.type() === "prompt" ? d.defaultValue() || "Reason given" : undefined));
    await page.goto(`${base}/admin-data-collection.html`);
    return { context, page };
  }

  test("the driver section stays hidden while the program is off", async () => {
    setFlags({});
    const { context, page } = await driverPage();
    await page.waitForResponse((r) => r.url().includes("/api/driver/data-collection"));
    await page.waitForTimeout(200);
    expect(await page.locator("#dcSection").isHidden()).toBe(true);
    await context.close();
  });

  test("end to end: apply, approve, sign, import, accept; organization code shown only when complete", async () => {
    setFlags({ program: "true", enrollment: "true", collection: "true" });

    // Driver applies (phone width: no horizontal scroll).
    const { context: dc, page: dp } = await driverPage(390);
    await dp.locator("#dcSection").waitFor({ state: "visible" });
    await expect(dp.locator("#dcIneligible").textContent()).resolves.toMatch(/driving.*seated.*repetitive/i);
    await dp.fill("#dcPhone", "Pixel 8");
    await dp.fill("#dcLocation", "Harvey Taxi depot, Nashville");
    await dp.fill("#dcTasks", "Restocking shelves\nWashing vehicles by hand");
    await dp.click("#dcSubmitBtn");
    await dp.waitForFunction(() => /understand|ineligible/i.test(document.querySelector("#dcMsg").textContent));
    await dp.check("#dcAck");
    await dp.click("#dcSubmitBtn");
    await dp.getByText("Under review").waitFor();
    expect(await dp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(state().data_collection_applications).toHaveLength(1);

    // Admin approves, links the contributor, records both agreements.
    const { context: ac, page: ap } = await adminPage();
    await ap.locator(".app-card").first().waitFor();
    await ap.click(".app-card button[data-status='approved']");
    await ap.waitForFunction(() => document.querySelector("#notice").textContent.includes("approved"));
    expect(state().data_collection_applications[0].status).toBe("approved");
    const appId = state().data_collection_applications[0].id;

    // The remaining setup goes through the same API the buttons call.
    const call = (path, body) =>
      ap.evaluate(
        async ([p, b]) => (await fetch(p, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status,
        [path, body]
      );
    expect(await call(`/api/admin/data-collection/applications/${appId}/contributor`, { minute_contributor_id: "C-100" })).toBe(200);

    // Approved, agreements unsigned: links section but no code.
    await dp.reload();
    await dp.getByText("Your organization code will appear here").waitFor();
    expect(await dp.content()).not.toContain("ORG-BROWSER-1");

    for (const type of ["contributor_agreement", "recording_consent"]) {
      expect(await call(`/api/admin/data-collection/applications/${appId}/agreements`, { agreement_type: type, status: "signed", document_version: "v1", signed_at: "2026-10-01" })).toBe(201);
    }

    // Import a CSV through the mapping UI.
    await ap.selectOption("#appFilter", "approved");
    await ap.setInputFiles("#importFile", {
      name: "minute.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Who,Session ID,Day,Mins\nC-100,S-1,2026-09-30,90\nC-100,S-1,2026-09-30,90\nC-555,S-2,2026-09-30,30\n")
    });
    await ap.locator("#mappingBox").waitFor({ state: "visible" });
    await ap.selectOption("#mapContributor", "Who");
    await ap.selectOption("#mapSession", "Session ID");
    await ap.selectOption("#mapDate", "Day");
    await ap.selectOption("#mapDuration", "Mins");
    await ap.selectOption("#mapUnit", "minutes");
    await ap.click("#previewBtn");
    await ap.locator("#commitBtn").waitFor();
    const previewText = await ap.locator("#previewBox").textContent();
    expect(previewText).toMatch(/duplicate_in_file/);
    expect(previewText).toMatch(/unmatched_contributor/);
    expect(previewText).toContain("$15.00"); // 1.5 h x $10
    await ap.click("#commitBtn");
    await ap.waitForFunction(() => document.querySelector("#notice").textContent.includes("Imported 1"));
    expect(state().data_collection_hour_records.map((r) => [r.external_session_id, r.duration_seconds, r.driver_amount_cents])).toEqual([["S-1", 5400, 1500]]);

    // Accept the pending hours.
    await ap.locator("[data-hour]").first().waitFor();
    await ap.check("#hoursAll");
    await ap.click("button[data-to='accepted']");
    await ap.waitForFunction(() => document.querySelector("#notice").textContent.includes("moved to accepted"));
    expect(state().data_collection_hour_records[0].status).toBe("accepted");
    // The page refreshes its lists after the notice; wait for the audit table.
    await ap.waitForFunction(() => document.querySelector("#auditList").textContent.includes("hours.status_changed"));

    // Driver now sees the code, accepted hours and estimated earnings.
    await dp.reload();
    await dp.getByText("ORG-BROWSER-1").waitFor();
    const section = await dp.locator("#dcSection").textContent();
    expect(section).toContain("1.50");
    expect(section).toContain("$15.00");
    expect(section).toMatch(/Awaiting payment approval/);
    expect(section).not.toMatch(/margin|company/i);
    expect(await dp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Admin page at phone width: no horizontal page scroll.
    const { context: mc, page: mp } = await adminPage(390);
    await mp.locator("#auditList table").waitFor();
    await mp.locator("#hoursList").waitFor();
    expect(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await Promise.all([dc.close(), ac.close(), mc.close()]);
  });
});
