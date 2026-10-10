// Rider web pages at small phone sizes: the dashboard, booking and live
// tracking screens that the rider iOS and Android apps show in their
// WebView. Chromium with phone viewports and touch: NOT a device test, and
// the soft keyboard is approximated by shrinking the viewport.
//
// Checks, for each phone size:
// - no sideways scrolling and the content uses the screen width;
// - the App Review banner and the page header never cover each other;
// - the assistant button never covers a button, link or field;
// - the last content clears the bottom navigation bar when scrolled to the end;
// - a focused field stays visible above the keyboard.
// Writes screenshots to docs/screenshots/rider-mobile-layout/<label>/ when
// LAYOUT_SCREENSHOTS=<label> (e.g. "before" or "after").
//
// Needs Playwright and Chromium; skips without them. Run with:
//   NODE_PATH="$(npm root -g)" npx jest test/rider-mobile-layout.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const fs = require("fs");
const path = require("path");
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
jest.setTimeout(240000);

const HOST = "harveytaxiservice.test";
const LABEL = process.env.LAYOUT_SCREENSHOTS || "";
// Each page from its own test address, so the server's per-address rate
// limits (shared by the whole file otherwise) don't decide these tests.
let testIp = 0;
const nextIpHeaders = () => ({ "X-Forwarded-For": `198.51.100.${(testIp = (testIp % 250) + 1)}` });
const SHOTS = LABEL ? path.join(__dirname, "..", "docs", "screenshots", "rider-mobile-layout", LABEL) : null;

