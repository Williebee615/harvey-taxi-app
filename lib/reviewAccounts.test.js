const {
  hashReviewPassword,
  verifyReviewPassword,
  isReviewAccountRow,
  resolveReviewLoginOutcome,
  resolveReviewSessionOutcome,
  isValidatedReviewerSession,
  planReviewAwareDispatch,
  buildSimulatedPaymentIntentResponse,
  SIMULATED_PAYMENT_LABEL
} = require("./reviewAccounts");

describe("hashReviewPassword / verifyReviewPassword", () => {
  test("round-trips a correct password", () => {
    const { salt, hash } = hashReviewPassword("correct-horse-battery");
    expect(verifyReviewPassword({ password: "correct-horse-battery", salt, hash })).toBe(true);
  });

  test("rejects a wrong password", () => {
    const { salt, hash } = hashReviewPassword("correct-horse-battery");
    expect(verifyReviewPassword({ password: "wrong-password-here", salt, hash })).toBe(false);
  });

  test("two hashes of the same password use different salts and hashes", () => {
    const a = hashReviewPassword("correct-horse-battery");
    const b = hashReviewPassword("correct-horse-battery");
    expect(a.salt).not.toEqual(b.salt);
    expect(a.hash).not.toEqual(b.hash);
  });

  test("rejects passwords shorter than 12 characters", () => {
    expect(() => hashReviewPassword("short")).toThrow();
  });

  test("verifyReviewPassword fails closed on missing salt/hash instead of throwing", () => {
    expect(verifyReviewPassword({ password: "anything", salt: null, hash: null })).toBe(false);
    expect(verifyReviewPassword({ password: "anything", salt: "abc", hash: null })).toBe(false);
    expect(verifyReviewPassword({ password: "", salt: "abc", hash: "def" })).toBe(false);
  });

  test("verifyReviewPassword fails closed on a malformed stored hash rather than throwing", () => {
    expect(
      verifyReviewPassword({ password: "anything", salt: "not-hex-!!!", hash: "also-not-hex-!!!" })
    ).toBe(false);
  });
});

describe("isReviewAccountRow", () => {
  test("true only for an explicit true", () => {
    expect(isReviewAccountRow({ is_review_account: true })).toBe(true);
  });

  test("false for a missing row, an absent column, or an explicit false/null", () => {
    expect(isReviewAccountRow(null)).toBe(false);
    expect(isReviewAccountRow(undefined)).toBe(false);
    expect(isReviewAccountRow({})).toBe(false);
    expect(isReviewAccountRow({ is_review_account: false })).toBe(false);
    expect(isReviewAccountRow({ is_review_account: null })).toBe(false);
  });
});

