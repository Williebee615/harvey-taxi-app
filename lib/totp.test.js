const t = require("./totp");

describe("authenticator codes (RFC 6238)", () => {
  // RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890"),
  // last 6 digits of the published 8-digit values.
  const RFC_SECRET = t.base32Encode(Buffer.from("12345678901234567890"));
  test.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"]
  ])("matches the RFC test vector at %i s", (seconds, code) => {
    expect(t.codeAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  test("base32 round-trips and generated secrets are 160 bits", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(t.base32Decode(t.base32Encode(buf))).toEqual(buf);
    const secret = t.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(t.base32Decode(secret)).toHaveLength(20);
  });

  test("accepts ±1 step of drift, refuses older steps and replays", () => {
    const secret = t.generateSecret();
    const nowMs = 1_800_000_000_000;
    const step = t.stepFor(nowMs);
    expect(t.verifyCode(secret, t.codeAt(secret, step), { nowMs })).toBe(step);
    expect(t.verifyCode(secret, t.codeAt(secret, step - 1), { nowMs })).toBe(step - 1);
    expect(t.verifyCode(secret, t.codeAt(secret, step + 1), { nowMs })).toBe(step + 1);
    expect(t.verifyCode(secret, t.codeAt(secret, step - 2), { nowMs })).toBeNull();
    // Same code again after it was accepted: refused.
    expect(t.verifyCode(secret, t.codeAt(secret, step), { nowMs, lastStep: step })).toBeNull();
    expect(t.verifyCode(secret, "12345", { nowMs })).toBeNull();
    expect(t.verifyCode(secret, "abcdef", { nowMs })).toBeNull();
  });

  test("the stored secret is encrypted and tamper-evident", () => {
    const key = t.deriveKey("server-secret", "admin-mfa-v1");
    const secret = t.generateSecret();
    const stored = t.encryptSecret(secret, key);
    expect(stored).not.toContain(secret);
    expect(t.decryptSecret(stored, key)).toBe(secret);
    expect(() => t.decryptSecret(stored, t.deriveKey("other-secret", "admin-mfa-v1"))).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => t.decryptSecret(parts.join("."), key)).toThrow();
  });

  test("otpauth link names the issuer and account only", () => {
    const uri = t.otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "owner@example.test" });
    expect(uri).toBe("otpauth://totp/Harvey%20Taxi%20Admin%3Aowner%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Harvey%20Taxi%20Admin&algorithm=SHA1&digits=6&period=30");
  });

  test("recovery codes are unique, readable, and hashed ignoring formatting", () => {
    const codes = t.generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(t.hashRecoveryCode(codes[0].toLowerCase().replace("-", " "))).toBe(t.hashRecoveryCode(codes[0]));
  });
});
