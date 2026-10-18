const m = require("./markets");

test("Nashville is the only market and the default, in Nashville time", () => {
  expect(m.MARKETS.map((x) => x.id)).toEqual(["nashville"]);
  expect(m.DEFAULT_MARKET).toBe("nashville");
  expect(m.getMarket("nashville")).toMatchObject({ name: "Nashville", state: "TN", time_zone: "America/Chicago" });
});

test("unknown or malformed market ids fall back to the default; ids match the database check", () => {
  expect(m.marketFromQuery("NASHVILLE")).toBe("nashville");
  expect(m.marketFromQuery("memphis")).toBe("nashville");
  expect(m.marketFromQuery("'; drop table")).toBe("nashville");
  expect(m.getMarket("memphis")).toBeNull();
  expect(m.MARKET_ID.test("nashville")).toBe(true);
  expect(m.MARKET_ID.test("Nash ville")).toBe(false);
});
