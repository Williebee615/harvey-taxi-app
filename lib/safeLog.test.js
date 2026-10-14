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
