#!/usr/bin/env node
// Before/after request and database-operation model for one driver shift:
// the current web driver dashboard versus the Harvey Taxi Driver app.
//
// What is measured, and what isn't:
//   - Request schedules come from each client's code (the dashboard's
//     7 s three-request poll and 12 s trip-only location; the app's stream
//     + reconcile + state-based location profiles).
//   - Database operations per request are MEASURED by running every request
//     against the real server routes with the in-memory test database and
//     counting the queries each one makes.
//   - It is a model of one driver, not production telemetry. CPU, memory and
//     real database time need production metrics (see docs/driver-app.md).
//
// Usage: node scripts/driver-load-model.js [--json]

process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "1000000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "model";
process.env.DRIVER_SESSION_SECRET = "model-driver-secret";
process.env.RIDER_SESSION_SECRET = "model-rider-secret";
process.env.RIDE_QUOTE_SECRET = "model-quote-secret";

const path = require("path");
const { createFakeSupabase } = require("../test/fakeSupabase");
const { makeDriver, makeRide, signTestDriverToken } = require("../test/rideTestHelpers");

const fake = createFakeSupabase({});
require.cache[require.resolve("@supabase/supabase-js")] = {
  id: "supabase-model",
  filename: "supabase-model",
  loaded: true,
  exports: { createClient: () => fake }
};
const { app } = require(path.join(__dirname, "..", "server"));
const request = require("supertest");

const MIN = 60_000;
// The shift (minutes): 0-10 signed in but offline, 10-30 online idle, a ride
// offer at 30 (accepted after 15 s), 5 min driving to pickup, 2 min at
// pickup, 13 min trip, 50-55 online idle, 55-60 offline.
const SHIFT = [
  { from: 0, to: 10, mode: "offline" },
  { from: 10, to: 30, mode: "online_idle" },
  { from: 30, to: 35, mode: "driver_enroute" },
  { from: 35, to: 37, mode: "arrived" },
  { from: 37, to: 50, mode: "in_progress" },
  { from: 50, to: 55, mode: "online_idle" },
  { from: 55, to: 60, mode: "offline" }
];
const modeAt = (ms) => (SHIFT.find((s) => ms >= s.from * MIN && ms < s.to * MIN) || SHIFT[SHIFT.length - 1]).mode;
const onTrip = (m) => ["driver_enroute", "arrived", "in_progress"].includes(m);

function webDashboardSchedule() {
  const reqs = [];
  for (let t = 0; t < 60 * MIN; t += 7000) {
    reqs.push(["GET", "readiness", t], ["GET", "missions", t], ["GET", "earnings", t]);
  }
  for (let t = 0; t < 60 * MIN; t += 12000) if (onTrip(modeAt(t))) reqs.push(["POST", "location", t]);
  // Driver actions.
  reqs.push(["POST", "status", 10 * MIN], ["POST", "accept", 30 * MIN + 15000]);
  for (const step of ["enroute", "arrived", "start", "complete"]) reqs.push(["POST", step, 30 * MIN]);
  reqs.push(["POST", "status", 55 * MIN]);
  return reqs;
}

function driverAppSchedule() {
  const reqs = [["GET", "state", 0]];
  // Stream open while not offline; reconcile every 60 s.
  for (let t = 10 * MIN; t < 55 * MIN; t += MIN) reqs.push(["GET", "state", t]);
  reqs.push(["STREAM", "connect", 10 * MIN]);
  // Event-driven reads: offer event, accept, 4 steps, online/offline, offer-expiry timer.
  for (const at of [30 * MIN, 30 * MIN + 15000, 30 * MIN + 16000]) reqs.push(["GET", "state", at]);
  for (let i = 0; i < 6; i += 1) reqs.push(["GET", "state", 30 * MIN]);
  reqs.push(["POST", "status", 10 * MIN], ["POST", "accept", 30 * MIN + 15000]);
  for (const step of ["enroute", "arrived", "start", "complete"]) reqs.push(["POST", step, 30 * MIN]);
  reqs.push(["POST", "status", 55 * MIN]);
  // Location by profile (assumes the car keeps moving except at pickup,
  // where only the 2-minute keep-alive fires).
  const every = { online_idle: 60000, driver_enroute: 10000, in_progress: 10000, arrived: 120000 };
  let last = -Infinity;
  for (let t = 0; t < 60 * MIN; t += 1000) {
    const m = modeAt(t);
    if (m === "offline") continue;
    if (t - last >= every[m]) {
      reqs.push(["POST", "location", t]);
      last = t;
    }
  }
  // Earnings/trips: one page each, opened once in the shift.
  reqs.push(["GET", "earnings_page", 52 * MIN], ["GET", "trips_page", 52 * MIN]);
  return reqs;
}

