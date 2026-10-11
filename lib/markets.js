// Markets: one rider app and one driver app, with each market's own
// settings (docs/markets/README.md).
//
// Nashville (us-nashville) is the only live market and keeps exactly the
// settings it has today: its prices still come from lib/pricing.js (the
// same environment variables), its phone, emergency and payment rules are
// unchanged, and every existing rider, driver and ride belongs to it.
//
// The pilot markets (Harare, Lagos, Accra) exist for a simulated test mode
// only. Live service in a market needs two things, on purpose in two
// places: `approved_for_live: true` here (a code change the owner
// approves per market) AND the system flag `market_live_<id>` set to
// "true". Neither alone is enough, and both are false today.
//
// Every value marked `confirmed: false` is a placeholder pending local
// confirmation (docs/markets/<country>.md lists the source and the open
// question). Prices are illustrative test values, not market research.

const pricing = require("./pricing");

const KM_PER_MILE = 1.609344;

// Mobile numbers only: riders and drivers sign in with a code by SMS.
const PHONE_RULES = Object.freeze({
  US: { country_code: "1", national_digits: 10, trunk_prefix: "", mobile_prefixes: null, example: "+1 615 555 0100" },
  // 71 NetOne, 73 Telecel, 77/78 Econet (+263 7X XXX XXXX).
  ZW: { country_code: "263", national_digits: 9, trunk_prefix: "0", mobile_prefixes: ["71", "73", "77", "78"], example: "+263 77 123 4567" },
  // Mobile ranges start 70, 80, 81, 90, 91 (+234 8XX XXX XXXX).
  NG: { country_code: "234", national_digits: 10, trunk_prefix: "0", mobile_prefixes: ["70", "80", "81", "90", "91"], example: "+234 803 123 4567" },
  // Mobile ranges start 2x and 5x (+233 24 123 4567).
  GH: { country_code: "233", national_digits: 9, trunk_prefix: "0", mobile_prefixes: ["20", "23", "24", "25", "26", "27", "28", "50", "53", "54", "55", "56", "57", "59"], example: "+233 24 123 4567" }
});

