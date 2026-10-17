// merchants migration (merchant portal phase 1a): applications and admin
// review. Server-only table; one open application per contact email.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

const COLS = "business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions";
const vals = (email, over = "") => `('TEST Diner', 'restaurant', '100 Test Ave', 'Nashville', 'Test Owner', '${email}', '+16155550100', true)${over}`;

describeDb("merchants migration", () => {
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

  beforeEach(async () => {
    await q("truncate public.merchants");
  });

  test("a new application is pending in Tennessee, with an id and timestamps", async () => {
    const [r] = await q(`insert into public.merchants (${COLS}) values ${vals("a@example.test")} returning id is not null as has_id, status, state, created_at is not null as dated`);
    expect(r).toEqual({ has_id: true, status: "pending", state: "TN", dated: true });
  });

  test("the excluded-items confirmation, category, state, ZIP and phone are enforced", async () => {
    await expect(q(`insert into public.merchants (${COLS}) values ('TEST', 'restaurant', '100 Test Ave', 'Nashville', 'Owner', 'b@example.test', '+16155550100', false)`)).rejects.toThrow(/confirmed_exclusions/);
    await expect(q(`insert into public.merchants (${COLS}) values ('TEST', 'bar', '100 Test Ave', 'Nashville', 'Owner', 'b@example.test', '+16155550100', true)`)).rejects.toThrow(/category/);
    await expect(q(`insert into public.merchants (${COLS}, state) values ('TEST', 'grocery', '100 Test Ave', 'Atlanta', 'Owner', 'b@example.test', '+16155550100', true, 'GA')`)).rejects.toThrow(/state/);
    await expect(q(`insert into public.merchants (${COLS}, postal_code) values ('TEST', 'grocery', '100 Test Ave', 'Nashville', 'Owner', 'b@example.test', '+16155550100', true, '372')`)).rejects.toThrow(/postal_code/);
    await expect(q(`insert into public.merchants (${COLS}) values ('TEST', 'grocery', '100 Test Ave', 'Nashville', 'Owner', 'b@example.test', '615-555-0100', true)`)).rejects.toThrow(/contact_phone/);
  });

  test("one open application per contact email, case-insensitive; a rejected one doesn't block a new one", async () => {
    await q(`insert into public.merchants (${COLS}) values ${vals("Shop@Example.test")}`);
    await expect(q(`insert into public.merchants (${COLS}) values ${vals("shop@example.test")}`)).rejects.toThrow(/merchants_open_contact_email_idx/);
    await q("update public.merchants set status = 'rejected', reviewed_by = 'admin@example.test', reviewed_at = now(), review_reason = 'Outside the pilot area.'");
    await q(`insert into public.merchants (${COLS}) values ${vals("shop@example.test")}`);
    expect((await q("select count(*)::int as n from public.merchants"))[0].n).toBe(2);
  });

  test("a reviewed status needs the reviewer and time; reject and suspend need a reason", async () => {
    await q(`insert into public.merchants (${COLS}) values ${vals("c@example.test")}`);
    await expect(q("update public.merchants set status = 'approved'")).rejects.toThrow(/check/);
    await expect(q("update public.merchants set status = 'rejected', reviewed_by = 'admin@example.test', reviewed_at = now(), review_reason = 'short'")).rejects.toThrow(/check/);
    await q("update public.merchants set status = 'approved', reviewed_by = 'admin@example.test', reviewed_at = now()");
    expect((await q("select status from public.merchants"))[0].status).toBe("approved");
  });

  test("server-only: row-level security on, no access for anon or signed-in clients", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.merchants'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.merchants', 'select') as anon_select,
      has_table_privilege('anon', 'public.merchants', 'insert') as anon_insert,
      has_table_privilege('authenticated', 'public.merchants', 'select') as auth_select`);
    expect(g).toEqual({ anon_select: false, anon_insert: false, auth_select: false });
  });
});
