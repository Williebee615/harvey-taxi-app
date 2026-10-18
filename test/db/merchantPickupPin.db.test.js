// merchants pickup pin columns (owner decision 2026-10-18).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("merchant pickup pin migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let id;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    [{ id }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Pin Store', 'restaurant', '1 Test St', 'Nashville', 'Owner', 'pin@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("a store starts without a pin; a pin needs both coordinates and who confirmed it, when", async () => {
    const [m] = await q("select pickup_lat, pickup_lng, pickup_pin_confirmed_by from public.merchants where id = $1", [id]);
    expect(m).toEqual({ pickup_lat: null, pickup_lng: null, pickup_pin_confirmed_by: null });
    await expect(q("update public.merchants set pickup_lat = 36.16 where id = $1", [id])).rejects.toThrow(/merchants_pickup_pin_check/);
    await expect(q("update public.merchants set pickup_lat = 36.16, pickup_lng = -86.78 where id = $1", [id])).rejects.toThrow(/merchants_pickup_pin_check/);
    await expect(q("update public.merchants set pickup_lat = 91, pickup_lng = -86.78, pickup_pin_confirmed_by = 'a@example.test', pickup_pin_confirmed_at = now() where id = $1", [id])).rejects.toThrow(/merchants_pickup_pin_check/);
    await q("update public.merchants set pickup_lat = 36.16, pickup_lng = -86.78, pickup_pin_confirmed_by = 'a@example.test', pickup_pin_confirmed_at = now() where id = $1", [id]);
  });
});
