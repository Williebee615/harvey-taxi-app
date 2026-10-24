// S.A.I. Cyber Defense tables (owner decision 2026-10-24).

const fs = require("fs");
const path = require("path");
const { describeDb, createTestDatabase } = require("./pgHarness");

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", "20261024010000_security_intel.sql"), "utf8");
const HASH = "0123456789abcdef0123456789abcdef";
jest.setTimeout(60_000);

describeDb("security intel migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    // Applying twice must be harmless.
    await q(MIGRATION);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("events are append-only; deletion only after 90 days; no truncate", async () => {
    const [row] = await q("insert into public.security_events (kind, ip_hash, ip_masked, count) values ('rate_limited', $1, '203.0.x.x', 7) returning id", [HASH]);
    await expect(q("update public.security_events set count = 1 where id = $1", [row.id])).rejects.toThrow(/append-only/);
    await expect(q("delete from public.security_events where id = $1", [row.id])).rejects.toThrow(/90 days/);
    await expect(q("truncate public.security_events")).rejects.toThrow(/append-only/);
    // An old row (inserted with an explicit timestamp) can be purged.
    const [old] = await q("insert into public.security_events (kind, created_at) values ('access_denied', now() - interval '91 days') returning id");
    await q("delete from public.security_events where id = $1", [old.id]);
    expect(await q("select id from public.security_events where id = $1", [old.id])).toEqual([]);
  });

  test("events refuse raw identifiers and unknown kinds", async () => {
    await expect(q("insert into public.security_events (kind, ip_hash) values ('rate_limited', '203.0.113.9')")).rejects.toThrow(/check/);
    await expect(q("insert into public.security_events (kind, subject_hash) values ('sms_code_sent', '+16155550100')")).rejects.toThrow(/check/);
    await expect(q("insert into public.security_events (kind) values ('auto_banned')")).rejects.toThrow(/check/);
    await expect(q("insert into public.security_events (kind, count) values ('rate_limited', 0)")).rejects.toThrow(/check/);
  });

  test("blocks always expire within 7 days and record who lifted them", async () => {
    await expect(q("insert into public.security_ip_blocks (ip_hash, reason, created_by, expires_at) values ($1, 'test', 'owner', now() + interval '8 days')", [HASH])).rejects.toThrow(/check/);
    const [b] = await q("insert into public.security_ip_blocks (ip_hash, reason, created_by, expires_at) values ($1, 'repeated failed sign-ins', 'owner', now() + interval '1 day') returning id", [HASH]);
    await expect(q("update public.security_ip_blocks set lifted_at = now() where id = $1", [b.id])).rejects.toThrow(/check/);
    await q("update public.security_ip_blocks set lifted_at = now(), lifted_by = 'owner' where id = $1", [b.id]);
  });

  test("MFA rows hold only an encrypted secret and need an activation time when active", async () => {
    await expect(q("insert into public.admin_mfa (email, secret_enc) values ('owner@example.test', 'JBSWY3DPEHPK3PXP')")).rejects.toThrow(/check/);
    await q("insert into public.admin_mfa (email, secret_enc) values ('owner@example.test', 'v1.a.b.c')");
    await expect(q("update public.admin_mfa set status = 'active' where email = 'owner@example.test'")).rejects.toThrow(/check/);
    await q("update public.admin_mfa set status = 'active', activated_at = now() where email = 'owner@example.test'");
  });

  test("RLS is on and anon/authenticated have no access", async () => {
    const rows = await q("select relname, relrowsecurity from pg_class where relname in ('security_events', 'security_ip_blocks', 'admin_mfa') order by relname");
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const grants = await q("select table_name, grantee from information_schema.role_table_grants where table_name in ('security_events', 'security_ip_blocks', 'admin_mfa') and grantee in ('anon', 'authenticated')");
    expect(grants).toEqual([]);
  });
});
