// HTAF admin redesign (owner decisions 2026-10-23), in Chromium: no Load
// buttons, status pill, auto-selected first record, keyboard, KPI filters,
// duplicate badge, tabs, US-format times, assistant inbox, grant export,
// partner onboarding controls, and phone width.
//   NODE_PATH="$(npm root -g)" npx jest test/htaf-admin-redesign.browser
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";
process.env.HTAF_PARTNER_SESSION_SECRET = "test-htaf-partner-secret";
delete process.env.OPENAI_API_KEY;

const crypto = require("crypto");
const { createFakeSupabase } = require("./fakeSupabase");

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
jest.setTimeout(120000);
const OWNER = "owner@harvey.example";

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

describeWithBrowser("HTAF admin redesign", () => {
  let server;
  let browser;
  let base;
  const app = (id, extra) => ({
    id, application_code: `HTAF-SYN-${id}`, first_name: "Syn", last_name: `Person${id}`, email: `${id}@example.test`, phone: `615555019${id.length}`,
    county: "Davidson", program_type: "medical", status: "submitted", ride_date: "2026-10-28", created_at: new Date(Date.now() - 2 * 86400000).toISOString(), ...extra
  });

  beforeAll(async () => {
    mockClient = createFakeSupabase({
      htaf_applications: [
        app("a1", { first_name: "Dup", last_name: "Twin", phone: "6155550101" }),
        app("a2", { first_name: "Dup", last_name: "Twin", phone: "6155550102", created_at: new Date(Date.now() - 1 * 86400000).toISOString() }),
        app("a3", { first_name: "Approved", last_name: "Case", status: "approved", ride_date: "2026-11-02" })
      ],
      htaf_assistant_questions: [{ id: 1, question_excerpt: "Unanswered question about: other", intent: "other", created_at: "2026-10-23T13:21:51Z", status: "open" }],
      htaf_partners: [],
      htaf_partner_users: [],
      system_flags: [],
      admin_roles: [{ email: OWNER, role: "super_admin" }],
      admin_rbac_shadow_log: [],
      audit_logs: [],
      rides: []
    });
    // eslint-disable-next-line global-require
    const { app: server_ } = require("../server");
    server = await new Promise((resolve) => {
      const s = server_.listen(0, "127.0.0.1", () => resolve(s));
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

  async function open(width = 1280) {
    const context = await browser.newContext({ viewport: { width, height: 1800 }, acceptDownloads: true, timezoneId: "America/Chicago" });
    await context.addCookies([{ name: "htaf_admin_session", value: session(OWNER), url: base }]);
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/admin-htaf.html`, { waitUntil: "load" });
    await page.locator(".queue-item").first().waitFor();
    return { context, page };
  }

  test("loads everything without Load buttons, selects the first record, keyboard and KPI filters", async () => {
    const { context, page } = await open();
    const html = await page.content();
    expect(html).not.toMatch(/Load questions|Load partner access|Load Applications|Manage transportation assistance applications from one admin dashboard/);
    await page.locator('#syncPillText:has-text("Connected (3 records)")').waitFor();
    // First record auto-selected; card shows age, trip date and duplicate badge.
    await page.locator(".queue-item.active").waitFor();
    const first = await page.locator(".queue-item").first().innerText();
    expect(first).toMatch(/Submitted (1d|2d) ago • Trip: (Oct 28|Nov 2), 2026/);
    expect(await page.locator(".dup-badge").count()).toBe(2);
    const before = await page.locator(".queue-item.active").innerText();
    await page.locator("body").press("ArrowDown");
    await page.waitForFunction((b) => document.querySelector(".queue-item.active")?.innerText !== b, before);
    // KPI card filters the queue.
    await page.click('.kpi-filter[data-filter="approved"]');
    await page.locator('.kpi-filter[data-filter="approved"].active').waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".queue-item").length === 1);
    expect(await page.locator(".queue-item").innerText()).toContain("Approved");
    // Sticky action bar.
    const bar = await page.locator(".action-primary").innerText();
    expect(bar).toMatch(/✓ Approve[\s\S]*\? Request Missing Docs[\s\S]*✕ Deny/);
    // The three main actions span the panel and their labels fit.
    const fit = await page.evaluate(() => {
      const row = document.querySelector(".action-primary");
      const panel = document.querySelector(".detail-actions");
      return {
        spans: row.getBoundingClientRect().width >= panel.getBoundingClientRect().width - 2,
        clipped: [...row.querySelectorAll(".btn")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim())
      };
    });
    expect(fit).toEqual({ spans: true, clipped: [] });
    if (process.env.PAGE_SCREENSHOTS) await page.locator(".detail-card").screenshot({ path: process.env.PAGE_SCREENSHOTS });
    await context.close();
  });

  test("tabs: scheduling list, assistant inbox in US time with Dismiss, diagnostics", async () => {
    const { context, page } = await open();
    await page.click('.tab[data-tab="scheduling"]');
    expect(await page.locator("#schedulingRows").innerText()).toContain("Nov 2, 2026");
    await page.click('.tab[data-tab="assistant"]');
    const row = page.locator("#htafAssistantQuestionRows tr").first();
    expect(await row.innerText()).toContain("Oct 23, 2026 • 8:21 AM");
    expect(await page.locator("#assistantTabBadge").innerText()).toBe("1");
    await row.locator('button:has-text("Dismiss")').click();
    await page.locator('#htafAssistantQuestionRows:has-text("No open questions.")').waitFor();
    expect(mockClient._state.htaf_assistant_questions[0].status).toBe("dismissed");
    await page.click("#syncPill");
    await page.locator("#diagnosticsModal.show").waitFor();
    expect(await page.locator("#diagnosticsModal").innerText()).toContain("/api/admin/foundation/applications");
    await context.close();
  });

  test("grant export with a preset, and partner onboarding controls", async () => {
    const { context, page } = await open();
    await page.click('button:has-text("Export CSV")');
    await page.click('button:has-text("Last quarter: approved")');
    expect(await page.inputValue("#exportStatus")).toBe("approved");
    expect(await page.inputValue("#exportFrom")).toMatch(/^\d{4}-\d{2}-01$/);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download CSV")')]);
    expect(download.suggestedFilename()).toMatch(/^htaf-applications-.*\.csv$/);
    const audit = mockClient._state.audit_logs.find((a) => a.action === "htaf_applications_exported");
    expect(audit.metadata.filters.status).toBe("approved");
    expect(audit.metadata.filters.from_date).toMatch(/^\d{4}-\d{2}-01$/);

    await page.click('.tab[data-tab="partners"]');
    await page.locator("#partnerAccessBody:not(.hidden)").waitFor();
    expect(await page.locator("#partnerMasterState").innerText()).toBe("Global Partner Portal: OFF");
    expect(await page.locator("#addPartnerButton").innerText()).toBe("+ Add Partner (Inactive)");
    await page.check("#newPartnerActivate");
    expect(await page.locator("#addPartnerButton").innerText()).toBe("+ Add Partner (Active)");
    await page.fill("#newPartnerName", "Test Workforce Center");
    await page.click("#addPartnerButton");
    expect(await page.locator("#partnerAccessStatus").innerText()).toContain("agreement reference");
    expect(mockClient._state.htaf_partners).toHaveLength(0);
    await page.uncheck("#newPartnerActivate");
    await page.fill("#newPartnerEmail", "intake@example.org");
    await page.click("#addPartnerButton");
    await page.locator('#partnerList:has-text("Test Workforce Center")').waitFor();
    expect(await page.locator("#partnerList").innerText()).toContain("Contact: intake@example.org");
    expect(await page.locator("#partnerAuditRows").innerText()).toContain("Partner added");
    await context.close();
  });

  test("no sideways scrolling at phone width", async () => {
    const { context, page } = await open(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await context.close();
  });
});
