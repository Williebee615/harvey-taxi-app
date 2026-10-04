// Atomic model budget (docs/ai-model.md): reservations from many
// simultaneous sessions (standing in for several server instances) never
// exceed the budget; settling writes the real cost exactly once; unsettled
// reservations keep counting as spent; the $10 cap is enforced inside the
// database too; only the server role can call the functions.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("agent model budget functions", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const reserve = (client, month, budget, amount) =>
    client.query("select public.agent_model_reserve($1, $2, $3, 'rider', 'TEST-R1') as id", [month, budget, amount]).then((r) => r.rows[0].id);
  const settle = (id, cost) =>
    q("select public.agent_model_settle($1, $2, 2, 3000, 100, 0, 0, 'claude-haiku-4-5', 'rider', 'TEST-R1', 'rider_web', 'answered') as ok", [id, cost]).then((r) => r[0].ok);

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("30 simultaneous reservations from separate sessions: exactly the ones that fit in $10 succeed", async () => {
    const sessions = await Promise.all(Array.from({ length: 30 }, () => db.connect("service_role")));
    const ids = await Promise.all(sessions.map((c) => reserve(c, "2026-11", 10, 0.6)));
    const granted = ids.filter((id) => id !== null);
    expect(granted).toHaveLength(16); // 16 x 0.6 = 9.6; a 17th would be 10.2
    const [t] = await q("select committed_usd::float as c, held_usd::float as h from public.agent_model_month_totals('2026-11')");
    expect(t).toEqual({ c: 0, h: 9.6 });
  });

  test("settling records the real cost once, frees the rest of the reservation, and can't be repeated", async () => {
    const id = await reserve(admin, "2026-12", 10, 0.0525);
    expect(await settle(id, 0.0038)).toBe(true);
    expect(await settle(id, 0.0038)).toBe(false); // second settle writes nothing
    expect(await q("select count(*)::int as n, sum(cost_usd)::float as c from public.agent_model_usage where reservation_id = $1", [id])).toEqual([{ n: 1, c: 0.0038 }]);
    const [t] = await q("select committed_usd::float as c, held_usd::float as h from public.agent_model_month_totals('2026-12')");
    expect(t).toEqual({ c: 0.0038, h: 0 });
    expect(await settle(999999, 0.01)).toBe(false); // unknown reservation
  });

  test("committed spend plus unsettled reservations block further reservations; the cap is $10 even if asked for more", async () => {
    await q("insert into public.agent_model_usage (usage_month, role, model, cost_usd, outcome) values ('2027-01', 'rider', 'claude-haiku-4-5', 9.9, 'answered')");
    expect(await reserve(admin, "2027-01", 10, 0.0525)).not.toBeNull(); // 9.9525
    expect(await reserve(admin, "2027-01", 10, 0.0525)).toBeNull(); // would be 10.005
    expect(await reserve(admin, "2027-01", 1000, 0.0525)).toBeNull(); // budget capped at 10 inside the database
    expect(await reserve(admin, "2027-02", 1000, 10.5)).toBeNull();
  });

  test("bad input is refused", async () => {
    await expect(reserve(admin, "Nov 2026", 10, 0.05)).rejects.toThrow(/invalid month/);
    await expect(reserve(admin, "2026-11", 10, 0)).rejects.toThrow(/positive/);
    const id = await reserve(admin, "2027-03", 10, 0.05);
    await expect(settle(id, -1)).rejects.toThrow(/zero or more/);
  });

  test("server-only: no table access or function execute for anon/authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select * from public.agent_model_reservations")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select public.agent_model_reserve('2026-11', 10, 0.05)")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
    }
    expect((await q("select relrowsecurity from pg_class where oid = 'public.agent_model_reservations'::regclass"))[0].relrowsecurity).toBe(true);
  });
});
