// Old request-page links go straight to the booking (or, with a ride_id,
// tracking) screen of the rider dashboard in one redirect; ride status
// notifications link to tracking, not to a new booking.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
});

const location = (res) => res.headers.location;

test.each([
  ["/request-ride", "/rider-dashboard.html?screen=book"],
  ["/request-ride.html?mode=airport", "/rider-dashboard.html?mode=airport&screen=book"],
  ["/request-food.html", "/rider-dashboard.html?mode=food&screen=book"],
  ["/request-groceries", "/rider-dashboard.html?mode=grocery&screen=book"],
  ["/request-ride.html?ride_id=RIDE-123", "/rider-dashboard.html?ride_id=RIDE-123&screen=track"]
])("%s redirects once to %s", async (from, to) => {
  const res = await request(app).get(from);
  expect(res.status).toBe(301);
  expect(location(res)).toBe(to);
});

test("the rider dashboard itself is served without a redirect (no loop)", async () => {
  const res = await request(app).get("/rider-dashboard.html?screen=book&mode=driver");
  expect(res.status).toBe(200);
});

test("ride status push notifications open that ride's tracking screen", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  expect(source).toMatch(
    /ownerType: "rider",\s*ownerId: ride\.rider_id,[\s\S]{0,300}?url: `\/rider-dashboard\.html\?screen=track&ride_id=\$\{encodeURIComponent\(ride\.id\)\}`/
  );
});

test("home page booking buttons open the booking screen explicitly", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  expect(html).not.toMatch(/rider-dashboard\.html\?mode=/);
  expect(html).toMatch(/rider-dashboard\.html\?screen=book&mode=driver/);
});

test("the unused-card-hold notice states the real payment state and promises no release time", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "rider-dashboard.html"), "utf8");
  const match = html.match(/event\.detail\?\.heldPayment\s*\?\s*"([^"]+)"/);
  expect(match).not.toBeNull();
  const message = match[1];
  // Nothing in the app cancels an abandoned hold today, so the notice
  // must not say it will be released, or when.
  expect(message).toMatch(/no ride was requested and your card was not charged/);
  expect(message).toMatch(/has not been used or cancelled/);
  expect(message).not.toMatch(/will be released|within \d|days?\b|hours?\b|automatically/i);
});