describe("resolveReviewLoginOutcome", () => {
  const { salt, hash } = hashReviewPassword("correct-horse-battery");
  const validRow = {
    id: "RIDER_REVIEW_1",
    is_review_account: true,
    review_password_salt: salt,
    review_password_hash: hash
  };

  test("succeeds with correct password while the flag is on", () => {
    const outcome = resolveReviewLoginOutcome({
      row: validRow,
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome).toEqual({ ok: true, id: "RIDER_REVIEW_1" });
  });

  test("rejects new logins outright while the flag is off, even with the correct password", () => {
    const outcome = resolveReviewLoginOutcome({
      row: validRow,
      password: "correct-horse-battery",
      reviewLoginEnabled: false
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(503);
  });

  test("rejects a wrong password", () => {
    const outcome = resolveReviewLoginOutcome({
      row: validRow,
      password: "totally-wrong-password",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("rejects a row that isn't actually a review account, even with a password that verifies against its (nonexistent) hash", () => {
    const outcome = resolveReviewLoginOutcome({
      row: { id: "R1", is_review_account: false, review_password_salt: salt, review_password_hash: hash },
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("rejects a revoked review account", () => {
    const outcome = resolveReviewLoginOutcome({
      row: { ...validRow, access_revoked: true },
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  test("rejects a null row (no such account) with the same generic message as a wrong password", () => {
    const noRow = resolveReviewLoginOutcome({ row: null, password: "x", reviewLoginEnabled: true });
    const wrongPassword = resolveReviewLoginOutcome({
      row: validRow,
      password: "wrong",
      reviewLoginEnabled: true
    });
    expect(noRow.statusCode).toBe(wrongPassword.statusCode);
    expect(noRow.message).toBe(wrongPassword.message);
  });
});

describe("resolveReviewSessionOutcome (the middleware kill-switch re-check)", () => {
  test("an ordinary rider/driver row is never affected by the flag's value", () => {
    expect(resolveReviewSessionOutcome({ row: { is_review_account: false }, reviewLoginEnabled: true })).toEqual({
      ok: true
    });
    expect(resolveReviewSessionOutcome({ row: { is_review_account: false }, reviewLoginEnabled: false })).toEqual({
      ok: true
    });
  });

  test("a review account passes while the flag is on", () => {
    expect(resolveReviewSessionOutcome({ row: { is_review_account: true }, reviewLoginEnabled: true })).toEqual({
      ok: true
    });
  });

  test("an already-issued review session is rejected the instant the flag goes off", () => {
    const outcome = resolveReviewSessionOutcome({ row: { is_review_account: true }, reviewLoginEnabled: false });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  test("a client-supplied is_review_account on a plain object cannot forge this decision -- only the row passed in matters", () => {
    // Simulates: an attacker's request body claims is_review_account,
    // but the row actually loaded from the database is a real rider.
    const realRiderRow = { id: "R1", is_review_account: false };
    const outcome = resolveReviewSessionOutcome({ row: realRiderRow, reviewLoginEnabled: false });
    expect(outcome.ok).toBe(true);
  });
});

describe("isValidatedReviewerSession (identity must come from the session, never client-supplied fields)", () => {
  test("true only for a currently-valid session, a review row, and the flag on", () => {
    expect(
      isValidatedReviewerSession({
        riderAuthOk: true,
        row: { is_review_account: true },
        reviewLoginEnabled: true
      })
    ).toBe(true);
  });

  test("false when the underlying session itself isn't currently valid, even if the row is a review account", () => {
    // Simulates: an expired/revoked/wrong-session-version rider session
    // for the review account -- resolveRiderAuthOutcome already said no,
    // and that must not be overridable here.
    expect(
      isValidatedReviewerSession({
        riderAuthOk: false,
        row: { is_review_account: true },
        reviewLoginEnabled: true
      })
    ).toBe(false);
  });

  test("false for a perfectly valid session belonging to an ordinary rider", () => {
    // This is the exact scenario the approved correction calls out: an
    // ordinary, authenticated rider must never get reviewer behavior no
    // matter what rider_id/is_review_account a request also claims --
    // this function only ever looks at the row from the rider's own
    // session, never anything else.
    expect(
      isValidatedReviewerSession({
        riderAuthOk: true,
        row: { is_review_account: false },
        reviewLoginEnabled: true
      })
    ).toBe(false);
  });

  test("false once the flag is off, even for an otherwise perfectly valid reviewer session", () => {
    expect(
      isValidatedReviewerSession({
        riderAuthOk: true,
        row: { is_review_account: true },
        reviewLoginEnabled: false
      })
    ).toBe(false);
  });

  test("false for a null row (no session at all)", () => {
    expect(isValidatedReviewerSession({ riderAuthOk: false, row: null, reviewLoginEnabled: true })).toBe(false);
  });
});

describe("planReviewAwareDispatch (two-way dispatch isolation)", () => {
  test("a review ride is routed only to the paired review driver when it's online", () => {
    const plan = planReviewAwareDispatch({
      isReviewRide: true,
      reviewDriverId: "DRIVER_REVIEW_1",
      reviewDriverOnline: true
    });
    expect(plan).toEqual({ bypassNormalMatching: true, candidateDriverIds: ["DRIVER_REVIEW_1"] });
  });

  test("a review ride gets zero candidates when the review driver is offline -- it must never fall through to a real driver", () => {
    const plan = planReviewAwareDispatch({
      isReviewRide: true,
      reviewDriverId: "DRIVER_REVIEW_1",
      reviewDriverOnline: false
    });
    expect(plan).toEqual({ bypassNormalMatching: true, candidateDriverIds: [] });
  });

  test("a review ride with no review driver seeded yet gets zero candidates, not an error", () => {
    const plan = planReviewAwareDispatch({ isReviewRide: true, reviewDriverId: null, reviewDriverOnline: false });
    expect(plan.candidateDriverIds).toEqual([]);
  });

  test("a real ride excludes the review driver from normal matching", () => {
    const plan = planReviewAwareDispatch({
      isReviewRide: false,
      reviewDriverId: "DRIVER_REVIEW_1",
      reviewDriverOnline: true
    });
    expect(plan).toEqual({ bypassNormalMatching: false, extraExcludeDriverIds: ["DRIVER_REVIEW_1"] });
  });

  test("a real ride with no review driver seeded yet excludes nothing extra", () => {
    const plan = planReviewAwareDispatch({ isReviewRide: false, reviewDriverId: null, reviewDriverOnline: false });
    expect(plan).toEqual({ bypassNormalMatching: false, extraExcludeDriverIds: [] });
  });
});

describe("buildSimulatedPaymentIntentResponse", () => {
  test("returns a clearly-labeled simulated response shaped like the real endpoint", () => {
    const estimate = { total: 12.34 };
    const response = buildSimulatedPaymentIntentResponse({ id: "abc123", estimate });

    expect(response.payment_intent_id).toBe("review_sim_abc123");
    expect(response.client_secret).toContain("review_sim_abc123");
    expect(response.estimate).toBe(estimate);
    expect(response.simulated).toBe(true);
    expect(response.simulated_label).toBe(SIMULATED_PAYMENT_LABEL);
    expect(response.simulated_label.toLowerCase()).toContain("google play review mode");
  });
});
