// admin_capability_grants: explicit per-person permissions (first use:
// drivers.onboarding_review), server-only.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("admin capability grants migration", () => {
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

  const grant = (email, capability = "drivers.onboarding_review") =>
    q("insert into public.admin_capability_grants (email, capability, granted_by) values ($1, $2, 'owner@harvey.example')", [email, capability]);

  test("records a grant; only known capabilities; emails stored lower-case", async () => {
    await grant("reviewer@harvey.example");
    await expect(grant("other@harvey.example", "drivers.approve")).rejects.toThrow(/check/);
    await expect(grant("Mixed@Harvey.example")).rejects.toThrow(/check/);
  });

  test("one active grant per person; a revoked grant can be re-granted", async () => {
    await expect(grant("reviewer@harvey.example")).rejects.toThrow(/duplicate key/);
    await expect(q("update public.admin_capability_grants set revoked_at = now() where email = 'reviewer@harvey.example'")).rejects.toThrow(/check/);
    await q("update public.admin_capability_grants set revoked_at = now(), revoked_by = 'owner@harvey.example' where email = 'reviewer@harvey.example'");
    await grant("reviewer@harvey.example");
    const rows = await q("select revoked_at is null as active from public.admin_capability_grants where email = 'reviewer@harvey.example' order by id");
    expect(rows).toEqual([{ active: false }, { active: true }]);
  });

  test("server-only", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.admin_capability_grants'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.admin_capability_grants', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.admin_capability_grants', 'insert') as auth_insert`);
    expect(g).toEqual({ anon_select: false, auth_insert: false });
  });
});
