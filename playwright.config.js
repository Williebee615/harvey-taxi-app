// Playwright config for the rider-dashboard migration regression suite
// (tests/e2e). These tests exercise the static frontend against a
// disposable local Express server with mocked API routes — they never
// touch real Supabase/Stripe/Google Maps or the production app — so
// there is no webServer directive here; each spec starts and stops its
// own server (see tests/e2e/helpers/testServer.js).
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    headless: true,
    // The sandbox's pre-installed Chromium revision doesn't match what
    // @playwright/test's default "chromium_headless_shell" project looks
    // for under PLAYWRIGHT_BROWSERS_PATH, so point directly at the full
    // Chromium binary that's actually present (same binary the project's
    // other Playwright scripts already use).
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" }
  }
});
