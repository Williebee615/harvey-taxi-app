// htaf_partners, htaf_partner_users and htaf_applications.partner_id
// (HTAF partner access, owner decision 2026-10-23).

const fs = require("fs");
const path = require("path");
const { describeDb, createTestDatabase } = require("./pgHarness");

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", "20261023010000_htaf_partners.sql"), "utf8");

jest.setTimeout(60_000);

describeDb("htaf partners migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    // The baseline has no htaf_applications, so the migration skipped its
    // columns. Create a minimal stand-in and apply it again (it is
    // written to be safe to repeat), as production would see it.
    await q("create table public.htaf_applications (id text primary key, application_code text)");
    await q("insert into public.htaf_applications (id, application_code) values ('HTAF-TEST-1', 'HTAF-TEST-1')");
    await q(MIGRATION);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });
  beforeEach(async () => {
    await q("update public.htaf_applications set partner_id = null, partner_user_id = null");
    await q("delete from public.htaf_partner_users");
    await q("delete from public.htaf_partners");
  });

  const addPartner = (agreement = null) =>
    q("insert into public.htaf_partners (name, partner_type, agreement_ref, created_by) values ('TEST Shelter', 'shelter', $1, 'owner@example.test') returning *", [agreement]);

  test("a partner starts off, and can't be on without an agreement and who/when", async () => {
    const [p] = await addPartner();
    expect(p.enabled).toBe(false);
    await expect(q("update public.htaf_partners set enabled = true, enabled_by = 'o', enabled_at = now() where id = $1", [p.id])).rejects.toThrow(/check/);
    await expect(q("update public.htaf_partners set enabled = true, agreement_ref = 'AGR-1' where id = $1", [p.id])).rejects.toThrow(/check/);
    await q("update public.htaf_partners set enabled = true, agreement_ref = 'AGR-1', enabled_by = 'o', enabled_at = now() where id = $1", [p.id]);
    await expect(q("insert into public.htaf_partners (name, partner_type, created_by) values ('X Bank', 'bank', 'o')")).rejects.toThrow(/partner_type/);
  });

  test("coordinators: +1 phones, one active sign-in per phone, version bump", async () => {
    const [p] = await addPartner();
    const add = (phone = "+16155550100") => q("insert into public.htaf_partner_users (partner_id, phone, name, created_by) values ($1, $2, 'Coordinator', 'o') returning id, status, session_version", [p.id, phone]);
    const [u] = await add();
    expect(u).toMatchObject({ status: "active", session_version: 0 });
    await expect(add()).rejects.toThrow(/htaf_partner_users_active_phone_idx/);
    await expect(add("615-555-0100")).rejects.toThrow(/phone/);
    const [{ bump_htaf_partner_user_session_version: v }] = await q("select public.bump_htaf_partner_user_session_version($1)", [u.id]);
    expect(v).toBe(1);
    await expect(q("update public.htaf_partner_users set status = 'disabled'")).rejects.toThrow(/check/);
  });

  test("applications can name the partner that sent them; a partner with applications can't be deleted", async () => {
    const [p] = await addPartner();
    const cols = (await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'htaf_applications' and column_name in ('partner_id', 'partner_user_id') order by 1")).map((r) => r.column_name);
    expect(cols).toEqual(["partner_id", "partner_user_id"]);
    await q("update public.htaf_applications set partner_id = $1 where id = 'HTAF-TEST-1'", [p.id]);
    await expect(q("delete from public.htaf_partners where id = $1", [p.id])).rejects.toThrow(/foreign key/);
    await expect(q("update public.htaf_applications set partner_id = gen_random_uuid() where id = 'HTAF-TEST-1'")).rejects.toThrow(/foreign key/);
  });

  test("server-only: RLS on, no anon or signed-in access", async () => {
    const rows = await q(`select relrowsecurity from pg_class where oid in ('public.htaf_partners'::regclass, 'public.htaf_partner_users'::regclass)`);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.htaf_partners', 'select') as a, has_table_privilege('authenticated', 'public.htaf_partner_users', 'select') as b,
      has_function_privilege('anon', 'public.bump_htaf_partner_user_session_version(uuid)', 'execute') as c`);
    expect(g).toEqual({ a: false, b: false, c: false });
  });
});
