// htaf_assistant_questions triage status and htaf_partners.contact_email
// (HTAF admin redesign, owner decisions 2026-10-23).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("htaf admin inbox and partner contact migration", () => {
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

  test("questions start open; closing one needs who and when; only known statuses", async () => {
    const [row] = await q("insert into public.htaf_assistant_questions (question_excerpt, intent) values ('Unanswered question about: other', 'other') returning id, status");
    expect(row.status).toBe("open");
    await expect(q("update public.htaf_assistant_questions set status = 'dismissed' where id = $1", [row.id])).rejects.toThrow(/check/);
    await q("update public.htaf_assistant_questions set status = 'faq', resolved_by = 'owner@example.test', resolved_at = now() where id = $1", [row.id]);
    await expect(q("update public.htaf_assistant_questions set status = 'deleted' where id = $1", [row.id])).rejects.toThrow(/check/);
  });

  test("partner contact email is optional and must look like an email", async () => {
    const [p] = await q("insert into public.htaf_partners (name, created_by, contact_email) values ('TEST Org', 'o', 'intake@example.org') returning contact_email");
    expect(p.contact_email).toBe("intake@example.org");
    await q("insert into public.htaf_partners (name, created_by) values ('TEST Org 2', 'o')");
    await expect(q("insert into public.htaf_partners (name, created_by, contact_email) values ('TEST Org 3', 'o', 'not an email')")).rejects.toThrow(/contact_email/);
  });
});
