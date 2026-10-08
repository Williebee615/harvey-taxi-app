// review_demo migration: review-only demo columns and the database guard
// that allows at most one open simulated driver offer at a time.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("App Review demo migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await q("insert into public.rides (id, rider_id, status) values ('RIDE-REAL-1', 'RIDER-1', 'driver_enroute')");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("existing rides are unaffected (no demo mode)", async () => {
    const [r] = await q("select review_demo, review_demo_next_at from public.rides where id = 'RIDE-REAL-1'");
    expect(r).toEqual({ review_demo: null, review_demo_next_at: null });
  });

  test("only review rides can be demo rides, and only the two known modes", async () => {
    await expect(q("update public.rides set review_demo = 'autopilot' where id = 'RIDE-REAL-1'")).rejects.toThrow(/rides_review_demo_check/);
    await q("insert into public.rides (id, status, is_review_ride, review_demo) values ('RIDE-DEMO-A', 'driver_assigned', true, 'autopilot')");
    await expect(q("insert into public.rides (id, status, is_review_ride, review_demo) values ('RIDE-DEMO-X', 'driver_assigned', true, 'robot')")).rejects.toThrow(/rides_review_demo_check/);
  });

  test("at most one open simulated driver offer; a closed one doesn't count", async () => {
    await q("insert into public.rides (id, status, is_review_ride, review_demo) values ('RIDE-OFFER-1', 'awaiting_driver_acceptance', true, 'auto_offer')");
    await expect(
      q("insert into public.rides (id, status, is_review_ride, review_demo) values ('RIDE-OFFER-2', 'payment_authorized', true, 'auto_offer')")
    ).rejects.toThrow(/rides_one_open_review_auto_offer/);
    await q("update public.rides set status = 'cancelled' where id = 'RIDE-OFFER-1'");
    await q("insert into public.rides (id, status, is_review_ride, review_demo) values ('RIDE-OFFER-2', 'payment_authorized', true, 'auto_offer')");
    const [{ n }] = await q("select count(*)::int as n from public.rides where review_demo = 'auto_offer'");
    expect(n).toBe(2);
  });
});
