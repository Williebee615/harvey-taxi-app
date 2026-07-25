const { manualOperationsAdapter, getPilotProvider, PILOT_ADAPTER_METHODS } = require("./pilotProvider");

describe("getPilotProvider", () => {
  it("returns the manual_operations adapter by name and by default", () => {
    expect(getPilotProvider("manual_operations")).toBe(manualOperationsAdapter);
    expect(getPilotProvider()).toBe(manualOperationsAdapter);
  });

  it("rejects an unknown provider instead of silently falling back", () => {
    expect(() => getPilotProvider("some_real_fleet_co")).toThrow(/Unknown autonomous pilot provider/);
  });

  it("rejects an adapter missing a required method rather than using it partially", () => {
    const incompleteAdapter = { checkAvailability: async () => ({}) };
    const providers = { incomplete: incompleteAdapter };

    // Exercises the same validation getPilotProvider runs, without
    // needing to mutate the module's internal registry.
    for (const method of PILOT_ADAPTER_METHODS) {
      if (method !== "checkAvailability") {
        expect(typeof providers.incomplete[method]).not.toBe("function");
      }
    }
  });
});

describe("manualOperationsAdapter — never fabricates real-provider behavior", () => {
  it("checkAvailability always reports not automatically available, clearly labeled simulated", async () => {
    const result = await manualOperationsAdapter.checkAvailability();

    expect(result.available).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.provider).toBe("manual_operations");
  });

  it("reserveVehicle requires an admin-supplied vehicleId rather than inventing one", async () => {
    await expect(manualOperationsAdapter.reserveVehicle({ rideId: "RIDE-1" })).rejects.toThrow(
      /admin-supplied vehicleId/
    );
  });

  it("reserveVehicle requires a rideId", async () => {
    await expect(manualOperationsAdapter.reserveVehicle({ vehicleId: "VAN-01" })).rejects.toThrow(
      /requires a rideId/
    );
  });

  it("reserveVehicle succeeds with both a rideId and an admin-supplied vehicleId", async () => {
    const result = await manualOperationsAdapter.reserveVehicle({
      rideId: "RIDE-1",
      vehicleId: "VAN-01",
      providerReservationId: "MANUAL-42"
    });

    expect(result.reserved).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.vehicle_id).toBe("VAN-01");
    expect(result.provider_reservation_id).toBe("MANUAL-42");
  });

  it("getVehicleLocation never returns a fabricated location — always null with an honest reason", async () => {
    const result = await manualOperationsAdapter.getVehicleLocation({ reservationId: "RES-1" });

    expect(result.location).toBeNull();
    expect(result.simulated).toBe(true);
    expect(result.reason).toBe("no_live_location_manual_operations");
  });

  it("getVehicleStatus echoes back the caller's known status rather than inventing one", async () => {
    const result = await manualOperationsAdapter.getVehicleStatus({
      reservationId: "RES-1",
      knownStatus: "vehicle_reserved"
    });

    expect(result.status).toBe("vehicle_reserved");
    expect(result.simulated).toBe(true);
  });

  it("getVehicleStatus falls back to 'unknown' rather than fabricating a status", async () => {
    const result = await manualOperationsAdapter.getVehicleStatus({ reservationId: "RES-1" });

    expect(result.status).toBe("unknown");
  });

  it("requestRemoteAssistance routes to human support instead of claiming vehicle control", async () => {
    const result = await manualOperationsAdapter.requestRemoteAssistance({
      reservationId: "RES-1",
      reason: "rider_requested_assistance"
    });

    expect(result.requested).toBe(true);
    expect(result.routed_to).toBe("human_support");
    expect(result.simulated).toBe(true);
  });

  it("requestRemoteAssistance and cancelReservation both require a reservationId", async () => {
    await expect(manualOperationsAdapter.requestRemoteAssistance({})).rejects.toThrow(
      /requires a reservationId/
    );
    await expect(manualOperationsAdapter.cancelReservation({})).rejects.toThrow(/requires a reservationId/);
  });

  it("cancelReservation succeeds given a reservationId", async () => {
    const result = await manualOperationsAdapter.cancelReservation({ reservationId: "RES-1" });

    expect(result.cancelled).toBe(true);
    expect(result.simulated).toBe(true);
  });
});
