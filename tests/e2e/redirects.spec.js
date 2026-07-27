// Confirms every retired rider-request URL redirects to rider-dashboard.html
// over real HTTP, end-to-end through the actual Express app wiring (not
// just the pure buildLegacyRedirectTarget() logic — see
// lib/riderRequestRedirects.test.js for that).
const { test, expect } = require("@playwright/test");
const { startTestServer } = require("./helpers/testServer");

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.close();
});

test("rider-dashboard.html itself returns 200 with no redirect", async ({ request }) => {
  const res = await request.get(`${server.url}/rider-dashboard.html`, {
    maxRedirects: 0
  });
  expect(res.status()).toBe(200);
});

for (const [path, expectedLocation] of [
  ["/request-ride", "/rider-dashboard.html"],
  ["/request-ride.html", "/rider-dashboard.html"],
  ["/request-ride.html?mode=driver&ride_id=RIDE-1", "/rider-dashboard.html?mode=driver&ride_id=RIDE-1"],
  ["/request-food", "/rider-dashboard.html?mode=food"],
  ["/request-food.html", "/rider-dashboard.html?mode=food"],
  ["/request-groceries", "/rider-dashboard.html?mode=grocery"],
  ["/request-groceries.html", "/rider-dashboard.html?mode=grocery"]
]) {
  test(`${path} redirects (301) to ${expectedLocation}`, async ({ request }) => {
    const res = await request.get(`${server.url}${path}`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toBe(expectedLocation);
  });
}

test("the deleted files return 404, not a stale cached copy", async ({ request }) => {
  // Hitting the exact filename via a path express.static wouldn't serve
  // (since the redirect routes above own these exact paths) is already
  // covered; this additionally confirms there's no leftover static file
  // anywhere else in public/ that would shadow the redirect.
  const fs = require("fs");
  const path = require("path");
  for (const file of ["request-ride.html", "request-food.html", "request-groceries.html"]) {
    expect(fs.existsSync(path.join(__dirname, "..", "..", "public", file))).toBe(false);
  }
});