// Small phones the rider apps run on (CSS pixels).
const PHONES = [
  { name: "android-360x640", width: 360, height: 640, ua: "Mozilla/5.0 (Linux; Android 14; SM-A146U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 HarveyTaxiApp/1.0.2 (android)" },
  { name: "android-412x915", width: 412, height: 915, ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 HarveyTaxiApp/1.0.2 (android)" },
  { name: "iphone-se-375x667", width: 375, height: 667, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 HarveyTaxiApp/1.0.2 (ios)" },
  { name: "iphone-13mini-375x812", width: 375, height: 812, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 HarveyTaxiApp/1.0.2 (ios)" }
];

describeWithBrowser("rider pages on small phones (booking, dashboard, tracking)", () => {
  let server;
  let browser;
  let base;
  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({
      riders: [makeRider({ is_review_account: true })],
      drivers: [makeDriver()],
      rides: [
        makeRide({
          id: "RIDE_LAYOUT_1",
          status: "driver_enroute",
          driver_id: "DRIVER_1",
          driver_name: "Test Driver",
          driver_vehicle: "Test Vehicle",
          driver_eta_to_pickup_text: "6 min",
          pickup_address: "116 5th Ave N, Nashville, TN 37219",
          dropoff_address: "2301 Vanderbilt Pl, Nashville, TN 37235",
          is_review_ride: true
        })
      ],
      audit_logs: [],
      system_flags: [
        { key: "agent_assist_enabled", value: "true" },
        { key: "agent_kill_switch", value: "false" },
        { key: "review_account_login_enabled", value: "true" }
      ]
    });
    // eslint-disable-next-line global-require
    const { app } = require("../server");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://${HOST}:${server.address().port}`;
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  });
  afterAll(async () => {
    if (browser) await browser.close();
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  async function openPhone(phone, url) {
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: phone.ua,
      extraHTTPHeaders: nextIpHeaders()
    });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}${url}`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 20000 });
    await page.waitForFunction(() => document.body.classList.contains("app-review-mode"), null, { timeout: 20000 });
    await page.waitForTimeout(600);
    return { context, page, errors };
  }

  // Layout facts for the current scroll position. `root` is the element
  // that scrolls (the booking/tracking overlay scrolls on its own).
  function measure(page, rootSelector) {
    return page.evaluate((sel) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const visible = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !el.closest("[hidden]");
      };
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      };
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const root = sel ? document.querySelector(sel) : document.scrollingElement;
      const inRoot = (el) => (sel ? root.contains(el) : !document.getElementById("rideWizardOverlay")?.contains(el) || document.getElementById("rideWizardOverlay").hidden);

      const banners = Array.from(document.querySelectorAll(".app-review-banner")).filter((b) => visible(b) && inRoot(b));
      const banner = banners[0] ? rect(banners[0]) : null;
      // Only a pinned (sticky or fixed) header can cover the pinned banner;
      // ordinary content scrolling beneath the banner is expected.
      const headers = Array.from(document.querySelectorAll(".topbar")).filter((h) => visible(h) && inRoot(h) && ["sticky", "fixed"].includes(getComputedStyle(h).position));
      const header = headers[0] ? rect(headers[0]) : null;

      const launcher = document.querySelector("[data-testid=hta-launcher]");
      const launcherRect = visible(launcher) ? rect(launcher) : null;
      const nav = document.querySelector(".bottom-nav");
      const navRect = visible(nav) && !sel ? rect(nav) : null;

      const controls = Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [role=button]"))
        .filter((el) => el !== launcher && !el.closest("#htaPanel") && !el.closest(".bottom-nav") && visible(el) && inRoot(el));
      const covered = [];
      if (launcherRect) {
        for (const el of controls) {
          const r = rect(el);
          if (r.bottom <= 0 || r.top >= vh) continue;
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const centreHit = cx >= launcherRect.left && cx <= launcherRect.right && cy >= launcherRect.top && cy <= launcherRect.bottom;
          if (centreHit || overlap(launcherRect, r) > (r.width * r.height) / 2) covered.push((el.innerText || el.getAttribute("aria-label") || el.placeholder || el.tagName).trim().slice(0, 40));
        }
      }
      const underNav = [];
      if (navRect) {
        for (const el of controls) {
          const r = rect(el);
          if (r.bottom <= 0 || r.top >= vh) continue;
          if (overlap(navRect, r) > 24) underNav.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40));
        }
      }
      // Widest visible content block, as a share of the screen.
      const blocks = Array.from(document.querySelectorAll(sel ? `${sel} .card, ${sel} section, ${sel} .panel` : ".card, section, .panel, .hero"))
        .filter((el) => visible(el) && inRoot(el) && !el.closest("#htaPanel"));
      const widest = blocks.reduce((m, el) => Math.max(m, el.getBoundingClientRect().width), 0);
      // What is drawn at the top and middle of the screen.
      const describe = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} [${Math.round(r.top)}..${Math.round(r.bottom)}] pos=${getComputedStyle(el).position}`;
      };
      return {
        at: { top10: describe(vw / 2, 10), top40: describe(vw / 2, 40), middle: describe(vw / 2, vh / 2), bottom: describe(vw / 2, vh - 90) },
        vw,
        vh,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        bodyScrollWidth: document.documentElement.scrollWidth,
        widestBlockShare: Math.round((widest / vw) * 100),
        banner,
        header,
        bannerHeaderOverlap: banner && header ? overlap(banner, header) : 0,
        launcher: launcherRect,
        covered,
        underNav,
        nav: navRect
      };
    }, rootSelector);
  }

  async function scrollRoot(page, rootSelector, to) {
    await page.evaluate(
      ({ sel, y }) => {
        const root = sel ? document.querySelector(sel) : document.scrollingElement;
        root.scrollTop = y === "end" ? root.scrollHeight : y;
      },
      { sel: rootSelector, y: to }
    );
    await page.waitForTimeout(1000);
  }

  const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  // Collected per phone and screen; asserted at the end so one run shows
  // every problem.
  const results = {};

  for (const phone of PHONES) {
    test(`${phone.name}: dashboard, booking and tracking`, async () => {
      const out = (results[phone.name] = {});

      // Dashboard: top, scrolled a little (sticky header/banner), bottom.
      {
        const { context, page, errors } = await openPhone(phone, "/rider-dashboard.html");
        out.dashboardTop = await measure(page, null);
        await shot(page, `${phone.name}-dashboard-top`);
        await scrollRoot(page, null, 600);
        out.dashboardScrolled = await measure(page, null);
        await shot(page, `${phone.name}-dashboard-scrolled`);
        await scrollRoot(page, null, "end");
        out.dashboardEnd = await measure(page, null);
        out.dashboardEndClearance = await page.evaluate(() => {
          const nav = document.querySelector(".bottom-nav");
          const launcher = document.querySelector("[data-testid=hta-launcher]");
          const navTop = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
          const launcherTop = launcher && !launcher.hidden ? launcher.getBoundingClientRect().top : navTop;
          // Lowest visible piece of page content (not fixed or sticky).
          let lowest = -Infinity;
          for (const el of document.querySelectorAll(".shell *")) {
            if (el.closest("#rideWizardOverlay, #htaPanel, .bottom-nav, [hidden]")) continue;
            const cs = getComputedStyle(el);
            if (cs.position === "fixed" || cs.position === "sticky" || cs.display === "none" || cs.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) lowest = Math.max(lowest, r.bottom);
          }
          return { belowContentToNav: Math.round(navTop - lowest), belowContentToAssistant: Math.round(launcherTop - lowest) };
        });
        await shot(page, `${phone.name}-dashboard-end`);
        out.errors = errors;
        await context.close();
      }

      // Booking (the wizard overlay scrolls on its own).
      {
        const { context, page, errors } = await openPhone(phone, "/rider-dashboard.html?screen=book&mode=driver");
        await page.waitForSelector("#rideWizardOverlay:not([hidden])", { timeout: 15000 });
        await page.waitForTimeout(500);
        out.bookTop = await measure(page, "#rideWizardOverlay");
        out.bookTextShare = await page.evaluate(() => Math.round((document.getElementById("heroCopy").getBoundingClientRect().width / window.innerWidth) * 100));
        await shot(page, `${phone.name}-book-top`);
        await scrollRoot(page, "#rideWizardOverlay", 500);
        out.bookScrolled = await measure(page, "#rideWizardOverlay");
        await shot(page, `${phone.name}-book-scrolled`);
        // Keyboard: focus the first text field, then shrink the viewport
        // by a typical keyboard height.
        // Step 1 -> address step: choose Driver Ride and confirm.
        await page.click("#modeDriverBtn");
        await page.click("#confirmServiceBtn");
        await page.waitForSelector("#pickupAddress", { state: "visible", timeout: 15000 });
        const hasField = await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll("#rideWizardOverlay input, #rideWizardOverlay textarea")).find((f) => {
            const r = f.getBoundingClientRect();
            return !["hidden", "checkbox", "radio", "button", "submit"].includes(f.type) && r.width > 0 && r.height > 0 && !f.closest("[hidden]") && getComputedStyle(f).visibility !== "hidden";
          });
          if (!el) return false;
          el.setAttribute("data-layout-field", "1");
          return true;
        });
        if (hasField) {
          const field = page.locator("[data-layout-field]");
          await field.scrollIntoViewIfNeeded();
          await field.focus();
          await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.55) });
          await page.waitForTimeout(500);
          out.bookKeyboard = await page.evaluate(() => {
            const el = document.activeElement;
            const r = el.getBoundingClientRect();
            const launcher = document.querySelector("[data-testid=hta-launcher]");
            const l = launcher && getComputedStyle(launcher).display !== "none" && !launcher.hidden ? launcher.getBoundingClientRect() : null;
            const hit = l && !(l.right <= r.left || l.left >= r.right || l.bottom <= r.top || l.top >= r.bottom);
            // Not under the pinned App Review banner either.
            const banner = Array.from(document.querySelectorAll("#rideWizardOverlay .app-review-banner")).find((b) => !b.hidden);
            const bannerBottom = banner ? banner.getBoundingClientRect().bottom : 0;
            return { fieldTop: Math.round(r.top), fieldBottom: Math.round(r.bottom), vh: window.innerHeight, fieldVisible: r.top >= bannerBottom && r.bottom <= window.innerHeight, launcherOverField: Boolean(hit) };
          });
          await shot(page, `${phone.name}-book-keyboard`);
        }
        out.bookErrors = errors;
        await context.close();
      }

      // Live tracking of the active ride.
      {
        const { context, page, errors } = await openPhone(phone, "/rider-dashboard.html?screen=track&ride_id=RIDE_LAYOUT_1");
        await page.waitForSelector("#rideWizardOverlay:not([hidden])", { timeout: 15000 });
        await page.waitForTimeout(800);
        out.trackTop = await measure(page, "#rideWizardOverlay");
        await shot(page, `${phone.name}-track-top`);
        await scrollRoot(page, "#rideWizardOverlay", "end");
        out.trackEnd = await measure(page, "#rideWizardOverlay");
        await shot(page, `${phone.name}-track-end`);
        out.trackErrors = errors;
        await context.close();
      }
      if (process.env.LAYOUT_REPORT) fs.writeFileSync(path.join(SHOTS || __dirname, `${phone.name}.json`), JSON.stringify(out, null, 2));

      const screens = ["dashboardTop", "dashboardScrolled", "dashboardEnd", "bookTop", "bookScrolled", "trackTop", "trackEnd"];
      for (const key of screens) {
        const m = out[key];
        // No sideways scrolling, on the page or inside booking/tracking.
        expect({ key, sideways: m.scrollWidth - m.clientWidth > 1 || m.bodyScrollWidth - m.vw > 1 }).toEqual({ key, sideways: false });
        // Content uses the screen width.
        expect({ key, wide: m.widestBlockShare >= 90 }).toEqual({ key, wide: true });
        // The pinned App Review banner and the page header never overlap.
        expect({ key, overlap: m.bannerHeaderOverlap }).toEqual({ key, overlap: 0 });
        // The assistant button never sits on a control's centre or covers
        // most of it.
        expect({ key, covered: m.covered }).toEqual({ key, covered: [] });
      }
      // Scrolled to the end, the last content clears the bottom bar and the
      // assistant button.
      expect(out.dashboardEndClearance.belowContentToNav).toBeGreaterThanOrEqual(0);
      expect(out.dashboardEndClearance.belowContentToAssistant).toBeGreaterThanOrEqual(0);
      // With the keyboard up, the focused address field is visible and the
      // assistant button is out of the way.
      expect(out.bookKeyboard).toMatchObject({ fieldVisible: true, launcherOverField: false });
      // The booking text column uses most of the screen (was ~62% at 360px).
      expect(out.bookTextShare).toBeGreaterThanOrEqual(80);
      expect([...out.errors, ...out.bookErrors, ...out.trackErrors]).toEqual([]);
    });
  }

  test("pinned bars stop below the status bar when the page draws under it (simulated 32px inset)", async () => {
    // Chromium can't emulate env(safe-area-inset-top); the page's pinned
    // bars use the --safe-top variable that holds it, so set that instead.
    for (const [url, root] of [["/rider-dashboard.html", null], ["/rider-dashboard.html?screen=book&mode=driver", "#rideWizardOverlay"]]) {
      // eslint-disable-next-line no-await-in-loop
      const { context, page } = await openPhone(PHONES[0], url);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-top", "32px");
        const ov = document.getElementById("rideWizardOverlay");
        if (ov) ov.style.setProperty("--safe-top", "32px");
      });
      // eslint-disable-next-line no-await-in-loop
      await scrollRoot(page, root, 900);
      // eslint-disable-next-line no-await-in-loop
      const m = await measure(page, root);
      expect(m.banner.top).toBeGreaterThanOrEqual(32);
      expect(m.bannerHeaderOverlap).toBe(0);
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  });

  test("desktop layout is unchanged: the dashboard header stays pinned and the assistant keeps its labelled button", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: nextIpHeaders() });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addCookies([{ name: "harvey_rider_session", value: encodeURIComponent(signTestRiderToken("RIDER_1")), url: base }]);
    const page = await context.newPage();
    await page.goto(`${base}/rider-dashboard.html`);
    await page.waitForSelector("[data-testid=hta-launcher]", { timeout: 30000 });
    const desk = await page.evaluate(() => {
      const header = document.querySelector(".shell > .topbar");
      const launcher = document.querySelector("[data-testid=hta-launcher]");
      return { headerPosition: getComputedStyle(header).position, headerTop: getComputedStyle(header).top, launcherText: launcher.innerText.trim(), launcherLeft: Math.round(launcher.getBoundingClientRect().left) };
    });
    expect(desk).toEqual({ headerPosition: "sticky", headerTop: "14px", launcherText: "Harvey Assistant", launcherLeft: 16 });
    await context.close();
  });
});
