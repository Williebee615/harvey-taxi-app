// htaf_applications test marker (owner decision 2026-10-23).

const fs = require("fs");
const path = require("path");
const { describeDb, createTestDatabase } = require("./pgHarness");

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", "20261023030000_htaf_applications_test_marker.sql"), "utf8");
jest.setTimeout(60_000);

describeDb("htaf_applications test marker migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    // The baseline has no htaf_applications: add a stand-in and apply the
    // migration again, as production would see it.
    await q("create table public.htaf_applications (id text primary key, status text)");
    await q("insert into public.htaf_applications values ('HTAF-1', 'submitted')");
    await q(MIGRATION);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("records start real; marking as test needs who and when; unmarking clears", async () => {
    const [r] = await q("select is_test from public.htaf_applications where id = 'HTAF-1'");
    expect(r.is_test).toBe(false);
    await expect(q("update public.htaf_applications set is_test = true where id = 'HTAF-1'")).rejects.toThrow(/check/);
    await q("update public.htaf_applications set is_test = true, test_marked_by = 'owner@example.test', test_marked_at = now() where id = 'HTAF-1'");
    await q("update public.htaf_applications set is_test = false, test_marked_by = null, test_marked_at = null where id = 'HTAF-1'");
  });
});
