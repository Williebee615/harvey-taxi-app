// assistant_passage_embeddings: pgvector store for the assistant pilot,
// organization-scoped, version-tagged, server-only.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

const DIMS = 384;
// Unit vector along axis i, optionally tilted toward axis j.
function vec(i, j = null, tilt = 0) {
  const v = new Array(DIMS).fill(0);
  v[i] = 1;
  if (j !== null) v[j] = tilt;
  const n = Math.hypot(...v);
  return `[${v.map((x) => x / n).join(",")}]`;
}

describeDb("assistant passage embeddings", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const put = (org, id, v, model = "e5-small") =>
    q("insert into public.assistant_passage_embeddings (org, passage_id, version, source_id, embedding_model, embedding) values ($1, $2, 'v1', 'src', $3, $4)", [org, id, model, v]);
  const match = (org, v, model = "e5-small", limit = 6) => q("select * from public.match_assistant_passages($1, $2, $3, $4)", [org, model, v, limit]);

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    await put("harvey_taxi", "harvey_taxi:fares:0", vec(0));
    await put("harvey_taxi", "harvey_taxi:cancel:0", vec(1));
    await put("htaf", "htaf:apply:0", vec(0, 1, 0.1));
    await put("harvey_taxi", "harvey_taxi:fares:0", vec(2), "other-model");
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("nearest passages, by cosine similarity, within one organization and model", async () => {
    const rows = await match("harvey_taxi", vec(0, 1, 0.2));
    expect(rows.map((r) => r.passage_id)).toEqual(["harvey_taxi:fares:0", "harvey_taxi:cancel:0"]);
    expect(rows[0].similarity).toBeGreaterThan(0.9);
    expect(rows[0].version).toBe("v1");
  });

  test("never returns another organization's passages", async () => {
    const rows = await match("htaf", vec(0));
    expect(rows.map((r) => r.passage_id)).toEqual(["htaf:apply:0"]);
    await expect(put("htaf", "harvey_taxi:fares:9", vec(3))).rejects.toThrow(/check/);
  });

  test("wrong vector size and unknown organizations are refused", async () => {
    await expect(q("insert into public.assistant_passage_embeddings (org, passage_id, version, source_id, embedding_model, embedding) values ('htaf', 'htaf:x', 'v1', 's', 'm', '[1,0,0]')")).rejects.toThrow(/dimensions/);
    await expect(put("someone_else", "someone_else:x", vec(0))).rejects.toThrow(/check/);
  });

  test("limit is clamped to 1-20", async () => {
    expect(await match("harvey_taxi", vec(0), "e5-small", 0)).toHaveLength(1);
  });

  test("an HNSW cosine index exists", async () => {
    const [idx] = await q("select indexdef from pg_indexes where indexname = 'assistant_passage_embeddings_hnsw'");
    expect(idx.indexdef).toMatch(/hnsw/);
    expect(idx.indexdef).toMatch(/vector_cosine_ops/);
  });

  test("server-only", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.assistant_passage_embeddings'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.assistant_passage_embeddings', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.assistant_passage_embeddings', 'select') as auth_select,
      has_function_privilege('anon', 'public.match_assistant_passages(text, text, extensions.vector, integer)', 'execute') as anon_exec`);
    expect(g).toEqual({ anon_select: false, auth_select: false, anon_exec: false });
  });
});
