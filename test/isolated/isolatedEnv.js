// Isolated end-to-end environment for the card-payment flow.
//
// Builds a throwaway local Postgres database from production's schema
// (test/isolated/production-schema.sql -- schema only, no production
// rows), seeds synthetic riders and test drivers, and serves it through
// PostgREST (the REST layer Supabase runs) behind a /rest/v1 prefix, so
// the unmodified server and supabase-js talk to a real database with
// production's constraints and dispatch functions.
//
// Safety rails (enforced, not advisory):
//   - The database server must be local (localhost / 127.0.0.1 / ::1).
//     A Supabase or any other remote host is refused.
//   - Every database this creates is named harvey_isolated_* and dropped
//     on teardown.
//   - SMS, email, web push, identity, background-check, AI and routing
//     provider credentials are removed from the process environment before
//     the server loads, so nothing can reach a real person or service.
//   - Seeded people are synthetic: @example.test emails and 555-01xx
//     phone numbers, which are reserved as fictional.

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Client } = require("pg");

const SCHEMA_FILE = path.join(__dirname, "production-schema.sql");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Credentials for services that reach real people or paid APIs. Removed
// from the environment before the server is required.
const OUTBOUND_ENV = [
  "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_PHONE_NUMBER", "TWILIO_VERIFY_SERVICE_SID",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
  "PERSONA_API_KEY", "PERSONA_WEBHOOK_SECRET",
  "CHECKR_API_KEY", "CHECKR_WEBHOOK_SECRET",
  "OPENAI_API_KEY", "GOOGLE_ROUTES_API_KEY", "MAPBOX_ACCESS_TOKEN",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "AGENT_LLM_BASE_URL", "AGENT_LLM_API_KEY",
  "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"
];

function assertLocalDatabase(adminUrl) {
  if (!adminUrl) throw new Error("HARVEY_TEST_DATABASE_URL is required (a local Postgres with PostGIS).");
  const host = new URL(adminUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run: the isolated suite only uses a local Postgres, not "${host}".`);
  }
}

function stripOutboundCredentials(env = process.env) {
  for (const name of OUTBOUND_ENV) delete env[name];
  env.ENABLE_REAL_SMS = "false";
  env.ENABLE_REAL_EMAIL = "false";
  env.ENABLE_PERSONA = "false";
  env.ENABLE_CHECKR = "false";
  env.ENABLE_AI_SUPPORT = "false";
}

function withDatabase(url, dbName) {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function adminQuery(adminUrl, sql) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signServiceRoleJwt(secret) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ role: "service_role", iss: "harvey-isolated-test", exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(fn, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for PostgREST${lastErr ? `: ${lastErr.message}` : ""}`);
}

function httpGetStatus(port, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathName, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
  });
}

// supabase-js calls <url>/rest/v1/<table>; PostgREST serves /<table>.
function startRestPrefixProxy(targetPort) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith("/rest/v1")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "isolated test proxy: only /rest/v1 is served" }));
        return;
      }
      const upstream = http.request(
        { host: "127.0.0.1", port: targetPort, method: req.method, path: req.url.slice("/rest/v1".length) || "/", headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        }
      );
      upstream.on("error", (err) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: err.message }));
      });
      req.pipe(upstream);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function insertRow(client, table, row) {
  const cols = Object.keys(row);
  const values = cols.map((c) => row[c]);
  const sql = `insert into public.${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
  await client.query(sql, values);
}

// Creates the database, starts PostgREST and the prefix proxy. Returns
// { supabaseUrl, serviceRoleKey, db (pg Client), reset(), teardown() }.
async function startIsolatedEnvironment({ adminUrl = process.env.HARVEY_TEST_DATABASE_URL, postgrestBin = process.env.POSTGREST_BIN || "postgrest" } = {}) {
  assertLocalDatabase(adminUrl);
  const dbName = `harvey_isolated_${crypto.randomBytes(4).toString("hex")}`;
  await adminQuery(adminUrl, `create database ${dbName}`);
  const dbUrl = withDatabase(adminUrl, dbName);

  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  await db.query(fs.readFileSync(SCHEMA_FILE, "utf8"));

  const jwtSecret = crypto.randomBytes(32).toString("hex");
  const pgrstPort = await freePort();
  const pgrst = spawn(postgrestBin, [], {
    env: {
      PATH: process.env.PATH,
      PGRST_DB_URI: dbUrl,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(pgrstPort),
      PGRST_LOG_LEVEL: "error"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let pgrstErr = "";
  pgrst.stderr.on("data", (d) => {
    pgrstErr += d.toString();
  });
  const serviceRoleKey = signServiceRoleJwt(jwtSecret);
  await waitFor(async () => (await httpGetStatus(pgrstPort, "/system_flags?limit=1", { Authorization: `Bearer ${serviceRoleKey}` })) === 200).catch((err) => {
    pgrst.kill();
    throw new Error(`${err.message}\n${pgrstErr}`);
  });
  const proxy = await startRestPrefixProxy(pgrstPort);

  const tables = ["driver_offers", "dispatches", "missions", "trip_events", "trip_timelines", "notification_logs", "audit_logs", "admin_logs", "payments", "rides", "drivers", "riders", "system_flags", "usage_counters"];

  async function reset({ riders = [], drivers = [], rides = [], flags = {} } = {}) {
    // rides.payment_id <-> payments.ride_id reference each other; clear the
    // ride side first so both tables can be emptied.
    await db.query("update public.rides set payment_id = null");
    await db.query(`truncate ${tables.map((t) => `public.${t}`).join(", ")} restart identity cascade`);
    for (const r of riders) await insertRow(db, "riders", r);
    for (const d of drivers) await insertRow(db, "drivers", d);
    for (const r of rides) await insertRow(db, "rides", r);
    for (const [key, value] of Object.entries(flags)) await insertRow(db, "system_flags", { key, value });
  }

  async function teardown() {
    await new Promise((r) => proxy.close(r));
    pgrst.kill();
    await db.end();
    await adminQuery(adminUrl, `drop database if exists ${dbName} with (force)`);
  }

  return {
    supabaseUrl: `http://127.0.0.1:${proxy.address().port}`,
    serviceRoleKey,
    dbName,
    db,
    reset,
    teardown
  };
}

module.exports = { startIsolatedEnvironment, stripOutboundCredentials, assertLocalDatabase, OUTBOUND_ENV };
