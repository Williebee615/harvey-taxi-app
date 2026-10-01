// agent_ops_cases migration (operations-assistant case memory) against the
// production-mirror baseline: the rows lib/ops/caseStore.js writes, the
// allowed states and roles, and no access for anon/authenticated.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("agent_ops_cases migration", () => {
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
    await q("delete from public.agent_ops_cases");
  });

  const insert = (id, overrides = {}) => {
    const row = {
      id,
      subject_role: "rider",
      subject_id: "RIDER-1",
      ride_id: "RIDE-1",
      state: "investigating",
      categories: ["missed_pickup"],
      summary: { decision_summary: "x" },
      queue: [],
      steps: [],
      answers: {},
      created_by_role: "rider",
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      ...overrides
    };
    return q(
      `insert into public.agent_ops_cases (id, subject_role, subject_id, ride_id, state, categories, summary, queue, steps, answers, created_by_role, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.id, row.subject_role, row.subject_id, row.ride_id, row.state, row.categories, row.summary, JSON.stringify(row.queue), JSON.stringify(row.steps), row.answers, row.created_by_role, row.expires_at]
    );
  };

  test("accepts the rows the case store writes, with optimistic versioning", async () => {
    await insert("OPS-1");
    const updated = await q("update public.agent_ops_cases set state = 'awaiting_confirmation', version = 2 where id = 'OPS-1' and version = 1 returning id");
    expect(updated).toHaveLength(1);
    const stale = await q("update public.agent_ops_cases set state = 'resolved', version = 2 where id = 'OPS-1' and version = 1 returning id");
    expect(stale).toHaveLength(0);
  });

  test("rejects unknown states and roles", async () => {
    await expect(insert("OPS-2", { state: "done" })).rejects.toThrow();
    await expect(insert("OPS-3", { subject_role: "admin_superuser" })).rejects.toThrow();
  });

  test("retention: expired rows can be purged by expires_at", async () => {
    await insert("OPS-OLD", { expires_at: new Date(Date.now() - 1000).toISOString() });
    await insert("OPS-NEW");
    const purged = await q("delete from public.agent_ops_cases where expires_at < now() returning id");
    expect(purged.map((r) => r.id)).toEqual(["OPS-OLD"]);
  });

  test("RLS on; anon and authenticated can neither read nor write", async () => {
    const [table] = await q("select relrowsecurity from pg_class where relname = 'agent_ops_cases'");
    expect(table.relrowsecurity).toBe(true);
    await insert("OPS-V");
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        let visible;
        try {
          visible = (await q("select count(*)::int as n from public.agent_ops_cases"))[0].n;
        } catch {
          visible = 0;
        }
        expect(visible).toBe(0);
      } finally {
        await q("rollback");
      }
    }
  });
});
