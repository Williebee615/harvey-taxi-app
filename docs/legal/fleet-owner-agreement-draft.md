# Harvey Taxi Fleet Program: Fleet Owner Agreement and Fleet Driver Acknowledgment

**DRAFT FOR COUNSEL REVIEW. NOT FOR SIGNATURE OR PUBLICATION.**

**Version:** `fleet-draft-2026-10-22`. The driver app already shows this version string to invited drivers, marked "draft, under legal review".
**Prepared:** 2026-10-22 (UTC), at the owner's request.
**For:** Harvey Taxi Service LLC (Nashville, Tennessee).
**Status:** a working draft by the platform team, not legal advice. Every bracketed item `[…]` and every "Counsel note" needs counsel's decision. Fleet management stays switched off until counsel approves final text and the owner approves switch-on.

**How this draft was written:** each operational term below describes what the platform actually does today (`docs/fleet-management-plan.md`; code in `lib/fleets.js` and `server.js`). If counsel changes a term that the software enforces, the software must change before launch. Those terms are marked **[Enforced by the platform]**.

---

## Part A. Fleet Owner Agreement

This Fleet Owner Agreement (the "Agreement") is between **Harvey Taxi Service LLC**, a Tennessee limited liability company ("Harvey Taxi"), and the individual or business identified in the fleet application (the "Fleet Owner").

> **Counsel note A0:** Phase 1 allows only individual, verified Harvey Taxi drivers to be Fleet Owners (owner decision 2026-10-22). Confirm whether the Fleet Owner contracts as an individual or must form an entity. Confirm what licences, permits or registrations a Fleet Owner needs in Tennessee and Metro Nashville (brief §E, question 16).

### 1. Purpose and relationship

1.1 **The program.** The Harvey Taxi Fleet Program lets a Fleet Owner make vehicles they own or lawfully control available to Harvey Taxi drivers who have accepted the Fleet Owner's invitation ("Fleet Drivers"). Fleet Drivers then use those vehicles to provide transportation arranged through the Harvey Taxi platform.

1.2 **No other change.** Harvey Taxi operates a technology platform. This Agreement does not make Harvey Taxi the owner, lessor, operator or insurer of any Fleet Vehicle. It does not change the terms between Harvey Taxi and any driver, rider or other user.

1.3 **Relationship of the parties.** [Counsel to draft. The Fleet Owner is an independent business and not an employee, agent, partner or joint venturer of Harvey Taxi. Nothing in this Agreement creates employment between Harvey Taxi and the Fleet Owner or any Fleet Driver.]

> **Counsel note A1 (priority):** brief §E, question 15. Does a Fleet Owner who receives an agreed share of another driver's fare earnings create an employment relationship between the Fleet Owner and that driver? Does it affect Harvey Taxi's position on driver classification? Draft §§ 1.3, 5 and 6 to reduce that risk. One option to consider: the Fleet Owner and the Fleet Driver sign their own agreement, and Harvey Taxi is not a party to it.

1.4 **HTAF is separate.** The Harvey Transportation Assistance Foundation ("HTAF") is a separate nonprofit organization. It is not a party to this Agreement and has no rights or obligations under it.

### 2. Eligibility

2.1 **Fleet Owner eligibility.** **[Enforced by the platform]** To apply and stay eligible, the Fleet Owner must:
- (a) be a Harvey Taxi driver whose own verification is complete. This means passing the same checks required to go online: email, phone, identity verification and background screening, as configured by Harvey Taxi;
- (b) hold no more than one fleet;
- (c) be approved by Harvey Taxi staff. Approval is a human decision and is never made automatically.

2.2 **Pilot limits.** **[Enforced by the platform]** During the pilot:
- the program is limited to three (3) fleets;
- each fleet is limited to five (5) vehicles in service.

Harvey Taxi may change these limits by notice.

