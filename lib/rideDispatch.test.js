const { RIDE_STATUS, shouldDispatchRideNow } = require("./rideDispatch");

describe("shouldDispatchRideNow", () => {
  it("does not dispatch a future scheduled ride immediately", () => {
    const ride = {
      id: "scheduled-test",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    expect(shouldDispatchRideNow(ride)).toBe(false);
  });

  it("dispatches once the scheduled time has arrived", () => {
    const ride = {
      id: "scheduled-due",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: new Date(Date.now() - 60 * 1000).toISOString()
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("dispatches an unscheduled ride immediately once payment is authorized", () => {
    const ride = {
      id: "unscheduled",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: null
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("does not dispatch a ride that hasn't been payment-authorized yet", () => {
    const ride = {
      id: "unpaid",
      status: RIDE_STATUS.PAYMENT_REQUIRED,
      scheduled_time: null
    };

    expect(shouldDispatchRideNow(ride)).toBe(false);
  });

  it("treats an unparseable scheduled_time as immediately dispatchable rather than stuck forever", () => {
    const ride = {
      id: "bad-schedule",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: "not-a-real-date"
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("respects an explicit reference time instead of always using the live clock", () => {
    const scheduledFor = new Date("2026-01-01T12:00:00.000Z");
    const ride = {
      id: "explicit-now",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: scheduledFor.toISOString()
    };

    expect(
      shouldDispatchRideNow(ride, new Date("2026-01-01T11:59:00.000Z"))
    ).toBe(false);

    expect(
      shouldDispatchRideNow(ride, new Date("2026-01-01T12:00:00.000Z"))
    ).toBe(true);
  });
});
