// merchant_users and merchant_hours (merchant portal phase 1b).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("merchant_users and merchant_hours migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let merchantId;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    [{ id: merchantId }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Fixture Store', 'grocery', '100 Test Ave', 'Nashville', 'Owner', 'o@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });
  beforeEach(async () => {
    await q("truncate public.merchant_hours, public.merchant_users cascade");
  });

  const addUser = (phone = "+16155550100") =>
    q("insert into public.merchant_users (merchant_id, phone, name, created_by) values ($1, $2, 'Owner', 'admin@example.test') returning id, status, session_version, role", [merchantId, phone]);

  test("a sign-in starts active, version 0, owner; phones must be +1 and active phones unique", async () => {
    const [u] = await addUser();
    expect(u).toMatchObject({ status: "active", session_version: 0, role: "owner" });
    await expect(addUser()).rejects.toThrow(/merchant_users_active_phone_idx/);
    await expect(addUser("615-555-0100")).rejects.toThrow(/phone/);
    // A disabled sign-in frees the phone; disabling needs who and when.
    await expect(q("update public.merchant_users set status = 'disabled'")).rejects.toThrow(/check/);
    await q("update public.merchant_users set status = 'disabled', disabled_by = 'admin@example.test', disabled_at = now()");
    await addUser();
  });

  test("bump_merchant_user_session_version raises the version atomically", async () => {
    const [u] = await addUser();
    const [{ bump_merchant_user_session_version: v1 }] = await q("select public.bump_merchant_user_session_version($1)", [u.id]);
    const [{ bump_merchant_user_session_version: v2 }] = await q("select public.bump_merchant_user_session_version($1)", [u.id]);
    expect([v1, v2]).toEqual([1, 2]);
  });

  test("hours: one row per day; open days need times closing after opening; closed days have none", async () => {
    await q("insert into public.merchant_hours (merchant_id, day_of_week, closed, opens_at, closes_at) values ($1, 1, false, '09:00', '21:00'), ($1, 0, true, null, null)", [merchantId]);
    await expect(q("insert into public.merchant_hours (merchant_id, day_of_week, closed, opens_at, closes_at) values ($1, 1, false, '10:00', '20:00')", [merchantId])).rejects.toThrow(/pkey|duplicate/);
    await expect(q("insert into public.merchant_hours (merchant_id, day_of_week, closed, opens_at, closes_at) values ($1, 2, false, '22:00', '02:00')", [merchantId])).rejects.toThrow(/check/);
    await expect(q("insert into public.merchant_hours (merchant_id, day_of_week, closed, opens_at, closes_at) values ($1, 3, true, '09:00', '17:00')", [merchantId])).rejects.toThrow(/check/);
    await expect(q("insert into public.merchant_hours (merchant_id, day_of_week, closed) values ($1, 7, true)", [merchantId])).rejects.toThrow(/day_of_week/);
  });

  test("server-only: RLS on, no anon or signed-in access, function only for the server", async () => {
    const rows = await q(`select relname, relrowsecurity from pg_class where oid in ('public.merchant_users'::regclass, 'public.merchant_hours'::regclass) order by relname`);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.merchant_users', 'select') as a, has_table_privilege('authenticated', 'public.merchant_hours', 'insert') as b,
      has_function_privilege('anon', 'public.bump_merchant_user_session_version(uuid)', 'execute') as c`);
    expect(g).toEqual({ a: false, b: false, c: false });
  });
});
