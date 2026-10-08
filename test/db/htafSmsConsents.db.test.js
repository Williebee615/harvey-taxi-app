// htaf_sms_consents migration: an additive, append-only, server-only table
// of HTAF text-message consent events. htaf_applications is unchanged.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("HTAF SMS consent records migration", () => {
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

  test("records an opt-in with its wording version and source; time defaults to now", async () => {
    await q("insert into public.htaf_sms_consents (phone, application_id, event, consent_version, source) values ('+16155550100', 'HTAF-1', 'opt_in', 'htaf-sms-v1', 'htaf-application-web-form')");
    const [r] = await q("select phone, event, consent_version, source, created_at is not null as dated from public.htaf_sms_consents");
    expect(r).toEqual({ phone: "+16155550100", event: "opt_in", consent_version: "htaf-sms-v1", source: "htaf-application-web-form", dated: true });
  });

  test("only known events and +1 US numbers are accepted", async () => {
    await expect(q("insert into public.htaf_sms_consents (phone, event, source) values ('+16155550100', 'maybe', 'x')")).rejects.toThrow(/htaf_sms_consents_event_check/);
    await expect(q("insert into public.htaf_sms_consents (phone, event, source) values ('615-555-0100', 'opt_out', 'x')")).rejects.toThrow(/htaf_sms_consents_phone_check/);
  });

  test("server-only: row-level security on, no access for anon or signed-in clients", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.htaf_sms_consents'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.htaf_sms_consents', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.htaf_sms_consents', 'insert') as auth_insert`);
    expect(g).toEqual({ anon_select: false, auth_insert: false });
  });
});
