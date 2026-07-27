// Confirms every request mode (standard driver ride, airport, autonomous
// pilot, food delivery, grocery delivery), the scheduled-ride variant,
// and a ride_id deep link all open correctly inside rider-dashboard.html's
// wizard overlay — this is the core "consolidate every rider request
// entry point into one page" guarantee.
const { test, expect } = require("@playwright/test");
const { startTestServer } = require("./helpers/testServer");

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.close();
});

async function openMode(page, query) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${server.url}/rider-dashboard.html?${query}`, { waitUntil: "networkidle" });
  return errors;
}

for (const [mode, expectedTitle] of [
  ["driver", "Request Your Ride"],
  ["airport", "Request an Airport Ride"],
  ["autonomous", "Request Autonomous Pilot"],
  ["food", "Request Food Delivery"],
  ["grocery", "Request Groceries"]
]) {
  test(`mode=${mode} opens the wizard overlay with the correct title`, async ({ page }) => {
    const errors = await openMode(page, `mode=${mode}`);

    const overlayVisible = await page.$eval("#rideWizardOverlay", (el) => !el.hidden);
    expect(overlayVisible).toBe(true);

    const title = await page.locator("#wizardHeroTitle").textContent();
    expect(title.trim()).toBe(expectedTitle);

    expect(errors).toEqual([]);
  });
}

test("mode=driver&ride_type=scheduled opens driver mode without error", async ({ page }) => {
  const errors = await openMode(page, "mode=driver&ride_type=scheduled");

  const overlayVisible = await page.$eval("#rideWizardOverlay", (el) => !el.hidden);
  expect(overlayVisible).toBe(true);

  const title = await page.locator("#wizardHeroTitle").textContent();
  expect(title.trim()).toBe("Request Your Ride");

  expect(errors).toEqual([]);
});

test("ride_id deep link jumps straight to the dispatch/tracking stage", async ({ page }) => {
  const errors = await openMode(page, "ride_id=RIDE-TEST-1&mode=driver");

  const overlayVisible = await page.$eval("#rideWizardOverlay", (el) => !el.hidden);
  expect(overlayVisible).toBe(true);

  const dispatchActive = await page.$eval("#wizardStageDispatch", (el) =>
    el.classList.contains("active")
  );
  expect(dispatchActive).toBe(true);

  expect(errors).toEqual([]);
});

test("bare rider-dashboard.html (no mode param) shows the dashboard, not the wizard", async ({ page }) => {
  const errors = await openMode(page, "");

  const overlayVisible = await page.$eval("#rideWizardOverlay", (el) => !el.hidden);
  expect(overlayVisible).toBe(false);

  expect(errors).toEqual([]);
});
