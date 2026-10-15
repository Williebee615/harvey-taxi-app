#!/usr/bin/env node
// Fills the pgvector store (assistant_passage_embeddings) from the REAL
// published pages, embedded by the membrane. Dry run by default: prints
// what would change and writes nothing. --apply writes, and needs the
// migration 20261015020000 applied and owner approval.
//
//   MEMBRANE_BASE_URL=... MEMBRANE_EMBED_MODEL=... SUPABASE_URL=... \
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/assistant-vector-sync.js [--apply]
//
// Only approved public passages are embedded. Unchanged passages (same
// version) are skipped; rows for passages no longer published are removed
// from the index (index rows only; no source record is touched).

const { buildOrgCorpus, loadPublishedSections } = require("../lib/assistantPilot/corpus");
const { readMembraneConfig, describeMembraneConfig } = require("../lib/membrane/config");
const { createMembraneEmbedder } = require("../lib/membrane/embeddings");

const APPLY = process.argv.includes("--apply");

(async () => {
  const config = readMembraneConfig();
  const embedder = createMembraneEmbedder(config);
  if (!embedder) throw new Error(`membrane not usable: ${describeMembraneConfig(config).problem}`);
  if (config.dims !== 384) throw new Error("the pgvector store holds 384-dimension vectors; this model needs a new migration");
  // eslint-disable-next-line global-require
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const org of ["harvey_taxi", "htaf"]) {
    const corpus = buildOrgCorpus(org, { sections: loadPublishedSections(org) });
    const { data: existing, error } = await db.from("assistant_passage_embeddings").select("passage_id, version").eq("org", org).eq("embedding_model", embedder.model);
    if (error) throw new Error(`read failed: ${error.code}`);
    const have = new Map((existing || []).map((r) => [r.passage_id, r.version]));
    const changed = corpus.passages.filter((p) => have.get(p.id) !== p.version);
    const live = new Set(corpus.passages.map((p) => p.id));
    const gone = [...have.keys()].filter((id) => !live.has(id));
    console.log(`${org}: ${corpus.passages.length} passages, ${changed.length} to embed, ${gone.length} to remove${APPLY ? "" : " (dry run)"}`);
    if (!APPLY) continue;
    const vectors = changed.length ? await embedder.embed(changed.map((p) => `${p.title}. ${p.heading}\n${p.text}`), { kind: "passage" }) : [];
    if (changed.length) {
      const rows = changed.map((p, i) => ({ org, passage_id: p.id, version: p.version, source_id: p.source_id, embedding_model: embedder.model, embedding: `[${Array.from(vectors[i]).join(",")}]`, updated_at: new Date().toISOString() }));
      const { error: upErr } = await db.from("assistant_passage_embeddings").upsert(rows, { onConflict: "org,embedding_model,passage_id" });
      if (upErr) throw new Error(`upsert failed: ${upErr.code}`);
    }
    if (gone.length) {
      const { error: delErr } = await db.from("assistant_passage_embeddings").delete().eq("org", org).eq("embedding_model", embedder.model).in("passage_id", gone);
      if (delErr) throw new Error(`remove failed: ${delErr.code}`);
    }
  }
})().catch((err) => {
  console.error("sync failed:", err.message);
  process.exit(1);
});
