// driver_push_tokens migration: token format and platform checks, one row
// per token, and no access for the anon/authenticated roles.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("driver_push_tokens migration", () => {
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

  test("accepts Expo tokens; one row per token; upsert moves a token to another driver", async () => {
    await q("insert into public.driver_push_tokens (token, driver_id, platform) values ('ExponentPushToken[abcdefghij1234]', 'D1', 'ios')");
    await expect(
      q("insert into public.driver_push_tokens (token, driver_id, platform) values ('ExponentPushToken[abcdefghij1234]', 'D2', 'android')")
    ).rejects.toThrow(/driver_push_tokens_pkey/);
    await q(`insert into public.driver_push_tokens (token, driver_id, platform) values ('ExponentPushToken[abcdefghij1234]', 'D2', 'android')
             on conflict (token) do update set driver_id = excluded.driver_id, platform = excluded.platform`);
    expect(await q("select driver_id, platform from public.driver_push_tokens")).toEqual([{ driver_id: "D2", platform: "android" }]);
  });

  test("rejects malformed tokens and unknown platforms", async () => {
    await expect(q("insert into public.driver_push_tokens (token, driver_id, platform) values ('not-a-token', 'D1', 'ios')")).rejects.toThrow(/check/);
    await expect(
      q("insert into public.driver_push_tokens (token, driver_id, platform) values ('ExpoPushToken[zzzzzzzzzz99]', 'D1', 'web')")
    ).rejects.toThrow(/platform_check/);
  });

  test("row level security on, no policies, and no anon/authenticated access", async () => {
    expect((await q("select relrowsecurity from pg_class where oid = 'public.driver_push_tokens'::regclass"))[0].relrowsecurity).toBe(true);
    expect(await q("select policyname from pg_policies where tablename = 'driver_push_tokens'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      await q("begin");
      try {
        await q(`set local role ${role}`);
        await expect(q("select * from public.driver_push_tokens")).rejects.toThrow(/permission denied/);
      } finally {
        await q("rollback");
      }
    }
  });
});