2.3 **Review and refusal.** Harvey Taxi may approve, decline, suspend or reinstate a fleet in its reasonable discretion, giving a reason when it declines or suspends. [Counsel: notice periods and any appeal process.]

### 3. Fleet Vehicles

3.1 **Human-driven vehicles only.** **[Enforced by the platform]** Every Fleet Vehicle must be operated by a licensed human Fleet Driver who has been verified by Harvey Taxi. Vehicles operated by an automated driving system without a human driver are not eligible under this Agreement. Harvey Taxi will not dispatch any autonomous ride until applicable law, insurance and a separate written agreement allow it.

3.2 **Vehicle information.** For each vehicle, the Fleet Owner gives accurate details:
- model year, make, model and colour;
- licence plate and plate state;
- the last six characters of the VIN.

The Fleet Owner keeps these details current. A plate may be registered to only one active fleet vehicle at a time. **[Enforced by the platform]**

3.3 **Documents.** **[Enforced by the platform]**
- (a) A Fleet Vehicle may carry riders only while it has both current **insurance** and current **registration**, each verified by Harvey Taxi staff from the document itself, and only while it is active.
- (b) Dates entered by the Fleet Owner are recorded as "entered by the owner, not verified" until staff check the document.
- (c) A vehicle whose insurance or registration has expired, or has not been staff-verified, cannot be used to go online.
- (d) The Fleet Owner must provide updated documents before expiry.

> **Counsel and insurer note A3:**
> - Phase 1 requires insurance and registration only (owner decision 2026-10-22). Add a vehicle inspection requirement only if counsel or the insurer requires it.
> - Confirm what insurance must cover a Fleet Vehicle in each period under Tenn. Code Ann. § 55-12-141, whose policy that is, and what proof Harvey Taxi should require (brief §5, questions 6–7).
> - Insert the required coverages, limits and additional-insured or notice provisions in § 7.

3.4 **Condition and compliance.** The Fleet Owner keeps each Fleet Vehicle:
- roadworthy, clean and safe;
- maintained to the manufacturer's schedule;
- free of open safety recalls;
- compliant with all laws that apply to vehicles used for this purpose.

[Counsel: age limits and vehicle standards, if any.]

3.5 **Suspension and retirement.** Harvey Taxi may suspend a Fleet Vehicle (with a reason) or retire it from the program. When that happens, any driver assigned to the vehicle is released from it and set offline. Suspension never takes effect in the middle of a trip. **[Enforced by the platform]**

### 4. Fleet Drivers

4.1 **Invitation and consent.** **[Enforced by the platform]**
- The Fleet Owner may invite a person to drive a Fleet Vehicle only through the platform, by phone number.
- The invited person must already have a Harvey Taxi driver account.
- The invited person must accept the invitation personally in their own driver account. Nobody can accept on their behalf.
- A driver may drive for only one fleet at a time.

4.2 **Screening is Harvey Taxi's.** **[Enforced by the platform]** Every Fleet Driver must pass the same Harvey Taxi verification as any other driver. The Fleet Owner cannot approve, verify or screen anyone, and does not receive screening results.

4.3 **Assignment.** **[Enforced by the platform]**
- The Fleet Owner may assign one active, ready Fleet Vehicle to one active Fleet Driver at a time, and only while that driver is offline and not on a trip.
- Riders see the assigned vehicle's details.
- The Fleet Owner or the Fleet Driver may end an assignment at any time except during a trip. When it ends, the driver is set offline and their own vehicle details are restored.

4.4 **Ending a membership.** **[Enforced by the platform]** Either the Fleet Owner or the Fleet Driver may end the membership through the platform. Ending it also ends any assignment, under the same rule about trips in progress.

4.5 **No direction of work.** [Counsel to draft.] The Fleet Owner does not control:
- when, where or whether a Fleet Driver goes online;
- which rides a Fleet Driver accepts;
- how a Fleet Driver performs a ride.

