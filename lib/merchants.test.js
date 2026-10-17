const { validateMerchantApplication, planMerchantReview, EXCLUDED_ITEMS } = require("./merchants");

const good = {
  business_name: "TEST Hot Chicken Co",
  category: "restaurant",
  address_line: "100 Broadway",
  city: "Nashville",
  postal_code: "37203",
  contact_name: "Test Owner",
  contact_email: "Owner@Example.TEST",
  contact_phone: "(615) 555-0100",
  website: "https://example.test",
  prices_differ_from_store: true,
  confirmed_exclusions: true
};

describe("validateMerchantApplication", () => {
  test("accepts a complete Tennessee application and normalizes contact details", () => {
    const r = validateMerchantApplication(good);
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ state: "TN", contact_email: "owner@example.test", contact_phone: "+16155550100", prices_differ_from_store: true, confirmed_exclusions: true });
  });
  test.each([
    [{ business_name: "" }, /business name/],
    [{ category: "pharmacy" }, /restaurant, grocery or convenience/],
    [{ state: "GA" }, /Tennessee/],
    [{ postal_code: "3720" }, /ZIP/],
    [{ contact_email: "nope" }, /email/],
    [{ contact_phone: "555-0100" }, /phone/],
    [{ website: "http://example.test" }, /https/],
    [{ confirmed_exclusions: false }, /excluded items/],
    [{ confirmed_exclusions: "true" }, /excluded items/]
  ])("refuses %p", (patch, msg) => {
    const r = validateMerchantApplication({ ...good, ...patch });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
  });
  test("price disclosure is only true when explicitly true", () => {
    expect(validateMerchantApplication({ ...good, prices_differ_from_store: "yes" }).row.prices_differ_from_store).toBe(false);
  });
  test("the excluded list carries the owner's decisions", () => {
    expect(EXCLUDED_ITEMS.join(" ")).toMatch(/Alcohol.*Cannabis.*Prescription.*Weapons.*Gift cards.*Live animals.*Hazardous/s);
  });
});

describe("planMerchantReview", () => {
  const at = new Date("2026-10-17T18:00:00Z");
  const plan = (status, decision, reason) => planMerchantReview({ merchant: status && { id: "m1", status }, decision, reason, reviewer: "owner@harvey.example", now: at });
  test("pending can be approved without a reason", () => {
    expect(plan("pending", "approve")).toEqual({ ok: true, update: { status: "approved", review_reason: null, reviewed_by: "owner@harvey.example", reviewed_at: at.toISOString(), updated_at: at.toISOString() } });
  });
  test("reject and suspend need a reason of 10+ characters", () => {
    expect(plan("pending", "reject", "no").statusCode).toBe(400);
    expect(plan("pending", "reject", "Outside the pilot area.").update.status).toBe("rejected");
    expect(plan("approved", "suspend", "short").ok).toBe(false);
    expect(plan("approved", "suspend", "Repeated missing items.").update.status).toBe("suspended");
  });
  test("only allowed moves", () => {
    expect(plan("rejected", "approve").statusCode).toBe(409);
    expect(plan("approved", "reject", "Changed our mind here.").statusCode).toBe(409);
    expect(plan("suspended", "approve").update.status).toBe("approved");
    expect(plan(null, "approve").statusCode).toBe(404);
    expect(plan("pending", "delete").statusCode).toBe(400);
  });
});
