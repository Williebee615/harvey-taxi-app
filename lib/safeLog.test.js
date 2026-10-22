const { errorCode, errorClass, routeTemplate, serverErrorEntry } = require("./safeLog");

describe("errorCode: fixed codes from the error's type, never its text", () => {
  test.each([
    [{ code: "23505", message: "Key (email)=(jane@example.test) already exists" }, "db_23505"],
    [{ code: "PGRST204", message: "Could not find column x" }, "postgrest_PGRST204"],
    [{ code: "ECONNRESET", message: "socket hang up at 10.0.0.1" }, "net_ECONNRESET"],
    [{ type: "entity.parse.failed", message: "Unexpected token J in JSON at position 0: Jane Doe" }, "request_body_invalid_json"],
    [{ type: "entity.too.large" }, "request_body_too_large"],
    [{ type: "StripeCardError", message: "Your card was declined for Jane" }, "stripe_card"],
    [{ corsDiagnostics: {} }, "cors_origin_blocked"],
    [new TypeError("Cannot read properties of undefined (reading 'jane@example.test')"), "js_type"],
    [new Error("Jane Doe at 12 Oak Street failed"), "unhandled"],
    [{ code: "jane@example.test" }, "unhandled"],
    [null, "unknown"]
  ])("%#", (error, expected) => {
    expect(errorCode(error)).toBe(expected);
  });
});

test("errorClass is allowlisted", () => {
  expect(errorClass(new TypeError("x"))).toBe("TypeError");
  class JaneDoeError extends Error {}
  expect(errorClass(new JaneDoeError("x"))).toBe("Other");
  expect(errorClass({})).toBe("Other");
});

test("routeTemplate uses the matched template, never the URL", () => {
  expect(routeTemplate({ baseUrl: "", route: { path: "/api/drivers/:id" }, originalUrl: "/api/drivers/jane@example.test?phone=6155550100" })).toBe("/api/drivers/:id");
  expect(routeTemplate({ originalUrl: "/api/x?email=jane@example.test" })).toBe("unmatched");
});

test("serverErrorEntry contains only the allowlisted keys and no input text", () => {
  const entry = serverErrorEntry(
    Object.assign(new Error("Jane Doe, 12 Oak Street, 615-555-0100"), { code: "23505", details: "Key (email)=(jane@example.test)" }),
    { method: "post", route: { path: "/api/x/:id" }, baseUrl: "", originalUrl: "/api/x/1?email=jane@example.test", headers: { authorization: "Bearer abc" }, body: { name: "Jane" } }
  );
  expect(entry).toEqual({ error_code: "db_23505", error_class: "Error", route: "/api/x/:id", method: "POST" });
});

describe("log privacy safety net (2026-10-22)", () => {
  const { dbErrorEntry, redactLogText, redactLogValue, installConsoleRedaction } = require("./safeLog");

  test("dbErrorEntry keeps the code and drops details and hint", () => {
    expect(dbErrorEntry({ code: "23502", message: "null value", details: "Failing row contains (1, Jane Doe, jane@example.test, 12 Oak Street).", hint: null })).toEqual({ error_code: "db_23502" });
  });

  test.each([
    ["sent to jane.doe+1@example.test", "sent to [email]"],
    ["call +16155550100 now", "call [phone] now"],
    ["call (615) 555-0100 or 615-555-0100", "call [phone] or [phone]"],
    ["Failing row contains (1, Jane (Jr), 12 Oak Street).", "Failing row contains [values redacted]"],
    ["Key (email)=(jane@example.test) already exists.", "Key (email)= [values redacted]"],
    ["key sk_live_abc123 and whsec_xyz and Bearer eyJ.a.b", "key [secret] and [secret] and [secret]"]
  ])("redacts %s", (input, expected) => {
    expect(redactLogText(input)).toBe(expected);
  });

  test("leaves IDs, commit SHAs, timestamps and amounts alone", () => {
    const text = "ride 1234567890 version 3933984a771804207adcbfbf70769070e2ff02b6 at 2026-10-22T12:00:00Z amount 1500";
    expect(redactLogText(text)).toBe(text);
  });

  test("redacts nested objects, errors and cycles without throwing", () => {
    const obj = { to: "jane@example.test", nested: { details: "Failing row contains (x)." }, n: 3 };
    obj.self = obj;
    const out = redactLogValue(obj);
    expect(out).toMatchObject({ to: "[email]", nested: { details: "Failing row contains [values redacted]" }, n: 3, self: "[circular]" });
    expect(redactLogValue(new Error("failed for jane@example.test"))).toMatch(/^Error: failed for \[email\]/);
  });

  test("installConsoleRedaction masks every level once and is idempotent", () => {
    const seen = [];
    const target = { log: (...a) => seen.push(a), error: (...a) => seen.push(a), warn: () => {}, info: () => {}, debug: () => {} };
    installConsoleRedaction(target);
    const wrapped = target.log;
    installConsoleRedaction(target);
    expect(target.log).toBe(wrapped);
    target.log("to", "jane@example.test", { phone: "+16155550100" });
    target.error(new Error("x for 615-555-0100"));
    expect(seen[0]).toEqual(["to", "[email]", { phone: "[phone]" }]);
    expect(seen[1][0]).toMatch(/^Error: x for \[phone\]/);
  });
});
