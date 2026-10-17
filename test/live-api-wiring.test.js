// Front end to back end wiring: every API address that a live page or
// one of the two apps calls must be a route the server defines. Pages no
// link reaches (old consoles, demos, test pages) and the unshipped
// root-level app are out of scope; KNOWN_GAPS lists the remaining gaps
// on purpose, each with its reason, so a new dead call fails this test.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", "__tests__", "__mocks__"].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

const LIVE_PAGES = [
  "public/index.html",
  "public/rider-dashboard.html",
  "public/rider-signup.html",
  "public/driver-dashboard.html",
  "public/driver-signup.html",
  "public/support.html",
  "public/merchant-apply.html",
  "public/settings.html",
  "public/admin-dashboard.html",
  "public/admin-htaf.html",
  "public/assistant-pilot.html",
  "public/agent-assist.js",
  "public/ride-cancel.js"
];
const APP_FILES = [...walk("driver-app/src"), ...walk("mobile/src")].filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && !/\.test\./.test(f));

const KNOWN_GAPS = {
  // Fallbacks after /api/drivers/signup, which exists and is tried first.
  "/api/driver/signup": "driver-signup fallback",
  "/api/driver/apply": "driver-signup fallback",
  "/api/signup/driver": "driver-signup fallback"
};

function serverRoutes() {
  const files = ["server.js", ...walk("lib").filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))];
  const paths = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g)) paths.push(m[2]);
  }
  // Route paths with each ":param" written as a placeholder segment.
  return paths.map((p) => p.replace(/:[A-Za-z_]+\??/g, "PARAM"));
}

const esc = (s) => s.replace(/[.+?^$()|[\]\\{}*]/g, "\\$&");
// A call matches a route when each literal segment is equal and each
// runtime segment (SEG) lines up with a route parameter or literal.
function matches(call, route, prefix) {
  const re = new RegExp("^" + esc(call).replace(/SEG/g, "[^/]+") + (prefix ? "(/|$)" : "/?$"));
  return re.test(route) || re.test(route.replace(/PARAM/g, "x1"));
}

function clientCalls(file) {
  const flat = read(file).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "SEG");
  const calls = [];
  for (const m of flat.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/.:]*?(?:SEG[A-Za-z0-9_\-/.:]*?)*)(["'`?])(\s*\+)?/g)) {
    let p = m[1];
    // A literal followed by "+" (or ending in a slash) is a prefix built on at runtime.
    const after = flat.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const prefix = Boolean(m[3]) || p.endsWith("/") || p.endsWith("SEG") || /^\s*,?\s*\/\/\s*\+/.test(after);
    p = p.replace(/SEG$/, "").replace(/\/$/, "");
    calls.push({ path: p, prefix });
  }
  return calls;
}

test("every API address called by live pages and the apps is a server route", () => {
  const routes = serverRoutes();
  expect(routes.length).toBeGreaterThan(150);
  const dead = [];
  for (const file of [...LIVE_PAGES, ...APP_FILES]) {
    for (const { path: p, prefix } of clientCalls(file)) {
      if (KNOWN_GAPS[p]) continue;
      const ok = routes.some((r) => matches(p, r, prefix) || matches(p, r.replace(/PARAM/g, "SEG"), prefix));
      if (!ok) dead.push(`${p}  (${file})`);
    }
  }
  expect(dead).toEqual([]);
});

test("the guard catches a dead address and accepts real ones", () => {
  const routes = serverRoutes();
  const live = (p, prefix = false) => routes.some((r) => matches(p, r, prefix) || matches(p, r.replace(/PARAM/g, "SEG"), prefix));
  expect(live("/api/definitely-not-a-route")).toBe(false);
  expect(live("/api/riders/status")).toBe(false);
  expect(live("/api/support/request")).toBe(false);
  expect(live("/api/riders/SEG/readiness")).toBe(true);
  expect(live("/api/agent", true)).toBe(true);
  expect(live("/api/nonexistent-base", true)).toBe(false);
});

test("pages no longer call the dead support, status and payment addresses", () => {
  const dash = read("public/rider-dashboard.html");
  expect(dash).not.toMatch(/\/api\/support\/request|\/api\/riders\/status/);
  expect(dash).toMatch(/\/api\/agent\/rider\/handoff/);
  expect(read("public/support.html")).not.toMatch(/href="payment\.html"/);
  expect(read("public/settings.html")).not.toMatch(/images\/harvey-taxi-logo\.png/);
  expect(fs.existsSync(path.join(ROOT, "public/icon-192.png"))).toBe(true);
});

// Owner decision 2026-10-15: Persona and Checkr are handled by the back end
// only. No page or app may offer a control that starts either check.
test("no front-end control starts a Persona or Checkr check", () => {
  const files = [...walk("public").filter((f) => /\.(html|js)$/.test(f)), ...APP_FILES];
  const offending = [];
  for (const f of files) {
    const s = read(f);
    if (/\/api\/(persona\/inquiry|checkr\/start|riders\/start-persona)/.test(s)) offending.push(`${f}: calls a start route`);
    if (/<button[^>]*>[^<]*(Start|Launch|Begin)[^<]*(Persona|Checkr)/i.test(s)) offending.push(`${f}: start button`);
    if (/id="(personaBtn|launchPersonaBtn|checkrBtn)"/.test(s)) offending.push(`${f}: start button id`);
  }
  expect(offending).toEqual([]);
});
