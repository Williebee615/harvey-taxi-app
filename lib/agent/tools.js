// Harvey Taxi AI Agent Manager -- the ONLY data access the agent has.
//
// Each tool is a fixed, read-only query with an explicit column list and a
// declared set of roles. Identity comes from the authenticated actor that
// server.js resolved (rider session, driver session, admin credentials),
// never from the message or request body, so ownership is enforced by
// construction: a rider tool can only ever read rows where rider_id is the
// signed-in rider, a driver tool only rows for the signed-in driver.
//
// There is deliberately no generic query, no write and no admin bypass
// here. Platform changes (booking, cancelling, accepting, dispatching)
// stay in the existing routes, which keep their own auth and validation.

const { ACTIVE_RIDE_STATUSES } = require("../driverAvailability");
const { RIDE_STATUS } = require("../rideDispatch");

const OPEN_RIDE_STATUSES = Object.freeze([
  RIDE_STATUS.PAYMENT_REQUIRED,
  RIDE_STATUS.PAYMENT_AUTHORIZED,
  RIDE_STATUS.AWAITING_DRIVER,
  ...ACTIVE_RIDE_STATUSES
]);

const RIDER_RIDE_COLUMNS =
  "id,status,ride_type,pickup_address,dropoff_address,estimated_fare,fare_total,driver_name,driver_vehicle,driver_eta_to_pickup_text,scheduled_time,created_at";
const DRIVER_RIDE_COLUMNS =
  "id,status,ride_type,pickup_address,dropoff_address,estimated_driver_payout,rider_name,created_at";
const ADMIN_RIDE_COLUMNS =
  "id,status,dispatch_status,ride_type,service_type,driver_id,driver_name,pickup_address,pickup_lat,pickup_lng,scheduled_time,dispatch_attempts,last_dispatch_at,is_review_ride,payment_status,created_at,updated_at";
const DRIVER_CANDIDATE_COLUMNS =
  "id,first_name,last_name,full_name,online,is_online,status,approval_status,access_revoked,is_blocked,is_disabled,deleted_at,is_review_account,email_verified,phone_verified,persona_verified,persona_status,checkr_status,vehicle_make,vehicle_model,vehicle_year,current_lat,current_lng,latitude,longitude,last_location_at,last_seen_at,rating,acceptance_rate,supports_rides,supports_food_delivery,supports_grocery_delivery";

class AgentToolError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = "AgentToolError";
    this.status = status;
  }
}

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || !actor.id) {
    throw new AgentToolError("This assistant action is not permitted for your account.", 403);
  }
}

function unwrap({ data, error }) {
  if (error) {
    const err = new AgentToolError("Platform data is temporarily unavailable.", 503);
    err.cause = error;
    throw err;
  }
  return data || [];
}

function createAgentTools({ supabase, now = () => Date.now() }) {
  const definitions = {
    rider_open_rides: {
      roles: ["rider"],
      async run(actor) {
        return unwrap(
          await supabase
            .from("rides")
            .select(RIDER_RIDE_COLUMNS)
            .eq("rider_id", actor.id)
            .in("status", OPEN_RIDE_STATUSES)
            .order("created_at", { ascending: false })
            .limit(3)
        );
      }
    },
    driver_pending_offers: {
      roles: ["driver"],
      async run(actor) {
        const rows = unwrap(
          await supabase
            .from("driver_offers")
            .select("id,ride_id,status,expires_at")
            .eq("driver_id", actor.id)
            .eq("status", "pending")
            .limit(5)
        );
        const t = now();
        return rows.filter((o) => !o.expires_at || Date.parse(o.expires_at) > t);
      }
    },
    driver_active_ride: {
      roles: ["driver"],
      async run(actor) {
        return unwrap(
          await supabase
            .from("rides")
            .select(DRIVER_RIDE_COLUMNS)
            .eq("driver_id", actor.id)
            .in("status", ACTIVE_RIDE_STATUSES)
            .limit(1)
        );
      }
    },
    driver_earnings_summary: {
      roles: ["driver"],
      async run(actor) {
        const rows = unwrap(
          await supabase
            .from("driver_earnings")
            .select("total_earning,created_at")
            .eq("driver_id", actor.id)
            .limit(500)
        );
        const weekAgo = now() - 7 * 24 * 60 * 60 * 1000;
        const sum = (list) => Number(list.reduce((acc, r) => acc + (Number(r.total_earning) || 0), 0).toFixed(2));
        const recent = rows.filter((r) => Date.parse(r.created_at) >= weekAgo);
        return [{ trips_total: rows.length, earnings_total: sum(rows), trips_last_7_days: recent.length, earnings_last_7_days: sum(recent) }];
      }
    },
    admin_open_rides: {
      roles: ["admin"],
      async run() {
        return unwrap(
          await supabase
            .from("rides")
            .select(ADMIN_RIDE_COLUMNS)
            .in("status", OPEN_RIDE_STATUSES)
            .order("created_at", { ascending: false })
            .limit(100)
        );
      }
    },
    admin_ride: {
      roles: ["admin"],
      async run(_actor, { rideId }) {
        const rows = unwrap(await supabase.from("rides").select(ADMIN_RIDE_COLUMNS).eq("id", String(rideId)).limit(1));
        return rows;
      }
    },
    admin_candidate_drivers: {
      roles: ["admin"],
      async run() {
        return unwrap(
          await supabase
            .from("drivers")
            .select(DRIVER_CANDIDATE_COLUMNS)
            .eq("approval_status", "approved")
            .limit(200)
        );
      }
    },
    admin_ride_offers: {
      roles: ["admin"],
      async run(_actor, { rideIds }) {
        const ids = (rideIds || []).map(String).filter(Boolean);
        if (!ids.length) return [];
        return unwrap(
          await supabase.from("driver_offers").select("ride_id,driver_id,status,expires_at").in("ride_id", ids).limit(1000)
        );
      }
    }
  };

  // Every tool call goes through here so the role check cannot be skipped
  // and every call is recorded for the decision log.
  async function invoke(name, actor, args = {}, trace = []) {
    const def = definitions[name];
    if (!def) throw new AgentToolError("Unknown assistant tool.", 400);
    assertActor(actor, def.roles);
    const started = now();
    try {
      const result = await def.run(actor, args);
      trace.push({ tool: name, ok: true, rows: Array.isArray(result) ? result.length : 0, ms: now() - started });
      return result;
    } catch (err) {
      trace.push({ tool: name, ok: false, ms: now() - started });
      throw err;
    }
  }

  return { invoke, names: Object.keys(definitions), roles: (name) => (definitions[name] ? [...definitions[name].roles] : []) };
}

module.exports = {
  OPEN_RIDE_STATUSES,
  DRIVER_CANDIDATE_COLUMNS,
  AgentToolError,
  createAgentTools
};
