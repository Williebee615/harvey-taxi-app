// Data Collection program migration against the production-mirror
// baseline: server-only access (RLS on, no client privileges), the
// integer-cent amount checks, duplicate-session rejection, the atomic
// commit/status functions with their audit entries, and the append-only
// audit log.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

const TABLES = [
  "data_collection_applications",
  "data_collection_agreements",
  "data_collection_equipment",
  "data_collection_import_batches",
  "data_collection_hour_records",
  "data_collection_import_exceptions",
  "data_collection_audit_log"
];

describeDb("data collection program migration", () => {
  let db;
  let admin;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  // The audit log is append-only (truncate is blocked too), so each test
  // uses its own driver ids instead of wiping tables.
  let seq = 0;
  async function approvedApplication(contributor = null) {
    seq += 1;
    const driverId = `DC-DRIVER-${seq}`;
    const [row] = await q(
      `insert into public.data_collection_applications
         (driver_id, status, phone_model, country, proposed_location, location_state, proposed_tasks,
          ineligible_tasks_acknowledged, minute_contributor_id)
       values ($1, 'approved', 'iPhone 15', 'US', 'Corner store, Nashville', 'TN', '["Restocking shelves"]', true, $2)
       returning id, driver_id`,
      [driverId, contributor]
    );
    return row;
  }

  function record(app, sessionId, seconds, overrides = {}) {
    const driver = Math.floor((seconds * 1000 + 1800) / 3600);
    const company = Math.floor((seconds * 1500 + 1800) / 3600);
    return {
      driver_id: app.driver_id,
      application_id: app.id,
      external_session_id: sessionId,
      session_date: "2026-09-30",
      duration_seconds: seconds,
      driver_rate_cents: 1000,
      company_rate_cents: 1500,
      driver_amount_cents: driver,
      company_amount_cents: company,
      ...overrides
    };
  }

  const commit = (records, exceptions = [], batch = {}) =>
    q("select public.data_collection_commit_hours($1, $2, $3, $4) as r", [
      JSON.stringify({ source: "manual_entry", row_count: records.length, ...batch }),
      JSON.stringify(records),
      JSON.stringify(exceptions),
      "admin@example.test"
    ]);

  test("every table has row level security on and no policies", async () => {
    for (const table of TABLES) {
      const [row] = await q(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
      expect([table, row.relrowsecurity]).toEqual([table, true]);
    }
    const policies = await q("select tablename from pg_policies where tablename like 'data_collection_%'");
    expect(policies).toEqual([]);
  });

  test("anon and authenticated can neither read nor write any table, nor call the functions", async () => {
    await approvedApplication();
    for (const role of ["anon", "authenticated"]) {
      for (const table of TABLES) {
        await q("begin");
        try {
          await q(`set local role ${role}`);
          await expect(q(`select count(*) from public.${table}`)).rejects.toThrow(/permission denied/);
        } finally {
          await q("rollback");
        }
      }
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(
          q(`insert into public.data_collection_applications
               (driver_id, phone_model, country, proposed_location, location_state, proposed_tasks, ineligible_tasks_acknowledged)
             values ('X', 'p', 'US', 'l', 'TN', '["t"]', true)`)
        ).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
      for (const fn of [
        "select public.data_collection_commit_hours('{}', '[]', '[]', 'x')",
        "select public.data_collection_set_hour_status(array[gen_random_uuid()], 'pending', 'accepted', 'x')"
      ]) {
        await q("begin");
        try {
          await q(`set local role ${role}`);
          await expect(q(fn)).rejects.toThrow(/permission denied/);
        } finally {
          await q("rollback");
        }
      }
    }
  });

  test("applications: U.S. only, acknowledgement required, one open application per driver", async () => {
    const base = `insert into public.data_collection_applications
      (driver_id, phone_model, country, proposed_location, location_state, proposed_tasks, ineligible_tasks_acknowledged)`;
    await expect(q(`${base} values ('A1', 'p', 'CA', 'l', 'TN', '["t"]', true)`)).rejects.toThrow(/country_check/);
    await expect(q(`${base} values ('A1', 'p', 'US', 'l', 'TN', '["t"]', false)`)).rejects.toThrow(/ineligible_tasks_acknowledge/);
    await q(`${base} values ('A1', 'p', 'US', 'l', 'TN', '["t"]', true)`);
    await expect(q(`${base} values ('A1', 'p', 'US', 'l', 'TN', '["t"]', true)`)).rejects.toThrow(/one_active_per_driver/);
    await q("update public.data_collection_applications set status = 'rejected', status_reason = 'no' where driver_id = 'A1'");
    await q(`${base} values ('A1', 'p', 'US', 'l', 'TN', '["t"]', true)`);
  });

  test("a contributor id links to one application at most (case-insensitive)", async () => {
    await approvedApplication("Contrib-One");
    await expect(approvedApplication("contrib-one")).rejects.toThrow(/contributor_unique/);
  });

  test("commit saves batch, records and audit entry together", async () => {
    const app = await approvedApplication();
    const [{ r }] = await commit([record(app, "S-COMMIT-1", 5400), record(app, "S-COMMIT-2", 61)]);
    expect(r.inserted).toBe(2);
    const rows = await q(
      "select status, driver_amount_cents, company_amount_cents, margin_cents from public.data_collection_hour_records where batch_id = $1 order by duration_seconds",
      [r.batch_id]
    );
    // 61 s: 1000 x 61 / 3600 = 16.94 -> 17; 1500 x 61 / 3600 = 25.42 -> 25.
    expect(rows).toEqual([
      { status: "pending", driver_amount_cents: 17, company_amount_cents: 25, margin_cents: 8 },
      { status: "pending", driver_amount_cents: 1500, company_amount_cents: 2250, margin_cents: 750 }
    ]);
    const audit = await q("select action, entity_id from public.data_collection_audit_log where entity_id = $1", [r.batch_id]);
    expect(audit).toEqual([{ action: "hours.manual_entry", entity_id: r.batch_id }]);
  });

  test("an amount that does not match seconds x rate is rejected", async () => {
    const app = await approvedApplication();
    await expect(commit([record(app, "S-BAD-AMT", 3600, { driver_amount_cents: 1001 })])).rejects.toThrow(/check/);
  });

  test("a duplicate session (any case) aborts the whole commit, leaving nothing behind", async () => {
    const app = await approvedApplication();
    await commit([record(app, "S-DUP-1", 600)]);
    const [{ n: batchesBefore }] = await q("select count(*)::int as n from public.data_collection_import_batches");
    await expect(commit([record(app, "S-DUP-NEW", 600), record(app, "s-dup-1", 600)])).rejects.toThrow(
      /data_collection_hour_records_session_unique/
    );
    const [{ n: batchesAfter }] = await q("select count(*)::int as n from public.data_collection_import_batches");
    expect(batchesAfter).toBe(batchesBefore);
    expect(await q("select 1 from public.data_collection_hour_records where external_session_id = 'S-DUP-NEW'")).toEqual([]);
  });

  test("a later commit resolves an earlier unmatched-contributor exception for the same session", async () => {
    const app = await approvedApplication();
    const [{ r: first }] = await commit(
      [],
      [{ row_number: 2, reason: "unmatched_contributor", external_contributor_id: "C-X", external_session_id: "S-LATE", session_date: "2026-09-30", duration_seconds: 900 }],
      { source: "minute_import", filename: "a.csv", file_sha256: "aaa" }
    );
    expect(first.exceptions).toBe(1);
    await commit([record(app, "s-late", 900)]);
    const [exc] = await q("select resolved_at is not null as resolved, resolved_hour_record_id is not null as linked from public.data_collection_import_exceptions where batch_id = $1", [first.batch_id]);
    expect(exc).toEqual({ resolved: true, linked: true });
  });

  test("status changes follow the allowed transitions, all or nothing, with an audit entry", async () => {
    const app = await approvedApplication();
    const [{ r }] = await commit([record(app, "S-ST-1", 3600), record(app, "S-ST-2", 1800)]);
    const ids = (await q("select id from public.data_collection_hour_records where batch_id = $1 order by external_session_id", [r.batch_id])).map((x) => x.id);
    const setStatus = (from, to, reason = null, ref = null, list = ids) =>
      q("select public.data_collection_set_hour_status($1::uuid[], $2, $3, 'admin@example.test', $4, $5) as r", [list, from, to, reason, ref]);

    await expect(setStatus("pending", "paid")).rejects.toThrow(/invalid hour status transition/);
    await setStatus("pending", "accepted", null, null, [ids[0]]);
    // ids[1] is still pending, so moving both from accepted changes nothing.
    await expect(setStatus("accepted", "payable")).rejects.toThrow(/stale_status/);
    expect((await q("select status from public.data_collection_hour_records where id = $1", [ids[0]]))[0].status).toBe("accepted");

    await setStatus("accepted", "payable", null, null, [ids[0]]);
    await expect(setStatus("payable", "paid", null, null, [ids[0]])).rejects.toThrow(/check/);
    await setStatus("payable", "paid", null, "ACH-2026-10-01", [ids[0]]);
    const [paid] = await q("select status, payout_reference, paid_at is not null as has_paid_at from public.data_collection_hour_records where id = $1", [ids[0]]);
    expect(paid).toEqual({ status: "paid", payout_reference: "ACH-2026-10-01", has_paid_at: true });

    await expect(setStatus("pending", "rejected", null, null, [ids[1]])).rejects.toThrow(/check/);
    await setStatus("pending", "rejected", "Not an eligible task", null, [ids[1]]);

    const audit = await q("select details->>'from' as f, details->>'to' as t from public.data_collection_audit_log where action = 'hours.status_changed' order by id");
    expect(audit.slice(-4)).toEqual([
      { f: "pending", t: "accepted" },
      { f: "accepted", t: "payable" },
      { f: "payable", t: "paid" },
      { f: "pending", t: "rejected" }
    ]);
  });

  test("the audit log is append-only", async () => {
    await q("insert into public.data_collection_audit_log (actor, action, entity_type) values ('a', 'test', 'x')");
    await expect(q("update public.data_collection_audit_log set action = 'changed'")).rejects.toThrow(/append-only/);
    await expect(q("delete from public.data_collection_audit_log")).rejects.toThrow(/append-only/);
    await expect(q("truncate public.data_collection_audit_log")).rejects.toThrow(/append-only/);
  });

  test("ride earnings are untouched: no data collection column or trigger on driver_earnings", async () => {
    const cols = await q("select column_name from information_schema.columns where table_name = 'driver_earnings' and column_name like '%collection%'");
    expect(cols).toEqual([]);
    const triggers = await q("select tgname from pg_trigger where tgrelid = 'public.driver_earnings'::regclass and not tgisinternal");
    expect(triggers).toEqual([]);
  });
});

describeDb("data collection rollback script", () => {
  test("removes every program object and nothing else", async () => {
    const fs = require("fs");
    const path = require("path");
    const db = await createTestDatabase();
    try {
      const c = await db.connect();
      await c.query("insert into public.data_collection_audit_log (actor, action, entity_type) values ('a', 'b', 'c')");
      await c.query(
        fs.readFileSync(path.join(__dirname, "..", "..", "docs", "data-collection", "rollback-20261003120000_add_data_collection_program.sql"), "utf8")
      );
      const left = await c.query("select relname from pg_class where relname like 'data_collection%'");
      const fns = await c.query("select proname from pg_proc where proname like 'data_collection%'");
      expect(left.rows).toEqual([]);
      expect(fns.rows).toEqual([]);
      const kept = await c.query("select to_regclass('public.driver_earnings') is not null as e, to_regclass('public.drivers') is not null as d");
      expect(kept.rows[0]).toEqual({ e: true, d: true });
    } finally {
      await db.drop();
    }
  });
});
