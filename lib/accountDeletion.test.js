const {
  DELETION_MODE,
  planAccountDeletion,
  resolveAccountByVerifiedPhone,
  isDeletionConfirmed
} = require("./accountDeletion");

describe("planAccountDeletion", () => {
  it("simulates deletion only for rows flagged is_review_account === true", () => {
    expect(planAccountDeletion({ row: { is_review_account: true }, userType: "rider" }).mode)
      .toBe(DELETION_MODE.REVIEW_SIMULATED);
    expect(planAccountDeletion({ row: { is_review_account: true }, userType: "driver" }).mode)
      .toBe(DELETION_MODE.REVIEW_SIMULATED);
  });

  it("gives ordinary riders and drivers the real flow", () => {
    expect(planAccountDeletion({ row: { is_review_account: false }, userType: "rider" }).mode)
      .toBe(DELETION_MODE.RIDER_IMMEDIATE);
    expect(planAccountDeletion({ row: {}, userType: "driver" }).mode)
      .toBe(DELETION_MODE.DRIVER_PENDING);
  });

  it("does not treat truthy non-boolean flags as a review account", () => {
    expect(planAccountDeletion({ row: { is_review_account: "true" }, userType: "rider" }).mode)
      .toBe(DELETION_MODE.RIDER_IMMEDIATE);
    expect(planAccountDeletion({ row: { is_review_account: 1 }, userType: "driver" }).mode)
      .toBe(DELETION_MODE.DRIVER_PENDING);
  });
});

describe("resolveAccountByVerifiedPhone", () => {
  it("requires exactly one matching account", () => {
    expect(resolveAccountByVerifiedPhone([]).statusCode).toBe(404);
    expect(resolveAccountByVerifiedPhone(null).statusCode).toBe(404);
    expect(resolveAccountByVerifiedPhone([{ id: "a" }, { id: "b" }]).statusCode).toBe(409);
    expect(resolveAccountByVerifiedPhone([{ id: "a" }])).toEqual({ ok: true, row: { id: "a" } });
  });
});

describe("isDeletionConfirmed", () => {
  it("accepts only the word DELETE", () => {
    expect(isDeletionConfirmed("DELETE")).toBe(true);
    expect(isDeletionConfirmed(" delete ")).toBe(true);
    expect(isDeletionConfirmed("yes")).toBe(false);
    expect(isDeletionConfirmed(undefined)).toBe(false);
    expect(isDeletionConfirmed(true)).toBe(false);
  });
});
