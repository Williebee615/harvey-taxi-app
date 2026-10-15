// LoRA/QLoRA dataset builder: published pages only, reproducible, every
// target answer passes the production citation checker, held-out sources
// never leak into training.

const { build } = require("../scripts/membrane-build-dataset");
const { checkAnswer } = require("../lib/assistantPilot/citations");

const sourcesFrom = (content) => [...content.matchAll(/<source id="S(\d+)" title="([^"]*)" section="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ title: m[2], heading: m[3], text: m[4], url: "" }));

test("reproducible, checker-clean, no held-out source in training, no personal-record fields", () => {
  const a = build();
  const b = build();
  expect(JSON.stringify(a.train)).toBe(JSON.stringify(b.train));
  expect(a.train.length).toBeGreaterThan(50);
  expect(a.evalSet.length).toBeGreaterThan(10);
  for (const ex of [...a.train, ...a.evalSet]) {
    const [system, user, assistant] = ex.messages;
    expect(system.role).toBe("system");
    expect(checkAnswer(assistant.content, sourcesFrom(user.content)).ok).toBe(true);
  }
  const heldOut = new Set(Object.values(a.manifest.orgs).flatMap((m) => m.held_out_sources));
  expect(heldOut.size).toBeGreaterThan(0);
  const leaked = a.train.filter((ex) => ex.meta.source_ids.some((id) => heldOut.has(id)));
  expect(leaked).toEqual([]);
  for (const ex of [...a.train, ...a.evalSet]) expect(ex.meta.passage_ids.every((id) => id.startsWith(`${ex.meta.org}:`))).toBe(true);
  expect(JSON.stringify(a)).not.toMatch(/application_code|drivers_license_number|payment_method|@example\.test/);
});
