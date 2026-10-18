// Merchant portal, phase 1a: application validation and the admin review
// state machine. Pure functions; server.js owns the database reads and
// writes. Terms (owner decision 2026-10-17) are in
// docs/merchant-portal-plan.md section 4.

const CATEGORIES = Object.freeze(["restaurant", "grocery", "convenience"]);

// Decision 3. Shown on the application; the applicant must confirm it.
const EXCLUDED_ITEMS = Object.freeze([
  "Alcohol, tobacco and vape products",
  "Cannabis, hemp and CBD products",
  "Prescription medicines",
  "Weapons and ammunition",
  "Gift cards, prepaid cards and lottery tickets",
  "Live animals",
  "Hazardous materials",
  "Oversized or highly fragile items, or items needing refrigerated or specialized transport"
]);

// Who may move an application where. Rejected is final for that
// application; the store can apply again.
const TRANSITIONS = Object.freeze({
  approve: { from: ["pending", "suspended"], to: "approved", reasonRequired: false },
  reject: { from: ["pending"], to: "rejected", reasonRequired: true },
  suspend: { from: ["approved"], to: "suspended", reasonRequired: true }
});

const MIN_REASON = 10;

const str = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

function toUsE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// Returns {ok:true, row} (columns for the insert) or {ok:false, error}.
function validateMerchantApplication(body = {}) {
  const row = {
    business_name: str(body.business_name, 160),
    category: str(body.category, 20).toLowerCase(),
    address_line: str(body.address_line, 240),
    city: str(body.city, 80),
    state: "TN",
    postal_code: str(body.postal_code, 10) || null,
    contact_name: str(body.contact_name, 120),
    contact_email: str(body.contact_email, 254).toLowerCase(),
    contact_phone: toUsE164(body.contact_phone),
    website: str(body.website, 300) || null,
    prices_differ_from_store: body.prices_differ_from_store === true,
    confirmed_exclusions: body.confirmed_exclusions === true
  };
  const fail = (error) => ({ ok: false, error });
  if (row.business_name.length < 2) return fail("Enter the business name.");
  if (!CATEGORIES.includes(row.category)) return fail("Choose restaurant, grocery or convenience store.");
  if (row.address_line.length < 5) return fail("Enter the store's street address.");
  if (row.city.length < 2) return fail("Enter the city.");
  if (str(body.state, 4) && str(body.state, 4).toUpperCase() !== "TN") return fail("The pilot is open to Tennessee stores only.");
  if (row.postal_code && !/^[0-9]{5}$/.test(row.postal_code)) return fail("Enter a 5-digit ZIP code.");
  if (row.contact_name.length < 2) return fail("Enter a contact name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.contact_email)) return fail("Enter a valid contact email.");
  if (!row.contact_phone) return fail("Enter a 10-digit US phone number.");
  if (row.website && !/^https:\/\//i.test(row.website)) return fail("The website must start with https://.");
  if (!row.confirmed_exclusions) return fail("Confirm that you won't list the excluded items.");
  return { ok: true, row };
}

// Returns {ok:true, update} or {ok:false, error, statusCode}.
function planMerchantReview({ merchant, decision, reason, reviewer, now = new Date() }) {
  const rule = TRANSITIONS[decision];
  if (!rule) return { ok: false, error: "Decision must be approve, reject or suspend.", statusCode: 400 };
  if (!merchant) return { ok: false, error: "Merchant not found.", statusCode: 404 };
  if (!rule.from.includes(merchant.status)) {
    return { ok: false, error: `A ${merchant.status} merchant can't be ${rule.to}.`, statusCode: 409 };
  }
  const why = str(reason, 1000);
  if (rule.reasonRequired && why.length < MIN_REASON) {
    return { ok: false, error: `Give a reason of at least ${MIN_REASON} characters.`, statusCode: 400 };
  }
  return {
    ok: true,
    update: {
      status: rule.to,
      review_reason: why || null,
      reviewed_by: reviewer,
      reviewed_at: now.toISOString(),
      updated_at: now.toISOString()
    }
  };
}

const ADMIN_MERCHANT_FIELDS = Object.freeze([
  "id",
  "business_name",
  "category",
  "address_line",
  "city",
  "postal_code",
  "contact_name",
  "contact_email",
  "contact_phone",
  "website",
  "prices_differ_from_store",
  "status",
  "review_reason",
  "reviewed_by",
  "reviewed_at",
  "created_at"
]);

// Store pickup pin (owner decision 2026-10-18). Staff paste coordinates
// copied from a map: "36.1627, -86.7816", or a Google Maps link containing
// "@36.1627,-86.7816" or "q=36.1627,-86.7816". The pin must be in
// Tennessee (the pilot is in Nashville).
const TN_BOUNDS = Object.freeze({ minLat: 34.98, maxLat: 36.68, minLng: -90.31, maxLng: -81.65 });
function parsePickupPin(input) {
  const text = String(input || "").trim().slice(0, 2000);
  const pair = text.match(/[@=]?(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (!pair) return { ok: false, error: "Paste coordinates like 36.1627, -86.7816, or a Google Maps link to the pin." };
  const lat = Number(pair[1]);
  const lng = Number(pair[2]);
  if (lat < TN_BOUNDS.minLat || lat > TN_BOUNDS.maxLat || lng < TN_BOUNDS.minLng || lng > TN_BOUNDS.maxLng) {
    return { ok: false, error: "That pin isn't in Tennessee. Check the coordinates (latitude first, then longitude)." };
  }
  return { ok: true, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
const PICKUP_PIN_FIELDS = Object.freeze(["pickup_lat", "pickup_lng", "pickup_pin_confirmed_by", "pickup_pin_confirmed_at"]);

module.exports = { parsePickupPin, PICKUP_PIN_FIELDS, TN_BOUNDS, CATEGORIES, EXCLUDED_ITEMS, TRANSITIONS, validateMerchantApplication, planMerchantReview, ADMIN_MERCHANT_FIELDS, toUsE164 };
