// Languages on HTAF and Harvey Taxi pages (owner, 2026-10-13).
// The HTAF home, application and contact pages and the Harvey Taxi home
// page follow the one language preference (/language-pref.js), in every
// language of its list; text without a translation stays English. Consent
// and legal statements always stay English, with a translated summary.
// Checked here, as the owner asked before review:
//   - all 242 HTAF entries are translated into every listed language, and
//     only the five intended strings are left in English;
//   - the change-watcher cannot loop;
//   - switching repeatedly works, back to English exactly;
//   - the saved preference and ?lang=xx work, English for unsupported ones;
//   - links between Harvey Taxi and HTAF carry the language and keep their
//     other parameters and #anchor;
//   - Arabic is right-to-left, and every selector fits a phone.
// Chromium; fake database.
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
jest.setTimeout(600000);
const HOST = "harveytaxiservice.test";
const PUBLIC = path.join(__dirname, "..", "public");
const HTAF_PAGES = ["foundation.html", "htaf-application.html", "contact.html"];

function loadScript(file) {
  const window = {};
  const document = { addEventListener() {} };
  const localStorage = { getItem: () => null, setItem() {} };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "localStorage", "navigator", "URLSearchParams", fs.readFileSync(path.join(PUBLIC, file), "utf8"))(
    window, document, localStorage, { language: "en-US" }, URLSearchParams
  );
  return window;
}
const REGISTRY = loadScript("language-pref.js").HarveyLanguage.languages;
const LANGS = REGISTRY.map((l) => l.code);
const TABLE = loadScript("htaf-translations.js").HTAF_TRANSLATIONS;

// Strings on the HTAF pages deliberately left in English: three sit inside
// the English SMS consent statement, one labels a hidden spam-trap field,
// and one is the state's name.
const INTENTIONALLY_ENGLISH = ["Privacy Policy", "and", "Terms of Use", "Leave this empty", "Tennessee"];
// Names, addresses and contact details are never translated.
const PROPER = [
  "Harvey Transportation Assistance Foundation", "Harvey Transportation Assistance Foundation (\"HTAF\")", "HT", "EIN", "HTAF",
  "1617 Lebanon Pike", "Nashville, TN 37210", "1617 Lebanon Pike, Nashville, TN 37210",
  "WillieHtaf@harveytransportationfoundation.com", "615-636-6201"
];

describe("language list and translation table", () => {
  test("the list offers the requested languages with clear Chinese and Portuguese variants", () => {
    expect(LANGS).toEqual(["en", "es", "ar", "zh", "pt", "fr", "hi", "ht", "sw", "yo", "ha", "ig", "sn", "nd", "ak"]);
    const zh = REGISTRY.find((l) => l.code === "zh");
    const pt = REGISTRY.find((l) => l.code === "pt");
    expect([zh.name, zh.html]).toEqual(["简体中文", "zh-Hans"]);
    expect([pt.name, pt.html]).toEqual(["Português (Brasil)", "pt-BR"]);
  });

  test("all 242 entries are translated into every listed language", () => {
    expect(Object.keys(TABLE.t)).toHaveLength(242);
    expect(["en", ...TABLE.langs].sort()).toEqual([...LANGS].sort());
    const gaps = Object.entries(TABLE.t).filter(([, v]) => v.length !== TABLE.langs.length || v.some((x) => !x || !x.trim()));
    expect(gaps).toEqual([]);
  });

  test("the five intentionally English strings are not in the table, and no consent text is", () => {
    const keys = Object.keys(TABLE.t);
    for (const s of INTENTIONALLY_ENGLISH) expect(keys).not.toContain(s);
    for (const start of ["Yes, I agree to receive text", "By submitting this application", "I certify that"]) {
      expect(keys.some((k) => k.startsWith(start))).toBe(false);
    }
  });

  test("numbers, phone numbers, emails and codes survive in every translation", () => {
    const TOK = /501\(c\)\(3\)|HTAF-XXXXXXXX-XXXX|\(844\) 795-0299|615-636-6201|WillieHtaf@harveytransportationfoundation\.com|EIN 41-5115030/g;
    const bad = [];
    for (const [en, row] of Object.entries(TABLE.t)) {
      const toks = en.match(TOK) || [];
      row.forEach((t, i) => toks.forEach((tok) => { if (!t.includes(tok)) bad.push(`${TABLE.langs[i]}: ${tok} in "${en.slice(0, 40)}"`); }));
    }
    expect(bad).toEqual([]);
  });
});

