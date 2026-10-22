// ride_tips and driver_ratings migration (owner decisions 2026-10-22):
// tips $1 to $100, one paid tip per ride, a payment intent unless
// simulated; one 1-5 star rating per ride with known tags only.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("ride_tips and driver_ratings migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await q("insert into public.rides (id, status) values ('RIDE-T1', 'completed'), ('RIDE-T2', 'completed')");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  beforeEach(async () => {
    await q("truncate public.ride_tips, public.driver_ratings");
  });

  const tip = (cents, { ride = "RIDE-T1", status = "pending", mode = "test", pi = "pi_x" } = {}) =>
    q(
      "insert into public.ride_tips (ride_id, rider_id, driver_id, amount_cents, status, mode, payment_intent_id, succeeded_at) values ($1, 'U1', 'D1', $2, $3, $4, $5, case when $3 in ('succeeded', 'simulated') then now() end)",
      [ride, cents, status, mode, pi]
    );

  test("tips: $1 to $100, a payment intent unless simulated", async () => {
    await expect(tip(99)).rejects.toThrow(/amount_cents/);
    await expect(tip(10001)).rejects.toThrow(/amount_cents/);
    await expect(tip(500, { mode: "test", pi: null })).rejects.toThrow(/check/);
    await expect(tip(500, { mode: "simulated", status: "simulated", pi: "pi_y" })).rejects.toThrow(/check/);
    await tip(500, { mode: "simulated", status: "simulated", pi: null });
    await expect(q("insert into public.ride_tips (ride_id, rider_id, driver_id, amount_cents, status, mode, payment_intent_id) values ('RIDE-T2', 'U1', 'D1', 500, 'succeeded', 'test', 'pi_z')")).rejects.toThrow(/check/);
  });

  test("tips: one paid tip per ride; pending and cancelled ones don't block", async () => {
    await tip(500, { status: "cancelled", pi: "pi_1" });
    await tip(500, { status: "pending", pi: "pi_2" });
    await tip(500, { status: "succeeded", pi: "pi_3" });
    await expect(tip(200, { status: "succeeded", pi: "pi_4" })).rejects.toThrow(/ride_tips_one_paid_idx/);
    await expect(tip(200, { ride: "RIDE-T2", pi: "pi_3" })).rejects.toThrow(/payment_intent_id/);
  });

  const rate = (ride, stars, tags = []) =>
    q("insert into public.driver_ratings (ride_id, rider_id, driver_id, stars, tags, counted) values ($1, 'U1', 'D1', $2, $3, true)", [ride, stars, tags]);

  test("ratings: 1 to 5 stars, known tags only, one per ride", async () => {
    await expect(rate("RIDE-T1", 0)).rejects.toThrow(/stars/);
    await expect(rate("RIDE-T1", 6)).rejects.toThrow(/stars/);
    await expect(rate("RIDE-T1", 5, ["made_up"])).rejects.toThrow(/tags/);
    await rate("RIDE-T1", 5, ["friendly", "clean_car"]);
    await expect(rate("RIDE-T1", 4)).rejects.toThrow(/ride_id/);
    await rate("RIDE-T2", 2, ["late"]);
  });

  test("server-only: RLS on, no access for anon or signed-in clients", async () => {
    for (const t of ["ride_tips", "driver_ratings"]) {
      const [r] = await q(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`);
      expect(r.relrowsecurity).toBe(true);
      const [g] = await q(`select has_table_privilege('anon', 'public.${t}', 'select') as a, has_table_privilege('authenticated', 'public.${t}', 'insert') as b`);
      expect(g).toEqual({ a: false, b: false });
    }
  });
});
