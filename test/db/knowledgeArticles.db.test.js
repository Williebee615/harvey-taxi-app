// knowledge_articles migration: approved articles need an approver and a
// date; slugs, titles, bodies and audiences are constrained; server-only
// access.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("knowledge articles migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const BODY = "Approved Harvey Taxi wording used for testing only.";

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("a draft gets defaults: both audiences, version 1, status draft", async () => {
    const [row] = await q("insert into public.knowledge_articles (slug, title, body) values ('test-one', 'Test one', $1) returning *", [BODY]);
    expect(row.status).toBe("draft");
    expect(row.version).toBe(1);
    expect(row.audience).toEqual(["rider", "driver"]);
    expect(row.approved_at).toBeNull();
  });

  test("approval requires an approver and a date", async () => {
    await expect(q("update public.knowledge_articles set status = 'approved' where slug = 'test-one'")).rejects.toThrow(/check constraint/);
    await q("update public.knowledge_articles set status = 'approved', approved_by = 'admin', approved_at = now() where slug = 'test-one'");
    expect((await q("select status from public.knowledge_articles where slug = 'test-one'"))[0].status).toBe("approved");
  });

  test("rejects bad slugs, duplicate slugs, short bodies, unknown audiences and statuses", async () => {
    const bad = [
      ["Bad Slug", "Title", BODY, "{rider}", "draft"],
      ["test-one", "Title", BODY, "{rider}", "draft"],
      ["ok-slug", "Title", "too short", "{rider}", "draft"],
      ["ok-slug", "Title", BODY, "{admin}", "draft"],
      ["ok-slug", "Title", BODY, "{}", "draft"],
      ["ok-slug", "Title", BODY, "{rider}", "published"]
    ];
    for (const [slug, title, body, audience, status] of bad) {
      await expect(
        q("insert into public.knowledge_articles (slug, title, body, audience, status) values ($1, $2, $3, $4::text[], $5)", [slug, title, body, audience, status])
      ).rejects.toThrow();
    }
  });

  test("row level security on, no policies, and no anon/authenticated access", async () => {
    expect((await q("select relrowsecurity from pg_class where oid = 'public.knowledge_articles'::regclass"))[0].relrowsecurity).toBe(true);
    expect(await q("select policyname from pg_policies where tablename = 'knowledge_articles'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select * from public.knowledge_articles")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
    }
  });
});
