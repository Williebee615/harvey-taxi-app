// Fleet management, phase 1 (docs/fleet-management-plan.md). Owner
// decisions 2026-10-22: human-driven fleets owned by verified drivers;
// earnings split recorded and shown, no money moved; fleet owners see a
// limited view of their drivers; vehicle insurance and registration
// staff-verified before a vehicle carries riders; pilot of up to 3 fleets
// with up to 5 vehicles each; owner's share agreed per driver, capped at
// 50%. Pure rules here; server.js does the reads and writes.

const { toUsE164 } = require("./merchants");

const FLEET_FLAG = "fleet_management_enabled";
const MAX_PILOT_FLEETS = 3;
const MAX_VEHICLES_PER_FLEET = 5;
const MAX_OWNER_SHARE_PCT = 50;
// Draft wording version; the final text needs counsel review before the
// switch is turned on (plan §5.5).
const AGREEMENT_VERSION = "fleet-draft-2026-10-22";
// Phase 1 accepts only human-driven vehicles. Autonomous vehicles wait
// for counsel and the insurer (docs/legal/autonomous-vehicles-brief.md).
const AUTOMATION_LEVELS = Object.freeze(["none"]);
const DOCUMENT_TYPES = Object.freeze(["insurance", "registration"]);
// The driver-row fields a fleet vehicle replaces while assigned; the
// driver's own values are kept on the assignment and restored after.
const DRIVER_VEHICLE_FIELDS = Object.freeze(["vehicle_year", "vehicle_make", "vehicle_model", "vehicle_color", "vehicle_plate", "license_plate"]);

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const fail = (error, statusCode = 400) => ({ ok: false, error, statusCode });

function validateFleetName(body = {}) {
  const name = str(body.name, 80);
  if (name.length < 2) return fail("Enter a name for your fleet.");
  return { ok: true, name };
}

function normalizePlate(raw) {
  return str(raw, 20).toUpperCase().replace(/[^A-Z0-9 -]/g, "");
}

// Returns { ok, row } or { ok: false, error }.
function validateVehicle(body = {}, { now = new Date() } = {}) {
  const year = Number(body.vehicle_year);
  const automation = str(body.automation, 20) || "none";
  const row = {
    vehicle_year: year,
    make: str(body.make, 40),
    model: str(body.model, 40),
    color: str(body.color, 30),
    plate: normalizePlate(body.plate),
    plate_state: str(body.plate_state, 20).toUpperCase(),
    vin_last6: str(body.vin_last6, 20).toUpperCase(),
    automation
  };
  if (!AUTOMATION_LEVELS.includes(automation)) return fail("Autonomous rides are not available yet. Only vehicles with a licensed human driver can be added.");
  if (!Number.isInteger(year) || year < 1990 || year > now.getUTCFullYear() + 1) return fail("Enter the vehicle's model year.");
  if (!row.make) return fail("Enter the vehicle make.");
  if (!row.model) return fail("Enter the vehicle model.");
  if (!row.color) return fail("Enter the vehicle colour.");
  if (!/^[A-Z0-9 -]{2,10}$/.test(row.plate)) return fail("Enter the licence plate.");
  if (!/^[A-Z]{2}$/.test(row.plate_state)) return fail("Enter the two-letter plate state.");
  if (!/^[A-HJ-NPR-Z0-9]{6}$/.test(row.vin_last6)) return fail("Enter the last 6 characters of the VIN.");
  return { ok: true, row };
}

