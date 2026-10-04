// ride_cancellation_records migration: additive columns on rides, the
// contact-attempt log, and the database rule that keeps every cancellation
// fee at $0 until the owner approves fees.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("ride cancellation records migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await q("insert into public.rides (id, rider_id, status) values ('RIDE-CXL-1', 'RIDER-1', 'driver_enroute')");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("existing rows get safe defaults: no records, zero contact attempts, $0 fee", async () => {
    const [r] = await q("select eta_at_accept_minutes, pickup_due_at, arrival_verified, contact_attempt_count, cancellation_category, cancellation_fee_cents, cancellation_fee_shown_cents from public.rides where id = 'RIDE-CXL-1'");
    expect(r).toEqual({
      eta_at_accept_minutes: null,
      pickup_due_at: null,
      arrival_verified: null,
      contact_attempt_count: 0,
      cancellation_category: null,
      cancellation_fee_cents: 0,
      cancellation_fee_shown_cents: null
    });
  });

  test("records can be written", async () => {
    await q(`update public.rides set eta_at_accept_minutes = 6.5, pickup_due_at = now(), pickup_start_distance_m = 2400,
      pickup_last_distance_m = 900, pickup_progress_at = now(), pickup_fix_lat = 36.16, pickup_fix_lng = -86.78,
      pickup_fix_accuracy_m = 12, pickup_fix_at = now(), arrival_verified = true, arrival_distance_m = 40,
      arrival_check = 'verified', contact_attempt_count = 1, last_contact_attempt_at = now(),
      cancellation_category = 'driver_no_show', cancellation_assessment = '{"fee_cents":0}'::jsonb,
      cancellation_fee_shown_cents = 0 where id = 'RIDE-CXL-1'`);
    const [r] = await q("select arrival_check, cancellation_category, cancellation_assessment from public.rides where id = 'RIDE-CXL-1'");
    expect(r).toEqual({ arrival_check: "verified", cancellation_category: "driver_no_show", cancellation_assessment: { fee_cents: 0 } });
  });

  test("charges are not active: any non-zero cancellation fee, charged or shown, is refused", async () => {
    await expect(q("update public.rides set cancellation_fee_cents = 500 where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_cancellation_fee_not_active_check/);
    await expect(q("update public.rides set cancellation_fee_shown_cents = 500 where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_cancellation_fee_not_active_check/);
    await expect(q("update public.rides set cancellation_fee_cents = -1 where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_cancellation_fee_not_active_check/);
  });

  test("unknown categories, arrival results and negative counts are refused", async () => {
    await expect(q("update public.rides set cancellation_category = 'rider_fee' where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_cancellation_category_check/);
    await expect(q("update public.rides set arrival_check = 'close_enough' where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_arrival_check_check/);
    await expect(q("update public.rides set contact_attempt_count = -1 where id = 'RIDE-CXL-1'")).rejects.toThrow(/rides_contact_attempt_count_check/);
  });

  test("contact attempts: call or message only; server-only table", async () => {
    await q("insert into public.ride_contact_attempts (ride_id, driver_id, method, ride_status) values ('RIDE-CXL-1', 'DRV-1', 'call', 'arrived')");
    await expect(q("insert into public.ride_contact_attempts (ride_id, driver_id, method) values ('RIDE-CXL-1', 'DRV-1', 'carrier_pigeon')")).rejects.toThrow();
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.ride_contact_attempts'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const grants = await q(`select has_table_privilege('anon', 'public.ride_contact_attempts', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.ride_contact_attempts', 'insert') as auth_insert`);
    expect(grants[0]).toEqual({ anon_select: false, auth_insert: false });
  });
});
