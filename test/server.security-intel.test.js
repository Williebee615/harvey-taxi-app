// S.A.I. Cyber Defense Intelligence, PR 1 (owner decision 2026-10-24):
// events are recorded only while monitoring is on, hashed and masked;
// alerts recommend, the owner acts; blocks spare the admin; the admin
// authenticator closes every password-only path once it is on.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.ADMIN_PASSWORD = "test-fixture-admin-password";
process.env.SENDGRID_API_KEY = "SG.test-key";
process.env.ENABLE_REAL_EMAIL = "true";
delete process.env.ADMIN_API_TOKEN;
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const totp = require("../lib/totp");
const securityIntel = require("../lib/securityIntel");

let mockClient;
const mockProxy = new Proxy({}, {
  get(_t, prop) {
    const value = mockClient[prop];
    return typeof value === "function" ? value.bind(mockClient) : value;
  }
});
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const mockSend = jest.fn(async () => [{ statusCode: 202 }]);
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: (...args) => mockSend(...args) }));

const server = require("../server");
const { app } = server;

const OWNER_IP = "198.51.100.7";
const ATTACKER_IP = "203.0.113.9";
const HASH_KEY = totp.deriveKey("test-admin-session-secret", "security-intel-v1");
const MFA_KEY = totp.deriveKey("test-admin-session-secret", "admin-mfa-v1");
const hashIp = (ip) => securityIntel.keyedHash(HASH_KEY, ip);

function freshDb(flags = []) {
  mockClient = createFakeSupabase(
    {
      system_flags: flags,
      security_events: [],
      security_ip_blocks: [],
      admin_mfa: [],
      audit_logs: [],
      rides: [],
      riders: [{ id: "R1", session_version: 0 }]
    },
    {
      identity: { security_ip_blocks: "id" },
      rpc: {
        increment_rider_session_version: (args, state) => {
          const r = state.riders.find((x) => x.id === args.p_rider_id);
          r.session_version += 1;
          state.audit_logs.push({ action: args.p_action, actor_type: args.p_actor_type });
          return { data: r, error: null };
        }
      }
    }
  );
}

async function signIn(ip = OWNER_IP) {
  const res = await request(app).post("/api/admin/login").set("CF-Connecting-IP", ip)
    .send({ email: "owner@example.test", password: "test-fixture-admin-password" });
  return res;
}
const cookieOf = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("htaf_admin_session="))?.split(";")[0];

async function adminCookie() {
  const res = await signIn();
  expect(res.status).toBe(200);
  return cookieOf(res);
}

beforeEach(async () => {
  mockSend.mockClear();
  freshDb();
  await server.refreshSecurityState();
});

describe("monitoring switch", () => {
  test("off by default: nothing is recorded, the panel still loads for the admin only", async () => {
    await request(app).post("/api/admin/login").set("CF-Connecting-IP", ATTACKER_IP).send({ email: "owner@example.test", password: "wrong" });
    await server.flushSecurityEvents();
    expect(mockClient._state.security_events).toEqual([]);

    expect((await request(app).get("/api/admin/security/overview")).status).toBe(401);
    const cookie = await adminCookie();
    const res = await request(app).get("/api/admin/security/overview").set("Cookie", cookie).set("CF-Connecting-IP", OWNER_IP);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ monitoring_enabled: false, alert_email_enabled: false, mfa_active: false, your_ip_hash: hashIp(OWNER_IP) });
    expect(res.body.alerts.map((a) => a.key)).toEqual(["admin_mfa_off"]);
  });

  test("on: failed sign-ins and refused requests are saved hashed and masked, and raise alerts", async () => {
    freshDb([{ key: "security_intel_enabled", value: "true" }]);
    await server.refreshSecurityState();
    for (let i = 0; i < 6; i++) {
      await request(app).post("/api/admin/login").set("CF-Connecting-IP", ATTACKER_IP).send({ email: "owner@example.test", password: `guess-${i}` });
    }
    for (let i = 0; i < 21; i++) await request(app).get("/api/admin/security/overview").set("CF-Connecting-IP", ATTACKER_IP);
    await server.flushSecurityEvents();

    const rows = mockClient._state.security_events;
    const failed = rows.find((r) => r.kind === "admin_login_failed");
    expect(failed).toMatchObject({ count: 6, ip_hash: hashIp(ATTACKER_IP), ip_masked: "203.0.x.x", route: "/api/admin/login" });
    expect(rows.find((r) => r.kind === "access_denied")).toMatchObject({ count: 21, route: "/api/admin/security/overview" });
    expect(JSON.stringify(rows)).not.toContain(ATTACKER_IP);
    for (const r of rows) r.created_at = new Date().toISOString();

    const cookie = await adminCookie();
    const res = await request(app).get("/api/admin/security/overview").set("Cookie", cookie).set("CF-Connecting-IP", OWNER_IP);
    const keys = res.body.alerts.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining([`admin_brute_force:${hashIp(ATTACKER_IP)}`, `access_denied:${hashIp(ATTACKER_IP)}`]));
    expect(res.body.recent.length).toBeGreaterThan(0);
    // Recording took no action: nothing is blocked.
    expect(mockClient._state.security_ip_blocks).toEqual([]);
  });
});

