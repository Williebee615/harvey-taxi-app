// catalog_items (merchant portal phase 2).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("catalog_items migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let merchantId;
  let otherId;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    const store = (name, phone) => q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ($1, 'grocery', '100 Test Ave', 'Nashville', 'Owner', $3, $2, true, 'approved', 'admin@example.test', now()) returning id`, [name, phone, `${phone.slice(-4)}@example.test`]);
    [{ id: merchantId }] = await store("TEST Fixture Store", "+16155550100");
    [{ id: otherId }] = await store("TEST Other Store", "+16155550101");
  });
  afterAll(async () => {
    if (db) await db.drop();
  });
  beforeEach(async () => {
    await q("truncate public.catalog_items");
  });

  const add = (name, price = 499, m = merchantId) =>
    q("insert into public.catalog_items (merchant_id, name, price_cents) values ($1, $2, $3) returning id, available, substitutable, review_status, review_flags", [m, name, price]);

  test("defaults: available, not substitutable, listed, no flags", async () => {
    const [i] = await add("Whole milk");
    expect(i).toMatchObject({ available: true, substitutable: false, review_status: "listed", review_flags: [] });
  });

  test("one live item per name per store, ignoring case; removed items and other stores don't count", async () => {
    const [i] = await add("Whole milk");
    await expect(add("WHOLE MILK")).rejects.toThrow(/catalog_items_store_name_idx/);
    await add("Whole milk", 499, otherId);
    await q("update public.catalog_items set archived_at = now() where id = $1", [i.id]);
    await add("whole milk");
  });

  test("name, price and status limits", async () => {
    await expect(add("A")).rejects.toThrow(/check/);
    await expect(add("Bread", 0)).rejects.toThrow(/price_cents/);
    await expect(add("Bread", 100001)).rejects.toThrow(/price_cents/);
    const [i] = await add("Bread");
    await expect(q("update public.catalog_items set review_status = 'gone' where id = $1", [i.id])).rejects.toThrow(/review_status/);
  });

  test("hidden by staff needs who, when and a reason of at least 10 characters", async () => {
    const [i] = await add("Vodka");
    await expect(q("update public.catalog_items set review_status = 'blocked' where id = $1", [i.id])).rejects.toThrow(/check/);
    await expect(q("update public.catalog_items set review_status = 'blocked', reviewed_by = 'a@example.test', reviewed_at = now(), review_reason = 'no' where id = $1", [i.id])).rejects.toThrow(/check/);
    await q("update public.catalog_items set review_status = 'blocked', reviewed_by = 'a@example.test', reviewed_at = now(), review_reason = 'Alcohol is excluded (term 3).' where id = $1", [i.id]);
  });

  test("a store with items can't be deleted", async () => {
    await add("Bread");
    await expect(q("delete from public.merchants where id = $1", [merchantId])).rejects.toThrow(/foreign key/);
  });

  test("server-only: RLS on, no anon or signed-in access", async () => {
    const [r] = await q("select relrowsecurity from pg_class where oid = 'public.catalog_items'::regclass");
    expect(r.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.catalog_items', 'select') as a, has_table_privilege('authenticated', 'public.catalog_items', 'insert') as b`);
    expect(g).toEqual({ a: false, b: false });
    const [{ n }] = await q("select count(*)::int as n from pg_policies where tablename = 'catalog_items'");
    expect(n).toBe(0);
  });
});