const MARKETS = Object.freeze({
  "us-nashville": {
    id: "us-nashville",
    name: "Nashville",
    country: "US",
    country_name: "United States",
    status: "live",
    approved_for_live: true,
    timezone: "America/Chicago",
    locale: "en-US",
    distance_unit: "mi",
    currency: { code: "USD", accepted: ["USD"], confirmed: true },
    // Today's prices, read from lib/pricing.js (environment variables).
    pricing: null,
    payments: [{ method: "card", provider: "stripe", enabled: true }],
    emergency: { primary: "911", label: "911", numbers: { all: "911" }, confirmed: true },
    driver_documents: "existing", // Persona identity, Checkr screening (unchanged)
    privacy: { law: "US state and federal law", notes: "Existing privacy policy." },
    ai_model_allowed: true,
    pilot_city: { name: "Nashville", center: { lat: 36.1627, lng: -86.7816 } }
  },

  "zw-harare": {
    id: "zw-harare",
    name: "Harare",
    country: "ZW",
    country_name: "Zimbabwe",
    status: "test",
    approved_for_live: false,
    timezone: "Africa/Harare",
    locale: "en-ZW",
    distance_unit: "km",
    // USD is used for most transactions alongside ZiG; which currency fares
    // are quoted and settled in is an open question (docs/markets/zimbabwe.md).
    currency: { code: "USD", accepted: ["USD", "ZWG"], confirmed: false },
    // Commission: Harvey Taxi's share of each fare, set by the owner only.
    // No rate is set (rate: null), so no split is computed: quotes show the
    // fare total and "commission not set". See docs/markets/zimbabwe-payments.md.
    pricing: { currency: "USD", base_fare: 1.0, per_km: 0.5, per_minute: 0.05, booking_fee: 0.5, minimum_fare: 2.0, airport_surcharge: 2.0, commission: { rate: null, approved: false }, confirmed: false },
    // EcoCash only. No cash bookings in Zimbabwe (owner decision, 10 Oct).
    cash_bookings: false,
    payments: [
      {
        method: "ecocash",
        provider: null,
        enabled: false,
        pending: "Provider not chosen (Paynow or EcoCash direct). Neither publicly documents collecting fares for drivers and paying out their share; written confirmation of that arrangement, payouts, fees, settlement, refunds, USD/ZiG and RBZ position is required first (docs/markets/zimbabwe-payments.md)."
      }
    ],
    emergency: {
      primary: "999",
      label: "999 (police 995, ambulance 994, fire 993)",
      numbers: { all: "999", police: "995", ambulance: "994", fire: "993" },
      confirmed: false
    },
    driver_documents: [
      { key: "national_id", label: "National ID", expiry_required: false, confirmed: false },
      { key: "drivers_licence", label: "Driver's licence", expiry_required: true, confirmed: false },
      { key: "defensive_driving_certificate", label: "Defensive driving certificate", expiry_required: true, confirmed: false },
      { key: "police_clearance", label: "Police clearance", expiry_required: true, confirmed: false },
      { key: "vehicle_registration", label: "Vehicle registration book", expiry_required: false, confirmed: false },
      { key: "vehicle_insurance", label: "Vehicle insurance (passenger cover)", expiry_required: true, confirmed: false },
      { key: "vehicle_licence_zinara", label: "ZINARA vehicle licence", expiry_required: true, confirmed: false },
      { key: "operator_permit", label: "Operator / route permit", expiry_required: true, confirmed: false }
    ],
    privacy: {
      law: "Cyber and Data Protection Act [Chapter 12:07]; SI 155 of 2024",
      regulator: "POTRAZ (Data Protection Authority)",
      notes: "Data controller licence from POTRAZ; cross-border transfers need an adequacy basis or another lawful ground; AI transfers not yet assessed."
    },
    ai_model_allowed: false,
    pilot_city: { name: "Harare", center: { lat: -17.8292, lng: 31.0522 } },
    simulation: { road_factor: 1.35, average_speed_kmh: 30 },
    places: [
      { key: "airport", label: "Robert Gabriel Mugabe International Airport", lat: -17.9318, lng: 31.0928 },
      { key: "cbd", label: "Africa Unity Square, Harare CBD", lat: -17.8292, lng: 31.0522 },
      { key: "borrowdale", label: "Sam Levy's Village, Borrowdale", lat: -17.755, lng: 31.089 },
      { key: "uz", label: "University of Zimbabwe, Mount Pleasant", lat: -17.784, lng: 31.053 }
    ]
  },

  "ng-lagos": {
    id: "ng-lagos",
    name: "Lagos",
    country: "NG",
    country_name: "Nigeria",
    status: "test",
    approved_for_live: false,
    timezone: "Africa/Lagos",
    locale: "en-NG",
    distance_unit: "km",
    currency: { code: "NGN", accepted: ["NGN"], confirmed: false },
    pricing: { currency: "NGN", base_fare: 500, per_km: 250, per_minute: 20, booking_fee: 200, minimum_fare: 1500, airport_surcharge: 1000, driver_share: 0.7, confirmed: false },
    payments: [
      { method: "cash", provider: null, enabled: false, pending: "Cash handling and driver remittance not designed or approved." },
      { method: "card_or_transfer", provider: "Local payment service provider (e.g. Paystack, Flutterwave)", enabled: false, pending: "Provider not chosen; merchant onboarding, fees and settlement not confirmed." }
    ],
    emergency: {
      primary: "112",
      label: "112 (Lagos emergency 767)",
      numbers: { all: "112", lagos: "767" },
      confirmed: false
    },
    driver_documents: [
      { key: "nin", label: "National Identification Number (NIN)", expiry_required: false, confirmed: false },
      { key: "drivers_licence", label: "Driver's licence", expiry_required: true, confirmed: false },
      { key: "lasdri_certificate", label: "LASDRI certificate of competence and card", expiry_required: true, confirmed: false },
      { key: "lasrra_card", label: "LASRRA residents card", expiry_required: false, confirmed: false },
      { key: "drivers_badge", label: "Driver's badge", expiry_required: true, confirmed: false },
      { key: "vehicle_registration", label: "Vehicle registration (Lagos State)", expiry_required: true, confirmed: false },
      { key: "vehicle_inspection", label: "Vehicle inspection certificate", expiry_required: true, confirmed: false },
      { key: "vehicle_insurance", label: "Vehicle insurance", expiry_required: true, confirmed: false }
    ],
    privacy: {
      law: "Nigeria Data Protection Act 2023",
      regulator: "Nigeria Data Protection Commission (NDPC)",
      notes: "Registration as a data controller of major importance likely (NDPC 2024 guidance: >200 data subjects in six months); cross-border transfers need adequacy or another Part VIII basis; AI transfers not yet assessed."
    },
    ai_model_allowed: false,
    pilot_city: { name: "Lagos", center: { lat: 6.4281, lng: 3.4219 } },
    simulation: { road_factor: 1.4, average_speed_kmh: 18 },
    places: [
      { key: "airport", label: "Murtala Muhammed International Airport, Ikeja", lat: 6.5774, lng: 3.3212 },
      { key: "vi", label: "Victoria Island", lat: 6.4281, lng: 3.4219 },
      { key: "lekki", label: "Lekki Phase 1", lat: 6.4474, lng: 3.4729 },
      { key: "ikeja", label: "Ikeja City Mall", lat: 6.6142, lng: 3.3576 }
    ]
  },

  "gh-accra": {
    id: "gh-accra",
    name: "Accra",
    country: "GH",
    country_name: "Ghana",
    status: "test",
    approved_for_live: false,
    timezone: "Africa/Accra",
    locale: "en-GH",
    distance_unit: "km",
    currency: { code: "GHS", accepted: ["GHS"], confirmed: false },
    pricing: { currency: "GHS", base_fare: 5, per_km: 3, per_minute: 0.4, booking_fee: 2, minimum_fare: 15, airport_surcharge: 10, driver_share: 0.7, confirmed: false },
    payments: [
      { method: "cash", provider: null, enabled: false, pending: "Cash handling and driver remittance not designed or approved." },
      { method: "mobile_money", provider: "Mobile money (e.g. MTN MoMo) via a licensed provider", enabled: false, pending: "Provider not chosen; merchant onboarding, fees and settlement not confirmed." }
    ],
    emergency: {
      primary: "112",
      label: "112 (police 191, fire 192, ambulance 193)",
      numbers: { all: "112", police: "191", fire: "192", ambulance: "193" },
      confirmed: false
    },
    driver_documents: [
      { key: "ghana_card", label: "Ghana Card (national ID)", expiry_required: true, confirmed: false },
      { key: "drivers_licence", label: "Driver's licence (commercial category)", expiry_required: true, confirmed: false },
      { key: "police_report", label: "Police clearance report", expiry_required: true, confirmed: false },
      { key: "vehicle_registration", label: "DVLA vehicle registration (commercial use)", expiry_required: true, confirmed: false },
      { key: "roadworthy_certificate", label: "Roadworthy certificate", expiry_required: true, confirmed: false },
      { key: "vehicle_insurance", label: "Vehicle insurance (commercial)", expiry_required: true, confirmed: false },
      { key: "dvla_ride_hailing_sticker", label: "DVLA ride-hailing registration / sticker", expiry_required: true, confirmed: false }
    ],
    privacy: {
      law: "Data Protection Act, 2012 (Act 843)",
      regulator: "Data Protection Commission",
      notes: "Registration with the Commission (renewed every two years); the Act's cross-border transfer position is unclear and needs counsel; AI transfers not yet assessed."
    },
    ai_model_allowed: false,
    pilot_city: { name: "Accra", center: { lat: 5.6037, lng: -0.187 } },
    simulation: { road_factor: 1.35, average_speed_kmh: 22 },
    places: [
      { key: "airport", label: "Kotoka International Airport", lat: 5.6052, lng: -0.1668 },
      { key: "accra_mall", label: "Accra Mall, Tetteh Quarshie", lat: 5.6223, lng: -0.1736 },
      { key: "makola", label: "Makola Market, Central Accra", lat: 5.548, lng: -0.209 },
      { key: "legon", label: "University of Ghana, Legon", lat: 5.6508, lng: -0.187 }
    ]
  }
});

