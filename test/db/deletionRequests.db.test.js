// deletion_requests migration against the production-mirror baseline:
// the shape server.js writes, the allowed statuses, one open request
// per account, and no access for the anon/authenticated roles.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("deletion_requests migration", () => {
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

  beforeEach(async () => {
    await q("delete from public.deletion_requests");
  });

  test("accepts the rows server.js writes for each flow", async () => {
    await q(`insert into public.deletion_requests
      (request_id, user_type, user_id, status, reason, requested_at, completed_at, reviewed_by)
      values ('DEL-R1', 'rider', 'RIDER-1', 'completed', null, now(), now(), 'self_service')`);
    await q(`insert into public.deletion_requests
      (request_id, user_type, user_id, status, reason, requested_at)
      values ('DEL-D1', 'driver', 'DRIVER-1', 'pending', 'moving', now())`);
    await q(`insert into public.deletion_requests
      (request_id, user_type, user_id, status, requested_at, completed_at, reviewed_by)
      values ('DEL-S1', 'rider', 'RIDER-REVIEW', 'review_simulated', now(), now(), 'app_review_simulation'),
             ('DEL-S2', 'rider', 'RIDER-REVIEW', 'review_simulated', now(), now(), 'app_review_simulation')`);
    await q(`update public.deletion_requests
      set status = 'completed', approved_at = now(), completed_at = now(), reviewed_by = 'admin@example.test', admin_notes = 'ok'
      where request_id = 'DEL-D1'`);
    const rows = await q("select request_id, status from public.deletion_requests order by request_id");
    expect(rows).toEqual([
      { request_id: "DEL-D1", status: "completed" },
      { request_id: "DEL-R1", status: "completed" },
      { request_id: "DEL-S1", status: "review_simulated" },
      { request_id: "DEL-S2", status: "review_simulated" }
    ]);
  });

  test("rejects unknown statuses and user types", async () => {
    await expect(q(`insert into public.deletion_requests (request_id, user_type, user_id, status)
      values ('X1', 'rider', 'R', 'deleted')`)).rejects.toThrow(/deletion_requests_status_check/);
    await expect(q(`insert into public.deletion_requests (request_id, user_type, user_id)
      values ('X2', 'admin', 'A')`)).rejects.toThrow(/deletion_requests_user_type_check/);
  });

  test("allows only one pending request per account", async () => {
    await q(`insert into public.deletion_requests (request_id, user_type, user_id) values ('P1', 'driver', 'D1')`);
    await expect(q(`insert into public.deletion_requests (request_id, user_type, user_id) values ('P2', 'driver', 'D1')`))
      .rejects.toThrow(/deletion_requests_one_pending_per_user/);
    await q(`update public.deletion_requests set status = 'rejected' where request_id = 'P1'`);
    await q(`insert into public.deletion_requests (request_id, user_type, user_id) values ('P3', 'driver', 'D1')`);
  });

  test("row level security is on with no policies", async () => {
    const [table] = await q(
      "select relrowsecurity from pg_class where oid = 'public.deletion_requests'::regclass"
    );
    expect(table.relrowsecurity).toBe(true);
    const policies = await q("select policyname from pg_policies where tablename = 'deletion_requests'");
    expect(policies).toEqual([]);
  });

  test("anon and authenticated can neither read nor write it", async () => {
    await q(`insert into public.deletion_requests (request_id, user_type, user_id) values ('V1', 'rider', 'R9')`);
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        let visible;
        try {
          visible = (await q("select count(*)::int as n from public.deletion_requests"))[0].n;
        } catch (err) {
          visible = 0; // no table privilege at all is also acceptable
        }
        expect(visible).toBe(0);
      } finally {
        await q("rollback");
      }
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(
          q(`insert into public.deletion_requests (request_id, user_type, user_id) values ('W-${role}', 'rider', 'R1')`)
        ).rejects.toThrow();
      } finally {
        await q("rollback");
      }
    }
  });
});
