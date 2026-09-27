const { createFakeSupabase } = require("../test/fakeSupabase");
const { RIDE_STATUS } = require("./rideDispatch");
const {
  ACTIVE_RIDE_STATUSES,
  excludeBusyDrivers,
  getBusyDriverIds
} = require("./driverAvailability");

describe("excludeBusyDrivers", () => {
  it("filters out drivers whose id is in the busy set", () => {
    const drivers = [{ id: "D1" }, { id: "D2" }, { id: "D3" }];

    expect(excludeBusyDrivers(drivers, ["D2"])).toEqual([{ id: "D1" }, { id: "D3" }]);
  });

  it("returns all drivers unchanged when nothing is busy", () => {
    const drivers = [{ id: "D1" }, { id: "D2" }];

    expect(excludeBusyDrivers(drivers, [])).toEqual(drivers);
    expect(excludeBusyDrivers(drivers, undefined)).toEqual(drivers);
  });

  it("compares ids as strings, so a numeric/string id mismatch still matches", () => {
    const drivers = [{ id: 42 }, { id: "43" }];

    expect(excludeBusyDrivers(drivers, ["42"])).toEqual([{ id: "43" }]);
  });

  it("handles an empty driver list", () => {
    expect(excludeBusyDrivers([], ["D1"])).toEqual([]);
  });
});

describe("getBusyDriverIds", () => {
  it("returns the driver_id of every ride in an active-ride status", async () => {
    const supabase = createFakeSupabase({
      rides: [
        { id: "R1", driver_id: "D1", status: RIDE_STATUS.DRIVER_ASSIGNED },
        { id: "R2", driver_id: "D2", status: RIDE_STATUS.DRIVER_ENROUTE },
        { id: "R3", driver_id: "D3", status: RIDE_STATUS.ARRIVED },
        { id: "R4", driver_id: "D4", status: RIDE_STATUS.IN_PROGRESS },
        { id: "R5", driver_id: "D5", status: RIDE_STATUS.AWAITING_DRIVER },
        { id: "R6", driver_id: "D6", status: RIDE_STATUS.COMPLETED }
      ]
    });

    const ids = await getBusyDriverIds({ supabase });

    expect(ids.sort()).toEqual(["D1", "D2", "D3", "D4"]);
  });

  it("deduplicates a driver who somehow appears on more than one active ride row", async () => {
    const supabase = createFakeSupabase({
      rides: [
        { id: "R1", driver_id: "D1", status: RIDE_STATUS.DRIVER_ASSIGNED },
        { id: "R2", driver_id: "D1", status: RIDE_STATUS.IN_PROGRESS }
      ]
    });

    const ids = await getBusyDriverIds({ supabase });

    expect(ids).toEqual(["D1"]);
  });

  it("excludes null/empty driver_id values", async () => {
    const supabase = createFakeSupabase({
      rides: [
        { id: "R1", driver_id: null, status: RIDE_STATUS.DRIVER_ASSIGNED }
      ]
    });

    const ids = await getBusyDriverIds({ supabase });

    expect(ids).toEqual([]);
  });

  it("uses ACTIVE_RIDE_STATUSES as the default status filter", () => {
    expect(ACTIVE_RIDE_STATUSES).toEqual([
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ]);
  });
});
