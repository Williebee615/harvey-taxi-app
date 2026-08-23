const { computeRetryAfterSeconds, buildRateLimitExceededLogEvent } = require("./rateLimit");

describe("computeRetryAfterSeconds", () => {
  test("rounds up to the next whole second", () => {
    expect(computeRetryAfterSeconds({ resetAt: 10_500, now: 9_000 })).toBe(2);
  });

  test("returns 0, never negative, once resetAt has already passed", () => {
    expect(computeRetryAfterSeconds({ resetAt: 1_000, now: 5_000 })).toBe(0);
  });

  test("returns 0 exactly at the reset boundary", () => {
    expect(computeRetryAfterSeconds({ resetAt: 5_000, now: 5_000 })).toBe(0);
  });

  test("returns null for non-finite input rather than NaN or throwing", () => {
    expect(computeRetryAfterSeconds({ resetAt: NaN, now: 1000 })).toBeNull();
    expect(computeRetryAfterSeconds({ resetAt: undefined, now: 1000 })).toBeNull();
    expect(computeRetryAfterSeconds({ resetAt: 1000, now: NaN })).toBeNull();
  });
});

describe("buildRateLimitExceededLogEvent", () => {
  test("produces a sanitized event with only the key prefix and retry time", () => {
    const event = buildRateLimitExceededLogEvent({
      keyPrefix: "review_rider_login_dest",
      retryAfterSeconds: 480
    });

    expect(event).toEqual({
      event: "rate_limit_exceeded",
      key_prefix: "review_rider_login_dest",
      retry_after_seconds: 480
    });
  });

  test("never includes anything resembling a raw identity, credential, or session artifact", () => {
    const event = buildRateLimitExceededLogEvent({
      keyPrefix: "review_rider_login_dest",
      retryAfterSeconds: 60
    });

    // The function's own parameter list already proves this (it never
    // accepts an email/password/token/cookie in the first place) -- this
    // assertion guards against a future edit accidentally widening it.
    const forbiddenFieldNamePattern = /email|password|token|cookie|authorization|ip\b/i;
    Object.keys(event).forEach((field) => {
      expect(field).not.toMatch(forbiddenFieldNamePattern);
    });
  });
});
