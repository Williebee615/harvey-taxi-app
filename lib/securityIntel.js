// S.A.I. Cyber Defense Intelligence (owner decision 2026-10-24): detect,
// record, summarise and recommend. It never acts on its own: today's
// automatic rate limits stay as they are, and every block or session
// revoke waits for the owner's click (docs/agent-action-rules.md: agents
// never decide about people).
//
// Pure: no I/O. The server feeds in events and rows; this module hashes
// identifiers, aggregates events between database writes, turns recent
// rows into plain-English alerts, and parses the free Pwned Passwords
// range response.
//
// Privacy: an IP address or phone number is never stored. Each is keyed
// with HMAC-SHA256 under a server-derived key (IPv4 space is small enough
// that a plain hash could be reversed), and the panel shows only a masked
// form such as "203.0.x.x".

const crypto = require("crypto");

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// Thresholds. Deliberately conservative: an alert is a prompt to look,
// not a verdict.
const RULES = Object.freeze({
  adminLoginFailures: { windowMin: 15, min: 5 },
  smsDestinationSpread: { windowMin: 60, min: 5 },
  smsHourlyVolume: { windowMin: 60, min: 40 },
  smsOutsideUs: { windowMin: 60, min: 3 },
  rateLimitSpike: { windowMin: 10, min: 50 },
  accessDeniedSpike: { windowMin: 10, min: 20 },
  cancelVelocity: { windowMin: 10, min: 5 }
});

function keyedHash(key, value) {
  if (!key || value === undefined || value === null || value === "") return null;
  return crypto.createHmac("sha256", key).update(String(value)).digest("hex").slice(0, 32);
}

function maskIp(ip) {
  const text = String(ip || "").replace(/^::ffff:/, "");
  const v4 = text.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  if (text.includes(":")) return `${text.split(":").slice(0, 2).join(":")}:…`;
  return "unknown";
}

// "+1…" is the US/Canada plan; anything else is reported by its leading
// digits only (e.g. "234" for Nigeria), never the number.
function countryPrefix(e164) {
  const digits = String(e164 || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("1")) return "1";
  return digits.slice(0, 3);
}

// Collects events in memory and hands back compact rows for one database
// insert, so an attack produces a handful of rows, not one per request.
// Bounded: past maxKeys distinct buckets, further events only bump a
// dropped counter (reported as its own row).
function createEventBuffer({ maxKeys = 2000, maxRowsPerFlush = 500 } = {}) {
  let buckets = new Map();
  let dropped = 0;

  function add({ kind, severity = "info", route = null, ipHash = null, ipMasked = null, subjectHash = null, detail = null }) {
    if (!kind) return;
    const key = [kind, route || "", ipHash || "", subjectHash || ""].join("|");
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    if (buckets.size >= maxKeys) {
      dropped += 1;
      return;
    }
    buckets.set(key, { kind, severity, route, ip_hash: ipHash, ip_masked: ipMasked, subject_hash: subjectHash, detail: detail || {}, count: 1 });
  }

  function drain() {
    const rows = [...buckets.values()];
    const overflow = Math.max(0, rows.length - maxRowsPerFlush);
    const kept = rows.slice(0, maxRowsPerFlush);
    const lost = dropped + rows.slice(maxRowsPerFlush).reduce((n, r) => n + r.count, 0);
    buckets = new Map();
    dropped = 0;
    if (lost > 0) {
      kept.push({ kind: "buffer_overflow", severity: "warning", route: null, ip_hash: null, ip_masked: null, subject_hash: null, detail: { events_not_itemised: lost, buckets_over_limit: overflow }, count: lost });
    }
    return kept;
  }

  return { add, drain, size: () => buckets.size };
}

const within = (row, nowMs, minutes) => nowMs - Date.parse(row.created_at) <= minutes * 60_000;

function sumBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const cur = out.get(k) || { count: 0, rows: [] };
    cur.count += Number(r.count) || 1;
    cur.rows.push(r);
    out.set(k, cur);
  }
  return out;
}

const lastAt = (rows) => rows.map((r) => r.created_at).sort().pop() || null;
const blockAction = (r) => ({ type: "block_ip", ip_hash: r.ip_hash, ip_masked: r.ip_masked || "unknown" });