const DEFAULT_MARKET_ID = "us-nashville";
const MARKET_ID_PATTERN = /^[a-z]{2}-[a-z]{2,30}$/;

function getMarket(id) {
  return MARKETS[id] || null;
}

function listMarkets() {
  return Object.values(MARKETS);
}

// Live service: Nashville always; any other market only when the code
// says it's approved for live AND its system flag is on.
function marketLiveAllowed(id, flags = {}) {
  const market = getMarket(id);
  if (!market) return false;
  if (id === DEFAULT_MARKET_ID) return true;
  return market.approved_for_live === true && String(flags[`market_live_${id}`] || "") === "true";
}

// A market's mobile number in E.164, or null if it isn't one.
function normalizeMarketPhone(id, input) {
  const market = getMarket(id);
  if (!market) return null;
  const rule = PHONE_RULES[market.country];
  const raw = String(input == null ? "" : input).trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const international = raw.replace(/[^\d+]/g, "").startsWith("+") || raw.startsWith("00");
  if (raw.startsWith("00")) digits = digits.slice(2);
  let national;
  if (international || (digits.startsWith(rule.country_code) && digits.length === rule.country_code.length + rule.national_digits)) {
    if (!digits.startsWith(rule.country_code)) return null; // another country's number
    national = digits.slice(rule.country_code.length);
  } else if (rule.trunk_prefix && digits.startsWith(rule.trunk_prefix) && digits.length === rule.national_digits + 1) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  if (national.length !== rule.national_digits) return null;
  if (rule.mobile_prefixes && !rule.mobile_prefixes.some((p) => national.startsWith(p))) return null;
  if (market.country === "US" && !/^[2-9]\d{2}[2-9]/.test(national)) return null;
  return `+${rule.country_code}${national}`;
}

