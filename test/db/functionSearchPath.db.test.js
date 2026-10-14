// 20261013210000_pin_function_search_path.sql: pins search_path on the
// seven public functions Supabase's advisor flags (lint 0011). Two of them
// (the driver location trigger and the updated_at trigger) are seeded here
// with their production bodies, since the baseline does not include them;
// the migration must pin them and they must still work when a caller's
// search_path points elsewhere.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

const SEED = `
create or replace function public.drivers_sync_geog() returns trigger language plpgsql as $f$
begin
  if new.current_lat is not null and new.current_lng is not null then
    new.geog := ST_SetSRID(ST_MakePoint(new.current_lng, new.current_lat), 4326)::geography;
  else
    new.geog := null;
  end if;
  return new;
end;
$f$;
create trigger drivers_sync_geog_trg before insert or update on public.drivers
  for each row execute function public.drivers_sync_geog();

create or replace function public.set_updated_at() returns trigger language plpgsql as $f$
begin
  new.updated_at = now();
  return new;
end;
$f$;
create table public.search_path_probe (id int primary key, updated_at timestamptz);
create trigger search_path_probe_updated before update on public.search_path_probe
  for each row execute function public.set_updated_at();
`;

describeDb("Pin search_path on flagged functions", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase({ seedBeforeMigrations: SEED });
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("the migration applies and pins search_path on the functions present", async () => {
    expect(db.appliedMigrations).toContain("20261013210000_pin_function_search_path.sql");
    const rows = await q(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('drivers_sync_geog', 'set_updated_at') order by 1`);
    expect(rows).toEqual([
      { proname: "drivers_sync_geog", proconfig: ["search_path=pg_catalog, public"] },
      { proname: "set_updated_at", proconfig: ["search_path=pg_catalog, public"] }
    ]);
  });

  test("security setting unchanged: both stay SECURITY INVOKER", async () => {
    const rows = await q(`select bool_or(p.prosecdef) as any_definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('drivers_sync_geog', 'set_updated_at')`);
    expect(rows[0].any_definer).toBe(false);
  });

  test("the triggers still work when the caller's search_path excludes public", async () => {
    await q("insert into public.drivers (id, first_name, online, status, approval_status) values ('DRV-SP1', 'S', false, 'active', 'approved')");
    await q("insert into public.search_path_probe (id) values (1)");
    await q("create schema if not exists elsewhere");
    await q("set search_path = elsewhere");
    try {
      await q("update public.drivers set current_lat = 36.1627, current_lng = -86.7816 where id = 'DRV-SP1'");
      await q("update public.search_path_probe set id = 1 where id = 1");
    } finally {
      await q("set search_path = public");
    }
    const [d] = await q("select round(ST_Y(geog::geometry)::numeric, 4) as lat, round(ST_X(geog::geometry)::numeric, 4) as lng from public.drivers where id = 'DRV-SP1'");
    expect(d).toEqual({ lat: "36.1627", lng: "-86.7816" });
    const [p] = await q("select updated_at is not null as stamped from public.search_path_probe where id = 1");
    expect(p.stamped).toBe(true);
  });
});