// events: security_events rows from the last day (newest first or any
// order). cancellations: [{ rider_id, cancelled_at }] from the rides
// table. passwordCheck: { breached, checked_at } or null. mfaActive:
// whether the admin authenticator is enrolled. blockedHashes: Set of
// currently blocked ip_hash values (their alerts say "blocked").
function buildAlerts({ events = [], cancellations = [], passwordCheck = null, mfaActive = false, blockedHashes = new Set(), nowMs = Date.now() } = {}) {
  const alerts = [];
  const push = (a) => alerts.push({ ...a, blocked: Boolean(a.ipHash && blockedHashes.has(a.ipHash)) });

  const failedLogins = events.filter((r) => (r.kind === "admin_login_failed" || r.kind === "admin_mfa_failed") && within(r, nowMs, RULES.adminLoginFailures.windowMin));
  for (const [ipHash, g] of sumBy(failedLogins, (r) => r.ip_hash)) {
    if (g.count < RULES.adminLoginFailures.min) continue;
    push({
      key: `admin_brute_force:${ipHash}`, ipHash, severity: "critical", count: g.count, last_at: lastAt(g.rows),
      title: "Repeated failed admin sign-ins",
      summary: `${g.count} failed admin sign-in attempts in ${RULES.adminLoginFailures.windowMin} minutes from ${g.rows[0].ip_masked || "one address"}.`,
      recommendation: "If this wasn't you, block the address and keep the authenticator code switched on. If you can't explain it, change the admin password.",
      actions: [blockAction(g.rows[0])]
    });
  }

  const sms = events.filter((r) => r.kind === "sms_code_sent");
  const smsHour = sms.filter((r) => within(r, nowMs, RULES.smsDestinationSpread.windowMin));
  for (const [ipHash, g] of sumBy(smsHour, (r) => r.ip_hash)) {
    const destinations = new Set(g.rows.map((r) => r.subject_hash).filter(Boolean));
    if (destinations.size < RULES.smsDestinationSpread.min) continue;
    push({
      key: `sms_spread:${ipHash}`, ipHash, severity: "critical", count: g.count, last_at: lastAt(g.rows),
      title: "One address requesting codes for many phone numbers",
      summary: `${g.rows[0].ip_masked || "One address"} asked for sign-in codes for ${destinations.size} different numbers in the last hour. This is the usual pattern of SMS pumping, which runs up the Twilio bill.`,
      recommendation: "Block the address. Check Twilio Verify's Fraud Guard and allowed countries in the Twilio console.",
      actions: [blockAction(g.rows[0])]
    });
  }
  const smsTotal = smsHour.reduce((n, r) => n + (Number(r.count) || 1), 0);
  if (smsTotal >= RULES.smsHourlyVolume.min) {
    push({
      key: "sms_volume", severity: "critical", count: smsTotal, last_at: lastAt(smsHour),
      title: "Unusually many sign-in texts",
      summary: `${smsTotal} sign-in codes were texted in the last hour (alert level: ${RULES.smsHourlyVolume.min}).`,
      recommendation: "If there's no event or promotion to explain it, look for one address or country behind it, and check Twilio's usage page.",
      actions: []
    });
  }
  const abroad = smsHour.filter((r) => r.detail && r.detail.country && r.detail.country !== "1");
  const abroadCount = abroad.reduce((n, r) => n + (Number(r.count) || 1), 0);
  if (abroadCount >= RULES.smsOutsideUs.min) {
    const prefixes = [...new Set(abroad.map((r) => `+${r.detail.country}`))].join(", ");
    push({
      key: "sms_outside_us", severity: "warning", count: abroadCount, last_at: lastAt(abroad),
      title: "Sign-in texts to numbers outside the US",
      summary: `${abroadCount} codes in the last hour went to numbers starting ${prefixes}. Harvey Taxi only serves Nashville today.`,
      recommendation: "Unless you are testing another market, limit Twilio Verify's allowed countries to the US.",
      actions: []
    });
  }

  const limited = events.filter((r) => r.kind === "rate_limited" && within(r, nowMs, RULES.rateLimitSpike.windowMin));
  for (const [ipHash, g] of sumBy(limited, (r) => r.ip_hash)) {
    if (g.count < RULES.rateLimitSpike.min) continue;
    const routes = [...new Set(g.rows.map((r) => r.route).filter(Boolean))].slice(0, 3).join(", ");
    push({
      key: `rate_limit:${ipHash}`, ipHash, severity: "warning", count: g.count, last_at: lastAt(g.rows),
      title: "Requests being throttled",
      summary: `${g.rows[0].ip_masked || "One address"} hit the automatic limits ${g.count} times in ${RULES.rateLimitSpike.windowMin} minutes${routes ? ` (${routes})` : ""}. The limits are already slowing it down.`,
      recommendation: "Usually no action is needed. Block it only if it keeps going; a shared address (an office or a mobile carrier) can carry real riders too.",
      actions: [blockAction(g.rows[0])]
    });
  }

  const denied = events.filter((r) => r.kind === "access_denied" && within(r, nowMs, RULES.accessDeniedSpike.windowMin));
  for (const [ipHash, g] of sumBy(denied, (r) => r.ip_hash)) {
    if (g.count < RULES.accessDeniedSpike.min) continue;
    const routes = [...new Set(g.rows.map((r) => r.route).filter(Boolean))].slice(0, 3).join(", ");
    push({
      key: `access_denied:${ipHash}`, ipHash, severity: "warning", count: g.count, last_at: lastAt(g.rows),
      title: "Repeated attempts to reach protected pages",
      summary: `${g.rows[0].ip_masked || "One address"} was refused ${g.count} times in ${RULES.accessDeniedSpike.windowMin} minutes on admin or driver routes${routes ? ` (${routes})` : ""}. Every attempt was blocked.`,
      recommendation: "Block the address if it isn't one of your own devices or staff.",
      actions: [blockAction(g.rows[0])]
    });
  }

  const recentCancels = cancellations.filter((c) => c.rider_id && nowMs - Date.parse(c.cancelled_at) <= RULES.cancelVelocity.windowMin * 60_000);
  for (const [riderId, g] of sumBy(recentCancels, (c) => c.rider_id)) {
    if (g.count < RULES.cancelVelocity.min) continue;
    push({
      key: `cancel_velocity:${riderId}`, severity: "warning", count: g.count, last_at: g.rows.map((r) => r.cancelled_at).sort().pop(),
      title: "Many cancelled rides from one account",
      summary: `One rider account had ${g.count} rides cancelled in ${RULES.cancelVelocity.windowMin} minutes.`,
      recommendation: "Review the account's rides before doing anything; it may be a rider struggling with the app. Signing it out everywhere is reversible.",
      actions: [{ type: "revoke_rider_sessions", rider_id: riderId }]
    });
  }

  if (passwordCheck && passwordCheck.breached === true) {
    push({
      key: "admin_password_breached", severity: "critical", count: 1, last_at: passwordCheck.checked_at || null,
      title: "Admin password found in a public breach list",
      summary: "The admin password appears in the Pwned Passwords breach list, so attackers may try it. The check sent only the first 5 characters of a hash of it, never the password.",
      recommendation: "Change ADMIN_PASSWORD in Render's environment settings to a new long password, then sign in again.",
      actions: []
    });
  }

  if (!mfaActive) {
    push({
      key: "admin_mfa_off", severity: "warning", count: 1, last_at: null,
      title: "Admin sign-in has no second step",
      summary: "The admin account is protected by a password alone.",
      recommendation: "Set up the authenticator code below. After that, the admin needs both the password and a code from your phone.",
      actions: [],
      notify: false
    });
  }

  return alerts
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || String(b.last_at || "").localeCompare(String(a.last_at || "")))
    .map(({ ipHash, ...rest }) => rest);
}

// Pwned Passwords range API (k-anonymity): we send the first 5 hex
// characters of the SHA-1, it returns every suffix it knows with a count.
function pwnedPrefixAndSuffix(password) {
  const sha1 = crypto.createHash("sha1").update(String(password)).digest("hex").toUpperCase();
  return { prefix: sha1.slice(0, 5), suffix: sha1.slice(5) };
}

function pwnedCountFromRange(body, suffix) {
  for (const line of String(body || "").split(/\r?\n/)) {
    const [s, n] = line.trim().split(":");
    if (s && s.toUpperCase() === suffix) return Number(n) || 0;
  }
  return 0;
}

module.exports = {
  RULES,
  keyedHash,
  maskIp,
  countryPrefix,
  createEventBuffer,
  buildAlerts,
  pwnedPrefixAndSuffix,
  pwnedCountFromRange
};
