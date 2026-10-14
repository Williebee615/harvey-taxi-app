// One assistant everywhere (owner, 2026-10-12): the home page, rider sign-up,
// Settings and the admin dashboard use the shared Harvey Assistant
// (agent-assist.js). The old OpenAI widget is gone, nothing calls the old
// /api/ai/support endpoint, there is one assistant per page, its button
// covers no other control, and answers come from rules (no AI model) until
// the consent step is live, even for accounts on the model test list.
// Chromium; fake database; no outside network.
//   NODE_PATH="$(npm root -g)" npx jest test/assistant-replacement.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ANTHROPIC_API_KEY = "test-key-never-used";
delete process.env.AGENT_MODEL_CONSENT_READY;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;
delete process.env.AGENT_LLM_BASE_URL;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeRider, makeDriver } = require("./rideTestHelpers");
const { resolveModelPolicy, modelEligibility } = require("../lib/agent/modelPolicy");

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
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PAGES = ["index.html", "rider-signup.html", "settings.html", "admin-dashboard.html"];
const SHOTS = process.env.PAGE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots", "assistant-replacement") : null;

const FLAGS = [
  { key: "agent_assist_enabled", value: "true" },
  { key: "agent_kill_switch", value: "false" },
  { key: "agent_model_mode", value: "test_accounts" },
  { key: "agent_model_test_accounts", value: JSON.stringify(["rider:RIDER_GPLAY_REVIEWER"]) }
];

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({
    riders: [makeRider()],
    drivers: [makeDriver()],
    rides: [],
    audit_logs: [],
    system_flags: FLAGS
  });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("pages and files", () => {
  test("the old OpenAI widget files are gone", () => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, "ai-support-widget.js"))).toBe(false);
    expect(fs.existsSync(path.join(PUBLIC_DIR, "ai-support-widget.css"))).toBe(false);
  });

  test.each([...PAGES, "mobility-os-prototype.html"])("%s loads Harvey Assistant once and no old widget or endpoint", (file) => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");
    expect(html.match(/<script[^>]+src="\/agent-assist\.js[^"]*"/g) || []).toHaveLength(1);
    expect(html).not.toMatch(/<(script|link)[^>]+ai-support-widget/);
    expect(html).not.toMatch(/fetch\([^)]*\/api\/ai\/support/);
    expect(html).not.toMatch(/api\(\s*["']\/api\/ai\/support/);
  });

  test("no public page or script calls the old endpoint", () => {
    const files = fs.readdirSync(PUBLIC_DIR).filter((f) => /\.(html|js)$/.test(f));
    const callers = files.filter((f) => /["'`]\/api\/ai\/support["'`]/.test(fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8")));
    expect(callers).toEqual([]);
  });
});

describe("no AI model answers until the consent step is live", () => {
  test("the review rider on the model test list gets no model answers", () => {
    const policy = resolveModelPolicy(FLAGS, { env: {} });
    expect(policy.mode).toBe("off");
    expect(policy.stored_mode).toBe("test_accounts");
    expect(modelEligibility(policy, { role: "rider", actor: { id: "RIDER_GPLAY_REVIEWER" } }).eligible).toBe(false);
  });

  test("the same account is eligible only once AGENT_MODEL_CONSENT_READY=true", () => {
    const policy = resolveModelPolicy(FLAGS, { env: { AGENT_MODEL_CONSENT_READY: "true" } });
    expect(modelEligibility(policy, { role: "rider", actor: { id: "RIDER_GPLAY_REVIEWER" } }).eligible).toBe(true);
  });

  test("the admin Try console refuses too", async () => {
    const res = await request(app)
      .post("/api/admin/agent/model/try")
      .set("x-admin-token", "test-admin-token")
      .send({ role: "rider", actor_id: "RIDER_GPLAY_REVIEWER", message: "Where is my ride?" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/consent/i);
  });

  test("the old endpoint makes no model call by default", async () => {
    const res = await request(app).post("/api/ai/support").send({ message: "hello", page: "index", role: "rider" });
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
  });
});

describeWithBrowser("one assistant per page, nothing covered, rules answers", () => {
  let server;
  let browser;
  let base;

  beforeAll(async () => {
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

  const SIZES = [
    { name: "phone", width: 375, height: 740, isMobile: true },
    { name: "desktop", width: 1280, height: 860, isMobile: false }
  ];

  for (const size of SIZES) {
    test.each(PAGES)(`%s (${size.name})`, async (file) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
        extraHTTPHeaders: file.startsWith("admin") ? { "x-admin-token": "test-admin-token" } : {}
      });
      const outside = [];
      await context.route(/^https?:\/\/(?!harveytaxiservice\.test)/, (route) => {
        outside.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      const calls = [];
      page.on("request", (r) => calls.push(new URL(r.url()).pathname));
      await page.goto(`${base}/${file}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.HarveyAssistant && typeof window.HarveyAssistant.open === "function", null, { timeout: 15000 });
      await page.waitForTimeout(300);

      const layout = await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
        };
        const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const launchers = [...document.querySelectorAll('[data-testid="hta-launcher"]')].filter(visible);
        const others = [...document.querySelectorAll("a[href], button, input, select, textarea")]
          .filter((el) => visible(el) && !el.matches('[data-testid="hta-launcher"]') && !el.closest("#htaPanel"));
        const covered = launchers.length
          ? others.filter((el) => hit(el.getBoundingClientRect(), launchers[0].getBoundingClientRect())).map((el) => el.outerHTML.slice(0, 70))
          : [];
        return {
          panels: document.querySelectorAll("#htaPanel").length,
          legacyRoot: !!document.getElementById("harvey-ai-chat-root"),
          launchers: launchers.length,
          covered
        };
      });
      expect(layout.panels).toBe(1);
      expect(layout.legacyRoot).toBe(false);
      expect(layout.launchers).toBeLessThanOrEqual(1);
      if (file === "admin-dashboard.html") expect(layout.launchers).toBe(0);
      expect(layout.covered).toEqual([]);

      await page.evaluate(() => window.HarveyAssistant.open());
      await page.waitForSelector("#htaPanel.open", { timeout: 5000 });
      const reply = page.waitForResponse((r) => r.url().includes("/api/agent/rider/assist"), { timeout: 15000 });
      await page.fill("#htaPanel .hta-form input", "How do I request a ride?");
      await page.press("#htaPanel .hta-form input", "Enter");
      const res = await reply;
      const body = await res.json();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${file.replace(".html", "")}-${size.name}.png`) });
      await context.close();

      expect(res.status()).toBe(200);
      expect(body.reply || body.answer || "").not.toBe("");
      expect(body.source || "rules").not.toMatch(/model|claude|anthropic/i);
      expect(calls.filter((p) => p.startsWith("/api/ai/support"))).toEqual([]);
      expect(outside.filter((u) => /openai|anthropic/i.test(u))).toEqual([]);
    });
  }
});