// Which market a phone number belongs to, by country code (null if none).
function marketForPhone(e164) {
  const digits = String(e164 || "").replace(/\D/g, "");
  return listMarkets().find((m) => normalizeMarketPhone(m.id, `+${digits}`) === `+${digits}`) || null;
}

function toKm(miles) {
  return Number(miles) * KM_PER_MILE;
}

function formatMoney(id, amount) {
  const market = getMarket(id);
  const code = market.pricing ? market.pricing.currency : market.currency.code;
  return new Intl.NumberFormat(market.locale, { style: "currency", currency: code, minimumFractionDigits: code === "NGN" ? 0 : 2, maximumFractionDigits: code === "NGN" ? 0 : 2 }).format(amount);
}

function formatDistance(id, km) {
  const market = getMarket(id);
  if (market.distance_unit === "mi") return `${(km / KM_PER_MILE).toFixed(1)} mi`;
  return `${km.toFixed(1)} km`;
}

function formatLocalTime(id, date) {
  const market = getMarket(id);
  return new Intl.DateTimeFormat(market.locale, { hour: "numeric", minute: "2-digit", timeZone: market.timezone, timeZoneName: "short" }).format(date);
}

const round2 = (n) => Math.round(n * 100) / 100;

// Fare for one trip in the market's currency. Nashville is delegated to
// lib/pricing.js unchanged (it prices by the mile).
function estimateForMarket(id, { km = 0, minutes = 0, ride_type = "standard" } = {}) {
  const market = getMarket(id);
  if (!market) throw new Error(`unknown market ${id}`);
  if (!market.pricing) {
    const us = pricing.calculateRideEstimate({ miles: Number(km) / KM_PER_MILE, minutes, ride_type });
    return { market: id, currency: "USD", confirmed: true, ...us };
  }
  const p = market.pricing;
  const base = p.base_fare + Math.max(0, km) * p.per_km + Math.max(0, minutes) * p.per_minute;
  const surcharge = ride_type === "airport" ? p.airport_surcharge : 0;
  const eligible = base + surcharge;
  const preFloor = eligible + p.booking_fee;
  const total = Math.max(p.minimum_fare, preFloor);
  const eligibleForPayout = total - p.booking_fee;
  const share = driverShareOf(p);
  return {
    market: id,
    currency: p.currency,
    confirmed: p.confirmed === true,
    base_fare: p.base_fare,
    distance_charge: round2(km * p.per_km),
    time_charge: round2(minutes * p.per_minute),
    surcharge_amount: surcharge,
    booking_fee: p.booking_fee,
    minimum_fare_applied: preFloor < p.minimum_fare,
    total: round2(total),
    // null while the market's commission is not set.
    driver_payout: share === null ? null : round2(eligibleForPayout * share),
    platform_fee: share === null ? null : round2(total - eligibleForPayout * share),
    commission_set: share !== null
  };
}

