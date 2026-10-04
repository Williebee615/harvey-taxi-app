// rider_live_location migration: four nullable columns on rides, existing
// rows untouched, and the partial index the purge sweep relies on.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("rider live location migration", () => {
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

  test("adds four nullable columns with the expected types", async () => {
    const cols = await q(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'rides' and column_name like 'rider_live_%' order by column_name`
    );
    expect(cols).toEqual([
      { column_name: "rider_live_accuracy_m", data_type: "integer", is_nullable: "YES" },
      { column_name: "rider_live_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "rider_live_lat", data_type: "double precision", is_nullable: "YES" },
      { column_name: "rider_live_lng", data_type: "double precision", is_nullable: "YES" }
    ]);
  });

  test("rows can be written and cleared; partial index exists", async () => {
    await q("insert into public.rides (id, rider_id, status) values ('RIDE-LIVE-1', 'RIDER-1', 'driver_enroute')");
    await q("update public.rides set rider_live_lat = 36.16, rider_live_lng = -86.78, rider_live_accuracy_m = 9, rider_live_at = now() where id = 'RIDE-LIVE-1'");
    expect((await q("select rider_live_lat from public.rides where id = 'RIDE-LIVE-1'"))[0].rider_live_lat).toBe(36.16);
    await q("update public.rides set rider_live_lat = null, rider_live_lng = null, rider_live_accuracy_m = null, rider_live_at = null where id = 'RIDE-LIVE-1'");
    expect((await q("select rider_live_at from public.rides where id = 'RIDE-LIVE-1'"))[0].rider_live_at).toBeNull();
    const idx = await q("select indexdef from pg_indexes where indexname = 'rides_rider_live_at_idx'");
    expect(idx[0].indexdef).toMatch(/WHERE \(rider_live_at IS NOT NULL\)/);
  });
});
