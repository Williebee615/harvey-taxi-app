// Regression test for a real production bug: rider-signup.html saves a
// freshly created rider's ID under "harveyRiderId" (plus "riderId" /
// "rider_id" aliases) -- never under CONFIG.STORAGE_KEYS.riderId
// ("harvey_rider_id"). rider-dashboard.html's embedded ride-request
// wizard used to look up the rider ID via a single-key
// readStorage(CONFIG.STORAGE_KEYS.riderId) call with no fallback, so a
// rider who had just signed up and opened "Book" without a ?riderId=
// link in the URL saw "No rider ID found. Please sign up or sign in as
// a rider first." even though they had, in fact, just signed up.
//
// public/rider-dashboard.html has no build step and isn't a CommonJS
// module, so this extracts hydrateFromStorage()'s real
// `storedRiderId` expression out of the live file and executes it in a
// sandbox -- this tests the actual shipped source, not a hand-copied
// duplicate that could silently drift from it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.join(__dirname, "..", "public", "rider-dashboard.html");

function extractStoredRiderIdExpression(html) {
  const match = html.match(
    /const storedRiderId =\s*([\s\S]*?);\s*\n\s*const storedRideId/
  );
  if (!match) {
    throw new Error(
      "Could not find hydrateFromStorage()'s storedRiderId assignment in " +
        "rider-dashboard.html -- did the function get renamed or restructured? " +
        "Update this test's extraction regex to match."
    );
  }
  return match[1];
}

function resolveStoredRiderId({ queryParams = {}, storageValues = {} } = {}) {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const expression = extractStoredRiderIdExpression(html);

  const sandbox = {
    getRawQueryParam: (name) => queryParams[name] || "",
    readStorage: (key) => storageValues[key] || "",
    CONFIG: { STORAGE_KEYS: { riderId: "harvey_rider_id" } },
    result: undefined
  };
  vm.createContext(sandbox);
  vm.runInContext(`result = (${expression});`, sandbox);
  return sandbox.result;
}

describe("rider-dashboard.html hydrateFromStorage() rider-ID resolution", () => {
  it("resolves a rider ID saved only under rider-signup.html's plain 'riderId' alias -- the actual reported bug", () => {
    expect(
      resolveStoredRiderId({ storageValues: { riderId: "RIDER-7DCDBAA6E2" } })
    ).toBe("RIDER-7DCDBAA6E2");
  });

  it("resolves a rider ID saved under the camelCase 'harveyRiderId' key rider-signup.html primarily uses", () => {
    expect(
      resolveStoredRiderId({ storageValues: { harveyRiderId: "RIDER-ABC123" } })
    ).toBe("RIDER-ABC123");
  });

  it("resolves a rider ID saved under the 'rider_id' alias key", () => {
    expect(
      resolveStoredRiderId({ storageValues: { rider_id: "RIDER-DEF456" } })
    ).toBe("RIDER-DEF456");
  });

  it("still resolves the canonical harvey_rider_id key directly", () => {
    expect(
      resolveStoredRiderId({ storageValues: { harvey_rider_id: "RIDER-CANONICAL" } })
    ).toBe("RIDER-CANONICAL");
  });

  it("prefers a ?riderId= URL param over anything already in storage", () => {
    expect(
      resolveStoredRiderId({
        queryParams: { riderId: "RIDER-FROM-URL" },
        storageValues: { harvey_rider_id: "RIDER-FROM-STORAGE" }
      })
    ).toBe("RIDER-FROM-URL");
  });

  it("falls back to a ?rider_id= URL param", () => {
    expect(
      resolveStoredRiderId({ queryParams: { rider_id: "RIDER-FROM-URL-2" } })
    ).toBe("RIDER-FROM-URL-2");
  });

  it("returns empty when no ID is set anywhere -- the correct 'please sign up' case", () => {
    expect(resolveStoredRiderId()).toBe("");
  });
});
