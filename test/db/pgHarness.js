// Real-Postgres harness for the dispatch migrations' database tests
// (test/db/*.db.test.js). Each test file gets its own freshly created
// database built from test/db/live-baseline.sql (a mirror of the live
// production objects) plus the real migration files under
// supabase/migrations/, applied exactly as written -- so these tests
// exercise the actual SQL that would ship, not a re-implementation.
//
// Opt-in: set HARVEY_TEST_DATABASE_URL to a Postgres server (with PostGIS
// available) that the tests may create and drop databases on, e.g.
//   HARVEY_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres
// Without it, the database suites are skipped (describeDb) so `npm test`
// still runs everywhere. CI sets it (see .github/workflows/ci.yml).
// Never point it at a Supabase project.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const ADMIN_URL = process.env.HARVEY_TEST_DATABASE_URL || "";

const describeDb = ADMIN_URL ? describe : describe.skip;

const ROOT = path.join(__dirname, "..", "..");

const MIGRATIONS = [
  "supabase/migrations/20260927220300_dispatch_functions_hardening.sql",
  "supabase/migrations/20260927220400_accept_driver_offer_atomic.sql"
];

function withDatabase(url, dbName) {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function adminQuery(sql) {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

// Creates an isolated database, applies the live baseline and then each
// migration in its own transaction (as `supabase db push` does).
async function createTestDatabase() {
  const dbName = `harvey_dispatch_${crypto.randomBytes(4).toString("hex")}`;
  await adminQuery(`create database ${dbName}`);
  const url = withDatabase(ADMIN_URL, dbName);

  const setup = new Client({ connectionString: url });
  await setup.connect();
  try {
    await setup.query(fs.readFileSync(path.join(__dirname, "live-baseline.sql"), "utf8"));
    for (const file of MIGRATIONS) {
      await setup.query("begin");
      await setup.query(fs.readFileSync(path.join(ROOT, file), "utf8"));
      await setup.query("commit");
    }
  } finally {
    await setup.end();
  }

  const clients = [];

  // A new session, optionally running as a given role (SET ROLE), the way
  // PostgREST runs a request as anon/authenticated/service_role.
  async function connect(role = null) {
    const client = new Client({ connectionString: url });
    await client.connect();
    if (role) await client.query(`set role ${role}`);
    clients.push(client);
    return client;
  }

  async function drop() {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
    await adminQuery(`drop database if exists ${dbName} with (force)`);
  }

  return { dbName, url, connect, drop };
}

// Resolves once `count` other sessions are blocked waiting on a lock, so a
// test can release a gate knowing every contender is genuinely queued on
// it (a true race, not two calls that happened to run one after another).
async function waitForLockWaiters(client, count, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await client.query(
      `select count(*)::int as n
         from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'`
    );
    if (rows[0].n >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${count} lock waiter(s); saw ${rows[0].n}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

module.exports = { describeDb, createTestDatabase, waitForLockWaiters };
