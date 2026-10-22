# Fleet management, phase 1: human-driven fleets (design for owner review)

**Prepared:** 2026-10-22 (UTC). **Status:** design only. Nothing is built, migrated or switched on.

**[Owner decision 2026-10-22]**
- Build the fleet foundation first, for human-driven vehicles. It must be built so autonomous vehicles can be added later.
- Only approved Harvey Taxi drivers may own a fleet.
- Earnings: record each trip and show the fleet owner's agreed share. No automated money movement until payouts are designed and approved.
- Counsel and the insurance broker have not yet reviewed the autonomous-vehicles brief. Autonomous work stays limited to switched-off groundwork. Fleet questions are added to the brief (section E).

## 1. What exists today [Verified 2026-10-22, code and read-only production counts]

- **Vehicle data:** each driver has one vehicle, stored on the driver row (`vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`, plate). Riders see "year make model" from that row.
- **Readiness to drive:** `computeDriverReadiness` (`lib/driverCompliance.js`) is the rule for going online:
  - email and phone verified;
  - identity verified (Persona, when switched on);
  - background check clear (Checkr, when switched on);
  - a vehicle on the driver row.
- **"Approved" is not reliable on its own.** All 28 driver rows say `approval_status = approved`, including applicants who never finished setup. The admin dashboard already shows "Unverified" or "Pending Setup" for them.
- **Documents:** `driver_document_records` stores expiry dates for licence, insurance and registration, with source and verification status. It has 0 current records in production.
- **Earnings:** `driver_earnings` has one row per completed ride (22 rows). None is marked paid. No payout system exists.
- **Autonomous:** autonomous rides are refused by the server (§23). The driver sign-up links an "Autonomous Vehicle Owner Program: planned, not available" interest list (email).

## 2. What phase 1 adds

A **fleet owner** is a verified Harvey Taxi driver who registers vehicles and invites other verified drivers to drive them.

| Area | Rule |
|---|---|
| **Becoming a fleet owner** | The driver applies from the driver dashboard. They must pass `computeDriverReadiness` (status "Verified"), not just show "approved". Staff approve or decline the fleet (agents never decide about people). |
| **Vehicles** | The owner adds each vehicle: year, make, model, colour, plate, state, and the last 6 characters of the VIN. Insurance and registration expiry dates use the existing document-record rules (source and verification status). A vehicle becomes **active only after staff verify** its insurance and registration, and only while both are unexpired. |
| **Drivers** | The owner invites by phone number. The invited person accepts or declines in their own driver dashboard; nothing happens without their acceptance. They must pass the same readiness check as any driver. **The fleet owner can't approve, screen or verify anyone.** |
| **Assignment** | The owner assigns one active vehicle to one fleet driver at a time. A driver can't go online in a fleet vehicle unless the vehicle is active and assigned to them. Riders see the assigned vehicle. |
| **Earnings** | When a fleet trip completes, the earnings row records the fleet, the vehicle and the fleet owner's agreed share (a snapshot of the percentage at the time of the trip). Both people see the split. **No money moves.** |
| **Ending** | Either side can end a membership. Ending it ends any assignment. Staff can suspend a fleet or a vehicle. All changes are audited. |
| **Autonomous hook** | Each vehicle has an `automation` field, and phase 1 accepts only `none`. Any other value is refused with the existing "Autonomous rides are not available yet" message. Later phases plug in here. |
| **Switch** | Everything sits behind a new flag, `fleet_management_enabled`, which is **off**. With it off, nothing a driver or rider sees changes. |

## 3. Data model (one migration, not applied until approved)

All new tables are server-only: RLS on, no anon or signed-in access. Nothing is deleted; changes are recorded as status changes.

- **`fleets`:** `id`, `owner_driver_id`, `name`, `status` (pending, active, declined, suspended), reviewer, reason, timestamps.
- **`fleet_vehicles`:**
  - `id`, `fleet_id`;
  - year, make, model, colour, plate, plate state, `vin_last6`;
  - `automation` (check: `none` only in phase 1);
  - `status` (pending_review, active, inactive, suspended);
  - timestamps.
