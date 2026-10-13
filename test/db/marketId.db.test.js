// market_id migration: every rider/driver/ride/offer/earning/payment row
// gets a market, defaulting to Nashville, so existing data and existing
// code are unchanged. Tables missing from the test schema are skipped.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("market_id migration", () => {
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

  test("existing and new rows default to Nashville", async () => {
    await q("insert into public.drivers (id, first_name, online, status, approval_status) values ('DRV-MKT-1', 'Synthetic', false, 'active', 'approved')");
    const [d] = await q("select market_id from public.drivers where id = 'DRV-MKT-1'");
    expect(d.market_id).toBe("us-nashville");
    const cols = await q(`select table_name, column_default, is_nullable from information_schema.columns
      where table_schema = 'public' and column_name = 'market_id' order by table_name`);
    expect(cols.map((c) => c.table_name)).toEqual(expect.arrayContaining(["driver_earnings", "driver_offers", "drivers", "rides"]));
    for (const c of cols) {
      expect(c.is_nullable).toBe("NO");
      expect(c.column_default).toMatch(/us-nashville/);
    }
  });

  test("a pilot market id is accepted; a malformed one is refused", async () => {
    await q("insert into public.drivers (id, first_name, online, status, approval_status, market_id) values ('DRV-MKT-2', 'Synthetic', false, 'active', 'approved', 'zw-harare')");
    await expect(q("insert into public.drivers (id, first_name, online, status, approval_status, market_id) values ('DRV-MKT-3', 'Synthetic', false, 'active', 'approved', 'Harare')")).rejects.toThrow(/drivers_market_id_format/);
  });

  test("indexed for per-market queries", async () => {
    const idx = await q("select indexname from pg_indexes where schemaname = 'public' and indexname in ('rides_market_id_idx', 'drivers_market_id_idx') order by 1");
    expect(idx.map((r) => r.indexname)).toEqual(["drivers_market_id_idx", "rides_market_id_idx"]);
  });
});
