// agent_ai_consents migration: an additive, append-only, server-only table
// of riders' and drivers' decisions on the "Allow AI answers?" notice
// (lib/agent/aiConsent.js). Nothing else changes.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("Harvey Assistant AI consent records migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("records a decision with the notice version and client; the latest row per account is found by the index order", async () => {
    await q("insert into public.agent_ai_consents (role, account_id, granted, consent_version, client, created_at) values ('rider', 'RIDER-SYNTH-1', true, '2026-10-10', 'web', now() - interval '1 minute')");
    await q("insert into public.agent_ai_consents (role, account_id, granted, consent_version, client) values ('rider', 'RIDER-SYNTH-1', false, '2026-10-10', 'web')");
    const rows = await q("select granted, consent_version, client from public.agent_ai_consents where role = 'rider' and account_id = 'RIDER-SYNTH-1' order by created_at desc limit 1");
    expect(rows).toEqual([{ granted: false, consent_version: "2026-10-10", client: "web" }]);
  });

  test("only riders and drivers, known clients, and a version are accepted", async () => {
    await expect(q("insert into public.agent_ai_consents (role, account_id, granted, consent_version, client) values ('admin', 'X', true, 'v', 'web')")).rejects.toThrow(/agent_ai_consents_role_check/);
    await expect(q("insert into public.agent_ai_consents (role, account_id, granted, consent_version, client) values ('driver', 'X', true, 'v', 'kiosk')")).rejects.toThrow(/agent_ai_consents_client_check/);
    await expect(q("insert into public.agent_ai_consents (role, account_id, granted, consent_version, client) values ('driver', 'X', true, '', 'driver_app')")).rejects.toThrow(/agent_ai_consents_consent_version_check/);
    await expect(q("insert into public.agent_ai_consents (role, account_id, consent_version, client) values ('driver', 'X', 'v', 'driver_app')")).rejects.toThrow(/null value/);
  });

  test("server-only: row-level security on, no access for anon or signed-in clients", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.agent_ai_consents'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.agent_ai_consents', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.agent_ai_consents', 'insert') as auth_insert`);
    expect(g).toEqual({ anon_select: false, auth_insert: false });
  });
});
