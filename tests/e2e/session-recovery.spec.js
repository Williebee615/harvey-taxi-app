// Confirms a rider's session (id + profile persisted in localStorage from
// a previous visit/signup) is picked up automatically when they land back
// on rider-dashboard.html, rather than being shown the "no rider session
// found" prompt every time.
const { test, expect } = require("@playwright/test");
const { startTestServer } = require("./helpers/testServer");

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.close();
});

test("no stored session shows the rider-setup prompt", async ({ page }) => {
  await page.goto(`${server.url}/rider-dashboard.html`, { waitUntil: "networkidle" });

  const riderId = await page.locator("#statusRiderId").textContent();
  expect(riderId.trim()).toBe("—");
});

test("a stored rider id + profile is recovered without requiring sign-in again", async ({ page }) => {
  // Seed localStorage before any page script runs, matching what a real
  // rider signup/login flow leaves behind.
  await page.addInitScript(() => {
    localStorage.setItem("harvey_rider_id", "RIDER-TEST-1");
    localStorage.setItem(
      "harvey_rider_profile",
      JSON.stringify({
        id: "RIDER-TEST-1",
        first_name: "Jordan",
        last_name: "Rivera",
        email: "jordan@example.test",
        approval_status: "approved"
      })
    );
  });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${server.url}/rider-dashboard.html`, { waitUntil: "networkidle" });

  const name = await page.locator("#heroRiderName").textContent();
  expect(name.trim()).toBe("Jordan Rivera");

  const riderId = await page.locator("#statusRiderId").textContent();
  expect(riderId.trim()).toBe("RIDER-TEST-1");

  expect(errors).toEqual([]);
});
