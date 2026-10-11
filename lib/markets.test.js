// lib/markets.js: per-market settings with Nashville unchanged and the
// pilot markets (Harare, Lagos, Accra) in simulated test mode only.
const markets = require("./markets");
const pricing = require("./pricing");

describe("Nashville keeps today's settings", () => {
  test("its fare is exactly lib/pricing.js's (same env-driven rates), in USD by the mile", () => {
    for (const [miles, minutes, ride_type] of [[3, 10, "standard"], [12.4, 25, "airport"], [0.5, 2, "standard"], [7, 15, "medical"]]) {
      const ours = markets.estimateForMarket("us-nashville", { km: miles * markets.KM_PER_MILE, minutes, ride_type });
      const today = pricing.calculateRideEstimate({ miles, minutes, ride_type });
      expect(ours.total).toBeCloseTo(today.total, 6);
      expect(ours.driver_payout).toBeCloseTo(today.driver_payout, 6);
      expect(ours.currency).toBe("USD");
    }
  });

  test("live, 911, US numbers, miles, Central time", () => {
    const m = markets.getMarket("us-nashville");
    expect(markets.marketLiveAllowed("us-nashville")).toBe(true);
    expect(m.emergency.primary).toBe("911");
    expect(markets.normalizeMarketPhone("us-nashville", "(615) 555-0100")).toBe("+16155550100");
    expect(markets.formatDistance("us-nashville", 16.09344)).toBe("10.0 mi");
    expect(markets.formatLocalTime("us-nashville", new Date("2026-10-10T17:00:00Z"))).toMatch(/12:00\sPM CDT/);
  });

  test("existing rows with no market belong to Nashville", () => {
    expect(markets.DEFAULT_MARKET_ID).toBe("us-nashville");
  });
});

describe("pilot markets: one city each, test mode only", () => {
  const pilots = { "zw-harare": "Harare", "ng-lagos": "Lagos", "gh-accra": "Accra" };

  test("one pilot city per country, none live, even with the flag on", () => {
    for (const [id, city] of Object.entries(pilots)) {
      const m = markets.getMarket(id);
      expect(m.pilot_city.name).toBe(city);
      expect(m.status).toBe("test");
      expect(m.approved_for_live).toBe(false);
      expect(markets.marketLiveAllowed(id, {})).toBe(false);
      // The flag alone can't turn a market on: the code must also approve it.
      expect(markets.marketLiveAllowed(id, { [`market_live_${id}`]: "true" })).toBe(false);
    }
    expect(markets.marketLiveAllowed("xx-nowhere", { "market_live_xx-nowhere": "true" })).toBe(false);
  });

  test("never the US 911 instruction outside the US", () => {
    for (const id of Object.keys(pilots)) {
      const m = markets.getMarket(id);
      expect(m.emergency.primary).not.toBe("911");
      expect(JSON.stringify(m.emergency)).not.toContain("911");
      expect(markets.simulateRide(id, { from: "airport", to: m.places[1].key }).emergency.instruction).not.toContain("911");
    }
    expect(markets.getMarket("zw-harare").emergency.numbers).toMatchObject({ police: "995", ambulance: "994", fire: "993" });
    expect(markets.getMarket("ng-lagos").emergency.primary).toBe("112");
    expect(markets.getMarket("gh-accra").emergency.numbers).toMatchObject({ police: "191", fire: "192", ambulance: "193" });
  });

  test("kilometres, local time zone and local currency", () => {
    expect(markets.formatDistance("zw-harare", 12.34)).toBe("12.3 km");
    expect(markets.formatLocalTime("zw-harare", new Date("2026-10-10T12:00:00Z"))).toMatch(/^(14:00|2:00\sPM) CAT$/); // CAT, UTC+2
    expect(markets.formatLocalTime("ng-lagos", new Date("2026-10-10T12:00:00Z"))).toMatch(/^(13:00|1:00\s[ap]m|1:00\s[AP]M) WAT$/); // WAT, UTC+1
    expect(markets.formatLocalTime("gh-accra", new Date("2026-10-10T12:00:00Z"))).toMatch(/^12:00(\s[ap]m|\s[AP]M)? GMT$/); // GMT
    expect(markets.formatMoney("ng-lagos", 4250)).toMatch(/₦\s?4,250|NGN\s?4,250/);
    expect(markets.formatMoney("gh-accra", 32.5)).toMatch(/GH₵\s?32\.50|GHS\s?32\.50/);
    expect(markets.formatMoney("zw-harare", 6.1)).toMatch(/US\$\s?6\.10|\$6\.10/);
  });

  test("local pricing is configured per market, marked unconfirmed, with the minimum fare and airport surcharge", () => {
    const short = markets.estimateForMarket("gh-accra", { km: 1, minutes: 3 });
    expect(short).toMatchObject({ currency: "GHS", confirmed: false, minimum_fare_applied: true, total: 15 });
    const airport = markets.estimateForMarket("ng-lagos", { km: 20, minutes: 60, ride_type: "airport" });
    // 500 + 20*250 + 60*20 + 1000 surcharge + 200 booking fee
    expect(airport.total).toBe(7900);
    expect(airport.driver_payout).toBeCloseTo((7900 - 200) * 0.7, 2);
  });

  test("payments: all disabled pending integration; Zimbabwe is EcoCash only (no cash)", () => {
    for (const id of Object.keys(pilots)) {
      const payments = markets.getMarket(id).payments;
      expect(payments.length).toBeGreaterThan(0);
      for (const p of payments) {
        expect(p.enabled).toBe(false);
        expect(p.pending).toMatch(/\w/);
      }
    }
    expect(markets.getMarket("zw-harare").payments.map((p) => p.method)).toEqual(["ecocash"]);
    expect(markets.paymentMethodAllowed("zw-harare", "cash")).toBe(false);
  });

  test("driver documents are per market, expiry tracked, all pending local confirmation", () => {
    for (const id of Object.keys(pilots)) {
      const docs = markets.getMarket(id).driver_documents;
      expect(docs.length).toBeGreaterThanOrEqual(5);
      expect(docs.every((d) => d.confirmed === false)).toBe(true);
      expect(docs.some((d) => d.expiry_required)).toBe(true);
    }
  });

  test("the AI model is off outside Nashville until each market's data transfer is assessed", () => {
    for (const id of Object.keys(pilots)) expect(markets.getMarket(id).ai_model_allowed).toBe(false);
  });
});

