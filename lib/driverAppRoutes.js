// Routes added for the Harvey Taxi Driver native app (docs/driver-app.md).
// All additive: the web driver dashboard's routes are unchanged. Registered
// from server.js with its middleware and helpers injected; rules live in
// lib/driverApp.js.
//
// Authorization: every driver route uses requireDriverSelf, so the driver
// is the one in the signed session (never a driver_id from the request) and
// admin credentials cannot act as a driver. Which app made the request is
// never consulted.

const crypto = require("crypto");
const da = require("./driverApp");

const NATIVE_PUSH_FLAG = "driver_native_push_enabled";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const SSE_HEARTBEAT_MS = 25_000;
const UNIFORM_START_MESSAGE = "If this number belongs to a Harvey Taxi driver account, a sign-in code is on its way.";

function createDriverRealtime() {
  // driverId -> Map(clientId -> res). Per server instance; the app
  // reconciles through GET /api/driver/state, so a missed event on another
  // instance only delays an update until the next reconcile or push.
  const clients = new Map();

  function add(driverId, clientId, res) {
    if (!clients.has(driverId)) clients.set(driverId, new Map());
    clients.get(driverId).set(clientId, res);
  }

  function remove(driverId, clientId) {
    const set = clients.get(driverId);
    if (!set) return;
    set.delete(clientId);
    if (!set.size) clients.delete(driverId);
  }

  // Events carry no ride data: they tell the app to re-read its state
  // from the server, which stays the single source of truth.
  function notifyDriver(driverId, event = "sync", data = {}) {
    const set = clients.get(String(driverId || ""));
    if (!set) return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, at: new Date().toISOString() })}\n\n`;
    let sent = 0;
    for (const res of set.values()) {
      try {
        res.write(payload);
        sent += 1;
      } catch {
        // closed; the close handler removes it
      }
    }
    return sent;
  }

  function connectionCount(driverId) {
    return clients.get(String(driverId || ""))?.size || 0;
  }

  return { add, remove, notifyDriver, connectionCount };
}

function registerDriverAppRoutes(app, deps) {
  const {
    supabase,
    requireDriverSelf,
    rateLimit,
    asyncRoute,
    ok,
    fail,
    getSystemFlag,
    getTwilioClient,
    twilioVerifyServiceSid,
    toE164,
    signDriverSession,
    driverSessionTtlHours,
    computeDriverReadiness,
    enablePersona,
    enableCheckr,
    auditLog,
    realtime,
    fetchImpl = (...args) => fetch(...args),
    env = process.env
  } = deps;

  const hashPhone = (last10) => crypto.createHash("sha256").update(`driver-phone:${last10}`).digest("hex").slice(0, 32);

  async function findDriverByPhone(last10) {
    const { data, error } = await supabase
      .from("drivers")
      .select("id, phone, access_revoked, deleted_at, is_blocked, is_disabled, is_review_account")
      .ilike("phone", da.phoneLikePattern(last10));
    if (error) throw error;
    return da.selectDriverForPhone(data, last10);
  }

  /* ---------------- phone sign-in ---------------- */

  const phoneKey = (req) => hashPhone(da.phoneLast10(req.body?.phone) || "none");

  app.post(
    "/api/driver/session/phone/start",
    rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "driver_phone_start_ip" }),
    rateLimit({ windowMs: 10 * 60_000, max: 5, keyPrefix: "driver_phone_start_dest", keyFn: phoneKey }),
    asyncRoute(async (req, res) => {
      const last10 = da.phoneLast10(req.body?.phone);
      if (!last10) return fail(res, "Enter a 10-digit U.S. mobile number.", 400);
      const twilio = getTwilioClient();
      if (!twilio || !twilioVerifyServiceSid) {
        return fail(res, "Driver sign-in is not available right now. Please try again later.", 503);
      }

      const { driver, matchCount } = await findDriverByPhone(last10);
      if (matchCount > 1) console.error("❌ Driver phone sign-in: number matches more than one active driver.");

      // Same answer whether or not the number belongs to a driver, so the
      // endpoint can't be used to find out who drives for Harvey Taxi.
      if (driver && driver.is_review_account !== true) {
        const to = toE164(driver.phone);
        if (to) {
          try {
            await twilio.verify.services(twilioVerifyServiceSid).verifications.create({ to, channel: "sms" });
          } catch (err) {
            console.error("❌ Driver phone sign-in: code send failed:", err && err.code ? `Twilio ${err.code}` : "error");
          }
        }
      }
      return ok(res, { sent: true, message: UNIFORM_START_MESSAGE });
    })
  );

  app.post(
    "/api/driver/session/phone/verify",
    rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "driver_phone_verify_ip" }),
    rateLimit({ windowMs: 10 * 60_000, max: 8, keyPrefix: "driver_phone_verify_dest", keyFn: phoneKey }),
    asyncRoute(async (req, res) => {
      const last10 = da.phoneLast10(req.body?.phone);
      const code = String(req.body?.code ?? "").replace(/\D/g, "").slice(0, 10);
      if (!last10 || code.length < 4) return fail(res, "Enter your phone number and the code you received.", 400);
      const twilio = getTwilioClient();
      if (!twilio || !twilioVerifyServiceSid) {
        return fail(res, "Driver sign-in is not available right now. Please try again later.", 503);
      }
      if (typeof signDriverSession !== "function") return fail(res, "Driver sessions are not configured on the server.", 500);

      const { driver } = await findDriverByPhone(last10);
      const to = driver && driver.is_review_account !== true ? toE164(driver.phone) : null;
      if (!to) return fail(res, "Invalid or expired code.", 400);

      let check;
      try {
        check = await twilio.verify.services(twilioVerifyServiceSid).verificationChecks.create({ to, code });
      } catch {
        return fail(res, "Invalid or expired code.", 400);
      }
      if (!check || check.status !== "approved") return fail(res, "Invalid or expired code.", 400);

      const token = signDriverSession(driver.id);
      if (!token) return fail(res, "Driver sessions are not configured on the server.", 500);
      auditLog({ actor_type: "driver", actor_id: driver.id, action: "driver_app_login", req }).catch(() => {});
      return ok(res, { driver_token: token, driver_id: driver.id, expires_in_hours: driverSessionTtlHours });
    })
  );

  /* ---------------- state snapshot ---------------- */

  app.get(
    "/api/driver/state",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const driver = req.driver;
      const nowIsoText = new Date().toISOString();

      const [{ data: offerRows, error: offerErr }, { data: rideRows, error: rideErr }] = await Promise.all([
        supabase
          .from("driver_offers")
          .select("id, ride_id, status, expires_at, created_at")
          .eq("driver_id", driver.id)
          .eq("status", "pending")
          .gt("expires_at", nowIsoText),
        supabase
          .from("rides")
          .select("*")
          .eq("driver_id", driver.id)
          .in("status", da.ACTIVE_RIDE_STATUSES)
          .order("updated_at", { ascending: false })
          .limit(1)
      ]);
      if (offerErr) throw offerErr;
      if (rideErr) throw rideErr;

      let offers = [];
      if (offerRows && offerRows.length) {
        const { data: offerRides, error } = await supabase
          .from("rides")
          .select("*")
          .in("id", offerRows.map((o) => o.ride_id));
        if (error) throw error;
        const byId = new Map((offerRides || []).map((r) => [r.id, r]));
        offers = offerRows.map((o) => da.shapeOffer(o, byId.get(o.ride_id)));
      }

      const activeRide = da.shapeActiveRide((rideRows || [])[0]);
      const readiness = computeDriverReadiness(driver, { enablePersona, enableCheckr });
      const mode = da.driverMode({ online: driver.online === true, offers, activeRide });
      const nativePush = (await getSystemFlag(NATIVE_PUSH_FLAG, "false")) === "true";

      return ok(res, {
        server_time: nowIsoText,
        driver: {
          id: driver.id,
          first_name: driver.first_name || (driver.full_name || driver.name || "").split(" ")[0] || null,
          online: driver.online === true,
          approval_status: driver.approval_status || null,
          photo_url: driver.photo_url || null,
          is_review_account: driver.is_review_account === true
        },
        readiness: {
          ready: readiness.ready,
          approved: String(driver.approval_status || "").toLowerCase() === "approved",
          checks: readiness.checks
        },
        mode,
        offers,
        active_ride: activeRide,
        poll_ms: da.pollIntervalFor(mode),
        reconcile_ms: da.RECONCILE_MS,
        native_push_enabled: nativePush
      });
    })
  );

  /* ---------------- real-time stream ---------------- */

  app.get(
    "/api/driver/stream",
    requireDriverSelf,
    (req, res) => {
      const driverId = String(req.driver.id);
      const clientId = crypto.randomUUID();
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      realtime.add(driverId, clientId, res);
      res.write(`retry: 5000\nevent: connected\ndata: ${JSON.stringify({ reconcile_ms: da.RECONCILE_MS })}\n\n`);
      const heartbeat = setInterval(() => {
        try {
          res.write(`event: heartbeat\ndata: {}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, SSE_HEARTBEAT_MS);
      heartbeat.unref?.();
      req.on("close", () => {
        clearInterval(heartbeat);
        realtime.remove(driverId, clientId);
      });
    }
  );

  /* ---------------- push tokens ---------------- */

  app.post(
    "/api/driver/push-token",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!da.isExpoPushToken(token)) return fail(res, "A valid Expo push token is required.", 400);
      const platform = ["ios", "android"].includes(req.body?.platform) ? req.body.platform : null;
      if (!platform) return fail(res, "platform must be ios or android.", 400);
      const now = new Date().toISOString();
      // A device has one token; if another driver signed in on this device
      // before, the token moves to the driver signed in now.
      const { error } = await supabase.from("driver_push_tokens").upsert(
        {
          token,
          driver_id: req.driver.id,
          platform,
          app_version: String(req.body?.app_version || "").slice(0, 40) || null,
          updated_at: now,
          last_registered_at: now
        },
        { onConflict: "token" }
      );
      if (error) throw error;
      return ok(res, { registered: true });
    })
  );

  app.delete(
    "/api/driver/push-token",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!da.isExpoPushToken(token)) return fail(res, "A valid Expo push token is required.", 400);
      const { error } = await supabase.from("driver_push_tokens").delete().eq("token", token).eq("driver_id", req.driver.id);
      if (error) throw error;
      return ok(res, { removed: true });
    })
  );

  /* ---------------- paginated trips and earnings ---------------- */

  app.get(
    "/api/driver/trips",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const page = da.parsePageQuery({ limit: req.query.limit ?? String(da.PAGE_DEFAULT), before: req.query.before });
      if (page.error) return fail(res, page.error, 400);
      let q = supabase
        .from("rides")
        .select("id, status, ride_type, pickup_address, dropoff_address, estimated_fare, final_fare, completed_at, is_review_ride")
        .eq("driver_id", req.driver.id)
        .eq("status", "completed");
      if (page.before) q = q.lt("completed_at", page.before);
      const { data, error } = await q.order("completed_at", { ascending: false }).limit(page.limit + 1);
      if (error) throw error;
      const { items, next_before } = da.pageResult(data, page.limit, "completed_at");
      return ok(res, { trips: items, next_before });
    })
  );

  app.get(
    "/api/driver/earnings-ledger",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const page = da.parsePageQuery({ limit: req.query.limit ?? String(da.PAGE_DEFAULT), before: req.query.before });
      if (page.error) return fail(res, page.error, 400);
      let q = supabase.from("driver_earnings").select("*").eq("driver_id", req.driver.id);
      if (page.before) q = q.lt("created_at", page.before);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(page.limit + 1);
      if (error) throw error;
      const { items, next_before } = da.pageResult(data, page.limit, "created_at");

      // Totals read two narrow columns only, on the first page.
      let totals;
      if (!page.before) {
        const { data: all, error: totErr } = await supabase
          .from("driver_earnings")
          .select("total_earning, created_at")
          .eq("driver_id", req.driver.id);
        if (totErr) throw totErr;
        const now = Date.now();
        const sum = (rows) => Math.round(rows.reduce((t, r) => t + Number(r.total_earning || 0), 0) * 100) / 100;
        const since = (ms) => (all || []).filter((r) => now - Date.parse(r.created_at || 0) <= ms);
        totals = { all_time: sum(all || []), last_7_days: sum(since(7 * 864e5)), last_24_hours: sum(since(864e5)) };
      }

      return ok(res, {
        records: items.map((r) => ({
          id: r.id,
          ride_id: r.ride_id,
          total_earning: Number(r.total_earning || 0),
          gross_fare: r.gross_fare === null || r.gross_fare === undefined ? null : Number(r.gross_fare),
          tip_amount: Number(r.tip_amount || 0),
          status: r.status || r.earning_status || null,
          created_at: r.created_at
        })),
        next_before,
        ...(totals ? { totals } : {}),
        ...(req.driver.is_review_account === true ? { review_mode: true } : {})
      });
    })
  );

  /* ---------------- native push sending ---------------- */

  async function sendDriverNativePush(driverId, { title, body, kind, data }) {
    if (!driverId) return { sent: 0, skipped: "no_driver" };
    if ((await getSystemFlag(NATIVE_PUSH_FLAG, "false")) !== "true") return { sent: 0, skipped: "flag_off" };
    const { data: rows, error } = await supabase.from("driver_push_tokens").select("token").eq("driver_id", driverId);
    if (error || !rows || !rows.length) return { sent: 0, skipped: error ? "lookup_failed" : "no_tokens" };
    const messages = da.buildExpoMessages(rows.map((r) => r.token), { title, body, kind, data });
    if (!messages.length) return { sent: 0, skipped: "no_valid_tokens" };
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
      const json = await response.json().catch(() => ({}));
      const dead = da.invalidTokensFromTickets(messages, json && json.data);
      if (dead.length) await supabase.from("driver_push_tokens").delete().in("token", dead);
      return { sent: messages.length, removed: dead.length, status: response.status };
    } catch (err) {
      console.error("⚠️ Driver native push failed:", err && err.message ? err.message : "error");
      return { sent: 0, skipped: "send_failed" };
    }
  }

  return { sendDriverNativePush };
}

module.exports = { registerDriverAppRoutes, createDriverRealtime, NATIVE_PUSH_FLAG };
