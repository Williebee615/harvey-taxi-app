// driver_document_records: expiration dates with source and verification
// status, append-only history, server-only.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("driver document records migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase({
      seedBeforeMigrations: "insert into public.drivers (id, first_name, online, status, approval_status) values ('DRV-DOC-1', 'Synthetic', false, 'pending', 'pending');"
    });
    admin = await db.connect();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  const rec = (fields) => {
    const row = { driver_id: "DRV-DOC-1", document_type: "insurance", expires_on: "2027-01-31", source: "driver_entered", recorded_by: "staff@harvey.example", ...fields };
    const cols = Object.keys(row);
    return q(`insert into public.driver_document_records (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id, verification_status`, Object.values(row));
  };

  test("a driver-entered date is recorded as unverified by default", async () => {
    const [r] = await rec({});
    expect(r.verification_status).toBe("unverified");
  });

  test("one current record per driver and document; a new one supersedes, history kept", async () => {
    await expect(rec({ expires_on: "2027-02-28" })).rejects.toThrow(/duplicate key/);
    await expect(q("update public.driver_document_records set superseded_at = now() where driver_id = 'DRV-DOC-1'")).rejects.toThrow(/check/);
    await q("update public.driver_document_records set superseded_at = now(), superseded_by = 'staff@harvey.example' where driver_id = 'DRV-DOC-1' and document_type = 'insurance' and superseded_at is null");
    await rec({ expires_on: "2027-02-28", source: "staff_from_document", verification_status: "staff_verified", verified_by: "staff@harvey.example", verified_at: new Date().toISOString() });
    const rows = await q("select expires_on::text, source, verification_status, superseded_at is null as current from public.driver_document_records where driver_id = 'DRV-DOC-1' order by id");
    expect(rows).toEqual([
      { expires_on: "2027-01-31", source: "driver_entered", verification_status: "unverified", current: false },
      { expires_on: "2027-02-28", source: "staff_from_document", verification_status: "staff_verified", current: true }
    ]);
  });

  test("verification rules", async () => {
    // Staff verification must name who and when.
    await expect(rec({ document_type: "drivers_license", source: "staff_from_document", verification_status: "staff_verified" })).rejects.toThrow(/check/);
    // Provider verification only from a provider.
    await expect(rec({ document_type: "drivers_license", source: "staff_from_document", verification_status: "provider_verified" })).rejects.toThrow(/check/);
    await expect(rec({ document_type: "drivers_license", source: "driver_entered", verification_status: "provider_verified" })).rejects.toThrow(/check/);
    const [ok] = await rec({ document_type: "drivers_license", source: "provider", verification_status: "provider_verified" });
    expect(ok.verification_status).toBe("provider_verified");
    // Unknown types and sources are refused.
    await expect(rec({ document_type: "passport" })).rejects.toThrow(/check/);
    await expect(rec({ document_type: "vehicle_registration", source: "guess" })).rejects.toThrow(/check/);
  });

  test("records cannot point at a missing driver, and a driver with records cannot be deleted silently", async () => {
    await expect(rec({ driver_id: "DRV-NOPE", document_type: "vehicle_registration" })).rejects.toThrow(/foreign key/);
    await expect(q("delete from public.drivers where id = 'DRV-DOC-1'")).rejects.toThrow(/foreign key/);
  });

  test("server-only", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.driver_document_records'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.driver_document_records', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.driver_document_records', 'insert') as auth_insert`);
    expect(g).toEqual({ anon_select: false, auth_insert: false });
  });
});
