// Regression test: request-ride.html, request-food.html, and
// request-groceries.html were deleted (see
// docs/rider-dashboard-migration-inventory.md). This locks in that they
// stay deleted and that no production file re-introduces a live link,
// script src, or server-side file-serving call pointing at them.
//
// This intentionally does NOT forbid every mention of the filenames —
// historical comments (e.g. "merged from request-ride.html") and this
// migration doc are legitimate and expected. It only forbids patterns
// that would actually serve or navigate to the deleted files.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const DELETED_FILES = [
  "request-ride.html",
  "request-food.html",
  "request-groceries.html"
];

// Matches an href/src attribute, a window.location assignment, or a
// server-side file-serving call that targets one of the deleted files —
// i.e. something that would actually try to load/serve/navigate to it,
// as opposed to a comment or doc mentioning the filename in passing.
const LIVE_REFERENCE_PATTERN = new RegExp(
  `(?:href|src)\\s*=\\s*["'][^"']*(?:${DELETED_FILES.join("|")})["']` +
    `|location\\.(?:href|replace)\\s*=?\\(?\\s*["\`'][^"\`']*(?:${DELETED_FILES.join("|")})` +
    `|send(?:File|StaticPage)\\([^)]*["'](?:${DELETED_FILES.join("|")})["']`,
  "i"
);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(html|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("legacy rider-request pages stay deleted", () => {
  it("request-ride.html, request-food.html, and request-groceries.html do not exist on disk", () => {
    for (const file of DELETED_FILES) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, file))).toBe(false);
    }
  });

  it("no file under public/ links, loads, or serves the deleted pages", () => {
    const offenders = [];

    for (const file of walk(PUBLIC_DIR)) {
      const contents = fs.readFileSync(file, "utf8");
      if (LIVE_REFERENCE_PATTERN.test(contents)) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("server.js only redirects the legacy routes, never serves the deleted files", () => {
    const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    expect(LIVE_REFERENCE_PATTERN.test(serverJs)).toBe(false);
  });
});
