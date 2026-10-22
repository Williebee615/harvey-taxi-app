// ride_driver_bounties migration (owner decision 2026-10-22: designed,
// switched off): proposals only, $3 to $15, one open per ride.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("ride_driver_bounties migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await q("insert into public.rides (id, status) values ('RIDE-B1', 'awaiting_driver_acceptance')");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  beforeEach(async () => {
    await q("truncate public.ride_driver_bounties");
  });

  const add = (cents, reason = "Hard to fill in Antioch") =>
    q("insert into public.ride_driver_bounties (ride_id, amount_cents, reason, created_by) values ('RIDE-B1', $1, $2, 'admin@example.test')", [cents, reason]);

  test("amount from $3 to $15, a reason, and only proposed or cancelled", async () => {
    await expect(add(299)).rejects.toThrow(/amount_cents/);
    await expect(add(1501)).rejects.toThrow(/amount_cents/);
    await expect(add(500, "x")).rejects.toThrow(/reason/);
    await add(500);
    await expect(q("update public.ride_driver_bounties set status = 'paid'")).rejects.toThrow(/status/);
    await expect(q("update public.ride_driver_bounties set status = 'cancelled'")).rejects.toThrow(/check/);
  });

  test("one open bounty per ride; a cancelled one doesn't block a new one", async () => {
    await add(500);
    await expect(add(800)).rejects.toThrow(/ride_driver_bounties_open_idx/);
    await q("update public.ride_driver_bounties set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now()");
    await add(800);
  });

  test("server-only: RLS on, no access for anon or signed-in clients", async () => {
    const [r] = await q("select relrowsecurity from pg_class where oid = 'public.ride_driver_bounties'::regclass");
    expect(r.relrowsecurity).toBe(true);
    const [g] = await q("select has_table_privilege('anon', 'public.ride_driver_bounties', 'select') as a, has_table_privilege('authenticated', 'public.ride_driver_bounties', 'insert') as b");
    expect(g).toEqual({ a: false, b: false });
  });
});