describe("owner-placed blocks", () => {
  test("block → that address gets 403 on the API; the admin keeps access; lift restores", async () => {
    const cookie = await adminCookie();
    const own = await request(app).post("/api/admin/security/blocks").set("Cookie", cookie).set("CF-Connecting-IP", OWNER_IP)
      .send({ ip_hash: hashIp(OWNER_IP), hours: 24, reason: "test" });
    expect(own.status).toBe(400);
    const bad = await request(app).post("/api/admin/security/blocks").set("Cookie", cookie).set("CF-Connecting-IP", OWNER_IP)
      .send({ ip_hash: hashIp(ATTACKER_IP), hours: 2, reason: "test" });
    expect(bad.status).toBe(400);

    const blocked = await request(app).post("/api/admin/security/blocks").set("Cookie", cookie).set("CF-Connecting-IP", OWNER_IP)
      .send({ ip_hash: hashIp(ATTACKER_IP), ip_masked: "203.0.x.x", hours: 24, reason: "repeated failed sign-ins" });
    expect(blocked.status).toBe(200);
    expect(mockClient._state.security_ip_blocks[0]).toMatchObject({ ip_hash: hashIp(ATTACKER_IP), created_by: "owner@example.test", reason: "repeated failed sign-ins" });
    expect(mockClient._state.audit_logs.some((a) => a.action === "security_ip_blocked")).toBe(true);

    const denied = await request(app).get("/api/geo/status").set("CF-Connecting-IP", ATTACKER_IP);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/paused/);
    expect((await request(app).get("/api/geo/status").set("CF-Connecting-IP", "192.0.2.50")).status).not.toBe(403);
    // A signed-in admin on that address is never locked out.
    expect((await request(app).get("/api/admin/security/overview").set("Cookie", cookie).set("CF-Connecting-IP", ATTACKER_IP)).status).toBe(200);

    const id = mockClient._state.security_ip_blocks[0].id;
    expect((await request(app).post(`/api/admin/security/blocks/${id}/lift`).set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/geo/status").set("CF-Connecting-IP", ATTACKER_IP)).status).not.toBe(403);
    expect((await request(app).post(`/api/admin/security/blocks/${id}/lift`).set("Cookie", cookie)).status).toBe(404);
  });

  test("signing a rider out everywhere uses the audited session-version bump", async () => {
    const cookie = await adminCookie();
    const res = await request(app).post("/api/admin/security/riders/R1/revoke-sessions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(mockClient._state.riders[0].session_version).toBe(1);
    expect(mockClient._state.audit_logs).toEqual(expect.arrayContaining([expect.objectContaining({ action: "rider_sessions_revoked_by_admin", actor_type: "admin" })]));
  });
});

describe("admin authenticator", () => {
  async function enrol(cookie) {
    const setup = await request(app).post("/api/admin/mfa/setup").set("Cookie", cookie).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.otpauth_uri).toContain(`secret=${setup.body.secret}`);
    const row = mockClient._state.admin_mfa[0];
    expect(row.secret_enc).not.toContain(setup.body.secret);
    expect(totp.decryptSecret(row.secret_enc, MFA_KEY)).toBe(setup.body.secret);
    const code = totp.codeAt(setup.body.secret, totp.stepFor(Date.now()));
    const confirm = await request(app).post("/api/admin/mfa/confirm").set("Cookie", cookie).send({ code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recovery_codes).toHaveLength(8);
    expect(JSON.stringify(mockClient._state.admin_mfa)).not.toContain(confirm.body.recovery_codes[0]);
    return { secret: setup.body.secret, recovery: confirm.body.recovery_codes };
  }

  test("setup needs a signed-in session, not password headers", async () => {
    const res = await request(app).post("/api/admin/mfa/setup").set("x-admin-email", "owner@example.test").set("x-admin-password", "test-fixture-admin-password").send({});
    expect(res.status).toBe(401);
  });

  test("once on: password alone gets a challenge, not a session; code is single-use; recovery code works once", async () => {
    const { secret, recovery } = await enrol(await adminCookie());

    const first = await signIn();
    expect(first.body).toMatchObject({ ok: true, mfa_required: true });
    expect(cookieOf(first)).toBeUndefined();

    const wrong = await request(app).post("/api/admin/login/verify-code").send({ challenge: first.body.challenge, code: "000000" });
    expect(wrong.status).toBe(401);
    expect(mockClient._state.audit_logs.some((a) => a.action === "admin_mfa_failed")).toBe(true);

    // The enrolment code's step is used up, so use the next step's code.
    const next = totp.codeAt(secret, totp.stepFor(Date.now()) + 1);
    const good = await request(app).post("/api/admin/login/verify-code").send({ challenge: first.body.challenge, code: next });
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toBeDefined();
    const replay = await request(app).post("/api/admin/login/verify-code").send({ challenge: first.body.challenge, code: next });
    expect(replay.status).toBe(401);

    const viaRecovery = await request(app).post("/api/admin/login/verify-code").send({ challenge: first.body.challenge, recovery_code: recovery[0].toLowerCase() });
    expect(viaRecovery.status).toBe(200);
    expect(viaRecovery.body.recovery_codes_left).toBe(7);
    expect((await request(app).post("/api/admin/login/verify-code").send({ challenge: first.body.challenge, recovery_code: recovery[0] })).status).toBe(401);

    // A forged or expired challenge is refused.
    expect((await request(app).post("/api/admin/login/verify-code").send({ challenge: "x.y", code: next })).status).toBe(401);
  });

  test("once on: email + password headers no longer authenticate; the session cookie still does", async () => {
    const cookie = await adminCookie();
    const headers = { "x-admin-email": "owner@example.test", "x-admin-password": "test-fixture-admin-password" };
    expect((await request(app).get("/api/admin/security/overview").set(headers)).status).toBe(200);
    await enrol(cookie);
    await server.refreshSecurityState();
    expect((await request(app).get("/api/admin/security/overview").set(headers)).status).toBe(401);
    expect((await request(app).get("/api/admin/security/overview").set("Cookie", cookie)).status).toBe(200);
  });

  test("turning it off needs a current code", async () => {
    const cookie = await adminCookie();
    const { secret } = await enrol(cookie);
    expect((await request(app).post("/api/admin/mfa/disable").set("Cookie", cookie).send({ code: "000000" })).status).toBe(401);
    const code = totp.codeAt(secret, totp.stepFor(Date.now()) + 1);
    expect((await request(app).post("/api/admin/mfa/disable").set("Cookie", cookie).send({ code })).status).toBe(200);
    expect(mockClient._state.admin_mfa).toEqual([]);
    expect((await signIn()).body.mfa_required).toBeUndefined();
  });
});

describe("background checks", () => {
  test("critical alerts email the owner once per hour, only with the email switch on, and say nothing was blocked", async () => {
    const recent = new Date().toISOString();
    freshDb([{ key: "security_intel_enabled", value: "true" }]);
    mockClient._state.security_events.push({ kind: "admin_login_failed", ip_hash: hashIp(ATTACKER_IP), ip_masked: "203.0.x.x", count: 9, created_at: recent, detail: {} });
    await server.refreshSecurityState();
    await server.runSecuritySweep();
    expect(mockSend).not.toHaveBeenCalled();

    mockClient._state.system_flags.push({ key: "security_alert_email_enabled", value: "true" });
    await server.runSecuritySweep();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const mail = mockSend.mock.calls[0][0];
    expect(mail.to).toBe("owner@example.test");
    expect(mail.subject).toContain("Repeated failed admin sign-ins");
    expect(mail.text).toContain("Nothing has been blocked automatically");
    expect(mail.text).not.toContain(ATTACKER_IP);

    await server.runSecuritySweep();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("breached-password check sends only a 5-character prefix and keeps only yes/no", async () => {
    const { prefix, suffix } = securityIntel.pwnedPrefixAndSuffix("test-fixture-admin-password");
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: async () => `${suffix}:12\r\nABC:1` }));
    const result = await server.runAdminPasswordCheck({ fetchImpl, force: true });
    expect(fetchImpl).toHaveBeenCalledWith(`https://api.pwnedpasswords.com/range/${prefix}`, expect.objectContaining({ headers: expect.objectContaining({ "Add-Padding": "true" }) }));
    expect(result.breached).toBe(true);
    const stored = mockClient._state.system_flags.find((f) => f.key === "security_admin_password_check").value;
    expect(stored).not.toContain("test-fixture-admin-password");
    expect(stored).not.toContain(suffix);
    // Off outside production unless forced.
    expect(await server.runAdminPasswordCheck({ fetchImpl })).toMatchObject({ skipped: true });
  });
});
