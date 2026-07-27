// Live-DOM complement to lib/legacyRiderPagesRemoved.test.js's static
// source scan: loads each page in a real browser and checks the actual
// rendered anchor/link elements, catching anything a static regex might
// miss (e.g. an href built up by JavaScript at render time).
const { test, expect } = require("@playwright/test");
const { startTestServer } = require("./helpers/testServer");

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.close();
});

const PAGES_TO_CHECK = [
  "index.html",
  "support.html",
  "admin-dashboard.html",
  "driver-dashboard.html",
  "privacy.html",
  "driver-missions.html",
  "app-review.html",
  "mobility-os-prototype.html"
];

for (const pageName of PAGES_TO_CHECK) {
  test(`${pageName} has no rendered link to a deleted rider-request page`, async ({ page }) => {
    await page.goto(`${server.url}/${pageName}`, { waitUntil: "networkidle" });

    const badHrefs = await page.evaluate(() => {
      const deleted = ["request-ride.html", "request-food.html", "request-groceries.html"];
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => deleted.some((f) => href.includes(f)));
    });

    expect(badHrefs).toEqual([]);
  });
}
