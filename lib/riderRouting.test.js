const fs = require("fs");
const path = require("path");
const RiderRouting = require("../public/rider-routing.js");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const readPage = (name) => fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");

describe("post-signup redirect", () => {
  test("successful rider signup redirects to rider-dashboard.html?mode=driver by default", () => {
    expect(RiderRouting.postSignupDashboardUrl()).toBe("/rider-dashboard.html?mode=driver");
    expect(RiderRouting.postSignupDashboardUrl(undefined)).toBe("/rider-dashboard.html?mode=driver");
  });

  test("preserves a requested food/grocery mode after signup when possible", () => {
    expect(RiderRouting.postSignupDashboardUrl("food")).toBe("/rider-dashboard.html?mode=food");
    expect(RiderRouting.postSignupDashboardUrl("grocery")).toBe("/rider-dashboard.html?mode=grocery");
  });

  test("falls back to the driver mode for an unrecognized mode rather than inventing a route", () => {
    expect(RiderRouting.postSignupDashboardUrl("not-a-real-mode")).toBe("/rider-dashboard.html?mode=driver");
  });
});

describe("wizard auto-open", () => {
  test("the driver wizard auto-opens for a mode=driver deep link", () => {
    expect(RiderRouting.shouldAutoOpenWizard({ mode: "driver" })).toBe(true);
  });

  test("food and grocery modes also auto-open the wizard", () => {
    expect(RiderRouting.shouldAutoOpenWizard({ mode: "food" })).toBe(true);
    expect(RiderRouting.shouldAutoOpenWizard({ mode: "grocery" })).toBe(true);
  });

  test("an existing ride_id (resuming/tracking an active ride) also auto-opens", () => {
    expect(RiderRouting.shouldAutoOpenWizard({ ride_id: "RIDE-1234" })).toBe(true);
  });

  test("direct dashboard access with no params still works for returning riders (no auto-open)", () => {
    expect(RiderRouting.shouldAutoOpenWizard({})).toBe(false);
  });
});

describe("signed-out deep link round trip", () => {
  test("an unauthenticated deep link preserves the requested mode through signup", () => {
    const signupUrl = RiderRouting.signupUrlForMode("food");
    expect(signupUrl).toBe("/rider-signup.html?mode=food");

    const requestedMode = RiderRouting.resolveRequestedMode({ mode: "food" });
    expect(requestedMode).toBe("food");

    const postAuthUrl = RiderRouting.postSignupDashboardUrl(requestedMode);
    expect(postAuthUrl).toBe("/rider-dashboard.html?mode=food");
  });

  test("resolveRequestedMode defaults to driver when no mode was carried through", () => {
    expect(RiderRouting.resolveRequestedMode({})).toBe("driver");
  });
});

describe("no code path resurrects the deleted request-ride.html page", () => {
  test("rider-signup.html never navigates to request-ride.html", () => {
    expect(readPage("rider-signup.html")).not.toContain("request-ride.html");
  });

  test("every request-ride.html mention left in rider-dashboard.html is a comment, not a navigation target", () => {
    const html = readPage("rider-dashboard.html");
    const offendingLines = html
      .split("\n")
      .filter((line) => line.includes("request-ride.html"))
      .filter((line) => /href\s*=|location\.href|location\.replace|location\.assign/.test(line));

    expect(offendingLines).toEqual([]);
  });
});
