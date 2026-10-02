// Static structure checks (no browser): the App Review entry and its
// sign-in panel live apart from the ordinary rider sign-in overlay and
// the booking wizard, and use the agreed wording. The interactive
// behavior is covered by test/app-review.browser.test.js.

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "rider-dashboard.html"), "utf8");

// Returns [start, end) of the element that opens with `openTag`, by
// counting nested <div> tags from there.
function divRegion(openTag) {
  const start = html.indexOf(openTag);
  if (start < 0) throw new Error(`missing ${openTag}`);
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tag.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return [start, tag.lastIndex];
  }
  throw new Error(`unclosed ${openTag}`);
}

const inside = (needle, [start, end]) => {
  const at = html.indexOf(needle);
  return at >= start && at < end;
};

const EXPLANATION =
  "For authorized Apple App Store and Google Play reviewers only. Review rides, payments, and earnings are simulated.";

describe("rider-dashboard App Review separation (markup)", () => {
  const signInOverlay = divRegion('<div id="riderAuthOverlay">');
  const wizard = divRegion('<div id="rideWizardOverlay" hidden>');
  const panel = divRegion('<div id="appReviewPanel"');

  test("the App Review Access card exists, is hidden by default and carries the agreed text", () => {
    const card = html.match(/<section class="app-review-access" id="appReviewAccess"[^>]*>([\s\S]*?)<\/section>/);
    expect(card).not.toBeNull();
    expect(card[0]).toMatch(/\bhidden\b/);
    expect(card[1]).toContain(">App Review Access<");
    expect(card[1]).toContain(EXPLANATION);
    expect(card[1]).toContain('id="appReviewSignInBtn"');
    expect(card[1]).toContain(">App Review Sign-In<");
  });

  test("the reviewer form lives only in the dedicated panel", () => {
    expect(inside('id="appReviewForm"', panel)).toBe(true);
    expect(inside('id="appReviewForm"', signInOverlay)).toBe(false);
    expect(inside('id="appReviewForm"', wizard)).toBe(false);
    expect(html.match(/type="password"/g)).toHaveLength(1);
    expect(inside('type="password"', panel)).toBe(true);
  });

  test("the panel is separate from the sign-in overlay and the wizard, hidden by default", () => {
    expect(panel[0] >= signInOverlay[1] || panel[1] <= signInOverlay[0]).toBe(true);
    expect(panel[0] >= wizard[1] || panel[1] <= wizard[0]).toBe(true);
    expect(html.slice(panel[0], html.indexOf(">", panel[0]))).toMatch(/\bhidden\b/);
    const panelHtml = html.slice(panel[0], panel[1]);
    expect(panelHtml).toContain(EXPLANATION);
    expect(panelHtml).toContain(">Back to regular booking<");
    expect(panelHtml).not.toMatch(/auth-tab|authPhoneInput|Send code/);
  });

  test("the booking wizard has no reviewer sign-in entry, only a hidden banner", () => {
    const wizardHtml = html.slice(wizard[0], wizard[1]);
    expect(wizardHtml).not.toMatch(/App Review Sign-In|appReviewSignInBtn|appReviewForm/);
    expect(wizardHtml).toMatch(/class="app-review-banner"[^>]*hidden/);
  });

  test("the old in-overlay reviewer form and hero/wizard entry points are gone", () => {
    expect(html).not.toMatch(/authReviewForm|authReviewToggleBtn|heroReviewSignInBtn|wizardReviewSignInLink/);
  });

  test("every App Review banner starts hidden", () => {
    const banners = html.match(/<div class="app-review-banner"[^>]*>/g);
    expect(banners.length).toBeGreaterThanOrEqual(2);
    for (const banner of banners) expect(banner).toMatch(/\bhidden\b/);
  });
});

describe("rider history exposes the simulated flag", () => {
  // The fake Supabase ignores column lists, so the server tests can't see
  // this; check the curated column list itself.
  test("RIDER_HISTORY_COLUMNS includes is_review_ride", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const block = source.match(/const RIDER_HISTORY_COLUMNS =([\s\S]*?);/);
    expect(block).not.toBeNull();
    const columns = block[1].replace(/\/\/.*$/gm, "").match(/"([^"]*)"/g).join("").replace(/"/g, "");
    expect(columns.split(",").map((c) => c.trim())).toContain("is_review_ride");
  });
});