The Fleet Owner may only make the vehicle available or unavailable. (See Counsel note A1.)

### 5. Earnings and the Fleet Owner's share

5.1 **Agreed share.** **[Enforced by the platform]**
- For each Fleet Driver, the Fleet Owner and the Fleet Driver agree a percentage (the "Owner Share"). It must be from 0% to **50%**.
- The Owner Share is shown to the driver before they accept.
- It applies only to the driver's **fare earning** for trips completed in a Fleet Vehicle. **Tips are never shared; they belong entirely to the driver.**

5.2 **Recording only.** **[Enforced by the platform]**
- For each fleet trip, the platform records the fleet, the vehicle, the Owner Share percentage in effect at the time of the trip, and the resulting amount.
- **In this phase, Harvey Taxi does not collect, hold, transfer or pay any Owner Share and moves no money between the Fleet Owner and Fleet Drivers.** The record is for information only.
- [Counsel: how, and whether, the parties settle the Owner Share between themselves, and any disclaimer of Harvey Taxi's responsibility for that settlement.]

> **Counsel note A5:**
> - Harvey Taxi records but does not set the Owner Share; the 50% cap was the owner's decision of 2026-10-22. Confirm whether Harvey Taxi should cap, set, or only record the share (brief §E, question 19).
> - Any future automated payout needs separate design, owner approval, counsel review and payment-provider onboarding before it is built.

5.3 **No guarantee of earnings.** Harvey Taxi does not guarantee any volume of rides, earnings or vehicle use.

### 6. Information the Fleet Owner may see

6.1 **Limited view.** **[Enforced by the platform]** For each Fleet Driver who has accepted, the Fleet Owner may see only:
- the driver's first name;
- the Fleet Vehicle assigned to them;
- whether they are online or offline;
- their number of trips in the fleet's vehicles;
- their fare earnings and the recorded Owner Share for those trips.

6.2 **Not shared.** **[Enforced by the platform]** The Fleet Owner does **not** receive a Fleet Driver's:
- phone number or email;
- documents, identity verification or background-check information;
- location;
- rider information.

6.3 **Use of information.** The Fleet Owner may use this information only to manage the fleet relationship. The Fleet Owner must keep it confidential, must not sell or share it, and must not contact riders.

> **Counsel note A6:**
> - Confirm the consent wording in Part B (brief §E, question 18).
> - Confirm that live vehicle location stays excluded unless and until counsel advises otherwise.
> - A fleet section must be added to the public privacy policy before switch-on.

### 7. Insurance

[Counsel and insurer to draft. Required coverages for each Fleet Vehicle and for the Fleet Owner, minimum limits for each period (logged on, en route, on trip), proof of coverage, notice of cancellation or change, and additional-insured status if required.]

> **Note:** Harvey Taxi's platform blocks any Fleet Vehicle whose staff-verified insurance date has passed (§ 3.3). Expiry dates are not a substitute for confirming that the coverage itself is adequate.

### 8. Safety, incidents and cooperation

8.1 The Fleet Owner must report any crash, injury, damage, safety concern or recall affecting a Fleet Vehicle to Harvey Taxi without delay. [Counsel: timeframe and channel.]

8.2 The Fleet Owner must cooperate with Harvey Taxi, insurers and authorities in any investigation.

8.3 Harvey Taxi may suspend a fleet, a vehicle or a membership while it reviews a safety concern. A person reviews and decides every suspension; the platform does not suspend anyone automatically.

### 9. Fleet Owner commitments

The Fleet Owner confirms and agrees that:
- (a) the information they give is accurate and kept current;
- (b) they own, or have the legal right to make available, each Fleet Vehicle;
- (c) they will comply with all applicable laws, including licensing, vehicle, tax and anti-discrimination laws;
- (d) they will not charge Fleet Drivers any fee or deposit through or in connection with the platform without Harvey Taxi's written approval [Counsel: confirm];
- (e) they will not make statements to riders, drivers or the public about Harvey Taxi services, coverage areas, airports or autonomous vehicles that Harvey Taxi has not approved.

### 10. Term and termination

10.1 This Agreement starts when Harvey Taxi approves the fleet. It continues until ended under this section.

10.2 Either party may end this Agreement [on __ days' notice / at any time] through the platform or in writing. Harvey Taxi may suspend or end it immediately for a safety concern, a material breach, or loss of the Fleet Owner's own driver eligibility.

10.3 When the Agreement ends:
- all memberships and assignments end, without interrupting a trip in progress;
- Fleet Drivers return to their own vehicles;
- records are kept as required by law and by Harvey Taxi's records policy.

### 11. Liability, indemnity and disputes

[Counsel to draft: limitation of liability, indemnities (including for vehicle condition, insurance lapses and the Fleet Owner's dealings with Fleet Drivers), governing law (Tennessee is assumed), venue, and dispute resolution.]

> **Note:** The current public Terms of Service don't state governing law or a dispute process. Counsel may want those terms aligned first.

### 12. Changes to this Agreement

Harvey Taxi may update this Agreement by notice. [Counsel: notice period and acceptance mechanism.] Each Fleet Driver accepts a specific version; the platform records the version each driver accepted (`agreement_version`). **[Enforced by the platform]**

### 13. General

[Counsel to draft: entire agreement, assignment, notices, severability, no waiver, electronic signature and records.]

---

## Part B. Fleet Driver Acknowledgment

*Shown to an invited driver in their Harvey Taxi driver dashboard before they accept. The current app shows a short version of the points below. The final text must match what counsel approves.*

By accepting this invitation from **[Fleet name]**, I understand and agree that:

1. **I accept voluntarily.** I can decline this invitation, and I can leave the fleet later from my dashboard. Leaving does not affect my Harvey Taxi driver account.
2. **The Owner Share.**
   - The fleet owner and I have agreed that the owner's share is **[__]% of my fare earnings** for trips I complete in the fleet's vehicles.
   - **My tips are always 100% mine.**
   - Harvey Taxi records this share for information only. It does not collect, hold or pay it.
3. **What the fleet owner can see.** My first name, the vehicle I'm assigned, whether I'm online, my number of trips in the fleet's vehicles, and my fare earnings and the owner's recorded share for those trips.
4. **What the fleet owner cannot see.** My phone number, email, documents, identity or background-check information, my location, or any rider's information.
5. **Screening.** Harvey Taxi, not the fleet owner, verifies me as a driver. I must keep my own driver verification current.
6. **Vehicle readiness.**
   - I may drive a fleet vehicle only while it is assigned to me and Harvey Taxi shows it as ready: active, with current, staff-verified insurance and registration.
   - If the vehicle stops being ready, I won't be able to go online in it.
   - If the vehicle is released, I'll be set offline and my own vehicle details will be restored.
7. **No change to riders' safety rules.** All Harvey Taxi driver rules, safety requirements and rider protections still apply.
8. **Version.** I am accepting terms version **[version]**. Harvey Taxi records the version I accept.

[Counsel: any additional disclosures, for example that the Fleet Owner is not Harvey Taxi, how disputes with the Fleet Owner are handled, and tax reporting responsibilities.]

---

## Part C. Checklist before switch-on (internal)

1. Counsel finalizes Parts A and B and answers brief §E, questions 15–19.
2. The insurer answers brief §5, questions 6–7. § 7 is completed.
3. The final version string replaces `fleet-draft-2026-10-22` in `lib/fleets.js` (`AGREEMENT_VERSION`), and the driver dashboard shows the approved Part B text.
4. A fleet section is added to `/privacy.html` and `/privacy-policy.html`.
5. If counsel changes any **[Enforced by the platform]** term, the software is updated and re-tested first.
6. The owner approves turning on `fleet_management_enabled`.
