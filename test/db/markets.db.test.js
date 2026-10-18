// market on merchants and orders (owner decision 2026-10-18).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("markets migration", () => {
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

  test("stores and orders default to Nashville; ids are lowercase words", async () => {
    const [m] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Market Store', 'restaurant', '1 Test St', 'Nashville', 'Owner', 'market@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id, market`);
    expect(m.market).toBe("nashville");
    await expect(q("update public.merchants set market = 'Nash ville' where id = $1", [m.id])).rejects.toThrow(/merchants_market_check/);
    await q("update public.merchants set market = 'memphis' where id = $1", [m.id]);
    const [o] = await q(`insert into public.orders (order_number, merchant_id, rider_id, order_type, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, client_order_key, quote_jti)
      values ('HT-MARKET', $1, 'rider-1', 'food', 100, 0, 0, 0, 100, 'market-key-1', 'market-jti-1') returning market`, [m.id]);
    expect(o.market).toBe("nashville");
    await expect(q("insert into public.orders (order_number, merchant_id, rider_id, order_type, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, client_order_key, quote_jti, market) values ('HT-MARKE2', $1, 'r', 'food', 1, 0, 0, 0, 1, 'market-key-2', 'market-jti-2', '')", [m.id])).rejects.toThrow(/orders_market_check/);
  });
});
