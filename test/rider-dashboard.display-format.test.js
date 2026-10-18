// Rider screen display helpers (owner-approved rider screen fixes,
// 2026-10-18): name capitalization at display time, plain status wording,
// and the bottom spacer that keeps page content clear of the assistant
// launcher. The functions are read from the page source and run here.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "rider-dashboard.html"), "utf8");
const assist = fs.readFileSync(path.join(__dirname, "..", "public", "agent-assist.js"), "utf8");

function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`missing ${startMarker}`);
  return html.slice(start, end);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  [
    "function safeTrim(value) { return String(value || '').trim(); }",
    extract("    function formatPersonName(value)", "    function renderRider()"),
    extract("    const RIDE_STATUS_TEXT = {", "    // High-contrast badge"),
    "this.formatPersonName = formatPersonName; this.rideStatusText = rideStatusText; this.rideStatusTone = rideStatusTone;"
  ].join("\n"),
  sandbox
);

describe("rider name display", () => {
  test.each([
    ["jane doe", "Jane Doe"],
    ["JOHN SMITH", "John Smith"],
    ["mary-jane o'brien", "Mary-Jane O'Brien"],
    ["  ana   lópez ", "Ana López"],
    ["McDonald", "McDonald"],
    ["de la Cruz", "de la Cruz"],
    ["", ""],
    [undefined, ""]
  ])("%p -> %p", (input, expected) => {
    expect(sandbox.formatPersonName(input)).toBe(expected);
  });

  test("formatPersonName lives in the same script block as renderRider and does not use helpers from other blocks", () => {
    const fn = extract("    function formatPersonName(value)", "    function renderRider()");
    expect(fn).not.toMatch(/safeTrim|safeLower/);
  });
});

describe("ride status wording", () => {
  test.each([
    ["driver_enroute", "Driver on the way", "active"],
    ["awaiting_driver_acceptance", "Finding a driver", "active"],
    ["arrived", "Driver has arrived", "active"],
    ["completed", "Trip completed", "done"],
    ["failed", "No driver available", "stopped"],
    ["cancelled", "Cancelled", "stopped"],
    ["some_new_state", "Some new state", "active"],
    ["", "Unknown", "active"]
  ])("%p -> %p (%p)", (status, text, tone) => {
    expect(sandbox.rideStatusText(status)).toBe(text);
    expect(sandbox.rideStatusTone(status)).toBe(tone);
  });

  test("the live status panel uses the badge, not the raw status", () => {
    expect(html).not.toMatch(/setLiveStatus\(\s*`Current ride status: \$\{state\.ride\.status/);
    expect(html).toContain("setLiveStatusBadge(state.ride.status);");
    expect(html).toMatch(/\.ride-status-badge \{[^}]*color: #06101f;/);
  });
});

describe("assistant launcher spacer", () => {
  test("a spacer is added after the page content whenever the launcher shows", () => {
    expect(assist).toContain(".hta-spacer{height:calc(var(--hta-bottom,16px) + 60px)}");
    expect(assist).toMatch(/if \(!noLauncher\) \{\s*document\.body\.appendChild\(el\("div", \{ class: desktopLauncherOnly \? "hta-spacer hta-desktop-only" : "hta-spacer"/);
    expect(assist).toContain("@media (max-width:599px){.hta-spacer.hta-desktop-only{display:none}}");
  });
});
