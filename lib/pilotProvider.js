// Autonomous Pilot V1 — provider adapter interface.
//
// Every autonomous-fleet interaction the app makes goes through this
// shape, so integrating a real provider later means writing one new
// adapter object, not touching call sites. V1 ships with exactly one
// adapter: manual_operations — a safe, honest stand-in that never
// fabricates real-provider behavior. It has no automatic availability
// signal and no live vehicle telemetry; a human (an admin, via the
// operations panel in a later phase) reserves/assigns a vehicle by
// hand, and every response is explicitly labeled `simulated: true` so
// no caller can mistake it for a real fleet connection.
//
// Dependency-free (no Supabase, no Express) so it's directly
// unit-testable, same pattern as lib/pricing.js and lib/rideDispatch.js.

const PILOT_ADAPTER_METHODS = [
  "checkAvailability",
  "reserveVehicle",
  "cancelReservation",
  "getVehicleStatus",
  "getVehicleLocation",
  "requestRemoteAssistance"
];

function nowIso() {
  return new Date().toISOString();
}

const manualOperationsAdapter = {
  name: "manual_operations",

  // There is no automatic fleet-availability signal without a real
  // provider — this always reports "not automatically available" so
  // the caller falls through to the honest "waitlisted" result and an
  // admin reviews the request by hand. Never returns available: true.
  async checkAvailability() {
    return {
      provider: "manual_operations",
      available: false,
      simulated: true,
      reason: "manual_operations_pending_admin_review"
    };
  },

  // Only ever called with an admin-supplied vehicle label — this
  // adapter does not invent one itself. Represents an admin manually
  // assigning a vehicle, not a real fleet-provider API call.
  async reserveVehicle({ rideId, vehicleId, providerReservationId, notes } = {}) {
    if (!rideId) {
      throw new Error("reserveVehicle requires a rideId.");
    }

    if (!vehicleId) {
      throw new Error("manual_operations reserveVehicle requires an admin-supplied vehicleId.");
    }

    return {
      provider: "manual_operations",
      reserved: true,
      simulated: true,
      vehicle_id: vehicleId,
      provider_reservation_id: providerReservationId || null,
      notes: notes || null,
      reserved_at: nowIso()
    };
  },

  async cancelReservation({ reservationId } = {}) {
    if (!reservationId) {
      throw new Error("cancelReservation requires a reservationId.");
    }

    return {
      provider: "manual_operations",
      cancelled: true,
      simulated: true,
      cancelled_at: nowIso()
    };
  },

  // Reports back whatever status the caller already knows (e.g. the
  // autonomous_provider_reservations row) — manual_operations has no
  // independent source of truth to poll, so it never invents one.
  async getVehicleStatus({ reservationId, knownStatus } = {}) {
    if (!reservationId) {
      throw new Error("getVehicleStatus requires a reservationId.");
    }

    return {
      provider: "manual_operations",
      simulated: true,
      status: knownStatus || "unknown",
      checked_at: nowIso()
    };
  },

  // No real vehicle means no real GPS. Returning a fabricated location
  // here is exactly the failure mode this adapter exists to prevent —
  // always null, with an honest, explicit reason.
  async getVehicleLocation() {
    return {
      provider: "manual_operations",
      simulated: true,
      location: null,
      reason: "no_live_location_manual_operations"
    };
  },

  // manual_operations has no channel to a real vehicle to relay a
  // remote-assistance command to. This routes to Harvey Taxi's existing
  // human support/safety workflow instead of claiming to control
  // anything — callers must treat `routed_to` as the real destination
  // of this request, not a vehicle.
  async requestRemoteAssistance({ reservationId, reason } = {}) {
    if (!reservationId) {
      throw new Error("requestRemoteAssistance requires a reservationId.");
    }

    return {
      provider: "manual_operations",
      simulated: true,
      requested: true,
      routed_to: "human_support",
      reason: reason || null,
      requested_at: nowIso()
    };
  }
};

const PROVIDERS = {
  manual_operations: manualOperationsAdapter
};

// Throws on an unknown/unregistered provider name rather than silently
// falling back to manual_operations, and throws if a registered
// adapter is missing a required method — a typo'd or half-implemented
// provider must never quietly behave like a different one.
function getPilotProvider(name = "manual_operations") {
  const adapter = PROVIDERS[name];

  if (!adapter) {
    throw new Error(
      `Unknown autonomous pilot provider: "${name}". No fabricated fallback is provided.`
    );
  }

  for (const method of PILOT_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`Pilot provider "${name}" is missing required method "${method}".`);
    }
  }

  return adapter;
}

module.exports = {
  PILOT_ADAPTER_METHODS,
  manualOperationsAdapter,
  getPilotProvider
};
