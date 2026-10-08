// htaf_assistant_questions migration: HTAF's own, server-only log of
// questions the HTAF assistant couldn't answer (redacted excerpts only).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("HTAF assistant questions migration", () => {
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

  test("stores an excerpt and intent, dated now; excerpts are capped at 200 characters", async () => {
    await q("insert into public.htaf_assistant_questions (question_excerpt, intent) values ('Do you have wheelchair vans?', 'knowledge_gap')");
    const [r] = await q("select question_excerpt, intent, created_at is not null as dated from public.htaf_assistant_questions");
    expect(r).toEqual({ question_excerpt: "Do you have wheelchair vans?", intent: "knowledge_gap", dated: true });
    await expect(q("insert into public.htaf_assistant_questions (question_excerpt, intent) values ($1, 'knowledge_gap')", ["x".repeat(201)])).rejects.toThrow(/check/);
  });

  test("server-only", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.htaf_assistant_questions'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.htaf_assistant_questions', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.htaf_assistant_questions', 'insert') as auth_insert`);
    expect(g).toEqual({ anon_select: false, auth_insert: false });
  });
});
