// Assistant pilot page (Chromium, fake database, fake model provider):
// streamed answer, linked sources, follow-up chips, a second turn that
// sends the in-page history, and nothing written to browser storage.
//   NODE_PATH="$(npm root -g)" npx jest test/assistant-pilot.browser

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ASSISTANT_PILOT_MODEL_APPROVED = "true";
process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";

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

describeWithBrowser("assistant pilot page", () => {
  let server;
  let browser;
  let base;
  const calls = [];

  beforeAll(async () => {
    mockClient = createFakeSupabase(
      {
        system_flags: [
          { key: "assistant_pilot_harvey_taxi_enabled", value: "true" },
          { key: "assistant_pilot_harvey_taxi_model_enabled", value: "true" }
        ],
        audit_logs: []
      },
      {
        rpc: {
          agent_model_reserve: () => ({ data: 1, error: null }),
          agent_model_settle: () => ({ data: true, error: null }),
          agent_model_month_totals: () => ({ data: [{ committed_usd: 0, held_usd: 0 }], error: null })
        }
      }
    );
    // eslint-disable-next-line global-require
    const { app, __assistantPilot } = require("../server");
    __assistantPilot.setProvider({
      name: "fake",
      model: "claude-haiku-4-5",
      async stream({ messages, onText }) {
        calls.push(messages);
        const chunks = ["Riders and drivers can reach support ", "by email [S1]."];
        for (const c of chunks) {
          onText(c);
          await new Promise((r) => setTimeout(r, 30));
        }
        return { text: chunks.join(""), usage: { input_tokens: 800, output_tokens: 30 } };
      },
      classify: () => "unknown"
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });

  test("streams a cited answer; a follow-up sends the in-page history; nothing stored in the browser", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/assistant-pilot.html`);
    await page.fill("#q", "How do I contact Harvey Taxi support?");
    await page.click("form button");
    const firstTurn = page.locator(".turn").nth(1);
    await firstTurn.locator(".sources a").first().waitFor();
    expect(await firstTurn.locator(".text").innerText()).toBe("Riders and drivers can reach support by email [S1].");
    expect(await firstTurn.locator(".label").innerText()).toMatch(/AI-generated from our published pages/i);
    expect(await firstTurn.locator(".sources a").first().getAttribute("href")).toBe("https://harveytaxiservice.com/support.html");
    expect(await page.locator("#title").innerText()).toBe("Harvey Taxi assistant (pilot)");
    expect(await firstTurn.locator(".chips .chip").count()).toBeGreaterThan(0);

    await page.fill("#q", "and for drivers?");
    await page.click("form button");
    await page.locator(".turn").nth(3).locator(".sources a").first().waitFor();
    const second = calls[calls.length - 1];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[0].content).toBe("How do I contact Harvey Taxi support?");

    if (process.env.PAGE_SCREENSHOTS) {
      // eslint-disable-next-line global-require
      const dir = require("path").join(__dirname, "..", "docs", "screenshots", "assistant-pilot");
      // eslint-disable-next-line global-require
      require("fs").mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width: 420, height: 900 });
      await page.screenshot({ path: `${dir}/1-two-turns-with-sources.png`, fullPage: true });
    }

    const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
    expect(storage).toEqual({ local: 0, session: 0, cookies: "" });

    await page.click("#clear");
    expect(await page.locator(".turn").count()).toBe(0);
    await page.close();
  });
});
