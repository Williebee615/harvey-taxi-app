// Post-migration assertions for every PR #130 migration, applied exactly
// once, in filename order, on top of the schema-only production-mirror
// baseline (test/db/live-baseline.sql). The behavior, concurrency, rollback
// and permission tests for the dispatch functions live in
// acceptDriverOfferAtomic.db.test.js and run against the same migrated
// schema.
//
// Single-application note: the versioned migrations 20260927220000 and
// 20260927220100 use plain ADD CONSTRAINT (no IF NOT EXISTS). They are
// designed to be applied once by the migration runner, like every other
// versioned migration; re-running one raises "already exists" rather than
// silently skipping, which is asserted below. Read-only production check
// (2026-09-28): none of the three constraints, or an equivalent, exists in
// production today, and rides and driver_earnings are both empty, so all
// three apply cleanly and nothing existing can violate them.

const fs = require("fs");
const path = require("path");
const { describeDb, createTestDatabase, pr130Migrations, MIGRATIONS_DIR } = require("./pgHarness");

jest.setTimeout(60_000);

const EXPECTED_ORDER = [
  "20260927220000_driver_earnings_unique_ride.sql",
  "20260927220100_rides_payment_capture_and_cancellation_columns.sql",
  "20260927220200_rides_quote_jti_idempotency.sql",
  "20260927220300_dispatch_functions_hardening.sql",
  "20260927220400_accept_driver_offer_atomic.sql"
];

// Synthetic pre-existing row (no production data), inserted after the
// baseline and before any migration, to prove migrations leave existing
// rides untouched apart from the new nullable columns.
const PRE_EXISTING_RIDE = {
  id: "RIDE-PREEXISTING-1",
  rider_id: "RIDER-SYNTH-1",
  status: "completed",
  dispatch_status: "accepted",
  driver_id: "DRV-SYNTH-1",
  payment_status: "captured",
  assigned_driver_id: "22222222-2222-2222-2222-222222222222",
  dispatch_attempts: 2
};

const SEED_SQL = `
  insert into public.drivers (id, first_name, online, status, approval_status)
    values ('DRV-SYNTH-1', 'Synthetic', false, 'active', 'approved');
  insert into public.rides (${Object.keys(PRE_EXISTING_RIDE).join(", ")})
    values (${Object.values(PRE_EXISTING_RIDE)
      .map((v) => (typeof v === "number" ? v : `'${v}'`))
      .join(", ")});
`;

const NEW_RIDE_COLUMNS = {
  payment_capture_idempotency_key: "text",
  payment_capture_attempted_at: "timestamp with time zone",
  payment_capture_error: "text",
  cancellation_payment_status: "text",
  cancellation_payment_idempotency_key: "text",
  cancellation_payment_attempted_at: "timestamp with time zone",
  cancellation_payment_error: "text",
  quote_jti: "text"
};

describe("PR #130 migration set (static)", () => {
  test("the harness applies exactly these migrations, in this order", () => {
    expect(pr130Migrations()).toEqual(EXPECTED_ORDER);
  });

  test("the baseline is schema-only: no data statements and no credentials", () => {
    const baseline = fs.readFileSync(path.join(__dirname, "live-baseline.sql"), "utf8");
    // Outside function bodies ($function$ ... $function$), no INSERT/COPY.
    const outsideFunctions = baseline.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(outsideFunctions).not.toMatch(/^\s*(insert|copy)\b/im);
    for (const secret of [
      /sb_(secret|publishable)_[A-Za-z0-9]/,
      /eyJ[A-Za-z0-9_-]{20,}/,
      /sk_(live|test)_[A-Za-z0-9]/,
      /postgres(ql)?:\/\/[^\s@]+:[^\s@]+@/,
      /password\s*=\s*'/i,
      /orgahzncmzptljapqffj/
    ]) {
      expect(baseline).not.toMatch(secret);
    }
    for (const file of EXPECTED_ORDER) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      expect(sql).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}|sk_(live|test)_/);
    }
  });
});

