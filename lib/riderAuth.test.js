const {
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  shouldRenewSession,
  timingSafeEqualString,
  RIDER_SESSION_SUBJECT
} = require("./riderAuth");

const SECRET = "test-rider-session-secret";
const NOW = 1_700_000_000_000;

function sign(overrides = {}) {
  return signRiderSession({
    riderId: "RIDER-1",
    sessionVersion: 0,
    secret: SECRET,
    ttlHours: 72,
    now: NOW,
    ...overrides
  });
}

describe("signRiderSession / verifyRiderSession round trip", () => {
  test("a freshly signed token verifies successfully", () => {
    const token = sign();
    const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

    expect(result.ok).toBe(true);
    expect(result.riderId).toBe("RIDER-1");
    expect(result.sessionVersion).toBe(0);
    expect(result.iat).toBe(NOW);
    expect(result.exp).toBe(NOW + 72 * 60 * 60 * 1000);
  });

  test("embeds the given sessionVersion, not always 0", () => {
    const token = sign({ sessionVersion: 4 });
    const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

    expect(result.ok).toBe(true);
    expect(result.sessionVersion).toBe(4);
  });

  test("rejects a token verified after its expiry", () => {
    const token = sign();
    const afterExpiry = NOW + 73 * 60 * 60 * 1000;
    const result = verifyRiderSession({ token, secret: SECRET, now: afterExpiry });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  test("accepts a token right up to (not past) its expiry instant", () => {
    const token = sign();
    const exactExpiry = NOW + 72 * 60 * 60 * 1000;
    const result = verifyRiderSession({ token, secret: SECRET, now: exactExpiry });

    expect(result.ok).toBe(true);
  });

  test("rejects a token signed with a different secret", () => {
    const token = sign();
    const result = verifyRiderSession({ token, secret: "wrong-secret", now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  test("rejects a tampered payload even if the signature format still parses", () => {
    const token = sign();
    const [encoded, sig] = token.split(".");
    const tampered = `${encoded}x.${sig}`;
    const result = verifyRiderSession({ token: tampered, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  test("rejects a malformed token with the wrong number of segments", () => {
    const result = verifyRiderSession({ token: "not-a-real-token", secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("rejects an empty or missing token", () => {
    expect(verifyRiderSession({ token: "", secret: SECRET, now: NOW }).ok).toBe(false);
    expect(verifyRiderSession({ token: null, secret: SECRET, now: NOW }).ok).toBe(false);
    expect(verifyRiderSession({ token: undefined, secret: SECRET, now: NOW }).ok).toBe(false);
  });

  test("rejects verification with no secret configured", () => {
    const token = sign();
    const result = verifyRiderSession({ token, secret: "", now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_token");
  });

  test("rejects a token whose subject claim was swapped for another session type", () => {
    // Simulates a driver or admin token (a different "sub") somehow
    // being presented at a rider route -- must not be accepted just
    // because the signature happens to verify against the same secret.
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: "harvey-driver",
        rider_id: "RIDER-1",
        session_version: 0,
        iat: NOW,
        exp: NOW + 1000
      }),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const crypto = require("crypto");
    const sig = crypto.createHmac("sha256", SECRET).update(forgedPayload).digest("hex");
    const result = verifyRiderSession({ token: `${forgedPayload}.${sig}`, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("signRiderSession requires riderId, secret, and a positive ttlHours", () => {
    expect(() => signRiderSession({ riderId: "", secret: SECRET, ttlHours: 72 })).toThrow();
    expect(() => signRiderSession({ riderId: "RIDER-1", secret: "", ttlHours: 72 })).toThrow();
    expect(() => signRiderSession({ riderId: "RIDER-1", secret: SECRET, ttlHours: 0 })).toThrow();
    expect(() => signRiderSession({ riderId: "RIDER-1", secret: SECRET, ttlHours: -5 })).toThrow();
  });

  test("uses the documented subject claim", () => {
    expect(RIDER_SESSION_SUBJECT).toBe("harvey-rider");
  });
});

describe("isSessionVersionCurrent", () => {
  test("matches when token version equals the rider's current version", () => {
    expect(isSessionVersionCurrent({ tokenVersion: 3, currentVersion: 3 })).toBe(true);
  });

  test("rejects a token from before a logout bumped the version", () => {
    expect(isSessionVersionCurrent({ tokenVersion: 2, currentVersion: 3 })).toBe(false);
  });

  test("rejects a token version claiming to be ahead of the rider's real version", () => {
    // Should never happen from a legitimately signed token, but the
    // check must not treat "ahead" as somehow more valid than "behind" --
    // it's exact equality only, not a >= comparison in either direction.
    expect(isSessionVersionCurrent({ tokenVersion: 5, currentVersion: 3 })).toBe(false);
  });
});

describe("shouldRenewSession", () => {
  const iat = NOW;
  const exp = NOW + 72 * 60 * 60 * 1000;

  test("does not renew a freshly issued session", () => {
    expect(shouldRenewSession({ iat, exp, now: iat })).toBe(false);
  });

  test("does not renew before the halfway point of the TTL", () => {
    const justBeforeHalf = iat + 35 * 60 * 60 * 1000;
    expect(shouldRenewSession({ iat, exp, now: justBeforeHalf })).toBe(false);
  });

  test("renews once past the halfway point of the TTL", () => {
    const justAfterHalf = iat + 37 * 60 * 60 * 1000;
    expect(shouldRenewSession({ iat, exp, now: justAfterHalf })).toBe(true);
  });

  test("does not renew a session that has already expired", () => {
    const afterExpiry = exp + 1000;
    expect(shouldRenewSession({ iat, exp, now: afterExpiry })).toBe(false);
  });

  test("returns false for malformed iat/exp input rather than throwing", () => {
    expect(shouldRenewSession({ iat: undefined, exp, now: NOW })).toBe(false);
    expect(shouldRenewSession({ iat, exp: undefined, now: NOW })).toBe(false);
  });
});

describe("timingSafeEqualString", () => {
  test("returns true for identical strings", () => {
    expect(timingSafeEqualString("abc123", "abc123")).toBe(true);
  });

  test("returns false for different strings of the same length", () => {
    expect(timingSafeEqualString("abc123", "abc124")).toBe(false);
  });

  test("returns false for strings of different lengths without throwing", () => {
    expect(timingSafeEqualString("short", "a-much-longer-string")).toBe(false);
  });

  test("treats null/undefined as empty strings rather than throwing", () => {
    expect(timingSafeEqualString(null, "")).toBe(true);
    expect(timingSafeEqualString(undefined, "x")).toBe(false);
  });
});
