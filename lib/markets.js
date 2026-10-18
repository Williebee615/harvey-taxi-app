// Markets: the cities Harvey Taxi serves (owner decision 2026-10-18).
// Every store and order carries a market id. Regional approvals and
// city-level pauses build on this; for now there is one market.

const MARKETS = Object.freeze([
  Object.freeze({ id: "nashville", name: "Nashville", state: "TN", time_zone: "America/Chicago" })
]);
const DEFAULT_MARKET = "nashville";
const MARKET_ID = /^[a-z][a-z0-9_]{1,39}$/;

function getMarket(id) {
  return MARKETS.find((m) => m.id === id) || null;
}

// A market id from a query string: known markets only, else the default.
function marketFromQuery(value) {
  const id = String(value || "").trim().toLowerCase();
  return MARKET_ID.test(id) && getMarket(id) ? id : DEFAULT_MARKET;
}

module.exports = { MARKETS, DEFAULT_MARKET, MARKET_ID, getMarket, marketFromQuery };
