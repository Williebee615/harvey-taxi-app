// agent_model_usage migration: the model spending ledger. Costs and token
// counts can't be negative, the month is YYYY-MM, roles are limited, and
// only the server can read or write it.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("agent model usage migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  test("a turn is recorded and the month can be summed", async () => {
    await q("insert into public.agent_model_usage (usage_month, role, actor_id, model, calls, input_tokens, output_tokens, cost_usd, outcome) values ('2026-10', 'rider', 'TEST-R1', 'claude-haiku-4-5', 2, 3000, 200, 0.004, 'answered')");
    await q("insert into public.agent_model_usage (usage_month, role, model, cost_usd, outcome) values ('2026-10', 'driver', 'claude-haiku-4-5', 0.002, 'fallback_timeout')");
    expect((await q("select sum(cost_usd)::float as total from public.agent_model_usage where usage_month = '2026-10'"))[0].total).toBeCloseTo(0.006, 6);
  });

  test("rejects negative cost or tokens, bad months and unknown roles", async () => {
    const bad = [
      "insert into public.agent_model_usage (usage_month, role, model, cost_usd, outcome) values ('2026-10', 'rider', 'm', -1, 'x')",
      "insert into public.agent_model_usage (usage_month, role, model, input_tokens, outcome) values ('2026-10', 'rider', 'm', -5, 'x')",
      "insert into public.agent_model_usage (usage_month, role, model, outcome) values ('Oct 2026', 'rider', 'm', 'x')",
      "insert into public.agent_model_usage (usage_month, role, model, outcome) values ('2026-10', 'visitor', 'm', 'x')"
    ];
    for (const sql of bad) await expect(q(sql)).rejects.toThrow();
  });

  test("row level security on, no policies, and no anon/authenticated access", async () => {
    expect((await q("select relrowsecurity from pg_class where oid = 'public.agent_model_usage'::regclass"))[0].relrowsecurity).toBe(true);
    expect(await q("select policyname from pg_policies where tablename = 'agent_model_usage'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select * from public.agent_model_usage")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
    }
  });
});
