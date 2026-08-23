const {
  hashReviewPassword,
  verifyReviewPassword,
  isReviewAccountRow,
  resolveReviewLoginOutcome,
  resolveReviewSessionOutcome,
  isValidatedReviewerSession,
  planReviewAwareDispatch,
  buildSimulatedPaymentIntentResponse,
  SIMULATED_PAYMENT_LABEL,
  resolveSystemFlagDiagnostics,
  extractSupabaseProjectRef,
  buildFlagDiagnosticLogEvent
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
    expect(outcome.reason).toBe("flag_disabled");
  });

  test("rejects with the identical public response, but a distinct audit reason, when the flag query itself failed rather than legitimately reading false", () => {
    const flagOff = resolveReviewLoginOutcome({
      row: validRow,
      password: "correct-horse-battery",
      reviewLoginEnabled: false,
      flagQuerySucceeded: true
    });
    const queryFailed = resolveReviewLoginOutcome({
      row: validRow,
      password: "correct-horse-battery",
      reviewLoginEnabled: false,
      flagQuerySucceeded: false
    });

    // Public response identical either way -- a caller must not be able
    // to distinguish "disabled" from "infrastructure fault" from the
    // HTTP response alone.
    expect(queryFailed.statusCode).toBe(flagOff.statusCode);
    expect(queryFailed.message).toBe(flagOff.message);
    // Internal audit reason differs -- this is the whole point.
    expect(queryFailed.reason).toBe("flag_query_failed");
    expect(flagOff.reason).toBe("flag_disabled");
  });

  test("flagQuerySucceeded defaults to true so existing callers that don't pass it are unaffected", () => {
    const outcome = resolveReviewLoginOutcome({
      row: validRow,
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(true);
  });

  test("rejects a wrong password", () => {
    const outcome = resolveReviewLoginOutcome({
      row: validRow,
      password: "totally-wrong-password",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
    expect(outcome.reason).toBe("invalid_credentials");
  });

  test("rejects a row that isn't actually a review account, even with a password that verifies against its (nonexistent) hash", () => {
    const outcome = resolveReviewLoginOutcome({
      row: { id: "R1", is_review_account: false, review_password_salt: salt, review_password_hash: hash },
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
    expect(outcome.reason).toBe("account_not_found");
  });

  test("rejects a revoked review account", () => {
    const outcome = resolveReviewLoginOutcome({
      row: { ...validRow, access_revoked: true },
      password: "correct-horse-battery",
      reviewLoginEnabled: true
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBe(401);
    expect(outcome.reason).toBe("account_not_found");
  });

  test("rejects a null row (no such account) with the same generic public message as a wrong password, but a distinct internal reason", () => {
    const noRow = resolveReviewLoginOutcome({ row: null, password: "x", reviewLoginEnabled: true });
    const wrongPassword = resolveReviewLoginOutcome({
      row: validRow,
      password: "wrong",
      reviewLoginEnabled: true
    });
    expect(noRow.statusCode).toBe(wrongPassword.statusCode);
    expect(noRow.message).toBe(wrongPassword.message);
    expect(noRow.reason).toBe("account_not_found");
    expect(wrongPassword.reason).toBe("invalid_credentials");
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

describe("resolveSystemFlagDiagnostics (production incident hotfix)", () => {
  test("query failure: reports querySucceeded false, rowFound false, and falls back to the caller's fallback value", () => {
    const diagnostics = resolveSystemFlagDiagnostics({
      error: { code: "PGRST301", message: "JWT expired" },
      data: null,
      fallback: "false"
    });
    expect(diagnostics).toEqual({
      querySucceeded: false,
      rowFound: false,
      value: "false",
      errorCode: "PGRST301",
      errorMessage: "JWT expired"
    });
  });

  test("missing row: query succeeded but no row exists yet, falls back to the caller's fallback value", () => {
    const diagnostics = resolveSystemFlagDiagnostics({ error: null, data: null, fallback: "false" });
    expect(diagnostics).toEqual({
      querySucceeded: true,
      rowFound: false,
      value: "false",
      errorCode: null,
      errorMessage: null
    });
  });

  test("row found with value 'false'", () => {
    const diagnostics = resolveSystemFlagDiagnostics({
      error: null,
      data: { key: "review_account_login_enabled", value: "false" },
      fallback: "false"
    });
    expect(diagnostics).toEqual({
      querySucceeded: true,
      rowFound: true,
      value: "false",
      errorCode: null,
      errorMessage: null
    });
  });

  test("row found with value 'true'", () => {
    const diagnostics = resolveSystemFlagDiagnostics({
      error: null,
      data: { key: "review_account_login_enabled", value: "true" },
      fallback: "false"
    });
    expect(diagnostics).toEqual({
      querySucceeded: true,
      rowFound: true,
      value: "true",
      errorCode: null,
      errorMessage: null
    });
  });

  test("an error object with no code/message still reports querySucceeded false without throwing", () => {
    const diagnostics = resolveSystemFlagDiagnostics({ error: {}, data: null, fallback: "false" });
    expect(diagnostics.querySucceeded).toBe(false);
    expect(diagnostics.errorCode).toBeNull();
    expect(diagnostics.errorMessage).toBeNull();
  });
});

describe("extractSupabaseProjectRef", () => {
  test("extracts the project ref from a real Supabase URL", () => {
    expect(extractSupabaseProjectRef("https://orgahzncmzptljapqffj.supabase.co")).toBe(
      "orgahzncmzptljapqffj"
    );
  });

  test("extracts the ref even with a trailing path", () => {
    expect(extractSupabaseProjectRef("https://abcdefghijklmnop.supabase.co/rest/v1")).toBe(
      "abcdefghijklmnop"
    );
  });

  test("returns null for a malformed or missing URL rather than leaking any substring of it", () => {
    expect(extractSupabaseProjectRef("not-a-url")).toBeNull();
    expect(extractSupabaseProjectRef("")).toBeNull();
    expect(extractSupabaseProjectRef(undefined)).toBeNull();
    expect(extractSupabaseProjectRef("http://orgahzncmzptljapqffj.supabase.co")).toBeNull();
  });
});

describe("buildFlagDiagnosticLogEvent", () => {
  test("produces an allow-listed, sanitized log event with no secret fields", () => {
    const event = buildFlagDiagnosticLogEvent({
      flagKey: "review_account_login_enabled",
      diagnostics: {
        querySucceeded: true,
        rowFound: true,
        value: "true",
        errorCode: null,
        errorMessage: null
      },
      supabaseProjectRef: "orgahzncmzptljapqffj"
    });

    expect(event).toEqual({
      event: "system_flag_diagnostic",
      flag: "review_account_login_enabled",
      supabase_project_ref: "orgahzncmzptljapqffj",
      query_succeeded: true,
      row_found: true,
      normalized_value: true,
      error_code: null,
      error_message: null
    });

    // Nothing in the allow-list resembles a secret, key, header, cookie,
    // or credential field name.
    const forbiddenFieldNamePattern = /key|secret|token|password|cookie|authorization/i;
    Object.keys(event).forEach((field) => {
      expect(field).not.toMatch(forbiddenFieldNamePattern);
    });
  });

  test("normalized_value is strictly boolean true only for the exact string 'true'", () => {
    const truthyLookingButNotTrue = buildFlagDiagnosticLogEvent({
      flagKey: "review_account_login_enabled",
      diagnostics: { querySucceeded: true, rowFound: false, value: "false", errorCode: null, errorMessage: null },
      supabaseProjectRef: "orgahzncmzptljapqffj"
    });
    expect(truthyLookingButNotTrue.normalized_value).toBe(false);
  });
});
