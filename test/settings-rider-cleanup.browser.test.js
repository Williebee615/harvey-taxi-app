// Rider experience cleanup (owner, 2026-10-13):
//   - Settings says "Harvey Assistant", never "AI Support" / "Open AI".
//   - No Driver tab or driver-dashboard link on the rider pages (home,
//     Settings, rider dashboard); driver sign-up and account deletion stay,
//     and the pages the Harvey Taxi Driver app opens still load.
//   - Bottom-bar labels fit on a 360px phone in every language.
//   - Settings text follows the chosen language, English where a page has
//     no translation; the word DELETE stays as typed.
// Chromium; fake database.
//   NODE_PATH="$(npm root -g)" npx jest test/settings-rider-cleanup.browser
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
const request = require("supertest");

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
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8");
const RIDER_PAGES = ["index.html", "settings.html", "rider-dashboard.html"];
const LANGS = ["en", "es", "ar", "zh", "pt", "fr", "hi", "ht", "sw", "yo", "ha", "ig", "sn", "nd", "ak"];

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({
    riders: [],
    drivers: [],
    rides: [],
    audit_logs: [],
    system_flags: [{ key: "agent_assist_enabled", value: "true" }, { key: "agent_kill_switch", value: "false" }]
  });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("Settings names Harvey Assistant", () => {
  test("no AI Support / Open AI wording in any language", () => {
    const html = read("settings.html");
    for (const phrase of ["Ask AI Support", ">AI Support<", "\"AI Support\"", "Open AI", "Harvey AI", "Soporte IA", "Support IA", "Abrir IA", "Ouvrir l'IA", "AI assistance"]) {
      expect(html).not.toContain(phrase);
    }
    expect(html).toContain('data-i18n="askAi">Ask Harvey Assistant</button>');
    expect(html).toContain('<strong data-i18n="aiSupportTitle">Harvey Assistant</strong>');
  });
});

describe("rider pages have no driver dashboard entry", () => {
  test.each(RIDER_PAGES)("%s has no Driver tab or driver-dashboard link", (file) => {
    const html = read(file);
    expect(html).not.toMatch(/href="\/?driver-dashboard\.html"/);
    expect(html).not.toContain("safeGo('driver-dashboard.html'");
    expect(html).not.toContain('data-action="driver"');
    expect(html).not.toMatch(/location\.href = "\/?driver-dashboard\.html"/);
  });

  test("driver sign-up and account deletion links stay", () => {
    expect(read("index.html")).toContain('href="driver-signup.html"');
    expect(read("index.html")).toContain('href="settings.html#account-deletion"');
    expect(read("rider-dashboard.html")).toContain('href="settings.html?account=rider#account-deletion"');
    expect(read("settings.html")).toContain('id="account-deletion"');
  });

  test.each([
    "/driver-signup.html",
    "/driver.html",
    "/support.html",
    "/privacy-policy.html",
    "/terms.html",
    "/settings.html?account=driver"
  ])("the Driver app's page %s still loads", async (url) => {
    const res = await request(app).get(url).redirects(1);
    expect(res.status).toBe(200);
  });
});

describeWithBrowser("in the browser", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
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

  async function open(file, lang, width = 360) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => route.abort());
    await context.addInitScript((l) => {
      try { localStorage.setItem("harvey_language", l); } catch (e) { /* ignore */ }
    }, lang);
    const page = await context.newPage();
    await page.goto(`${base}/${file}`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    return { context, page };
  }

  for (const file of ["index.html", "settings.html"]) {
    test(`${file}: bottom-bar labels fit at 360px in every language`, async () => {
      const problems = [];
      for (const lang of LANGS) {
        const { context, page } = await open(file, lang);
        const r = await page.evaluate(() => {
          const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
          const shown = [...document.querySelectorAll(".bottom-nav .nav-btn")].filter((b) => getComputedStyle(b).display !== "none");
          return {
            labels: shown.map((b) => b.innerText.trim()),
            clipped: shown.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.innerText.trim()),
            outside: shown.filter((b) => b.getBoundingClientRect().right > window.innerWidth + 1 || b.getBoundingClientRect().bottom > nav.bottom + 1).map((b) => b.innerText.trim()),
            overflow: document.documentElement.scrollWidth - window.innerWidth
          };
        });
        await context.close();
        if (r.clipped.length || r.outside.length || r.overflow > 1) problems.push({ lang, ...r });
      }
      expect(problems).toEqual([]);
    });
  }

  test("Settings in Spanish: deletion steps translated, DELETE kept as typed", async () => {
    const { context, page } = await open("settings.html", "es", 390);
    const r = await page.evaluate(() => ({
      confirm: document.querySelector('label[for="deletionConfirmText"]').textContent,
      identity: document.getElementById("deletionIdentity").textContent,
      help: document.querySelector(".deletion-help").innerText,
      reason: document.getElementById("deletionReason").placeholder,
      contrast: document.getElementById("contrastBtn").textContent,
      assistant: document.querySelector('[data-i18n="aiSupportTitle"]').textContent
    }));
    await context.close();
    expect(r.confirm).toBe("Escribe DELETE para confirmar");
    expect(r.identity).toContain("No has iniciado sesión");
    expect(r.help).toContain("Contacta con soporte");
    expect(r.reason).toBe("Ayúdanos a entender por qué te vas (opcional)");
    expect(r.contrast).toBe("Contraste");
    expect(r.assistant).toBe("Harvey Assistant");
  });

  test("a language Settings doesn't have shows English", async () => {
    const { context, page } = await open("settings.html", "yo", 390);
    const r = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      confirm: document.querySelector('label[for="deletionConfirmText"]').textContent,
      identity: document.getElementById("deletionIdentity").textContent
    }));
    await context.close();
    expect(r.lang).toBe("en");
    expect(r.confirm).toBe("Type DELETE to confirm");
    expect(r.identity).toContain("You're not signed in");
  });

  test("home page in Spanish: notice, app card and bottom bar translated", async () => {
    const { context, page } = await open("index.html", "es", 390);
    const r = await page.evaluate(() => ({
      note: document.querySelector(".lang-note").textContent,
      announce: document.querySelector('[data-i18n="announceCopy"]').textContent,
      nav: [...document.querySelectorAll(".bottom-nav .nav-btn")].map((b) => b.innerText.trim())
    }));
    await context.close();
    expect(r.note).toContain("Las traducciones son automáticas");
    expect(r.announce).toContain("Solicita un viaje en Nashville");
    expect(r.nav).toEqual(["Inicio", "Viajes", "Asistente", "HTAF", "Ajustes"]);
  });
});
