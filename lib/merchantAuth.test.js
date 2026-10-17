const { signMerchantSession, verifyMerchantSession, validateStoreHours } = require("./merchantAuth");

const SECRET = "test-merchant-secret";
const sign = (over = {}) => signMerchantSession({ merchantUserId: "U1", merchantId: "M1", sessionVersion: 0, secret: SECRET, ttlHours: 12, now: 1_000_000, ...over });

describe("merchant session tokens", () => {
  test("a fresh token verifies and carries the user, store and version", () => {
    const out = verifyMerchantSession({ token: sign(), secret: SECRET, now: 1_000_000 + 1000 });
    expect(out).toMatchObject({ ok: true, payload: { merchant_user_id: "U1", merchant_id: "M1", session_version: 0 } });
  });
  test("expired, tampered, wrong-secret and rider tokens are refused", () => {
    expect(verifyMerchantSession({ token: sign(), secret: SECRET, now: 1_000_000 + 12 * 3600 * 1000 })).toMatchObject({ ok: false, reason: "expired" });
    const [enc, sig] = sign().split(".");
    expect(verifyMerchantSession({ token: `${enc}x.${sig}`, secret: SECRET, now: 1_000_001 }).ok).toBe(false);
    expect(verifyMerchantSession({ token: sign(), secret: "other", now: 1_000_001 }).reason).toBe("bad_signature");
    const { signRiderSession } = require("./riderAuth");
    const rider = signRiderSession({ riderId: "R1", sessionVersion: 0, secret: SECRET, ttlHours: 1, now: 1_000_000 });
    expect(verifyMerchantSession({ token: rider, secret: SECRET, now: 1_000_001 }).reason).toBe("malformed");
  });
  test("refuses to sign without its inputs", () => {
    expect(() => sign({ secret: "" })).toThrow();
    expect(() => sign({ sessionVersion: -1 })).toThrow();
    expect(() => sign({ merchantId: "" })).toThrow();
  });
});

describe("store hours", () => {
  const week = (over = {}) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, closed: d === 0, opens_at: d === 0 ? null : "09:00", closes_at: d === 0 ? null : "21:00", ...(over[d] || {}) }));
  test("a valid week is normalized and sorted", () => {
    const out = validateStoreHours(week().reverse());
    expect(out.ok).toBe(true);
    expect(out.rows.map((r) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out.rows[0]).toEqual({ day_of_week: 0, closed: true, opens_at: null, closes_at: null });
  });
  test.each([
    [week().slice(1), /all seven/],
    [[...week().slice(1), { day_of_week: 1, closed: true }], /once/],
    [week({ 2: { opens_at: "9am" } }), /Tuesday: enter/],
    [week({ 3: { opens_at: "22:00", closes_at: "02:00" } }), /Wednesday: closing time must be after/],
    [week({ 4: { opens_at: "10:00", closes_at: "10:00" } }), /Thursday/],
    [null, /all seven/]
  ])("refuses bad input (%#)", (days, msg) => {
    const out = validateStoreHours(days);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(msg);
  });
});