describe("phone numbers and verification", () => {
  test.each([
    ["zw-harare", "0771234567", "+263771234567"],
    ["zw-harare", "+263 78 123 4567", "+263781234567"],
    ["zw-harare", "00263711234567", "+263711234567"],
    ["ng-lagos", "08031234567", "+2348031234567"],
    ["ng-lagos", "+234 905 123 4567", "+2349051234567"],
    ["gh-accra", "0241234567", "+233241234567"],
    ["gh-accra", "+233 55 123 4567", "+233551234567"]
  ])("%s accepts %s", (id, input, e164) => {
    expect(markets.normalizeMarketPhone(id, input)).toBe(e164);
    expect(markets.marketForPhone(e164).id).toBe(id);
  });

  test.each([
    ["zw-harare", "0241234567"], // Ghana-style
    ["zw-harare", "+263 24 123 4567"], // landline range
    ["zw-harare", "+1 615 555 0100"], // another country
    ["ng-lagos", "0803123456"], // too short
    ["gh-accra", "+233 30 123 4567"], // landline
    ["us-nashville", "+263771234567"]
  ])("%s rejects %s", (id, input) => {
    expect(markets.normalizeMarketPhone(id, input)).toBeNull();
  });
});

describe("simulated rides", () => {
  test("a Harare ride: km, local times, illustrative fare, nothing live", () => {
    const ride = markets.simulateRide("zw-harare", { from: "airport", to: "cbd", startAt: new Date("2026-10-10T08:00:00Z") });
    expect(ride.simulated).toBe(true);
    expect(ride.market.live_allowed).toBe(false);
    expect(ride.distance_text).toMatch(/km$/);
    expect(ride.distance_km).toBeGreaterThan(10);
    expect(ride.fare.illustrative).toBe(true);
    expect(ride.timeline[0].local_time).toMatch(/^(10:00|10:00\sAM) CAT$/);
    expect(ride.payment.options.every((p) => p.enabled === false)).toBe(true);
    expect(ride.ai_model_allowed).toBe(false);
  });

  test("rejects unknown or identical places, and markets without a simulation", () => {
    expect(() => markets.simulateRide("gh-accra", { from: "airport", to: "airport" })).toThrow();
    expect(() => markets.simulateRide("gh-accra", { from: "nowhere", to: "legon" })).toThrow();
    expect(() => markets.simulateRide("us-nashville", { from: "a", to: "b" })).toThrow();
  });
});