// Driver's share of the payout-eligible fare (fare less booking fee).
// Markets with a `commission` block use 1 - rate, and return null while no
// rate is set; older placeholder markets still carry `driver_share`.
function driverShareOf(p) {
  if (p.commission) {
    const rate = p.commission.rate;
    return typeof rate === "number" && rate >= 0 && rate < 1 ? 1 - rate : null;
  }
  return typeof p.driver_share === "number" ? p.driver_share : null;
}

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A simulated ride in a test market: no database writes, no dispatch, no
// payment, no messages. Distance is straight-line x a road factor (a
// placeholder until a routing provider is confirmed for the city).
function simulateRide(id, { from, to, ride_type = "standard", startAt = new Date() } = {}) {
  const market = getMarket(id);
  if (!market || !market.places) throw new Error(`no simulation for market ${id}`);
  const origin = market.places.find((p) => p.key === from);
  const dest = market.places.find((p) => p.key === to);
  if (!origin || !dest || origin === dest) throw new Error("choose two different places in the pilot city");
  const km = round2(haversineKm(origin, dest) * market.simulation.road_factor);
  const minutes = Math.max(4, Math.round((km / market.simulation.average_speed_kmh) * 60));
  const fare = estimateForMarket(id, { km, minutes, ride_type });
  const t0 = startAt.getTime();
  const step = (label, offsetMin) => ({ label, at: new Date(t0 + offsetMin * 60000).toISOString(), local_time: formatLocalTime(id, new Date(t0 + offsetMin * 60000)) });
  return {
    simulated: true,
    market: { id, name: market.name, country: market.country_name, timezone: market.timezone, live_allowed: false },
    pickup: origin.label,
    dropoff: dest.label,
    distance_km: km,
    distance_text: formatDistance(id, km),
    duration_minutes: minutes,
    fare: { ...fare, total_text: formatMoney(id, fare.total), driver_payout_text: fare.driver_payout === null ? "not set (commission not set)" : formatMoney(id, fare.driver_payout), illustrative: fare.confirmed !== true },
    payment: { method: "simulated", options: market.payments.map((p) => ({ method: p.method, provider: p.provider, enabled: p.enabled, pending: p.pending || null })) },
    emergency: { ...market.emergency, instruction: `Emergency? Call ${market.emergency.label} first.` },
    ai_model_allowed: market.ai_model_allowed,
    timeline: [step("Ride requested (simulated)", 0), step("Test driver assigned", 2), step("Driver arrived at pickup", 8), step("Trip started", 10), step("Trip completed", 10 + minutes)]
  };
}

// Readiness summary for the admin preview.
function marketSummary(id, flags = {}) {
  const m = getMarket(id);
  const docs = Array.isArray(m.driver_documents) ? m.driver_documents : [];
  return {
    id: m.id,
    name: m.name,
    country: m.country_name,
    status: m.status,
    approved_for_live: m.approved_for_live,
    live_flag: String(flags[`market_live_${id}`] || "false") === "true",
    live_allowed: marketLiveAllowed(id, flags),
    timezone: m.timezone,
    distance_unit: m.distance_unit,
    currency: m.currency,
    pricing: m.pricing ? { ...m.pricing } : { source: "lib/pricing.js (current Nashville settings)" },
    phone: { country_code: `+${PHONE_RULES[m.country].country_code}`, example: PHONE_RULES[m.country].example },
    payments: m.payments,
    cash_bookings: m.cash_bookings !== false,
    emergency: m.emergency,
    driver_documents: m.driver_documents,
    privacy: m.privacy,
    ai_model_allowed: m.ai_model_allowed,
    pilot_city: m.pilot_city.name,
    places: (m.places || []).map(({ key, label }) => ({ key, label })),
    unconfirmed: [
      m.currency.confirmed === false && "currency",
      m.pricing && m.pricing.confirmed === false && "pricing",
      m.pricing && m.pricing.commission && m.pricing.commission.rate == null && "commission rate (owner to set)",
      m.emergency.confirmed === false && "emergency numbers",
      docs.some((d) => d.confirmed === false) && "driver documents"
    ].filter(Boolean)
  };
}

// Whether a booking in this market may use this payment method at all
// (enabled or not). Zimbabwe: EcoCash only, never cash.
function paymentMethodAllowed(id, method) {
  const m = getMarket(id);
  if (!m) return false;
  if (method === "cash" && m.cash_bookings === false) return false;
  return m.payments.some((p) => p.method === method);
}

module.exports = {
  paymentMethodAllowed,
  driverShareOf,
  MARKETS,
  PHONE_RULES,
  DEFAULT_MARKET_ID,
  MARKET_ID_PATTERN,
  KM_PER_MILE,
  getMarket,
  listMarkets,
  marketLiveAllowed,
  normalizeMarketPhone,
  marketForPhone,
  estimateForMarket,
  simulateRide,
  marketSummary,
  formatMoney,
  formatDistance,
  formatLocalTime,
  haversineKm
};
