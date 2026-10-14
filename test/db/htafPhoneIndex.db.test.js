// Phone index migration: every outcome is recorded distinctly, and a
// failed (invalid) concurrent build is never recorded as success.

const fs = require("fs");
const path = require("path");
const { describeDb, createTestDatabase, MIGRATIONS_DIR } = require("./pgHarness");

jest.setTimeout(60_000);

const MIGRATION = fs.readFileSync(path.join(MIGRATIONS_DIR, "20261014030000_htaf_applications_phone_idx.sql"), "utf8");
const TABLE = "create table public.htaf_applications (id uuid primary key default gen_random_uuid(), phone text, submitted_at timestamptz default now())";

describeDb("HTAF phone index migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const outcomes = async () => (await q("select outcome from public.schema_change_outcomes order by id")).map((r) => r.outcome);
  const indexValid = async () => (await q("select i.indisvalid from pg_index i where i.indexrelid = to_regclass('public.htaf_applications_phone_idx')"))[0]?.indisvalid;

  beforeAll(async () => {
    // The harness has already applied every migration, this one included,
    // to a baseline with no HTAF tables.
    db = await createTestDatabase();
    admin = await db.connect();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("table absent: recorded as skipped, nothing created", async () => {
    expect(await outcomes()).toEqual(["skipped_table_absent"]);
    expect(await indexValid()).toBeUndefined();
  });

  test("table present, no index: created and recorded as created", async () => {
    await q(TABLE);
    await q(MIGRATION);
    expect((await outcomes()).at(-1)).toBe("created");
    expect(await indexValid()).toBe(true);
  });

  test("index built concurrently beforehand: recorded as already_present", async () => {
    await q("drop index public.htaf_applications_phone_idx");
    await q("create index concurrently if not exists htaf_applications_phone_idx on public.htaf_applications (phone)");
    await q(MIGRATION);
    expect((await outcomes()).at(-1)).toBe("already_present");
  });

  test("invalid index (failed concurrent build): the migration fails and records nothing", async () => {
    await q("update pg_index set indisvalid = false where indexrelid = 'public.htaf_applications_phone_idx'::regclass");
    const before = (await outcomes()).length;
    await expect(q(MIGRATION)).rejects.toThrow(/INVALID/);
    expect((await outcomes()).length).toBe(before);
  });

  test("the duplicate-check query can use the index", async () => {
    await q("drop index public.htaf_applications_phone_idx");
    await q("create index htaf_applications_phone_idx on public.htaf_applications (phone)");
    await q("insert into public.htaf_applications (phone) select lpad(g::text, 10, '6') from generate_series(1, 2000) g");
    await q("analyze public.htaf_applications");
    const plan = (await q("explain select id from public.htaf_applications where phone in ('6155550100','16155550100','+16155550100') and id <> gen_random_uuid() order by submitted_at limit 5")).map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/htaf_applications_phone_idx/);
  });

  test("the outcome log is server-only", async () => {
    const [g] = await q(`select has_table_privilege('anon', 'public.schema_change_outcomes', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.schema_change_outcomes', 'select') as auth_select`);
    expect(g).toEqual({ anon_select: false, auth_select: false });
  });
});
