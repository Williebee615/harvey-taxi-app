const s = require("./securityIntel");

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const row = (over) => ({ kind: "rate_limited", severity: "info", route: "/api/x", ip_hash: "h1", ip_masked: "203.0.x.x", subject_hash: null, detail: {}, count: 1, created_at: ago(1), ...over });

describe("S.A.I. hashing and masking", () => {
  test("keyed hash is stable per key, differs across keys, and skips empty input", () => {
    expect(s.keyedHash("k", "1.2.3.4")).toBe(s.keyedHash("k", "1.2.3.4"));
    expect(s.keyedHash("k", "1.2.3.4")).not.toBe(s.keyedHash("other", "1.2.3.4"));
    expect(s.keyedHash("k", "1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
    expect(s.keyedHash("k", "")).toBeNull();
    expect(s.keyedHash(null, "x")).toBeNull();
  });

  test("masks keep only the network part", () => {
    expect(s.maskIp("203.0.113.9")).toBe("203.0.x.x");
    expect(s.maskIp("::ffff:198.51.100.2")).toBe("198.51.x.x");
    expect(s.maskIp("2001:db8:1:2::5")).toBe("2001:db8:…");
    expect(s.maskIp("")).toBe("unknown");
  });

  test("country prefix never reveals the number", () => {
    expect(s.countryPrefix("+16155550100")).toBe("1");
    expect(s.countryPrefix("+2348012345678")).toBe("234");
    expect(s.countryPrefix(null)).toBeNull();
  });
});

describe("event buffer", () => {
  test("aggregates repeats into one row with a count", () => {
    const b = s.createEventBuffer();
    for (let i = 0; i < 30; i++) b.add({ kind: "rate_limited", route: "/api/a", ipHash: "h1", ipMasked: "1.2.x.x" });
    b.add({ kind: "rate_limited", route: "/api/a", ipHash: "h2" });
    const rows = b.drain();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ip_hash === "h1").count).toBe(30);
    expect(b.drain()).toEqual([]);
  });

  test("is bounded, and reports what it could not itemise", () => {
    const b = s.createEventBuffer({ maxKeys: 3, maxRowsPerFlush: 2 });
    for (let i = 0; i < 10; i++) b.add({ kind: "access_denied", ipHash: `h${i}` });
    const rows = b.drain();
    expect(rows).toHaveLength(3);
    const overflow = rows.find((r) => r.kind === "buffer_overflow");
    // 7 dropped at intake + 1 bucket over the per-flush limit.
    expect(overflow.count).toBe(8);
  });
});

describe("alerts", () => {
  test("nothing alarming → only the MFA recommendation, which is never emailed", () => {
    const alerts = s.buildAlerts({ events: [row({ count: 3 })], nowMs: NOW });
    expect(alerts.map((a) => a.key)).toEqual(["admin_mfa_off"]);
    expect(alerts[0].notify).toBe(false);
    expect(s.buildAlerts({ mfaActive: true, nowMs: NOW })).toEqual([]);
  });

  test("admin brute force is critical and offers a block, not an automatic one", () => {
    const alerts = s.buildAlerts({ mfaActive: true, nowMs: NOW, events: [row({ kind: "admin_login_failed", count: 3 }), row({ kind: "admin_mfa_failed", count: 2, created_at: ago(10) }), row({ kind: "admin_login_failed", count: 9, created_at: ago(30) })] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "critical", count: 5, actions: [{ type: "block_ip", ip_hash: "h1", ip_masked: "203.0.x.x" }], blocked: false });
  });

  test("SMS pumping: one address, many numbers; plus hourly volume and non-US", () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(row({ kind: "sms_code_sent", subject_hash: `p${i}`, detail: { country: i < 3 ? "234" : "1" } }));
    for (let i = 0; i < 40; i++) events.push(row({ kind: "sms_code_sent", ip_hash: `x${i}`, subject_hash: `q${i}`, detail: { country: "1" } }));
    const keys = s.buildAlerts({ mfaActive: true, nowMs: NOW, events }).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["sms_spread:h1", "sms_volume", "sms_outside_us"]));
    expect(keys).not.toContain("sms_spread:x1");
  });

  test("throttling, refused access and cancel bursts are warnings with matching actions", () => {
    const alerts = s.buildAlerts({
      mfaActive: true, nowMs: NOW, blockedHashes: new Set(["h2"]),
      events: [row({ count: 60 }), row({ kind: "access_denied", ip_hash: "h2", count: 25, route: "/api/admin/rides" }), row({ count: 60, ip_hash: "old", created_at: ago(30) })],
      cancellations: Array.from({ length: 5 }, (_, i) => ({ rider_id: "r1", cancelled_at: ago(i) }))
    });
    expect(alerts.map((a) => [a.key, a.severity])).toEqual(expect.arrayContaining([["rate_limit:h1", "warning"], ["access_denied:h2", "warning"], ["cancel_velocity:r1", "warning"]]));
    expect(alerts.find((a) => a.key === "access_denied:h2").blocked).toBe(true);
    expect(alerts.find((a) => a.key === "cancel_velocity:r1").actions).toEqual([{ type: "revoke_rider_sessions", rider_id: "r1" }]);
    expect(alerts.some((a) => a.key === "rate_limit:old")).toBe(false);
    // No alert exposes an internal hash field beyond its action.
    for (const a of alerts) expect(a).not.toHaveProperty("ipHash");
  });

  test("breached admin password is critical; criticals sort first", () => {
    const alerts = s.buildAlerts({ nowMs: NOW, passwordCheck: { breached: true, checked_at: ago(5) }, events: [row({ count: 60 })] });
    expect(alerts[0].key).toBe("admin_password_breached");
    expect(alerts.map((a) => a.severity)).toEqual(["critical", "warning", "warning"]);
  });

  test("alert text never claims to have acted", () => {
    const events = [row({ kind: "admin_login_failed", count: 9 }), row({ count: 60 }), row({ kind: "access_denied", count: 30 })];
    for (const a of s.buildAlerts({ events, nowMs: NOW })) {
      expect(`${a.summary} ${a.recommendation}`).not.toMatch(/\b(we|S\.A\.I\.) (blocked|banned|revoked|suspended)\b/i);
    }
  });
});

describe("Pwned Passwords range check", () => {
  test("sends a 5-character prefix and finds the suffix count", () => {
    const { prefix, suffix } = s.pwnedPrefixAndSuffix("password");
    expect(prefix).toBe("5BAA6");
    expect(suffix).toBe("1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${suffix}:9659365\r\nFFFF0000000000000000000000000000000:0`;
    expect(s.pwnedCountFromRange(body, suffix)).toBe(9659365);
    expect(s.pwnedCountFromRange(body, "0000000000000000000000000000000000A")).toBe(0);
  });
});