// A date the fleet owner types, or staff enter from the document.
function validateDocumentDate(body = {}, { now = new Date() } = {}) {
  const type = str(body.document_type, 20);
  const expires = str(body.expires_on, 10);
  if (!DOCUMENT_TYPES.includes(type)) return fail("Document must be insurance or registration.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) return fail("Enter the expiry date as YYYY-MM-DD.");
  if (expires < now.toISOString().slice(0, 10)) return fail("That document has already expired.");
  return { ok: true, document_type: type, expires_on: expires };
}

function validateInvitation(body = {}) {
  const phone = toUsE164(body.phone);
  const pct = Number(body.owner_share_pct);
  if (!phone) return fail("Enter the driver's 10-digit US phone number.");
  if (!Number.isFinite(pct) || pct < 0 || pct > MAX_OWNER_SHARE_PCT || Math.round(pct * 100) !== pct * 100) {
    return fail(`Enter the agreed share as a percentage from 0 to ${MAX_OWNER_SHARE_PCT}.`);
  }
  return { ok: true, phone, owner_share_pct: pct };
}

// Whether a vehicle may carry riders today: active, and both documents
// current, staff-verified and unexpired.
function vehicleDispatchable(vehicle, documents = [], { now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const reasons = [];
  if (!vehicle || vehicle.status !== "active") reasons.push("vehicle_not_active");
  if (vehicle && vehicle.automation !== "none") reasons.push("automation_not_allowed");
  for (const type of DOCUMENT_TYPES) {
    const doc = documents.find((d) => d.document_type === type && !d.superseded_at);
    if (!doc) reasons.push(`${type}_missing`);
    else if (doc.verification_status !== "staff_verified") reasons.push(`${type}_unverified`);
    else if (String(doc.expires_on) < today) reasons.push(`${type}_expired`);
  }
  return { ok: reasons.length === 0, reasons };
}

// Documents alone (used when staff activate a vehicle).
function documentsReady(documents, opts) {
  const { reasons } = vehicleDispatchable({ status: "active", automation: "none" }, documents, opts);
  return { ok: reasons.length === 0, reasons };
}

// The fleet owner's share of a trip: the fare earning only. Tips stay
// 100% with the driver (same rule as upsertDriverEarningIdempotent).
function ownerShareAmount(driverBaseEarning, pct) {
  const base = Number(driverBaseEarning) || 0;
  const share = Number(pct) || 0;
  if (base <= 0 || share <= 0) return 0;
  return Math.round(base * share) / 100;
}

// What a fleet owner sees about a driver in their fleet (owner decision
// 2026-10-22): first name, assigned vehicle, online or offline, trip count
// and fleet earnings. Never phone, email, documents, screening details or
// location.
function ownerViewOfMember({ membership, driver, assignment, vehicle, stats }) {
  return {
    membership_id: membership.id,
    status: membership.status,
    owner_share_pct: Number(membership.owner_share_pct),
    first_name: (driver && (driver.first_name || String(driver.full_name || driver.name || "").split(" ")[0])) || "Driver",
    online: Boolean(driver && (driver.online || driver.is_online)),
    assigned_vehicle: assignment && vehicle ? { assignment_id: assignment.id, vehicle_id: vehicle.id, label: `${vehicle.vehicle_year} ${vehicle.make} ${vehicle.model}`, plate: vehicle.plate } : null,
    fleet_trips: (stats && stats.trips) || 0,
    fleet_earnings: (stats && stats.earnings) || 0,
    owner_share_total: (stats && stats.owner_share) || 0
  };
}

// The driver-row values to restore when an assignment ends.
function previousVehicleSnapshot(driver) {
  const snap = {};
  for (const field of DRIVER_VEHICLE_FIELDS) snap[field] = driver ? driver[field] ?? null : null;
  return snap;
}

function driverFieldsForVehicle(vehicle) {
  return {
    vehicle_year: String(vehicle.vehicle_year),
    vehicle_make: vehicle.make,
    vehicle_model: vehicle.model,
    vehicle_color: vehicle.color,
    vehicle_plate: vehicle.plate,
    license_plate: vehicle.plate
  };
}

module.exports = {
  FLEET_FLAG,
  MAX_PILOT_FLEETS,
  MAX_VEHICLES_PER_FLEET,
  MAX_OWNER_SHARE_PCT,
  AGREEMENT_VERSION,
  AUTOMATION_LEVELS,
  DOCUMENT_TYPES,
  DRIVER_VEHICLE_FIELDS,
  validateFleetName,
  normalizePlate,
  validateVehicle,
  validateDocumentDate,
  validateInvitation,
  vehicleDispatchable,
  documentsReady,
  ownerShareAmount,
  ownerViewOfMember,
  previousVehicleSnapshot,
  driverFieldsForVehicle
};
