// Brand guard: Harvey Taxi Service pages show the HTS logo, never the old
// "HT"/"H" text badges or empty placeholder marks, and HTAF pages keep their
// own logo.
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public");
const HTAF_PAGES = new Set(["foundation", "htaf-application", "htaf-privacy", "htaf-service-providers", "htaf-terms", "contact", "leadership", "admin-htaf"]);
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5));
const read = (page) => fs.readFileSync(path.join(PUBLIC, `${page}.html`), "utf8");

test("the HTS logo assets exist", () => {
  for (const f of ["hts-logo-192.png", "icon-192.png", "icon-512.png", "favicon.ico"]) {
    expect(fs.existsSync(path.join(PUBLIC, f))).toBe(true);
  }
});

test.each(pages.filter((p) => !HTAF_PAGES.has(p)))("%s has no placeholder brand mark", (page) => {
  const html = read(page);
  // Text badges ("HT", "H") inside a logo element.
  expect(html).not.toMatch(/class="(?:logo|logo-mark|brand-mark)[^"]*"[^>]*>\s*HT?\s*</);
  // Empty marks and bare dots without the logo image.
  expect(html).not.toMatch(/class="(?:logo|logo-mark|brand-mark|logo-dot)"[^>]*>\s*<\/div>/);
});

test.each(["index", "rider-dashboard", "rider-signup", "driver-signup", "driver-dashboard", "support", "privacy", "privacy-policy", "settings", "admin-dashboard"])(
  "%s shows the HTS logo in its header",
  (page) => {
    expect(read(page)).toContain('src="/hts-logo-192.png"');
  }
);

test.each([...HTAF_PAGES].filter((p) => pages.includes(p)))("%s (HTAF) does not use the HTS logo", (page) => {
  expect(read(page)).not.toContain("hts-logo-192.png");
});

test.each([...HTAF_PAGES].filter((p) => pages.includes(p)))("%s (HTAF) uses the HTAF tab icon", (page) => {
  const html = read(page);
  expect(html).toContain('href="/htaf-favicon.ico"');
  expect(html).toContain('href="/htaf-apple-touch-icon.png"');
  expect(html).not.toMatch(/href="\/(favicon\.ico|icon-192\.png)"/);
});

test.each(pages.filter((p) => !HTAF_PAGES.has(p)))("%s does not use the HTAF tab icon", (page) => {
  expect(read(page)).not.toMatch(/htaf-(favicon|icon-192|apple-touch-icon)/);
});

test("the HTAF icon files exist", () => {
  for (const f of ["htaf-favicon.ico", "htaf-icon-192.png", "htaf-apple-touch-icon.png"]) {
    expect(fs.existsSync(path.join(PUBLIC, f))).toBe(true);
  }
});
