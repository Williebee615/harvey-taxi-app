// A small, purpose-built in-memory stand-in for the @supabase/supabase-js
// client, used only by the Google Play reviewer-account
// composition/integration tests (see
// server.review-accounts.test.js). It supports exactly the query-builder
// surface those routes/middleware actually call (select/eq/neq/in/gte/
// order/limit/single/maybeSingle/insert/update/upsert, plus a no-op rpc)
// against a handful of in-memory tables -- it is deliberately not a
// general-purpose Supabase mock, and does not model RLS, joins, or
// Postgres error codes beyond a generic "not found" for .single().
//
// Every builder stage is thenable (see `then` below) so `await` works
// whether or not the caller ever adds .single()/.maybeSingle(), matching
// real supabase-js's own thenable query builder.

function createFakeSupabase(seed = {}) {
  const state = {};

  for (const table of Object.keys(seed)) {
    state[table] = seed[table].map((row) => ({ ...row }));
  }

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every((f) => f(row)));
  }

  function makeBuilder(table) {
    const filters = [];
    let pendingInsertRows = null;
    let pendingUpdatePatch = null;
    let isUpsert = false;
    let wantSingle = false;
    let wantMaybeSingle = false;

    async function exec() {
      const rows = ensureTable(table);

      if (pendingInsertRows) {
        const keyField = table === "system_flags" ? "key" : "id";

        const inserted = pendingInsertRows.map((record) => {
          const clean = { ...record };

          if (isUpsert) {
            const idx = rows.findIndex((r) => r[keyField] === clean[keyField]);
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...clean };
              return rows[idx];
            }
          }

          rows.push(clean);
          return clean;
        });

        if (wantSingle || wantMaybeSingle) {
          return { data: inserted[0] || null, error: null };
        }

        return { data: inserted, error: null };
      }

      if (pendingUpdatePatch) {
        const matched = applyFilters(rows, filters);
        matched.forEach((row) => Object.assign(row, pendingUpdatePatch));

        if (wantSingle || wantMaybeSingle) {
          return { data: matched[0] || null, error: null };
        }

        return { data: matched, error: null };
      }

      const matched = applyFilters(rows, filters);

      if (wantSingle) {
        return matched.length
          ? { data: matched[0], error: null }
          : { data: null, error: { message: `No row found in ${table}.` } };
      }

      if (wantMaybeSingle) {
        return { data: matched[0] || null, error: null };
      }

      return { data: matched, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      neq(col, val) {
        filters.push((row) => row[col] !== val);
        return builder;
      },
      in(col, arr) {
        filters.push((row) => arr.includes(row[col]));
        return builder;
      },
      gte(col, val) {
        filters.push((row) => row[col] >= val);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      insert(record) {
        pendingInsertRows = Array.isArray(record) ? record : [record];
        return builder;
      },
      update(patch) {
        pendingUpdatePatch = patch;
        return builder;
      },
      upsert(record) {
        isUpsert = true;
        pendingInsertRows = Array.isArray(record) ? record : [record];
        return builder;
      },
      single() {
        wantSingle = true;
        return exec();
      },
      maybeSingle() {
        wantMaybeSingle = true;
        return exec();
      },
      then(resolve, reject) {
        return exec().then(resolve, reject);
      },
      catch(reject) {
        return exec().catch(reject);
      }
    };

    return builder;
  }

  return {
    from: (table) => makeBuilder(table),
    rpc: async () => ({ data: null, error: null }),
    _state: state
  };
}

module.exports = { createFakeSupabase };
