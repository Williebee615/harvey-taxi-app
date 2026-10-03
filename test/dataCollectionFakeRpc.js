// Emulates the Data Collection SQL functions (data_collection_commit_hours,
// data_collection_set_hour_status) on test/fakeSupabase.js's tables,
// including the case-insensitive unique session index (all or nothing)
// and the audit rows they write. The real SQL is exercised by
// test/db/dataCollection.db.test.js; this only lets route tests run
// against the fake.
const crypto = require("crypto");

function installDataCollectionRpc(client) {
  const uuid = () => crypto.randomUUID();
  const fallback = client.rpc;
  client.rpc = async (name, args) => {
    const s = client._state;
    for (const t of ["data_collection_hour_records", "data_collection_import_batches", "data_collection_import_exceptions", "data_collection_audit_log"]) {
      if (!s[t]) s[t] = [];
    }
    if (name === "data_collection_commit_hours") {
      const taken = new Set(s.data_collection_hour_records.map((r) => r.external_session_id.toLowerCase()));
      for (const r of args.p_records) {
        const key = r.external_session_id.toLowerCase();
        if (taken.has(key)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        taken.add(key);
      }
      const batchId = uuid();
      s.data_collection_import_batches.push({ id: batchId, ...args.p_batch, imported_by: args.p_actor });
      const inserted = args.p_records.map((r) => ({
        id: uuid(),
        ...r,
        batch_id: batchId,
        source: args.p_batch.source,
        status: "pending",
        created_by: args.p_actor
      }));
      s.data_collection_hour_records.push(...inserted);
      for (const e of args.p_exceptions) s.data_collection_import_exceptions.push({ id: uuid(), batch_id: batchId, resolved_at: null, ...e });
      for (const x of s.data_collection_import_exceptions) {
        const hit = inserted.find((h) => h.external_session_id.toLowerCase() === String(x.external_session_id).toLowerCase());
        if (hit && x.resolved_at === null && x.batch_id !== batchId) x.resolved_at = "now";
      }
      s.data_collection_audit_log.push({
        actor: args.p_actor,
        action: args.p_batch.source === "manual_entry" ? "hours.manual_entry" : "hours.import_committed",
        entity_id: batchId,
        details: args.p_batch.audit
      });
      return { data: { batch_id: batchId, inserted: inserted.length, exceptions: args.p_exceptions.length }, error: null };
    }
    if (name === "data_collection_set_hour_status") {
      const rows = s.data_collection_hour_records.filter((r) => args.p_ids.includes(r.id));
      if (rows.length !== args.p_ids.length || rows.some((r) => r.status !== args.p_from)) {
        return { data: null, error: { code: "P0001", message: `stale_status: some records are no longer ${args.p_from}` } };
      }
      for (const r of rows) {
        r.status = args.p_to;
        if (args.p_to === "paid") Object.assign(r, { payout_reference: args.p_payout_reference, paid_at: "now" });
        if (args.p_to === "rejected") r.status_reason = args.p_reason;
      }
      s.data_collection_audit_log.push({ actor: args.p_actor, action: "hours.status_changed", details: args });
      return { data: { updated: rows.length }, error: null };
    }
    return fallback(name, args);
  };
}

module.exports = { installDataCollectionRpc };

