const {
  CAPTURE_STATUS,
  isCaptureResolved,
  captureIdempotencyKey,
  decideCaptureAction
} = require("./ridePaymentCapture");

describe("captureIdempotencyKey", () => {
  it("derives a stable key from only the ride id", () => {
    expect(captureIdempotencyKey("RIDE_123")).toBe("complete-capture:RIDE_123");
    expect(captureIdempotencyKey("RIDE_123")).toBe(captureIdempotencyKey("RIDE_123"));
  });

  it("differs for different rides", () => {
    expect(captureIdempotencyKey("RIDE_1")).not.toBe(captureIdempotencyKey("RIDE_2"));
  });
});

describe("isCaptureResolved", () => {
  it("treats captured, capture_failed, and not_required as resolved", () => {
    expect(isCaptureResolved(CAPTURE_STATUS.CAPTURED)).toBe(true);
    expect(isCaptureResolved(CAPTURE_STATUS.CAPTURE_FAILED)).toBe(true);
    expect(isCaptureResolved(CAPTURE_STATUS.NOT_REQUIRED)).toBe(true);
  });

  it("treats pending and capture_pending as unresolved", () => {
    expect(isCaptureResolved(CAPTURE_STATUS.PENDING)).toBe(false);
    expect(isCaptureResolved(CAPTURE_STATUS.CAPTURE_PENDING)).toBe(false);
    expect(isCaptureResolved(null)).toBe(false);
    expect(isCaptureResolved(undefined)).toBe(false);
  });
});

describe("decideCaptureAction", () => {
  it("attempts on a true first pass (no payment_status yet, Stripe configured, has payment_id)", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: null },
      stripeConfigured: true
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("resumes (attempts again) from capture_pending -- the crash-mid-attempt case", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.CAPTURE_PENDING },
      stripeConfigured: true
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("skips a ride whose capture already succeeded", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.CAPTURED },
      stripeConfigured: true
    });

    expect(result.action).toBe("skip");
    expect(result.reason).toContain("captured");
  });

  it("skips (does not auto-retry) a ride whose capture already failed once", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.CAPTURE_FAILED },
      stripeConfigured: true
    });

    expect(result.action).toBe("skip");
    expect(result.reason).toContain("capture_failed");
  });

  it("attempts a previously-failed capture only when forceRetry is explicitly set (admin reconciliation)", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.CAPTURE_FAILED },
      stripeConfigured: true,
      forceRetry: true
    });

    expect(result).toEqual({ action: "attempt" });
  });

  it("forceRetry never resurrects an already-captured or not_required ride", () => {
    expect(
      decideCaptureAction({
        ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.CAPTURED },
        stripeConfigured: true,
        forceRetry: true
      }).action
    ).toBe("skip");

    expect(
      decideCaptureAction({
        ride: { id: "R1", payment_id: "pi_123", payment_status: CAPTURE_STATUS.NOT_REQUIRED },
        stripeConfigured: true,
        forceRetry: true
      }).action
    ).toBe("skip");
  });

  it("returns not_required when Stripe isn't configured", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: "pi_123", payment_status: null },
      stripeConfigured: false
    });

    expect(result).toEqual({ action: "not_required" });
  });

  it("returns not_required when the ride has no payment_id at all", () => {
    const result = decideCaptureAction({
      ride: { id: "R1", payment_id: null, payment_status: null },
      stripeConfigured: true
    });

    expect(result).toEqual({ action: "not_required" });
  });

  it("skips gracefully when given no ride", () => {
    expect(decideCaptureAction({ ride: null, stripeConfigured: true })).toEqual({
      action: "skip",
      reason: "no_ride"
    });
  });
});
