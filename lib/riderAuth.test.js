const crypto = require("crypto");

const {
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  isNonNegativeInteger,
  shouldRenewSession,
  applyRiderSessionVersionIncrement,
  buildLogoutOutcome,
  resolveRiderAuthOutcome,
  buildRiderSessionBootstrap,
  phoneLast10,
  phoneToE164US,
  selectExactlyOneActiveRider,
  resolveVerificationTtlMinutes,
  hashIdentifier,
  hashLoginDestination,
  timingSafeEqualString,
  RIDER_SESSION_SUBJECT,
  RIDER_SESSION_VERSION_RPC,
  CLOCK_SKEW_TOLERANCE_MS
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

// For tests that need a payload verifyRiderSession would never sign
// itself (a forged/malformed claim) -- builds a correctly-signed token
// around an arbitrary payload object so the test proves the structural
// *validation*, not the signature check.
function makeRawToken(payload, secret = SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

function basePayload(overrides = {}) {
  return {
    sub: RIDER_SESSION_SUBJECT,
    rider_id: "RIDER-1",
    session_version: 0,
    iat: NOW,
    exp: NOW + 1000,
    ...overrides
  };
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

  test("accepts a token an instant before its expiry", () => {
    const token = sign();
    const justBeforeExpiry = NOW + 72 * 60 * 60 * 1000 - 1;
    const result = verifyRiderSession({ token, secret: SECRET, now: justBeforeExpiry });

    expect(result.ok).toBe(true);
  });

  test("rejects a token verified after its expiry", () => {
    const token = sign();
    const afterExpiry = NOW + 73 * 60 * 60 * 1000;
    const result = verifyRiderSession({ token, secret: SECRET, now: afterExpiry });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  test("fails closed exactly at the expiry instant (now === exp)", () => {
    const token = sign();
    const exactExpiry = NOW + 72 * 60 * 60 * 1000;
    const result = verifyRiderSession({ token, secret: SECRET, now: exactExpiry });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
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
    const token = makeRawToken(basePayload({ sub: "harvey-driver" }));
    const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  describe("session_version claim is never coerced to 0", () => {
    test.each([
      ["missing entirely", undefined],
      ["null", null],
      ["negative", -1],
      ["decimal", 1.5],
      ["NaN", NaN],
      ["a numeric string", "0"],
      ["a non-numeric string", "abc"],
      ["boolean true", true]
    ])("rejects as malformed when session_version is %s", (_label, badValue) => {
      const payload = basePayload();
      payload.session_version = badValue;
      const token = makeRawToken(payload);
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });

    test("session_version: 0 is accepted (a real, meaningful value, not a fallback)", () => {
      const token = makeRawToken(basePayload({ session_version: 0 }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

      expect(result.ok).toBe(true);
      expect(result.sessionVersion).toBe(0);
    });
  });

  describe("iat/exp structural validation", () => {
    test("rejects a non-finite iat", () => {
      const token = makeRawToken(basePayload({ iat: NaN }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });

    test("rejects a non-finite exp", () => {
      const token = makeRawToken(basePayload({ exp: Infinity }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });

    test("rejects a string iat/exp (no numeric coercion)", () => {
      const token = makeRawToken(basePayload({ iat: String(NOW), exp: String(NOW + 1000) }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });

    test("rejects exp equal to iat (zero-width window)", () => {
      const token = makeRawToken(basePayload({ iat: NOW, exp: NOW }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });

    test("rejects exp before iat (inverted window)", () => {
      const token = makeRawToken(basePayload({ iat: NOW, exp: NOW - 1000 }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
    });
  });

  describe("clock-skew tolerance for a future-dated iat", () => {
    test("accepts an iat within the documented clock-skew tolerance", () => {
      const slightlyFuture = NOW + CLOCK_SKEW_TOLERANCE_MS - 1;
      const token = makeRawToken(basePayload({ iat: slightlyFuture, exp: slightlyFuture + 10_000 }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(true);
    });

    test("rejects an iat materially ahead of now as issued_in_future", () => {
      const materiallyFuture = NOW + CLOCK_SKEW_TOLERANCE_MS + 10_000;
      const token = makeRawToken(basePayload({ iat: materiallyFuture, exp: materiallyFuture + 10_000 }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("issued_in_future");
    });
  });

  describe("riderId is exposed on a signature-verified-but-stale token, never on an untrusted one", () => {
    test("an expired token still returns the (trustworthy) riderId and sessionVersion", () => {
      const token = sign();
      const afterExpiry = NOW + 73 * 60 * 60 * 1000;
      const result = verifyRiderSession({ token, secret: SECRET, now: afterExpiry });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("expired");
      expect(result.riderId).toBe("RIDER-1");
      expect(result.sessionVersion).toBe(0);
    });

    test("an issued-in-future token still returns the (trustworthy) riderId and sessionVersion", () => {
      const materiallyFuture = NOW + CLOCK_SKEW_TOLERANCE_MS + 10_000;
      const token = makeRawToken(basePayload({ iat: materiallyFuture, exp: materiallyFuture + 10_000 }));
      const result = verifyRiderSession({ token, secret: SECRET, now: NOW });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("issued_in_future");
      expect(result.riderId).toBe("RIDER-1");
    });

    test("a bad-signature token exposes no riderId -- an attacker without the secret must not be able to name a victim", () => {
      const token = sign();
      const result = verifyRiderSession({ token, secret: "wrong-secret", now: NOW });

      expect(result.ok).toBe(false);
      expect(result.riderId).toBeUndefined();
    });

    test("a malformed token exposes no riderId", () => {
      const result = verifyRiderSession({ token: "not-a-real-token", secret: SECRET, now: NOW });

      expect(result.ok).toBe(false);
      expect(result.riderId).toBeUndefined();
    });

    test("a missing token exposes no riderId", () => {
      const result = verifyRiderSession({ token: "", secret: SECRET, now: NOW });

      expect(result.ok).toBe(false);
      expect(result.riderId).toBeUndefined();
    });
  });

  test("signRiderSession requires riderId, secret, and a positive ttlHours", () => {
    expect(() =>
      signRiderSession({ riderId: "", secret: SECRET, sessionVersion: 0, ttlHours: 72 })
    ).toThrow();
    expect(() =>
      signRiderSession({ riderId: "RIDER-1", secret: "", sessionVersion: 0, ttlHours: 72 })
    ).toThrow();
    expect(() =>
      signRiderSession({ riderId: "RIDER-1", secret: SECRET, sessionVersion: 0, ttlHours: 0 })
    ).toThrow();
    expect(() =>
      signRiderSession({ riderId: "RIDER-1", secret: SECRET, sessionVersion: 0, ttlHours: -5 })
    ).toThrow();
  });

  test.each([
    ["negative", -1],
    ["decimal", 1.5],
    ["NaN", NaN],
    ["a string", "0"],
    ["undefined", undefined],
    ["null", null]
  ])("signRiderSession rejects sessionVersion that is %s", (_label, badValue) => {
    expect(() =>
      signRiderSession({ riderId: "RIDER-1", secret: SECRET, sessionVersion: badValue, ttlHours: 72 })
    ).toThrow();
  });

  test("uses the documented subject claim", () => {
    expect(RIDER_SESSION_SUBJECT).toBe("harvey-rider");
  });
});

describe("isNonNegativeInteger", () => {
  test.each([
    [0, true],
    [1, true],
    [42, true],
    [-1, false],
    [1.5, false],
    [NaN, false],
    [Infinity, false],
    ["0", false],
    [null, false],
    [undefined, false],
    [true, false]
  ])("isNonNegativeInteger(%p) === %p", (value, expected) => {
    expect(isNonNegativeInteger(value)).toBe(expected);
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

describe("applyRiderSessionVersionIncrement — session invalidation cannot leave an unaudited version bump", () => {
  test("a successful atomic RPC call returns the updated rider", async () => {
    const updatedRider = { id: "RIDER-1", session_version: 1 };
    const callRpc = jest.fn().mockResolvedValue({ data: updatedRider, error: null });

    const result = await applyRiderSessionVersionIncrement({
      callRpc,
      riderId: "RIDER-1",
      actorType: "rider",
      actorId: "RIDER-1",
      action: "rider_logout",
      metadata: {},
      ipAddress: "1.2.3.4",
      userAgent: "test-agent"
    });

    expect(result).toEqual({ ok: true, rider: updatedRider });
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc).toHaveBeenCalledWith(RIDER_SESSION_VERSION_RPC, {
      p_rider_id: "RIDER-1",
      p_actor_type: "rider",
      p_actor_id: "RIDER-1",
      p_action: "rider_logout",
      p_metadata: {},
      p_ip_address: "1.2.3.4",
      p_user_agent: "test-agent"
    });
  });

  test("when the atomic call fails (e.g. the audit INSERT failed and rolled back the whole transaction), no increment is reported as applied", async () => {
    const callRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "insert into audit_logs violates not-null constraint" }
    });

    const result = await applyRiderSessionVersionIncrement({
      callRpc,
      riderId: "RIDER-1",
      actorType: "admin",
      actorId: "admin@example.com",
      action: "rider_force_logout",
      metadata: { reason: "reported account compromise" },
      ipAddress: "1.2.3.4",
      userAgent: "test-agent"
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(502);
  });

  test("defaults metadata/ip/user-agent when not supplied", async () => {
    const callRpc = jest.fn().mockResolvedValue({ data: { id: "RIDER-1" }, error: null });

    await applyRiderSessionVersionIncrement({
      callRpc,
      riderId: "RIDER-1",
      actorType: "rider",
      actorId: "RIDER-1",
      action: "rider_logout"
    });

    expect(callRpc).toHaveBeenCalledWith(RIDER_SESSION_VERSION_RPC, expect.objectContaining({
      p_metadata: {},
      p_ip_address: null,
      p_user_agent: null
    }));
  });
});

describe("buildLogoutOutcome — a revocation failure must never read as a successful logout", () => {
  test("no trusted riderId at all (no session, or an untrusted token): a clean, full success", () => {
    const outcome = buildLogoutOutcome({ hadTrustedRiderId: false, rpcSucceeded: false });

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body).toEqual({ logged_out: true, session_fully_invalidated: true });
  });

  test("a trusted session that the RPC successfully invalidated: a clean, full success", () => {
    const outcome = buildLogoutOutcome({ hadTrustedRiderId: true, rpcSucceeded: true });

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body).toEqual({ logged_out: true, session_fully_invalidated: true });
  });

  test("a trusted session whose RPC invalidation failed: reported as a partial failure, not success", () => {
    const outcome = buildLogoutOutcome({ hadTrustedRiderId: true, rpcSucceeded: false });

    expect(outcome.statusCode).toBe(502);
    expect(outcome.body.logged_out_locally).toBe(true);
    expect(outcome.body.session_fully_invalidated).toBe(false);
    // The specific field the caller must never set on this branch --
    // a partial failure must not carry the same "logged_out: true"
    // shape a real success does, or a client checking only that field
    // would wrongly treat it as a full logout.
    expect(outcome.body.logged_out).toBeUndefined();
    expect(typeof outcome.body.error).toBe("string");
    expect(outcome.body.error.length).toBeGreaterThan(0);
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

  test("fails closed exactly at the expiry instant (now === exp)", () => {
    expect(shouldRenewSession({ iat, exp, now: exp })).toBe(false);
  });

  test("does not renew when now is before iat", () => {
    expect(shouldRenewSession({ iat, exp, now: iat - 1 })).toBe(false);
  });

  test("does not renew when exp equals iat (zero-width window)", () => {
    expect(shouldRenewSession({ iat, exp: iat, now: iat })).toBe(false);
  });

  test("does not renew when exp is before iat (inverted window)", () => {
    expect(shouldRenewSession({ iat, exp: iat - 1000, now: iat })).toBe(false);
  });

  test("returns false for non-finite iat/exp/now rather than throwing", () => {
    expect(shouldRenewSession({ iat: undefined, exp, now: NOW })).toBe(false);
    expect(shouldRenewSession({ iat, exp: undefined, now: NOW })).toBe(false);
    expect(shouldRenewSession({ iat, exp, now: NaN })).toBe(false);
    expect(shouldRenewSession({ iat: "not-a-number", exp, now: NOW })).toBe(false);
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

describe("phoneLast10", () => {
  test("a bare 10-digit US number", () => {
    expect(phoneLast10("6156366201")).toBe("6156366201");
  });

  test("an 11-digit number with a leading country code 1", () => {
    expect(phoneLast10("16156366201")).toBe("6156366201");
  });

  test("a full E.164 number", () => {
    expect(phoneLast10("+16156366201")).toBe("6156366201");
  });

  test("formatting characters are ignored", () => {
    expect(phoneLast10("(615) 636-6201")).toBe("6156366201");
  });

  test("too short: not a valid US number", () => {
    expect(phoneLast10("636620")).toBe("");
  });

  test("11 digits NOT starting with 1: not accepted as a US number", () => {
    expect(phoneLast10("26156366201")).toBe("");
  });

  test("a malformed longer value that merely ends in a real number's 10 digits is rejected, not truncated to a match", () => {
    // The exact false-positive risk an ilike suffix lookup at the SQL
    // layer can hand back: a 13-digit garbage value ending in the same
    // 10 digits as a real number must not be treated as that number.
    expect(phoneLast10("9996156366201")).toBe("");
  });

  test("empty/null/undefined input", () => {
    expect(phoneLast10("")).toBe("");
    expect(phoneLast10(null)).toBe("");
    expect(phoneLast10(undefined)).toBe("");
  });
});

describe("phoneToE164US", () => {
  test("builds E.164 from a bare 10-digit number", () => {
    expect(phoneToE164US("6156366201")).toBe("+16156366201");
  });

  test("builds E.164 from an 11-digit number", () => {
    expect(phoneToE164US("16156366201")).toBe("+16156366201");
  });

  test("passes through an already-E.164 number unchanged", () => {
    expect(phoneToE164US("+16156366201")).toBe("+16156366201");
  });

  test("returns null for a value with no valid 10-digit US representation", () => {
    expect(phoneToE164US("9996156366201")).toBeNull();
    expect(phoneToE164US("123")).toBeNull();
    expect(phoneToE164US("")).toBeNull();
  });
});

describe("selectExactlyOneActiveRider — duplicate/ambiguous phone resolution", () => {
  const TARGET = "6156366201";

  function rider(overrides = {}) {
    return {
      id: "RIDER-1",
      phone: "6156366201",
      access_revoked: false,
      deleted_at: null,
      ...overrides
    };
  }

  test("a single active, exact-match candidate resolves cleanly", () => {
    const result = selectExactlyOneActiveRider([rider()], TARGET);

    expect(result.matchCount).toBe(1);
    expect(result.rider.id).toBe("RIDER-1");
  });

  test("no candidates at all: zero matches, not an error", () => {
    const result = selectExactlyOneActiveRider([], TARGET);

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("no target last10 provided: zero matches regardless of candidates", () => {
    const result = selectExactlyOneActiveRider([rider()], "");

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("a candidate whose own phone does NOT normalize to the target is excluded, even if an ilike prefilter returned it", () => {
    const result = selectExactlyOneActiveRider(
      [rider({ id: "RIDER-DIFFERENT", phone: "9996156366201" })],
      TARGET
    );

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("real duplicate phone across two active rider rows: ambiguous, resolves to no match -- never guesses", () => {
    const result = selectExactlyOneActiveRider(
      [rider({ id: "RIDER-A" }), rider({ id: "RIDER-B" })],
      TARGET
    );

    expect(result.matchCount).toBe(2);
    expect(result.rider).toBeNull();
  });

  test("a lone match that is access_revoked is excluded, not treated as a match", () => {
    const result = selectExactlyOneActiveRider([rider({ access_revoked: true })], TARGET);

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("a lone match that is soft-deleted (deleted_at set) is excluded", () => {
    const result = selectExactlyOneActiveRider([rider({ deleted_at: "2026-01-01T00:00:00Z" })], TARGET);

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("duplicate phone rows where one is revoked: resolves unambiguously to the surviving active row", () => {
    const result = selectExactlyOneActiveRider(
      [
        rider({ id: "RIDER-OLD-REVOKED", access_revoked: true }),
        rider({ id: "RIDER-CURRENT", access_revoked: false })
      ],
      TARGET
    );

    expect(result.matchCount).toBe(1);
    expect(result.rider.id).toBe("RIDER-CURRENT");
  });

  test("duplicate phone rows where one is soft-deleted: resolves unambiguously to the surviving row", () => {
    const result = selectExactlyOneActiveRider(
      [
        rider({ id: "RIDER-DELETED", deleted_at: "2026-01-01T00:00:00Z" }),
        rider({ id: "RIDER-CURRENT" })
      ],
      TARGET
    );

    expect(result.matchCount).toBe(1);
    expect(result.rider.id).toBe("RIDER-CURRENT");
  });

  test("duplicate phone rows where BOTH are revoked/deleted: no eligible match at all", () => {
    const result = selectExactlyOneActiveRider(
      [
        rider({ id: "RIDER-A", access_revoked: true }),
        rider({ id: "RIDER-B", deleted_at: "2026-01-01T00:00:00Z" })
      ],
      TARGET
    );

    expect(result.matchCount).toBe(0);
    expect(result.rider).toBeNull();
  });

  test("never picks a first/best row when multiple are eligible -- confirmed by matchCount, not just rider === null", () => {
    const result = selectExactlyOneActiveRider(
      [rider({ id: "FIRST" }), rider({ id: "SECOND" }), rider({ id: "THIRD" })],
      TARGET
    );

    expect(result.matchCount).toBe(3);
    expect(result.rider).toBeNull();
  });
});

describe("resolveVerificationTtlMinutes — OTP expiration", () => {
  test("an explicit override wins regardless of channel", () => {
    const minutes = resolveVerificationTtlMinutes({
      isEmail: true,
      ttlMinutes: 10,
      emailVerifyTtlHours: 24,
      verifyTtlMinutes: 10
    });

    expect(minutes).toBe(10);
  });

  test("rider login's short email TTL is honored, not the long default account-verification TTL", () => {
    const minutes = resolveVerificationTtlMinutes({
      isEmail: true,
      ttlMinutes: 10,
      emailVerifyTtlHours: 24,
      verifyTtlMinutes: 10
    });

    expect(minutes).toBe(10);
    expect(minutes).toBeLessThan(24 * 60);
  });

  test("email with no override falls back to the channel default (hours converted to minutes)", () => {
    const minutes = resolveVerificationTtlMinutes({
      isEmail: true,
      ttlMinutes: undefined,
      emailVerifyTtlHours: 24,
      verifyTtlMinutes: 10
    });

    expect(minutes).toBe(24 * 60);
  });

  test("SMS with no override falls back to the SMS default", () => {
    const minutes = resolveVerificationTtlMinutes({
      isEmail: false,
      ttlMinutes: undefined,
      emailVerifyTtlHours: 24,
      verifyTtlMinutes: 10
    });

    expect(minutes).toBe(10);
  });

  test("a zero or negative override is treated as no override (falls back to the channel default)", () => {
    expect(
      resolveVerificationTtlMinutes({
        isEmail: true,
        ttlMinutes: 0,
        emailVerifyTtlHours: 24,
        verifyTtlMinutes: 10
      })
    ).toBe(24 * 60);

    expect(
      resolveVerificationTtlMinutes({
        isEmail: true,
        ttlMinutes: -5,
        emailVerifyTtlHours: 24,
        verifyTtlMinutes: 10
      })
    ).toBe(24 * 60);
  });

  test("a non-finite override (NaN) is treated as no override", () => {
    expect(
      resolveVerificationTtlMinutes({
        isEmail: false,
        ttlMinutes: NaN,
        emailVerifyTtlHours: 24,
        verifyTtlMinutes: 10
      })
    ).toBe(10);
  });
});

describe("hashIdentifier", () => {
  test("never returns the raw input value", () => {
    const raw = "6156366201";
    const hashed = hashIdentifier(raw);

    expect(hashed).not.toBe(raw);
    expect(hashed).not.toContain(raw);
  });

  test("is deterministic for the same input", () => {
    expect(hashIdentifier("same-value")).toBe(hashIdentifier("same-value"));
  });

  test("different inputs produce different hashes", () => {
    expect(hashIdentifier("value-a")).not.toBe(hashIdentifier("value-b"));
  });

  test("handles empty/null/undefined without throwing", () => {
    expect(() => hashIdentifier("")).not.toThrow();
    expect(() => hashIdentifier(null)).not.toThrow();
    expect(() => hashIdentifier(undefined)).not.toThrow();
  });
});

describe("hashLoginDestination — rate-limit key derivation, both dimensions", () => {
  test("a phone destination never leaks the raw or even the normalized digits in the key", () => {
    const key = hashLoginDestination({ phone: "6156366201", email: "" });

    expect(key).not.toContain("6156366201");
  });

  test("an email destination never leaks the raw address in the key", () => {
    const key = hashLoginDestination({ phone: "", email: "rider@example.com" });

    expect(key).not.toContain("rider@example.com");
  });

  test("the same phone number in different formats collapses to the same rate-limit key", () => {
    const a = hashLoginDestination({ phone: "6156366201", email: "" });
    const b = hashLoginDestination({ phone: "16156366201", email: "" });
    const c = hashLoginDestination({ phone: "+16156366201", email: "" });

    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("phone and email destinations hash to different keys even if one is empty-ish", () => {
    const phoneKey = hashLoginDestination({ phone: "6156366201", email: "" });
    const emailKey = hashLoginDestination({ phone: "", email: "6156366201@example.com" });

    expect(phoneKey).not.toBe(emailKey);
  });

  test("phone takes priority over email when both are somehow present, matching the routes' own phone-first branching", () => {
    const withBoth = hashLoginDestination({ phone: "6156366201", email: "rider@example.com" });
    const phoneOnly = hashLoginDestination({ phone: "6156366201", email: "" });

    expect(withBoth).toBe(phoneOnly);
  });

  test("two different phone numbers produce different keys (the limiter is actually per-destination, not global)", () => {
    const a = hashLoginDestination({ phone: "6156366201", email: "" });
    const b = hashLoginDestination({ phone: "6159145359", email: "" });

    expect(a).not.toBe(b);
  });
});

describe("resolveRiderAuthOutcome — requireRider's auth decision (P0 remediation, PR #1)", () => {
  function activeRider(overrides = {}) {
    return {
      id: "RIDER-1",
      access_revoked: false,
      deleted_at: null,
      session_version: 0,
      ...overrides
    };
  }

  test("no session at all: 401, no riderId ever exposed", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: false, reason: "no_session" },
      riderRow: null
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
    expect(outcome.riderId).toBeUndefined();
  });

  test("an unsigned/tampered/malformed token: 401, treated the same as no session", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: false, reason: "bad_signature" },
      riderRow: null
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("an expired token: 401, never falls through to authenticated", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: false, reason: "expired", riderId: "RIDER-1", sessionVersion: 0 },
      riderRow: activeRider()
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("a validly signed token naming a rider row that no longer exists: 401, not 404 (never confirms/denies existence to an unauthenticated caller)", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-DELETED", sessionVersion: 0, iat: 0, exp: 1000 },
      riderRow: null
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("access_revoked rider: 403, distinct from an invalid session", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 0, iat: 0, exp: 1000 },
      riderRow: activeRider({ access_revoked: true })
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  test("soft-deleted rider (deleted_at set, access_revoked left false): still 403, not treated as active", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 0, iat: 0, exp: 1000 },
      riderRow: activeRider({ deleted_at: "2026-01-01T00:00:00Z" })
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  test("token's session_version is stale against the rider row (logged out elsewhere / Force Logout): 401", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 0, iat: 0, exp: 1000 },
      riderRow: activeRider({ session_version: 1 })
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("a rider row with a null/non-integer session_version is treated as version 0, not as always-current", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 1, iat: 0, exp: 1000 },
      riderRow: activeRider({ session_version: null })
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("a fully valid, current, active session: authenticated, riderId comes from the verified token", () => {
    const outcome = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 2, iat: 0, exp: 1000 },
      riderRow: activeRider({ session_version: 2 })
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.riderId).toBe("RIDER-1");
  });

  test("carries shouldRenew through from shouldRenewSession rather than recomputing its own renewal rule", () => {
    const iat = NOW;
    const exp = NOW + 1000;

    const pastHalfway = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 0, iat, exp },
      riderRow: activeRider(),
      now: iat + 600
    });
    expect(pastHalfway.shouldRenew).toBe(true);

    const notYetHalfway = resolveRiderAuthOutcome({
      verification: { ok: true, riderId: "RIDER-1", sessionVersion: 0, iat, exp },
      riderRow: activeRider(),
      now: iat + 100
    });
    expect(notYetHalfway.shouldRenew).toBe(false);
  });
});

describe("buildRiderSessionBootstrap — GET /api/rider/session's response contract (P0 remediation, PR #2a)", () => {
  // String-valued fields only -- toContain does a substring check, so
  // this list intentionally excludes boolean/null columns like
  // access_revoked/deleted_at (the first test's exact-keys assertion
  // already proves those aren't present at all; a substring check on a
  // boolean isn't meaningful).
  const SENSITIVE_RIDER_STRING_FIELDS = [
    "stripe_customer_id",
    "phone",
    "email",
    "password_hash",
    "persona_status",
    "internal_notes",
    "address"
  ];

  function fullRiderRow(overrides = {}) {
    return {
      id: "RIDER-1",
      first_name: "Jordan",
      last_name: "Rivers",
      approval_status: "approved",
      stripe_customer_id: "cus_secret123",
      phone: "6156366201",
      email: "jordan@example.com",
      password_hash: "should-never-exist-but-just-in-case",
      session_version: 3,
      access_revoked: false,
      deleted_at: null,
      persona_status: "persona_status_should_not_leak",
      internal_notes: "flagged for VIP treatment",
      address: "123 Secret St",
      ...overrides
    };
  }

  test("returns exactly the allow-listed keys, nothing more", () => {
    const result = buildRiderSessionBootstrap({
      rider: fullRiderRow(),
      readiness: { ready: true, checks: { email_verified: true } }
    });

    expect(Object.keys(result).sort()).toEqual(
      ["approval_status", "checks", "first_name", "last_name", "ready", "rider_id"].sort()
    );
  });

  test("never leaks payment, contact, or internal fields even though the input rider row carries them", () => {
    const result = buildRiderSessionBootstrap({
      rider: fullRiderRow(),
      readiness: { ready: true, checks: {} }
    });

    const serialized = JSON.stringify(result);

    for (const field of SENSITIVE_RIDER_STRING_FIELDS) {
      expect(serialized).not.toContain(fullRiderRow()[field]);
    }
  });

  test("rider_id always comes from rider.id, and first/last name fall back to null when absent", () => {
    const result = buildRiderSessionBootstrap({
      rider: { id: "RIDER-2" },
      readiness: { ready: false, checks: {} }
    });

    expect(result.rider_id).toBe("RIDER-2");
    expect(result.first_name).toBeNull();
    expect(result.last_name).toBeNull();
    expect(result.approval_status).toBeNull();
  });

  test("ready and checks are sourced from the readiness argument, not guessed from the rider row", () => {
    const notReady = buildRiderSessionBootstrap({
      rider: fullRiderRow(),
      readiness: { ready: false, checks: { email_verified: false, phone_verified: true } }
    });

    expect(notReady.ready).toBe(false);
    expect(notReady.checks).toEqual({ email_verified: false, phone_verified: true });
  });

  test("a missing/undefined readiness argument never throws and defaults to not-ready with empty checks", () => {
    const result = buildRiderSessionBootstrap({ rider: fullRiderRow(), readiness: undefined });

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual({});
  });
});
