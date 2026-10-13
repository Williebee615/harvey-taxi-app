// HTAF "Partner With Us" (owner request, 2026-10-13), on HTAF's own domain:
// the foundation page links to a partnership section, its button opens the
// HTAF contact form with "Partnership inquiry" chosen, and a sent form
// reaches HTAF's inbox. Checked on phone widths with no sideways scrolling.
// Chromium; fake database; email mocked.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-partner.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.SENDGRID_API_KEY = "SG.test-key";
process.env.ENABLE_REAL_EMAIL = "true";
process.env.HTAF_ADMIN_EMAIL = "htaf-inbox@harveytransportationfoundation.example";
process.env.FOUNDATION_HOST = "harveytransportationfoundation.test";
delete process.env.CANONICAL_HOST;
delete process.env.HTAF_INQUIRY_EMAIL;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
const mockSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: (...args) => mockSend(...args) }));

let chromium = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ chromium } = require("playwright"));
} catch (error) {
  chromium = null;
}
const describeWithBrowser = chromium ? describe : describe.skip;
jest.setTimeout(180000);
const HOST = "harveytransportationfoundation.test";
const SHOTS = process.env.PAGE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "htaf-partner") : null;

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8");

describe("page copy", () => {
  test("the foundation page has the owner's partnership copy and links", () => {
    const html = read("foundation.html");
    expect(html).toMatch(/Contact HTAF<\/a>\s*<a href="#partner" class="btn btn-secondary">Partner With Us<\/a>/);
    expect(html).toContain("<h3>Partner With HTAF</h3>");
    expect(html).toContain("We welcome inquiries from\n          healthcare providers, employers, schools, community organizations, transportation\n          providers, and sponsors.");
    for (const way of ["Referring people for assistance", "Sponsoring transportation", "Coordinating community programs", "Providing transportation resources"]) {
      expect(html).toContain(`<li>${way}</li>`);
    }
    expect(html).toContain('href="contact.html?topic=partnership#inquiry" class="btn btn-primary">Discuss a Partnership</a>');
  });

  test("the contact form warns against patient information and takes no files", () => {
    const html = read("contact.html");
    expect(html).toContain("Please don't include patient information, medical details, or sensitive documents.");
    expect(html).not.toMatch(/type="file"/);
  });
});

describeWithBrowser("on HTAF's domain, on phones", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ audit_logs: [], system_flags: [], htaf_applications: [] });
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

  async function phone(width) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytransportationfoundation\.test)/, (route) => route.abort());
    return { context, page: await context.newPage() };
  }
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  for (const width of [360, 390]) {
    test(`${width}px: Partner With Us → section → Discuss a Partnership → form sent to HTAF`, async () => {
      mockSend.mockClear();
      const { context, page } = await phone(width);
      await page.goto(`${base}/`, { waitUntil: "load" });
      const button = page.locator('.hero-actions a:has-text("Partner With Us")');
      const fits = await button.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth);
      const homeOverflow = await overflow(page);
      if (SHOTS && width === 390) {
        await page.evaluate(() => {
          document.documentElement.style.scrollBehavior = "auto";
          document.querySelector(".hero-actions").scrollIntoView({ block: "center" });
        });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, "1-foundation-buttons.png") });
      }
      await button.click();
      await page.waitForFunction(() => {
        const r = document.getElementById("partner").getBoundingClientRect();
        return r.top >= -2 && r.top < window.innerHeight / 2;
      });
      if (SHOTS && width === 390) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(SHOTS, "2-partner-section.png") });
      }

      await Promise.all([page.waitForURL(/contact\.html\?topic=partnership#inquiry$/), page.click('a:has-text("Discuss a Partnership")')]);
      const form = await page.evaluate(() => ({
        topic: document.getElementById("f-topic").value,
        interestShown: !document.getElementById("interest-field").hidden,
        orgOptionalShown: !document.getElementById("org-opt").hidden
      }));
      const contactOverflow = await overflow(page);
      if (SHOTS && width === 390) await page.screenshot({ path: path.join(SHOTS, "3-contact-form.png") });

      // Empty submit: errors on the fields, nothing sent.
      await page.click("#inquiry-submit");
      await page.waitForSelector("#e-name:not([hidden])");
      const sentEarly = mockSend.mock.calls.length;

      await page.fill("#f-name", "Dana Rivers");
      await page.fill("#f-organization", "Eastside Clinic");
      await page.fill("#f-email", "dana@example.test");
      await page.selectOption("#f-interest", "referrals");
      await page.fill("#f-message", "We'd like to refer patients who miss appointments for lack of a ride.");
      await page.click("#inquiry-submit");
      await page.waitForSelector("#inquiry-status.ok");
      const statusText = await page.textContent("#inquiry-status");
      if (SHOTS && width === 390) {
        await page.locator("#inquiry-status").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, "4-sent.png") });
      }
      await context.close();

      expect(fits).toBe(true);
      expect(homeOverflow).toBeLessThanOrEqual(1);
      expect(form).toEqual({ topic: "partnership", interestShown: true, orgOptionalShown: false });
      expect(contactOverflow).toBeLessThanOrEqual(1);
      expect(sentEarly).toBe(0);
      expect(statusText).toContain("Your message was sent to HTAF");
      expect(mockSend).toHaveBeenCalledTimes(1);
      const msg = mockSend.mock.calls[0][0];
      expect(msg.to).toBe("htaf-inbox@harveytransportationfoundation.example");
      expect(msg.from.name).toBe("Harvey Transportation Assistance Foundation");
      expect(msg.replyTo).toBe("dana@example.test");
      expect(msg.subject).toBe("HTAF partnership inquiry: Eastside Clinic");
    });
  }

  test("if the email can't be sent, the form says so and gives HTAF's email and phone", async () => {
    mockSend.mockRejectedValueOnce(new Error("down"));
    const { context, page } = await phone(390);
    await page.goto(`${base}/contact.html?topic=general#inquiry`, { waitUntil: "load" });
    await page.fill("#f-name", "Sam");
    await page.fill("#f-email", "sam@example.test");
    await page.fill("#f-message", "Do you accept donations by check?");
    await page.click("#inquiry-submit");
    await page.waitForSelector("#inquiry-status.err");
    const text = await page.textContent("#inquiry-status");
    const keptName = await page.inputValue("#f-name");
    await context.close();
    expect(text).toContain("couldn't be sent");
    expect(text).toContain("WillieHtaf@harveytransportationfoundation.com");
    expect(text).toContain("615-636-6201");
    expect(keptName).toBe("Sam");
  });
});
