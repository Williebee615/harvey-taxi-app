// driver_online_sessions migration: the drivers.online trigger opens a
// session on going online and closes it on going offline, whatever sets
// the flag; one open session per driver; server-only access.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("driver online sessions migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const sessions = (id) => q("select started_at, ended_at from public.driver_online_sessions where driver_id = $1 order by id", [id]);

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("online opens a session, offline closes it, repeats stay single", async () => {
    await q("insert into public.drivers (id, first_name, online, status, approval_status) values ('DRV-S1', 'S', false, 'active', 'approved')");
    expect(await sessions("DRV-S1")).toEqual([]);
    await q("update public.drivers set online = true where id = 'DRV-S1'");
    await q("update public.drivers set online = true, updated_at = now() where id = 'DRV-S1'");
    let rows = await sessions("DRV-S1");
    expect(rows).toHaveLength(1);
    expect(rows[0].ended_at).toBeNull();
    await q("update public.drivers set online = false where id = 'DRV-S1'");
    rows = await sessions("DRV-S1");
    expect(rows[0].ended_at).not.toBeNull();
    await q("update public.drivers set online = true where id = 'DRV-S1'");
    rows = await sessions("DRV-S1");
    expect(rows).toHaveLength(2);
    expect(rows[1].ended_at).toBeNull();
  });

  test("a driver inserted online gets a session; other column updates don't touch sessions", async () => {
    await q("insert into public.drivers (id, first_name, online, status, approval_status) values ('DRV-S2', 'S', true, 'active', 'approved')");
    expect(await sessions("DRV-S2")).toHaveLength(1);
    await q("update public.drivers set first_name = 'T' where id = 'DRV-S2'");
    expect(await sessions("DRV-S2")).toHaveLength(1);
  });

  test("at most one open session per driver", async () => {
    await expect(
      q("insert into public.driver_online_sessions (driver_id) values ('DRV-S2')")
    ).rejects.toThrow(/driver_online_sessions_one_open/);
  });

  test("row level security on, no policies, and no anon/authenticated access", async () => {
    expect((await q("select relrowsecurity from pg_class where oid = 'public.driver_online_sessions'::regclass"))[0].relrowsecurity).toBe(true);
    expect(await q("select policyname from pg_policies where tablename = 'driver_online_sessions'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select * from public.driver_online_sessions")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
    }
  });
});