describeDb("PR #130 migrations applied to the production-mirror baseline", () => {
  let db;
  let admin;

  beforeAll(async () => {
    db = await createTestDatabase({ seedBeforeMigrations: SEED_SQL });
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  test("every migration applied exactly once, in timestamp order", () => {
    expect(db.appliedMigrations).toEqual(EXPECTED_ORDER);
  });

  test("the baseline database held no rows before synthetic seeding", () => {
    expect(db.baselineRowsAtLoad).toEqual({ drivers: 0, rides: 0, driver_offers: 0, driver_earnings: 0 });
  });

  test("the Supabase roles carry no credentials", async () => {
    const rows = await q(
      "select rolname, rolcanlogin, rolpassword is null as no_password from pg_authid where rolname in ('anon','authenticated','service_role') order by 1"
    );
    expect(rows).toEqual([
      { rolname: "anon", rolcanlogin: false, no_password: true },
      { rolname: "authenticated", rolcanlogin: false, no_password: true },
      { rolname: "service_role", rolcanlogin: false, no_password: true }
    ]);
  });

  // ---------------------------------------------------------- quote_jti

  describe("rides.quote_jti", () => {
    test("exists as a nullable text column", async () => {
      expect(
        await q("select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='rides' and column_name='quote_jti'")
      ).toEqual([{ data_type: "text", is_nullable: "YES" }]);
    });

    test("has a partial unique index on non-null values", async () => {
      const rows = await q("select indexdef from pg_indexes where schemaname='public' and indexname='rides_quote_jti_unique'");
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX rides_quote_jti_unique ON public\.rides USING btree \(quote_jti\) WHERE \(quote_jti IS NOT NULL\)/);
    });

    test("permits many null values and rejects a reused non-null value", async () => {
      await admin.query("begin");
      try {
        await admin.query("insert into public.rides (id, quote_jti) values ('RIDE-JTI-N1', null), ('RIDE-JTI-N2', null), ('RIDE-JTI-1', 'jti-abc')");
        await expect(admin.query("insert into public.rides (id, quote_jti) values ('RIDE-JTI-2', 'jti-abc')")).rejects.toMatchObject({
          code: "23505"
        });
      } finally {
        await admin.query("rollback");
      }
    });
  });

  test("a pre-existing ride row is unchanged apart from null values in the new columns", async () => {
    const [row] = await q("select * from public.rides where id = $1", [PRE_EXISTING_RIDE.id]);
    for (const [col, value] of Object.entries(PRE_EXISTING_RIDE)) {
      expect(row[col]).toBe(value);
    }
    for (const col of Object.keys(NEW_RIDE_COLUMNS)) {
      expect(row[col]).toBeNull();
    }
  });

  // --------------------------------------------------- driver_earnings

  test("driver_earnings_ride_id_unique is a UNIQUE constraint on ride_id", async () => {
    expect(
      await q("select contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.driver_earnings'::regclass and conname='driver_earnings_ride_id_unique'")
    ).toEqual([{ contype: "u", def: "UNIQUE (ride_id)" }]);
  });

  // ------------------------------------ payment/cancellation reconciliation

  test("payment and cancellation reconciliation columns exist with the expected types", async () => {
    const rows = await q(
      "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='rides' and column_name = any($1)",
      [Object.keys(NEW_RIDE_COLUMNS)]
    );
    expect(Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]))).toEqual(NEW_RIDE_COLUMNS);
  });

  test("both CHECK constraints exist and enforce their allowed values", async () => {
    const rows = await q(
      "select conname from pg_constraint where conrelid='public.rides'::regclass and contype='c' and conname in ('rides_payment_status_check','rides_cancellation_payment_status_check') order by 1"
    );
    expect(rows.map((r) => r.conname)).toEqual(["rides_cancellation_payment_status_check", "rides_payment_status_check"]);

    await admin.query("begin");
    try {
      await admin.query("insert into public.rides (id, payment_status, cancellation_payment_status) values ('RIDE-CHK-OK', 'capture_failed', 'cancel_failed')");
      await admin.query("savepoint s1");
      await expect(admin.query("insert into public.rides (id, payment_status) values ('RIDE-CHK-1', 'bogus')")).rejects.toMatchObject({ code: "23514" });
      await admin.query("rollback to savepoint s1");
      await expect(
        admin.query("insert into public.rides (id, cancellation_payment_status) values ('RIDE-CHK-2', 'bogus')")
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await admin.query("rollback");
    }
  });

  test("the reconciliation failure-queue partial indexes exist", async () => {
    const rows = await q(
      "select indexname from pg_indexes where schemaname='public' and indexname in ('rides_payment_capture_failed_idx','rides_cancellation_payment_failed_idx') order by 1"
    );
    expect(rows.map((r) => r.indexname)).toEqual(["rides_cancellation_payment_failed_idx", "rides_payment_capture_failed_idx"]);
  });

  // --------------------------------------------------------- functions

  test("the three dispatch functions have the expected signatures, invoker security and search_path", async () => {
    const rows = await q(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
             p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('dispatch_ride_atomic','nearest_drivers','accept_driver_offer_atomic')
      order by p.proname`);
    expect(rows).toEqual([
      {
        proname: "accept_driver_offer_atomic",
        args: "p_offer_id text, p_driver_id text",
        result:
          "TABLE(outcome text, ride_id text, offer_id text, driver_id text, ride_status text, rider_id text, rider_phone text, ride_type text, is_review_ride boolean, driver_name text, driver_vehicle text, driver_phone text)",
        prosecdef: false,
        proconfig: ["search_path=pg_catalog, public"]
      },
      {
        proname: "dispatch_ride_atomic",
        args: "p_ride_id text, p_driver_id text, p_expires_seconds integer",
        result: "TABLE(offer_id text, outcome text)",
        prosecdef: false,
        proconfig: ["search_path=pg_catalog, public"]
      },
      {
        proname: "nearest_drivers",
        args: "p_lat double precision, p_lng double precision, p_radius_miles double precision, p_limit integer",
        result:
          "TABLE(id text, first_name text, last_name text, email text, phone text, current_lat double precision, current_lng double precision, distance_miles double precision)",
        prosecdef: false,
        proconfig: ["search_path=pg_catalog, public"]
      }
    ]);
  });

  test("EXECUTE is denied to PUBLIC, anon and authenticated and granted to service_role", async () => {
    const rows = await q(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role', p.oid, 'execute') as service_role,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('dispatch_ride_atomic','nearest_drivers','accept_driver_offer_atomic')
      order by p.proname`);
    for (const row of rows) {
      expect(row).toEqual({ proname: row.proname, anon: false, authenticated: false, service_role: true, public: false });
    }
    expect(rows).toHaveLength(3);
  });

  // ------------------------------------------------------ schema contract

  test("no current_driver_id or current_offer_id column is introduced", async () => {
    expect(
      await q(
        "select table_name, column_name from information_schema.columns where table_schema='public' and column_name in ('current_driver_id','current_offer_id')"
      )
    ).toEqual([]);
  });

  test("rides.assigned_driver_id is untouched: still uuid, index intact, value preserved", async () => {
    expect(
      await q("select data_type from information_schema.columns where table_schema='public' and table_name='rides' and column_name='assigned_driver_id'")
    ).toEqual([{ data_type: "uuid" }]);
    expect(await q("select 1 from pg_indexes where schemaname='public' and indexname='idx_rides_assigned_driver_id'")).toHaveLength(1);
    const [row] = await q("select assigned_driver_id from public.rides where id = $1", [PRE_EXISTING_RIDE.id]);
    expect(row.assigned_driver_id).toBe(PRE_EXISTING_RIDE.assigned_driver_id);
  });

  // ------------------------------------------------ single application

  test.each([
    ["20260927220000_driver_earnings_unique_ride.sql", "42P07"],
    ["20260927220100_rides_payment_capture_and_cancellation_columns.sql", "42710"]
  ])("%s is single-application: re-running it fails loudly (%s) instead of skipping", async (file, code) => {
    await admin.query("begin");
    try {
      await expect(admin.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))).rejects.toMatchObject({ code });
    } finally {
      await admin.query("rollback");
    }
  });
});