- **`fleet_vehicle_documents`:** the same model as `driver_document_records`, for insurance and registration (and inspection if required). One current record per vehicle and type, with history kept.
- **`fleet_memberships`:** `fleet_id`, `driver_id`, `status` (invited, active, declined, ended), `owner_share_pct` (0 to the cap in §5), `agreement_version`, `accepted_at`, `ended_by`, `ended_at`. One active fleet per driver.
- **`vehicle_assignments`:** `vehicle_id`, `driver_id`, `starts_at`, `ends_at`. At most one open assignment per vehicle and one per driver (partial unique indexes).
- **`driver_earnings`** (new nullable columns): `fleet_id`, `vehicle_id`, `fleet_owner_share_pct`, `fleet_owner_share_amount`. Existing rows are untouched.

## 4. Surfaces

- **Web first, no app build needed:**
  - a "Fleet" section in the driver dashboard (`driver.html`): apply, vehicles, invitations, assignments, the earnings split;
  - an admin "Fleets" card: approve or decline fleets, verify vehicle documents, suspend.
- **Rider side:** no change beyond the vehicle shown, which comes from the server.
- **Driver app (iOS/Android):** in phase 1 the app keeps working. A fleet driver going online from the app uses their assigned vehicle (server-side rule). Fleet screens in the app come in a later build.

## 5. Owner decisions

**[Owner decision 2026-10-22]** "Approved all five recommendations": items 1–5 below as recommended. The agreement text (item 5) is still to be drafted and reviewed by counsel before switch-on.

1. **What the fleet owner can see about their drivers.**
   - *Recommended:* first name, vehicle assignment, online or offline, trip count and fleet earnings.
   - Not phone, email, documents, background-check details, or live location.
   - Live vehicle location is common in fleet tools, but it's personal data and needs counsel's view first.
2. **Owner's share.**
   - *Recommended:* an agreed percentage recorded per driver, capped at 50% in the pilot.
   - Harvey Taxi records it and doesn't set it.
   - Counsel to confirm (brief §E).
3. **Vehicle documents required before a vehicle is active.**
   - *Recommended:* insurance and registration, both staff-verified.
   - Add an inspection only if counsel or the insurer requires it.
4. **Pilot size.** *Recommended:* up to 3 fleets and 5 vehicles each, staff-approved, before any wider opening.
5. **Agreement text.** The fleet owner terms and the driver's acceptance wording need counsel review before the switch is turned on. I'll draft them for review.

## 6. Risks and how phase 1 handles them

- **Contractor classification:** a fleet owner taking a share of another driver's earnings may look like an employer. Phase 1 only records the split. Counsel question E1.
- **Insurance for vehicles a driver doesn't own:** Tennessee rideshare law sets cover levels by period. Whose policy covers a fleet vehicle is the first insurer question (brief §E). No vehicle goes active without staff-verified insurance.
- **Screening:** every driver is screened individually, exactly as today. A fleet adds no shortcut.
- **Privacy:** sharing is limited to the minimum and agreed by the driver at acceptance. The privacy policy needs a fleet section before launch.
- **Autonomous creep:** `automation` is restricted to `none` at the database and server level until counsel and the insurer sign off.

## 7. Delivery

1. **This document and the brief update.** Docs only.
2. **PR 1: schema and server.** Migration not applied; flag off. It includes:
   - fleet rules in a tested library (`lib/fleets.js`);
   - routes for owners, drivers and staff;
   - dispatch and earnings hooks;
   - tests, including database tests.
3. **PR 2: web screens.** The driver dashboard Fleet section and the admin Fleets card, with browser tests.
4. **Before switch-on:**
   - counsel and insurer answers;
   - agreement text;
   - the privacy policy section;
   - the owner's approval to apply the migration and switch the flag on.

**Next step:** the owner's decisions in §5, then PR 1.
