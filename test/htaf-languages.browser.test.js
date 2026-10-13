// HTAF pages in the visitor's language (owner, 2026-10-13): the HTAF home,
// application and contact pages follow the one language preference shared
// with Harvey Taxi, in the same 10 languages, English where a string has no
// translation. Consent and legal statements always stay English, with a
// translated summary beside them. A ?lang= on a link sets the preference
// (the two domains keep separate browser storage), and links between the
// two sites carry it. Chromium; fake database.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-languages.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

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
jest.setTimeout(300000);
const HOST = "harveytaxiservice.test";
const PAGES = ["foundation.html", "htaf-application.html", "contact.html"];
const LANGS = ["en", "es", "fr", "ar", "sw", "zh", "hi", "pt", "ht", "yo"];
const SMS_CONSENT_START = "Yes, I agree to receive text messages from Harvey Transportation Assistance Foundation (HTAF)";

// Load the translation table the way the browser does.
const table = (() => {
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "public", "htaf-translations.js"), "utf8"))(window);
  return window.HTAF_TRANSLATIONS;
})();

describe("translation table", () => {
  test("covers the same 9 languages as Harvey Taxi, and every entry has all 9", () => {
    expect(["en", ...table.langs]).toEqual(LANGS);
    const incomplete = Object.entries(table.t).filter(([, v]) => v.length !== 9 || v.some((x) => !x));
    expect(incomplete).toEqual([]);
  });

  test("never translates the binding consent statements", () => {
    const keys = Object.keys(table.t);
    expect(keys.some((k) => k.startsWith("Yes, I agree to receive text"))).toBe(false);
    expect(keys.some((k) => k.startsWith("By submitting this application"))).toBe(false);
    expect(keys.some((k) => k.startsWith("I certify that"))).toBe(false);
  });
});

describeWithBrowser("HTAF pages in the browser", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ htaf_applications: [], audit_logs: [], system_flags: [] });
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

  async function open(file, lang, width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    if (lang) {
      await context.addInitScript((l) => {
        try { localStorage.setItem("harvey_language", l); } catch (e) { /* ignore */ }
      }, lang);
    }
    const page = await context.newPage();
    await page.goto(`${base}/${file}`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
    return { context, page };
  }

  test("a Spanish choice made in Harvey Taxi Settings carries to the HTAF pages", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    const page = await context.newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    await page.selectOption("#languageSelect", "es");
    await page.goto(`${base}/foundation.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
    const r = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      apply: [...document.querySelectorAll(".hero-actions a")].map((a) => a.textContent.trim()),
      select: document.querySelector("select[data-htaf-lang]").value
    }));
    await context.close();
    expect(r.lang).toBe("es");
    expect(r.apply).toEqual(expect.arrayContaining(["Solicitar asistencia", "Colabore con nosotros"]));
    expect(r.select).toBe("es");
  });

  test("the application keeps consent statements English, with a translated summary", async () => {
    const { context, page } = await open("htaf-application.html", "fr");
    const r = await page.evaluate(() => ({
      submit: document.querySelector('#applicationForm button[type="submit"], button[type="submit"]').textContent.trim(),
      sms: document.getElementById("smsConsentText").textContent,
      cert: document.querySelector(".status-box span[data-no-translate]").textContent,
      certify: document.querySelector("#consent").closest("label").textContent.trim(),
      summaries: [...document.querySelectorAll(".htaf-summary")].map((p) => ({ shown: getComputedStyle(p).display !== "none", text: p.textContent }))
    }));
    await context.close();
    expect(r.submit).toBe("Envoyer la demande");
    expect(r.sms.startsWith("Yes, I agree to receive text messages")).toBe(true);
    expect(r.cert.startsWith("By submitting this application")).toBe(true);
    expect(r.certify.startsWith("I certify that")).toBe(true);
    expect(r.summaries).toHaveLength(2);
    expect(r.summaries.every((s) => s.shown && s.text.startsWith("Résumé dans votre langue"))).toBe(true);
  });

  test("in English the summaries are hidden and the page is unchanged", async () => {
    const { context, page } = await open("htaf-application.html", "en");
    const r = await page.evaluate(() => ({
      shown: [...document.querySelectorAll(".htaf-summary")].some((p) => getComputedStyle(p).display !== "none"),
      sms: document.getElementById("smsConsentText").textContent
    }));
    await context.close();
    expect(r.shown).toBe(false);
    expect(r.sms.startsWith(SMS_CONSENT_START)).toBe(true);
  });

  test("switching with the page's own selector updates the page and the shared preference", async () => {
    const { context, page } = await open("contact.html", "en");
    await page.selectOption("select[data-htaf-lang]", "ar");
    const ar = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      title: document.querySelector("h1").textContent,
      saved: localStorage.getItem("harvey_language")
    }));
    await page.selectOption("select[data-htaf-lang]", "en");
    const en = await page.evaluate(() => ({ title: document.querySelector("h1").textContent, dir: document.documentElement.dir }));
    await context.close();
    expect(ar).toEqual({ lang: "ar", dir: "rtl", title: "تواصل مع HTAF", saved: "ar" });
    expect(en).toEqual({ title: "Contact HTAF", dir: "ltr" });
  });

  test("messages the contact form writes are translated too", async () => {
    const { context, page } = await open("contact.html?topic=general", "es");
    await page.click("#inquiry-submit");
    await page.waitForSelector("#e-name:not([hidden])");
    const err = await page.textContent("#e-name");
    await context.close();
    expect(err).toBe("Escriba su nombre.");
  });

  test("?lang= on a link sets the preference (for the other domain)", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    const page = await context.newPage();
    await page.goto(`${base}/foundation.html?lang=pt`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
    const r = await page.evaluate(() => ({ lang: window.HTAF_LANG(), saved: localStorage.getItem("harvey_language") }));
    await context.close();
    expect(r).toEqual({ lang: "pt", saved: "pt" });
  });

  test("a link to the other site carries the language", async () => {
    const { context, page } = await open("foundation.html", "sw");
    const href = await page.evaluate(() => {
      const a = document.querySelector('a[href^="https://harveytransportationfoundation.com"]') || document.createElement("a");
      if (!a.getAttribute("href")) { a.href = "https://harveytaxiservice.com/"; document.body.appendChild(a); }
      a.addEventListener("click", (e) => e.preventDefault());
      a.click();
      return a.getAttribute("href");
    });
    await context.close();
    // On this test host both sites count as "the other site".
    expect(href).toMatch(/[?&]lang=sw\b/);
  });

  test("in Arabic, the address, email and phone keep their left-to-right order", async () => {
    const { context, page } = await open("contact.html", "ar");
    const dirs = await page.evaluate(() => [...document.querySelectorAll(".contact-value")].map((el) => getComputedStyle(el).direction));
    await context.close();
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.every((d) => d === "ltr")).toBe(true);
  });

  for (const file of PAGES) {
    test(`${file}: every language fits a 360px phone`, async () => {
      const problems = [];
      for (const lang of LANGS) {
        const { context, page } = await open(file, lang, 360);
        const r = await page.evaluate(() => ({ lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - window.innerWidth }));
        await context.close();
        if (r.lang !== lang || r.overflow > 1) problems.push({ lang, ...r });
      }
      expect(problems).toEqual([]);
    });
  }
});
