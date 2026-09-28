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
// still runs in local environments that have no Postgres.
//
// CI must never skip: the db-functions job sets HARVEY_REQUIRE_DB_TESTS=1,
// which turns a missing URL into a hard failure, and any setup problem
// (unreachable server, PostGIS missing, a migration that doesn't apply)
// fails the suite in beforeAll. Never point it at a Supabase project.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const ADMIN_URL = process.env.HARVEY_TEST_DATABASE_URL || "";

const DB_TESTS_REQUIRED = process.env.HARVEY_REQUIRE_DB_TESTS === "1";

if (DB_TESTS_REQUIRED && !ADMIN_URL) {
  throw new Error(
    "HARVEY_REQUIRE_DB_TESTS=1 but HARVEY_TEST_DATABASE_URL is not set: the database tests must run, not skip."
  );
}

const describeDb = ADMIN_URL ? describe : describe.skip;

const ROOT = path.join(__dirname, "..", "..");

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// Every PR #130 migration: all files at or after the first one this PR
// added, applied exactly once each, in filename (= timestamp) order. Files
// before this cutoff are already applied in production and are represented
// by test/db/live-baseline.sql instead.
const PR130_FIRST_MIGRATION = "20260927220000";

function pr130Migrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= PR130_FIRST_MIGRATION)
    .sort();
}

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

// Creates an isolated database, applies the live baseline, optionally runs
// `seedBeforeMigrations` (synthetic rows only), then applies each PR #130
// migration exactly once, in its own transaction (as `supabase db push`
// does). Any SQL error -- a missing table/column/function/type/index/
// extension, a constraint conflict, a permission or signature problem --
// aborts setup with the failing file named, which fails the suite.
async function createTestDatabase({ seedBeforeMigrations = null } = {}) {
  const dbName = `harvey_dispatch_${crypto.randomBytes(4).toString("hex")}`;
  await adminQuery(`create database ${dbName}`);
  const url = withDatabase(ADMIN_URL, dbName);

  const appliedMigrations = [];
  let baselineRowsAtLoad = null;

  const setup = new Client({ connectionString: url });
  await setup.connect();
  try {
    await setup.query(fs.readFileSync(path.join(__dirname, "live-baseline.sql"), "utf8"));

    const { rows: baselineRowCounts } = await setup.query(`
      select 'drivers' as t, count(*)::int as n from public.drivers
      union all select 'rides', count(*)::int from public.rides
      union all select 'driver_offers', count(*)::int from public.driver_offers
      union all select 'driver_earnings', count(*)::int from public.driver_earnings`);
    baselineRowsAtLoad = Object.fromEntries(baselineRowCounts.map((r) => [r.t, r.n]));

    if (seedBeforeMigrations) await setup.query(seedBeforeMigrations);

    for (const file of pr130Migrations()) {
      await setup.query("begin");
      try {
        await setup.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (err) {
        await setup.query("rollback");
        throw new Error(`migration ${file} failed: ${err.code || ""} ${err.message}`);
      }
      await setup.query("commit");
      appliedMigrations.push(file);
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

  return { dbName, url, connect, drop, appliedMigrations, baselineRowsAtLoad };
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

module.exports = { describeDb, createTestDatabase, waitForLockWaiters, pr130Migrations, MIGRATIONS_DIR };
