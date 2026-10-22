// fleets migration (fleet management phase 1, owner decisions 2026-10-22):
// constraints that keep fleets safe even if the server had a bug.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("fleets migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await q("insert into public.drivers (id, first_name) values ('OWNER', 'Olivia'), ('D2', 'Sam'), ('D3', 'Ari')");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  beforeEach(async () => {
    await q("truncate public.vehicle_assignments, public.fleet_memberships, public.fleet_vehicle_documents, public.fleet_vehicles, public.fleets cascade");
  });

  const fleet = async (status = "active") =>
    (await q(`insert into public.fleets (owner_driver_id, name, status, reviewed_by, reviewed_at) values ('OWNER', 'Music City Cars', $1, 'admin@example.test', now()) returning id`, [status]))[0].id;
  const vehicle = async (fleetId, plate = 'ABC123') =>
    (await q(`insert into public.fleet_vehicles (fleet_id, vehicle_year, make, model, color, plate, plate_state, vin_last6) values ($1, 2022, 'Toyota', 'Camry', 'Blue', $2, 'TN', 'A1B2C3') returning id`, [fleetId, plate]))[0].id;
  const member = async (fleetId, driver, status = "active") =>
    (await q(`insert into public.fleet_memberships (fleet_id, driver_id, status, owner_share_pct, agreement_version, invited_by, responded_at) values ($1, $2, $3, 20, 'fleet-draft-2026-10-22', 'OWNER', now()) returning id`, [fleetId, driver, status]))[0].id;

  test("a new fleet is pending; decisions need a reviewer, and declining needs a reason", async () => {
    const [f] = await q("insert into public.fleets (owner_driver_id, name) values ('OWNER', 'Pending Co') returning status");
    expect(f.status).toBe("pending");
    await expect(q("update public.fleets set status = 'active'")).rejects.toThrow(/check/);
    await expect(q("update public.fleets set status = 'declined', reviewed_by = 'a', reviewed_at = now()")).rejects.toThrow(/check/);
  });

  test("one fleet per owner; a declined one doesn't block a new application", async () => {
    await fleet("active");
    await expect(q("insert into public.fleets (owner_driver_id, name) values ('OWNER', 'Second')")).rejects.toThrow(/fleets_one_per_owner_idx/);
    await q("update public.fleets set status = 'declined', review_reason = 'Not now'");
    await q("insert into public.fleets (owner_driver_id, name) values ('OWNER', 'Second')");
  });

  test("vehicles: human-driven only, valid plate and VIN, activation names who did it", async () => {
    const f = await fleet();
    await expect(q(`insert into public.fleet_vehicles (fleet_id, vehicle_year, make, model, color, plate, plate_state, vin_last6, automation) values ($1, 2025, 'X', 'Y', 'White', 'AV1', 'TN', 'A1B2C3', 'driverless')`, [f])).rejects.toThrow(/automation/);
    await expect(q(`insert into public.fleet_vehicles (fleet_id, vehicle_year, make, model, color, plate, plate_state, vin_last6) values ($1, 2022, 'T', 'C', 'B', 'abc', 'TN', 'A1B2C3')`, [f])).rejects.toThrow(/plate/);
    await expect(q(`insert into public.fleet_vehicles (fleet_id, vehicle_year, make, model, color, plate, plate_state, vin_last6) values ($1, 2022, 'T', 'C', 'B', 'ABC', 'TN', 'IOQ123')`, [f])).rejects.toThrow(/vin_last6/);
    const v = await vehicle(f);
    await expect(q("update public.fleet_vehicles set status = 'active' where id = $1", [v])).rejects.toThrow(/check/);
    await q("update public.fleet_vehicles set status = 'active', status_changed_by = 'admin', status_changed_at = now() where id = $1", [v]);
    await expect(vehicle(f, "ABC123")).rejects.toThrow(/fleet_vehicles_plate_idx/);
  });

  test("documents: only a staff entry can be staff-verified; one current record per type", async () => {
    const v = await vehicle(await fleet());
    await expect(q(`insert into public.fleet_vehicle_documents (vehicle_id, document_type, expires_on, source, verification_status, recorded_by, verified_by, verified_at) values ($1, 'insurance', '2027-01-01', 'owner_entered', 'staff_verified', 'OWNER', 'OWNER', now())`, [v])).rejects.toThrow(/check/);
    await q(`insert into public.fleet_vehicle_documents (vehicle_id, document_type, expires_on, source, recorded_by) values ($1, 'insurance', '2027-01-01', 'owner_entered', 'OWNER')`, [v]);
    await expect(q(`insert into public.fleet_vehicle_documents (vehicle_id, document_type, expires_on, source, recorded_by) values ($1, 'insurance', '2027-02-01', 'owner_entered', 'OWNER')`, [v])).rejects.toThrow(/fleet_vehicle_documents_current_idx/);
    await expect(q(`insert into public.fleet_vehicle_documents (vehicle_id, document_type, expires_on, source, recorded_by) values ($1, 'inspection', '2027-02-01', 'owner_entered', 'OWNER')`, [v])).rejects.toThrow(/document_type/);
  });

  test("memberships: share capped at 50%; a driver drives for one fleet at a time", async () => {
    const f = await fleet();
    await expect(q(`insert into public.fleet_memberships (fleet_id, driver_id, owner_share_pct, agreement_version, invited_by) values ($1, 'D2', 51, 'v', 'OWNER')`, [f])).rejects.toThrow(/owner_share_pct/);
    await member(f, "D2");
    await q("insert into public.drivers (id) values ('OWNER2') on conflict do nothing");
    const [f2] = await q(`insert into public.fleets (owner_driver_id, name, status, reviewed_by, reviewed_at) values ('OWNER2', 'Other', 'active', 'a', now()) returning id`);
    await expect(member(f2.id, "D2")).rejects.toThrow(/fleet_memberships_one_active_idx/);
    await expect(q(`insert into public.fleet_memberships (fleet_id, driver_id, status, owner_share_pct, agreement_version, invited_by) values ($1, 'D3', 'active', 10, 'v', 'OWNER')`, [f])).rejects.toThrow(/check/);
  });

  test("assignments: one open assignment per vehicle and per driver", async () => {
    const f = await fleet();
    const v = await vehicle(f);
    const m2 = await member(f, "D2");
    const m3 = await member(f, "D3");
    await q(`insert into public.vehicle_assignments (vehicle_id, driver_id, membership_id, assigned_by) values ($1, 'D2', $2, 'OWNER')`, [v, m2]);
    await expect(q(`insert into public.vehicle_assignments (vehicle_id, driver_id, membership_id, assigned_by) values ($1, 'D3', $2, 'OWNER')`, [v, m3])).rejects.toThrow(/vehicle_assignments_open_vehicle_idx/);
    const v2 = await vehicle(f, "XYZ789");
    await expect(q(`insert into public.vehicle_assignments (vehicle_id, driver_id, membership_id, assigned_by) values ($1, 'D2', $2, 'OWNER')`, [v2, m2])).rejects.toThrow(/vehicle_assignments_open_driver_idx/);
    await expect(q("update public.vehicle_assignments set ends_at = now()")).rejects.toThrow(/check/);
    await q("update public.vehicle_assignments set ends_at = now(), ended_by = 'OWNER'");
  });

  test("driver_earnings gains nullable fleet columns; the share is checked", async () => {
    const cols = (await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'driver_earnings' and column_name like 'fleet%' order by 1")).map((r) => r.column_name);
    expect(cols).toEqual(["fleet_id", "fleet_owner_share_amount", "fleet_owner_share_pct", "fleet_vehicle_id"]);
    await q("insert into public.driver_earnings (id, driver_id, total_earning) values ('E1', 'D2', 10)");
    await expect(q("update public.driver_earnings set fleet_owner_share_pct = 60 where id = 'E1'")).rejects.toThrow(/check/);
  });

  test("server-only: RLS on and no access for anon or signed-in clients", async () => {
    for (const table of ["fleets", "fleet_vehicles", "fleet_vehicle_documents", "fleet_memberships", "vehicle_assignments"]) {
      const [r] = await q(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
      expect(r.relrowsecurity).toBe(true);
      const [g] = await q(`select has_table_privilege('anon', 'public.${table}', 'select') as a, has_table_privilege('authenticated', 'public.${table}', 'insert') as b`);
      expect(g).toEqual({ a: false, b: false });
    }
  });
});