describeWithBrowser("in the browser", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
    mockSupabaseClient = createFakeSupabase({ htaf_applications: [], riders: [], drivers: [], rides: [], audit_logs: [], system_flags: [] });
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
    if (HTAF_PAGES.includes(file.split("?")[0])) await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
    else await page.waitForTimeout(400);
    return { context, page };
  }

  // Visible text outside [data-no-translate], one entry per text node.
  const visibleText = (page) => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      const el = n.parentElement;
      if (!t || !/[A-Za-z]/.test(t) || !el || el.closest("script,style,noscript,[data-no-translate],#htaPanel,.hta-root")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === "hidden" || el.closest("[hidden]")) continue;
      out.push(t);
    }
    return out;
  });

  test("on the three HTAF pages, only names and the intended strings stay English", async () => {
    const leftovers = {};
    for (const file of HTAF_PAGES) {
      const en = await open(file, "en");
      const english = new Set(await visibleText(en.page));
      await en.context.close();
      const ha = await open(file, "ha");
      const hausa = await visibleText(ha.page);
      await ha.context.close();
      const same = [...new Set(hausa.filter((t) => english.has(t)))]
        .filter((t) => !PROPER.includes(t) && !INTENTIONALLY_ENGLISH.includes(t) && !/^©/.test(t) && !/^(Updated|An sabunta)/.test(t));
      if (same.length) leftovers[file] = same;
    }
    expect(leftovers).toEqual({});
  });

  test("the change-watcher cannot loop", async () => {
    const { context, page } = await open("contact.html?topic=general", "es");
    // Page-written text (form errors) is translated once, then everything settles.
    await page.click("#inquiry-submit");
    await page.waitForSelector("#e-name:not([hidden])");
    await page.selectOption("select[data-htaf-lang]", "fr");
    await page.selectOption("select[data-htaf-lang]", "ar");
    await page.waitForTimeout(800);
    const a = await page.evaluate(() => ({ ...window.HTAF_I18N_STATS }));
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => ({ ...window.HTAF_I18N_STATS }));
    const err = await page.textContent("#e-name");
    await context.close();
    expect(b).toEqual(a);
    expect(err).toBe("أدخل اسمك.");
  });

  test("switching through every language twice returns to the exact English page", async () => {
    for (const file of HTAF_PAGES) {
      const { context, page } = await open(file, "en");
      const snapshot = () => page.evaluate(() => ({
        text: document.body.innerText,
        placeholders: [...document.querySelectorAll("[placeholder]")].map((e) => e.placeholder),
        lang: document.documentElement.lang,
        dir: document.documentElement.dir
      }));
      const before = await snapshot();
      for (let round = 0; round < 2; round++) {
        for (const l of LANGS) await page.selectOption("select[data-htaf-lang]", l);
      }
      await page.selectOption("select[data-htaf-lang]", "en");
      await page.waitForTimeout(200);
      const after = await snapshot();
      await context.close();
      expect(after).toEqual(before);
    }
  });

  test("every language shows its own text on each HTAF page", async () => {
    const wrong = [];
    for (const l of LANGS.filter((x) => x !== "en")) {
      const { context, page } = await open("foundation.html", l);
      const r = await page.evaluate(() => ({ lang: document.documentElement.lang, apply: document.querySelector(".hero-actions a").textContent.trim() }));
      await context.close();
      const expected = TABLE.t["Apply For Assistance"][TABLE.langs.indexOf(l)];
      const html = REGISTRY.find((x) => x.code === l).html || l;
      if (r.apply !== expected || r.lang !== html) wrong.push({ l, ...r });
    }
    expect(wrong).toEqual([]);
  });

  test("?lang= sets the preference; unsupported or invalid codes give English", async () => {
    const check = async (query) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
      await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
      const page = await context.newPage();
      await page.goto(`${base}/foundation.html${query}`, { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
      const htaf = await page.evaluate(() => ({ lang: document.documentElement.lang, saved: localStorage.getItem("harvey_language") }));
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.waitForTimeout(400);
      const taxi = await page.evaluate(() => document.documentElement.lang);
      await context.close();
      return { ...htaf, taxi };
    };
    expect(await check("?lang=ha")).toEqual({ lang: "ha", saved: "ha", taxi: "ha" });
    expect(await check("?lang=pt")).toEqual({ lang: "pt-BR", saved: "pt", taxi: "pt-BR" });
    expect(await check("?lang=de")).toEqual({ lang: "en", saved: "de", taxi: "en" });
    expect(await check("?lang=%3Cscript%3E")).toEqual({ lang: "en", saved: null, taxi: "en" });
  });

  test("links between Harvey Taxi and HTAF carry the language and keep parameters and anchor", async () => {
    const results = {};
    for (const [file, target] of [
      ["index.html", "https://harveytransportationfoundation.com/contact.html?topic=partnership#inquiry"],
      ["foundation.html", "https://harveytaxiservice.com/rider-dashboard.html?screen=book&mode=driver#top"]
    ]) {
      const { context, page } = await open(file, "sn");
      results[file] = await page.evaluate((href) => {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = "test link";
        a.addEventListener("click", (e) => e.preventDefault());
        document.body.appendChild(a);
        a.click();
        const first = a.getAttribute("href");
        // The preference changes; the same link picks up the new language.
        localStorage.setItem("harvey_language", "ig");
        a.click();
        return { first, second: a.getAttribute("href") };
      }, target);
      await context.close();
    }
    expect(results["index.html"]).toEqual({
      first: "https://harveytransportationfoundation.com/contact.html?topic=partnership&lang=sn#inquiry",
      second: "https://harveytransportationfoundation.com/contact.html?topic=partnership&lang=ig#inquiry"
    });
    expect(results["foundation.html"]).toEqual({
      first: "https://harveytaxiservice.com/rider-dashboard.html?screen=book&mode=driver&lang=sn#top",
      second: "https://harveytaxiservice.com/rider-dashboard.html?screen=book&mode=driver&lang=ig#top"
    });
  });

  test("a choice made in Harvey Taxi Settings carries to the HTAF pages", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (r) => r.abort());
    const page = await context.newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "load" });
    await page.selectOption("#languageSelect", "nd");
    await page.goto(`${base}/htaf-application.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.HTAF_LANG === "function");
    const r = await page.evaluate(() => ({ lang: document.documentElement.lang, submit: document.querySelector('button[type="submit"]').textContent.trim() }));
    await context.close();
    expect(r).toEqual({ lang: "nd", submit: "Thumela Isicelo" });
  });

  test("the application keeps consent statements English, with a translated summary", async () => {
    const { context, page } = await open("htaf-application.html", "fr");
    const r = await page.evaluate(() => ({
      sms: document.getElementById("smsConsentText").textContent,
      cert: document.querySelector(".status-box span[data-no-translate]").textContent,
      certify: document.querySelector("#consent").closest("label").textContent.trim(),
      summaries: [...document.querySelectorAll(".htaf-summary")].map((p) => getComputedStyle(p).display !== "none" && p.textContent.startsWith("Résumé dans votre langue"))
    }));
    await context.close();
    expect(r.sms.startsWith("Yes, I agree to receive text messages")).toBe(true);
    expect(r.cert.startsWith("By submitting this application")).toBe(true);
    expect(r.certify.startsWith("I certify that")).toBe(true);
    expect(r.summaries).toEqual([true, true]);
  });

  test("Arabic is right-to-left with contact details kept left-to-right", async () => {
    const { context, page } = await open("contact.html", "ar");
    const r = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      details: [...document.querySelectorAll(".contact-value")].map((el) => getComputedStyle(el).direction),
      h1: document.querySelector("h1").textContent
    }));
    await context.close();
    expect(r.dir).toBe("rtl");
    expect(r.details.every((d) => d === "ltr")).toBe(true);
    expect(r.h1).toBe("تواصل مع HTAF");
  });

  for (const file of [...HTAF_PAGES, "index.html", "settings.html"]) {
    test(`${file}: every language fits a 360px phone, selector and bottom bar included`, async () => {
      const problems = [];
      for (const l of LANGS) {
        const { context, page } = await open(file, l, 360);
        const r = await page.evaluate(() => {
          const sel = document.querySelector("select[data-htaf-lang], #language-select, #languageSelect");
          const b = sel.getBoundingClientRect();
          const nav = document.querySelector(".bottom-nav, nav[class*=bottom]");
          const navClipped = nav
            ? [...nav.querySelectorAll("a,button")]
              .filter((e) => getComputedStyle(e).display !== "none")
              .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth + 1)
              .map((e) => e.innerText.trim())
            : [];
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            selectFits: b.left >= -1 && b.right <= window.innerWidth + 1,
            options: sel.options.length,
            navClipped
          };
        });
        await context.close();
        if (r.overflow > 1 || !r.selectFits || r.options !== 15 || r.navClipped.length) problems.push({ l, ...r });
      }
      expect(problems).toEqual([]);
    });
  }
});
