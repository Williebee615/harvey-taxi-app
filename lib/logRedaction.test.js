const { redactLogText, redactPath } = require("./logRedaction");

describe("redactPath", () => {
  test("drops the query string", () => {
    expect(redactPath("/api/riders/lookup?email=jane@example.com&phone=6155550100")).toBe("/api/riders/lookup?[query removed]");
    expect(redactPath("/api/health")).toBe("/api/health");
  });
  test("masks personal identifiers in the path, including encoded ones", () => {
    expect(redactPath("/api/admin/riders/jane%40example.com")).toBe("/api/admin/riders/[email]");
    expect(redactPath("/api/x/+16155550100/y")).toBe("/api/x/[phone]/y");
  });
  test("keeps ordinary ids", () => {
    expect(redactPath("/api/admin/drivers/DRV-85708D8A35/review-assist")).toBe("/api/admin/drivers/DRV-85708D8A35/review-assist");
    expect(redactPath("/api/admin/foundation/applications/3f2b6c1e-0a4d-4f7e-9b1a-2c3d4e5f6a7b")).toBe("/api/admin/foundation/applications/3f2b6c1e-0a4d-4f7e-9b1a-2c3d4e5f6a7b");
  });
});

describe("redactLogText", () => {
  test.each([
    ['duplicate key value violates unique constraint "riders_email_key" Key (email)=(jane@example.com) already exists.', 'duplicate key value violates unique constraint "riders_email_key" Key (email)=([redacted]) already exists.'],
    ['new row violates check constraint "x" Failing row contains (1, Jane, 6155550100).', 'new row violates check constraint "x" Failing row contains ([redacted]).'],
    ["could not reach jane.doe+1@example.co.uk", "could not reach [email]"],
    ["call (615) 555-0100 or +1 615 555 0100 or 615.555.0100", "call [phone] or [phone] or [phone]"],
    ["Authorization: Bearer abcdefghijklmnop", "Authorization: Bearer [token]"],
    ["key sk_live_abcdefgh1234 leaked", "key [key] leaked"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij", "token [token]"],
    ["account 123456789012", "account [number]"]
  ])("%s", (input, expected) => {
    expect(redactLogText(input)).toBe(expected);
  });
  test("leaves ordinary diagnostics readable", () => {
    expect(redactLogText("relation \"rides\" does not exist (code 42P01) after 30 s")).toBe("relation \"rides\" does not exist (code 42P01) after 30 s");
    expect(redactLogText("2026-10-14T01:00:00Z timeout")).toBe("2026-10-14T01:00:00Z timeout");
  });
  test("caps length and passes null through", () => {
    expect(redactLogText("x".repeat(900)).length).toBe(500);
    expect(redactLogText(null)).toBeNull();
  });
});