function seed(mode) {
  const s = fake._state;
  for (const k of Object.keys(s)) delete s[k];
  const driver = makeDriver({ id: "DRIVER_M", online: mode !== "offline" });
  const rides = [];
  const earnings = [];
  for (let i = 0; i < 40; i += 1) {
    rides.push(makeRide({ id: `DONE_${i}`, status: "completed", driver_id: "DRIVER_M", completed_at: new Date(Date.now() - i * 3600e3).toISOString() }));
    earnings.push({ id: `E_${i}`, driver_id: "DRIVER_M", ride_id: `DONE_${i}`, total_earning: 12, created_at: new Date(Date.now() - i * 3600e3).toISOString() });
  }
  if (onTrip(mode)) rides.push(makeRide({ id: "RIDE_M", status: mode, driver_id: "DRIVER_M" }));
  Object.assign(s, { drivers: [driver], rides, driver_offers: [], driver_earnings: earnings, system_flags: [], audit_logs: [], driver_push_tokens: [] });
}

const H = { "x-driver-token": signTestDriverToken("DRIVER_M") };
const ROUTES = {
  readiness: (a) => a.get("/api/drivers/DRIVER_M/readiness"),
  missions: (a) => a.get("/api/driver/DRIVER_M/missions"),
  earnings: (a) => a.get("/api/driver/DRIVER_M/earnings"),
  state: (a) => a.get("/api/driver/state"),
  location: (a) => a.post("/api/driver/location").send({ latitude: 36.16 + Math.random() / 100, longitude: -86.78, accuracy: 10 }),
  earnings_page: (a) => a.get("/api/driver/earnings-ledger?limit=20"),
  trips_page: (a) => a.get("/api/driver/trips?limit=20")
};

async function dbOpsFor(route, mode) {
  seed(mode);
  fake._log.length = 0;
  const res = await ROUTES[route](request(app)).set(H);
  // Location throttling is per process; wait it out between samples.
  return { ops: fake._log.length, status: res.status };
}

async function main() {
  const perRoute = {};
  const sampleMode = { location: "in_progress" };
  for (const route of Object.keys(ROUTES)) {
    const { ops, status } = await dbOpsFor(route, sampleMode[route] || "online_idle");
    perRoute[route] = { ops, status };
    await new Promise((r) => setTimeout(r, route === "location" ? 5100 : 0));
  }
  // An idle-online location write (new behaviour) costs the same driver update.
  const { ops: idleLocOps } = await dbOpsFor("location", "online_idle");

  function total(schedule, label) {
    let http = 0;
    let db = 0;
    let location = 0;
    for (const [method, name, at] of schedule) {
      if (method === "STREAM") continue;
      http += 1;
      if (name === "location") {
        location += 1;
        db += onTrip(modeAt(at)) ? perRoute.location.ops : idleLocOps;
      } else if (perRoute[name]) {
        db += perRoute[name].ops;
      } else {
        db += 2; // driver actions: not modelled per query; same for both clients
      }
    }
    return { label, http_requests: http, location_posts: location, db_operations: db };
  }

  const before = total(webDashboardSchedule(), "web dashboard (current)");
  const after = total(driverAppSchedule(), "Harvey Taxi Driver app");
  const result = { per_request_db_ops: perRoute, idle_location_db_ops: idleLocOps, before, after };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Per-request database operations (measured on the real routes):");
    for (const [k, v] of Object.entries(perRoute)) console.log(`  ${k.padEnd(14)} ${v.ops}  (HTTP ${v.status})`);
    console.log(`  location idle  ${idleLocOps}`);
    console.log("\nOne 60-minute shift, one driver (modelled schedule):");
    for (const r of [before, after]) {
      console.log(`  ${r.label.padEnd(26)} HTTP ${String(r.http_requests).padStart(5)}   location ${String(r.location_posts).padStart(4)}   DB ops ${String(r.db_operations).padStart(5)}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
