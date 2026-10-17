const { screenMerchants } = require("./merchantScreening");

const base = (over) => ({
  id: "M1", business_name: "Corner Market (fixture)", category: "grocery", address_line: "100 Main Street", city: "Nashville",
  postal_code: "37203", contact_email: "owner@cornermarket.example", contact_phone: "+16155550100", status: "pending",
  created_at: "2026-10-17T10:00:00Z", ...over
});
const codes = (rows, id = "M1") => screenMerchants(rows)[id].map((f) => f.code);

test("a normal application has no flags", () => {
  expect(codes([base()])).toEqual([]);
});

test("single-application signals", () => {
  expect(codes([base({ contact_email: "x@mailinator.com" })])).toContain("disposable_email");
  expect(codes([base({ postal_code: "38103" })])).toContain("zip_outside_pilot");
  expect(codes([base({ postal_code: null })])).toContain("zip_missing");
  expect(codes([base({ address_line: "Main Street" })])).toContain("address_no_number");
  expect(codes([base({ business_name: "test store" })])).toContain("placeholder_name");
  expect(codes([base({ business_name: "Testa Bakery" })])).not.toContain("placeholder_name");
});

test("shared phone or address (same address written differently) is flagged on both applications", () => {
  const rows = [base(), base({ id: "M2", business_name: "Other", contact_email: "b@other.example", address_line: "100 main st.", created_at: "2026-10-10T10:00:00Z" })];
  expect(codes(rows, "M1")).toEqual(expect.arrayContaining(["shared_phone", "shared_address"]));
  expect(codes(rows, "M2")).toEqual(expect.arrayContaining(["shared_phone", "shared_address"]));
  expect(codes(rows, "M1")).not.toContain("rapid_repeat");
});

test("reapplying after a rejection, and repeats within 24 hours", () => {
  const rows = [base(), base({ id: "M0", status: "rejected", contact_phone: "+16155550199", address_line: "9 Elm St", created_at: "2026-10-17T02:00:00Z" })];
  expect(codes(rows, "M1")).toEqual(expect.arrayContaining(["previously_rejected", "rapid_repeat"]));
});

test("every flag has a label, and screening never changes the rows", () => {
  const rows = [base({ contact_email: "x@yopmail.com", postal_code: "" })];
  const before = JSON.stringify(rows);
  const out = screenMerchants(rows);
  expect(out.M1.every((f) => typeof f.label === "string" && f.label.length > 10)).toBe(true);
  expect(JSON.stringify(rows)).toBe(before);
  expect(screenMerchants(null)).toEqual({});
});
