const { RIDE_STATUS } = require("./rideDispatch");
const {
  CANCELLATION_PAYMENT_STATUS,
  isCancellable,
  hasAssignedDriver,
  cancelPaymentIdempotencyKey,
  decideCancelPaymentAction
} = require("./rideCancellation");

describe("isCancellable", () => {
  it("allows every pre-in_progress status", () => {
    expect(isCancellable(RIDE_STATUS.DRAFT)).toBe(true);
    expect(isCancellable(RIDE_STATUS.PAYMENT_REQUIRED)).toBe(true);
    expect(isCancellable(RIDE_STATUS.PAYMENT_AUTHORIZED)).toBe(true);
    expect(isCancellable(RIDE_STATUS.AWAITING_DRIVER)).toBe(true);
    expect(isCancellable(RIDE_STATUS.DRIVER_ASSIGNED)).toBe(true);
    expect(isCancellable(RIDE_STATUS.DRIVER_ENROUTE)).toBe(true);
    expect(isCancellable(RIDE_STATUS.ARRIVED)).toBe(true);
    expect(isCancellable(RIDE_STATUS.FAILED)).toBe(true);
  });

  it("blocks in_progress -- no self-service cancellation once the trip starts", () => {
    expect(isCancellable(RIDE_STATUS.IN_PROGRESS)).toBe(false);
  });

  it("blocks both terminal statuses", () => {
    expect(isCancellable(RIDE_STATUS.COMPLETED)).toBe(false);
    expect(isCancellable(RIDE_STATUS.CANCELLED)).toBe(false);
  });
});

describe("hasAssignedDriver", () => {
  it("is true only once a driver has accepted, before the trip starts", () => {
    expect(hasAssignedDriver(RIDE_STATUS.DRIVER_ASSIGNED)).toBe(true);
    expect(hasAssignedDriver(RIDE_STATUS.DRIVER_ENROUTE)).toBe(true);
    expect(hasAssignedDriver(RIDE_STATUS.ARRIVED)).toBe(true);
  });

  it("is false before acceptance and once the trip is underway", () => {
    expect(hasAssignedDriver(RIDE_STATUS.AWAITING_DRIVER)).toBe(false);
    expect(hasAssignedDriver(RIDE_STATUS.PAYMENT_AUTHORIZED)).toBe(false);
    expect(hasAssignedDriver(RIDE_STATUS.IN_PROGRESS)).toBe(false);
  });
});

describe("cancelPaymentIdempotencyKey", () => {
  it("is stable per ride id and distinct from the capture key namespace", () => {
    expect(cancelPaymentIdempotencyKey("RIDE_1")).toBe("cancel-payment-intent:RIDE_1");
    expect(cancelPaymentIdempotencyKey("RIDE_1")).toBe(cancelPaymentIdempotencyKey("RIDE_1"));
  });
});

describe("decideCancelPaymentAction", () => {
  it("attempts on a first pass with a payment_id present", () => {
    const result = decideCancelPaymentAction({
      ride: { id: "R1", payment_id: "pi_123", cancellation_payment_status: null }
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("resumes from cancel_pending -- the crash-before-void-recorded case", () => {
    const result = decideCancelPaymentAction({
      ride: { id: "R1", payment_id: "pi_123", cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCEL_PENDING }
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("resumes from cancel_failed -- a repeated cancel request must not silently abandon reconciliation", () => {
    const result = decideCancelPaymentAction({
      ride: { id: "R1", payment_id: "pi_123", cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED }
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("skips once already cancelled", () => {
    const result = decideCancelPaymentAction({
      ride: { id: "R1", payment_id: "pi_123", cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCELLED }
    });

    expect(result).toEqual({ action: "skip", reason: "already_cancelled" });
  });

  it("returns not_required when there is no payment_id at all", () => {
    const result = decideCancelPaymentAction({
      ride: { id: "R1", payment_id: null, cancellation_payment_status: null }
    });

    expect(result).toEqual({ action: "not_required" });
  });

  it("skips gracefully when given no ride", () => {
    expect(decideCancelPaymentAction({ ride: null })).toEqual({ action: "skip", reason: "no_ride" });
  });
});

describe("decideCancelPaymentAction for App Review rides", () => {
  it("never cancels a Stripe payment for a review ride, even with a payment id", () => {
    const ride = { id: "RIDE_R", is_review_ride: true, payment_id: "pi_x", payment_status: "authorized" };
    expect(decideCancelPaymentAction({ ride })).toEqual({ action: "not_required", reason: "review_ride" });
  });

  it("does not treat a truthy non-boolean flag as a review ride", () => {
    const ride = { id: "RIDE_N", is_review_ride: 1, payment_id: "pi_x", payment_status: "authorized" };
    expect(decideCancelPaymentAction({ ride }).reason).not.toBe("review_ride");
  });
});
