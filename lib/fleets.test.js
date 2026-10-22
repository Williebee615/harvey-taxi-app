const f = require("./fleets");

const NOW = new Date("2026-10-22T12:00:00Z");
const doc = (type, over = {}) => ({ document_type: type, expires_on: "2027-01-01", verification_status: "staff_verified", superseded_at: null, ...over });

test("fleet name is required", () => {
  expect(f.validateFleetName({ name: " " }).ok).toBe(false);
  expect(f.validateFleetName({ name: "Music City Cars" })).toEqual({ ok: true, name: "Music City Cars" });
});

test("vehicles: human-driven only; plate, state and VIN checked", () => {
  const good = { vehicle_year: 2022, make: "Toyota", model: "Camry", color: "Blue", plate: "abc-123", plate_state: "tn", vin_last6: "a1b2c3" };
  expect(f.validateVehicle(good, { now: NOW })).toMatchObject({ ok: true, row: { plate: "ABC-123", plate_state: "TN", vin_last6: "A1B2C3", automation: "none" } });
  expect(f.validateVehicle({ ...good, automation: "driverless" }, { now: NOW }).error).toMatch(/Autonomous rides are not available yet/);
  expect(f.validateVehicle({ ...good, vehicle_year: 2030 }, { now: NOW }).ok).toBe(false);
  expect(f.validateVehicle({ ...good, vin_last6: "IOQ123" }, { now: NOW }).ok).toBe(false);
  expect(f.validateVehicle({ ...good, plate_state: "Tenn" }, { now: NOW }).ok).toBe(false);
});

test("document dates: insurance or registration, not already expired", () => {
  expect(f.validateDocumentDate({ document_type: "insurance", expires_on: "2027-03-01" }, { now: NOW }).ok).toBe(true);
  expect(f.validateDocumentDate({ document_type: "inspection", expires_on: "2027-03-01" }, { now: NOW }).ok).toBe(false);
  expect(f.validateDocumentDate({ document_type: "insurance", expires_on: "2026-10-21" }, { now: NOW }).error).toMatch(/expired/);
  expect(f.validateDocumentDate({ document_type: "insurance", expires_on: "03/01/2027" }, { now: NOW }).ok).toBe(false);
});

test("invitations: US phone, share from 0 to 50%", () => {
  expect(f.validateInvitation({ phone: "(615) 555-0202", owner_share_pct: 20 })).toEqual({ ok: true, phone: "+16155550202", owner_share_pct: 20 });
  expect(f.validateInvitation({ phone: "6155550202", owner_share_pct: 50.5 }).ok).toBe(false);
  expect(f.validateInvitation({ phone: "6155550202", owner_share_pct: -1 }).ok).toBe(false);
  expect(f.validateInvitation({ phone: "6155550202", owner_share_pct: 12.345 }).ok).toBe(false);
  expect(f.validateInvitation({ phone: "555", owner_share_pct: 10 }).ok).toBe(false);
});

test("a vehicle carries riders only when active with both documents staff-verified and current", () => {
  const vehicle = { status: "active", automation: "none" };
  expect(f.vehicleDispatchable(vehicle, [doc("insurance"), doc("registration")], { now: NOW })).toEqual({ ok: true, reasons: [] });
  expect(f.vehicleDispatchable({ ...vehicle, status: "pending_review" }, [doc("insurance"), doc("registration")], { now: NOW }).reasons).toEqual(["vehicle_not_active"]);
  expect(f.vehicleDispatchable(vehicle, [doc("insurance", { verification_status: "unverified" }), doc("registration")], { now: NOW }).reasons).toEqual(["insurance_unverified"]);
  expect(f.vehicleDispatchable(vehicle, [doc("insurance", { expires_on: "2026-10-21" }), doc("registration")], { now: NOW }).reasons).toEqual(["insurance_expired"]);
  expect(f.vehicleDispatchable(vehicle, [doc("insurance")], { now: NOW }).reasons).toEqual(["registration_missing"]);
  expect(f.vehicleDispatchable({ ...vehicle, automation: "driverless" }, [doc("insurance"), doc("registration")], { now: NOW }).reasons).toEqual(["automation_not_allowed"]);
});

test("owner's share applies to the fare earning only, to the cent", () => {
  expect(f.ownerShareAmount(20, 25)).toBe(5);
  expect(f.ownerShareAmount(13.37, 20)).toBe(2.67);
  expect(f.ownerShareAmount(20, 0)).toBe(0);
  expect(f.ownerShareAmount(0, 50)).toBe(0);
});

test("the fleet owner's view of a driver has no contact, screening or location details", () => {
  const view = f.ownerViewOfMember({
    membership: { id: "M1", status: "active", owner_share_pct: "20.00" },
    driver: { id: "D2", first_name: "Sam", phone: "+16155550202", email: "sam@example.test", current_lat: 36.1, checkr_status: "clear", online: true },
    assignment: { vehicle_id: "V1" },
    vehicle: { id: "V1", vehicle_year: 2022, make: "Toyota", model: "Camry", plate: "ABC123" },
    stats: { trips: 3, earnings: 60, owner_share: 12 }
  });
  expect(view).toEqual({
    membership_id: "M1",
    status: "active",
    owner_share_pct: 20,
    first_name: "Sam",
    online: true,
    assigned_vehicle: { vehicle_id: "V1", label: "2022 Toyota Camry", plate: "ABC123" },
    fleet_trips: 3,
    fleet_earnings: 60,
    owner_share_total: 12
  });
});

test("assignment swaps the driver-row vehicle and keeps the old one to restore", () => {
  const driver = { vehicle_year: "2019", vehicle_make: "Honda", vehicle_model: "Civic", vehicle_color: "Red", vehicle_plate: "OWN1", license_plate: "OWN1" };
  expect(f.previousVehicleSnapshot(driver)).toEqual(driver);
  expect(f.driverFieldsForVehicle({ vehicle_year: 2022, make: "Toyota", model: "Camry", color: "Blue", plate: "ABC123" })).toEqual({
    vehicle_year: "2022", vehicle_make: "Toyota", vehicle_model: "Camry", vehicle_color: "Blue", vehicle_plate: "ABC123", license_plate: "ABC123"
  });
});
