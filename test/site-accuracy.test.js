// Public pages make only claims the platform supports today (owner
// audit, 2026-10-12): no "verified operations" or "live" status, no
// booking buttons for services that don't run, no unconfirmed app-store
// listing, no public admin link, labelled planned coverage and automatic
// translations. Also checks that every internal link on the public pages
// resolves and that page titles stay short.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

const request = require("supertest");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8");

const PUBLIC_PAGES = [
  "index.html",
  "foundation.html",
  "htaf-application.html",
  "contact.html",
  "leadership.html",
  "driver-signup.html",
  "rider-signup.html",
  "support.html",
  "privacy.html",
  "terms.html",
  "htaf-privacy.html",
  "htaf-terms.html",
  "htaf-service-providers.html",
  "app-review.html",
  "policies.html",
  "settings.html"
];

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ drivers: [], rides: [], system_flags: [], audit_logs: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("home page claims", () => {
  const html = read("index.html");

  test.each([
    "VERIFIED OPERATIONS",
    "LIVE SUPPORT",
    "Live System Overview",
    "Live on the Apple App Store",
    "verified driver network",
    "Order Food",
    "Order Groceries",
    "Open Pilot",
    "mode=autonomous",
    "mode=food",
    "mode=grocery",
    "BNA",
    "NEMT",
    "apps.apple.com",
    "HTAF Assisted Rides",
    "Not connected",
    "Platform Loaded",
    "future mobility services",
    "Not offered at this time",
    "autonomous_info",
    "logistics innovation",
    "Open AI Support",
    "Harvey AI Support",
    "Open AI Chat"
  ])("does not contain %p", (phrase) => {
    expect(html).not.toContain(phrase);
  });

  test("has no admin link", () => {
    expect(html).not.toMatch(/href="[^"]*admin[^"]*"/i);
  });

  test("unavailable services offer an email waitlist with a subject", () => {
    for (const subject of ["autonomous%20rides", "food%20delivery", "grocery%20delivery"]) {
      expect(html).toMatch(new RegExp(`href="mailto:support@harveytaxiservice\\.com\\?subject=Waitlist%3A%20${subject}&body=[^"]+"`));
    }
  });

  test("planned services and areas are labelled as planned", () => {
    expect(html).toContain("Food and grocery delivery");
    expect((html.match(/PLANNED/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Planned: Knoxville and Chattanooga.");
  });

  test("the driver snapshot starts hidden and is shown only for a real, positive count", () => {
    expect(html).toMatch(/<section class="mc-bar" id="mission-control"[^>]*hidden>/);
    expect(html).toContain("online <= 0");
  });

  test("translations are labelled automatic, and support is described as English", () => {
    expect(html).toContain("Translations are automated");
    expect(html).not.toContain("Spanish rider and driver support");
  });

  test("airport trips are listed as available without naming permits, terminals or pickup zones", () => {
    expect(html).toContain("<strong>Airport trips</strong><span>Available. Request an airport trip the same way as any other ride.</span>");
    expect(html).not.toMatch(/BNA|permit|curbside|terminal|pickup zone/i);
  });

  test("the welcome note is part of the page, not an overlay, and closes itself", () => {
    expect(html).toMatch(/\.welcome-banner \{\s*position: relative;/);
    expect(html).toContain("setTimeout(close, 4000)");
  });

  test("the ride request remains available", () => {
    expect(html).toContain('href="rider-dashboard.html?screen=book&mode=driver"');
  });
});

describe("other public pages", () => {
  test("sign-up pages call translation automatic, not AI support", () => {
    expect(read("driver-signup.html")).not.toContain(">AI Translation<");
    expect(read("driver-signup.html")).toContain("Automatic translation");
    expect(read("driver-signup.html")).not.toContain("screen reader compatibility");
    expect(read("rider-signup.html")).toContain("Translations are automatic");
  });

  test("foundation page makes no governance-independence claim pending documents", () => {
    expect(read("foundation.html")).not.toContain("does not share governance");
  });

  test.each(PUBLIC_PAGES)("%s has a title of 70 characters or fewer", (file) => {
    const title = (read(file).match(/<title>([^<]*)<\/title>/) || [])[1];
    expect(title).toBeTruthy();
    expect(title.length).toBeLessThanOrEqual(70);
  });
});

describe("internal links on public pages resolve", () => {
  test.each(PUBLIC_PAGES)("%s", async (file) => {
    const html = read(file);
    const hrefs = [...html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)]
      .map((m) => m[1])
      .filter((h) => !/^(https?:|mailto:|tel:|sms:|javascript:|\/\/|data:)/i.test(h))
      .filter((h) => !h.includes("${"));
    const broken = [];
    for (const href of [...new Set(hrefs)]) {
      const url = href.startsWith("/") ? href : `/${href}`;
      const res = await request(app).get(url);
      if (![200, 301, 302].includes(res.status)) broken.push(`${href} -> ${res.status}`);
    }
    expect(broken).toEqual([]);
  });
});
