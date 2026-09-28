// A small, purpose-built in-memory stand-in for the @supabase/supabase-js
// client, used only by the Google Play reviewer-account
// composition/integration tests (see
// server.review-accounts.test.js). It supports exactly the query-builder
// surface those routes/middleware actually call (select/eq/neq/in/gte/
// order/limit/single/maybeSingle/insert/update/upsert, plus a no-op rpc;
// is/gt/lt/lte were added for the driver-offer dispatch tests)
// against a handful of in-memory tables -- it is deliberately not a
// general-purpose Supabase mock, and does not model RLS, joins, or
// Postgres error codes beyond a generic "not found" for .single().
//
// Every builder stage is thenable (see `then` below) so `await` works
// whether or not the caller ever adds .single()/.maybeSingle(), matching
// real supabase-js's own thenable query builder.
//
// Optional `options` (used by the driver-offer dispatch tests, see
// server.driver-offer-dispatch.test.js; every option defaults off so
// existing callers are unaffected):
//   - columns: { [table]: string[] } -- an update/insert that writes, or a
//     select that reads, a column not in the list fails the way PostgREST
//     does (PGRST204 / 42703) instead of silently succeeding, so a column
//     the real schema does not have is caught in tests.
//   - failUpdate: (table, patch) => error|null -- inject a failure for a
//     specific update.
//   - failSelect: (table) => error|null -- inject a failure for a read.
// `_log` records every executed operation as { table, op, patch }.

// `options.uniqueColumns`, e.g. { driver_earnings: ["ride_id"], rides:
// ["quote_jti"] }, simulates a real UNIQUE constraint on plain insert()
// (not upsert(), which already has its own conflict-handling path
// below): a second insert whose value for that column matches an
// existing row returns a Postgres-shaped 23505 (unique_violation) error
// instead of silently succeeding, the same way the real database would.
// A null/undefined value never collides, matching real UNIQUE semantics
// (and how the corresponding production constraints are declared as
// partial/nullable-aware indexes). Optional and additive -- omitting it
// keeps every existing test's behavior unchanged.
function createFakeSupabase(seed = {}, options = {}) {
  const uniqueColumns = options.uniqueColumns || {};
  const state = {};
  const log = [];
  const columns = options.columns || {};

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
    let selectedColumns = null;

    function unknownColumnError(record) {
      const allowed = columns[table];
      if (!allowed) return null;
      const bad = Object.keys(record).find((col) => !allowed.includes(col));
      if (!bad) return null;
      return {
        code: "PGRST204",
        message: `Could not find the '${bad}' column of '${table}' in the schema cache`
      };
    }

    async function exec() {
      const rows = ensureTable(table);
      const op = pendingInsertRows ? "insert" : pendingUpdatePatch ? "update" : "select";
      log.push({ table, op, patch: pendingUpdatePatch });

      if (pendingInsertRows) {
        const insertError = pendingInsertRows.map(unknownColumnError).find(Boolean);
        if (insertError) return { data: null, error: insertError };
      }

      if (pendingUpdatePatch) {
        const updateError =
          unknownColumnError(pendingUpdatePatch) ||
          (options.failUpdate && options.failUpdate(table, pendingUpdatePatch)) ||
          null;
        if (updateError) return { data: null, error: updateError };
      }

      if (selectedColumns && columns[table]) {
        const bad = selectedColumns.find((col) => !columns[table].includes(col));
        if (bad) {
          return {
            data: null,
            error: { code: "42703", message: `column ${table}.${bad} does not exist` }
          };
        }
      }

      if (op === "select" && options.failSelect) {
        const selectError = options.failSelect(table);
        if (selectError) return { data: null, error: selectError };
      }

      if (pendingInsertRows) {
        const keyField = table === "system_flags" ? "key" : "id";

        if (!isUpsert) {
          const uniqueCols = uniqueColumns[table] || [];

          for (const record of pendingInsertRows) {
            for (const col of uniqueCols) {
              const val = record[col];

              if (val === null || val === undefined) {
                continue;
              }

              const conflict = rows.find((r) => r[col] === val);

              if (conflict) {
                return {
                  data: null,
                  error: {
                    code: "23505",
                    message: `duplicate key value violates unique constraint "fake_${table}_${col}_unique"`,
                    details: `Key (${col})=(${val}) already exists.`
                  }
                };
              }
            }
          }
        }

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
      select(cols) {
        if (typeof cols === "string" && cols.trim() !== "*") {
          selectedColumns = cols
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c && c !== "*" && !c.includes("("));
        }
        return builder;
      },
      is(col, val) {
        filters.push((row) => (row[col] === undefined ? null : row[col]) === val);
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
      gt(col, val) {
        filters.push((row) => row[col] > val);
        return builder;
      },
      lt(col, val) {
        filters.push((row) => row[col] < val);
        return builder;
      },
      lte(col, val) {
        filters.push((row) => row[col] <= val);
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
    // dispatch_ride_atomic gets a distinct default: the fake has no real
    // implementation of its atomic offer-creation/eligibility-recheck
    // logic, so reporting it as errored (not merely "no data") is the
    // honest default -- it makes dispatchRide() correctly exercise its
    // two-step fallback path in any test that doesn't specifically care
    // about the RPC's own behavior, the same way a genuinely
    // missing/erroring RPC would in production. Tests that DO care about
    // dispatch_ride_atomic's behavior (candidate loop, eligibility
    // decline, etc.) override this per-test by reassigning
    // mockSupabaseClient.rpc directly.
    rpc: async (name) => {
      if (name === "dispatch_ride_atomic") {
        return {
          data: null,
          error: { message: "dispatch_ride_atomic is not implemented in the test fake" }
        };
      }

      return { data: null, error: null };
    },
    _state: state,
    _log: log
  };
}

module.exports = { createFakeSupabase };
