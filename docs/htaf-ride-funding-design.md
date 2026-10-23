# HTAF as a ride funding option in Harvey Taxi: design

**Date: 2026-10-23 (UTC). Status: design only. Nothing is built, nothing is switched on, and no money moves.**

Labels: **[Verified]** (with how) · **[Owner decision]** (date, scope) · **[Recommendation]** · **[Unresolved]**.

- **[Owner decision 2026-10-22]** Nothing that moves money between HTAF and Harvey Taxi Service LLC is built until counsel and the HTAF board answer the questions in `docs/legal/autonomous-vehicles-brief.md` §F (questions 20–26).
- **[Owner decision 2026-10-23]** The websites are separated (status §79). Inside the Harvey Taxi app, HTAF stays as a program or funding option, similar in concept to organization-paid ride programs such as Lyft Pass. This document is that design ("Approved, start the HTAF funding option design doc").

This document is written for the owner, counsel, the HTAF board and the insurer. Every build step in section 10 needs its own approval.

---

## 1. What it is

An HTAF participant who has been approved for transportation help can book a Harvey Taxi ride in the app and choose **"HTAF ride assistance"** instead of a card. HTAF pays for the ride, within limits that HTAF set. Harvey Taxi bills HTAF afterwards, on an invoice that HTAF reviews and approves.

What it is not:
- It is not a way for Harvey Taxi to decide who receives help. **HTAF decides eligibility, through its own caseworkers, outside the Harvey Taxi app** (`docs/agent-action-rules.md`: agents never decide about people).
- It is not an automatic charge to HTAF. No code charges, debits or transfers HTAF funds.
- It is not a route for medical information. Harvey Taxi receives what it needs to run a ride, nothing more (section 7).

## 2. Principles

1. **Separate decisions.**
   - HTAF approves people and sets limits.
   - Harvey Taxi provides rides on the terms of a written agreement.
   - The app only enforces what HTAF approved.
2. **Arm's length.**
   - The same person controls both organizations.
   - The rate card, the agreement and every change to them are approved by the HTAF board with the interested director recused, under a written conflict-of-interest policy (§F questions 20–22).
3. **People decide, the system checks.**
   - No automated eligibility decision.
   - No automatic suspension of a participant or a driver.
   - Staff, not code, resolve disputes.
4. **Minimum data.**
   - HTAF learns only about trips it funds.
   - Harvey Taxi learns only what a ride needs.
5. **Off until approved.**
   - Every part ships switched off.
   - It is gated on a recorded approval, the same pattern as `lib/htafActivation.js` (a feature flag alone is ignored without the approval references).

## 3. The rider's experience (proposed)

1. **Approval (on HTAF's side).**
   - The person applies on harveytransportationfoundation.com, using the existing form `htaf-application.html` and `POST /api/foundation/apply`.
   - An HTAF caseworker reviews it in `admin-htaf.html` and decides.
2. **Ride authorization.** If approved, the caseworker issues an authorization with these fields:

   | Field | Example |
   |---|---|
   | Program | Medical Transportation (one of the six approved programs) |
   | Limit | 8 one-way trips, or $240, whichever is reached first |
   | Valid dates | 2026-11-01 to 2026-12-31 |
   | Allowed trips | Home address ↔ one named destination (e.g. a clinic address), or any destination within the service area |
   | Rider share | $0 (default), or a fixed co-pay |

3. **Linking (rider consent).**
   - HTAF gives the participant a one-time link code.
   - The participant enters it in the Harvey Taxi app (Settings → Ride assistance) and confirms a consent screen. The screen explains what HTAF will see (date, time, pickup and drop-off area, fare and status of funded trips) and what Harvey Taxi will see (the authorization's limits and dates, not the application).
   - Without this step, nothing is shared in either direction.
4. **Booking.**
   - At checkout the rider sees "HTAF ride assistance: 6 of 8 trips left, valid to 31 Dec".
   - The server checks the authorization when quoting and again when booking.
   - A trip that falls outside it (wrong destination, expired, limit reached) is **not offered as an HTAF trip**. The rider can still pay by card as usual.
   - There is no card hold for the HTAF-funded part.
5. **After the trip.**
   - The trip shows "Paid by HTAF ride assistance" in the rider's history.
   - The driver's earnings are calculated and paid exactly as for any other trip (section 5).

**[Recommendation]** For the first version, have no co-pays and no partial coverage: a trip is either fully within the authorization or not offered as an HTAF trip. That keeps billing simple and avoids charging participants.

## 4. Rules that need decisions

| Rule | Proposal | Status |
|---|---|---|
| Fare over the per-trip cap | Not offered as HTAF trip; rider may pay by card | **[Recommendation]** |
| Cancellation fee or no-show fee on an HTAF trip | HTAF is not billed. Harvey Taxi absorbs it, and staff may pause the authorization after review | **[Unresolved]**: owner and board |
| Tips | Never funded by HTAF; the rider may tip by card | **[Recommendation]** |
| Ride types | Standard rides only at first; no delivery orders | **[Recommendation]** |
| Shared or scheduled rides | Scheduled rides allowed (clinic appointments); the authorization is checked again at dispatch | **[Recommendation]** |
| Who may cancel an authorization | HTAF caseworkers only; Harvey Taxi staff can only *flag* a problem to HTAF | **[Recommendation]** |
| Market | Tennessee only. Zimbabwe, Nigeria and Ghana markets excluded | **[Recommendation]** |

## 5. Billing and money

**Nothing in this section is built or switched on until counsel and the board answer §F.**

1. **Rate card.**
   - It holds a per-trip price or a formula (for example the standard Harvey Taxi fare, or a discount).
   - It is approved by the HTAF board, with comparables from at least two unaffiliated providers (§F question 22).
   - It is stored with its board reference and effective dates. The app prices HTAF trips only from an approved, current rate card.
2. **Monthly invoice.**
   - At month end the system *drafts* an invoice from Harvey Taxi Service LLC to HTAF.
   - It has one line per completed funded trip: trip reference, date, program, authorization reference, fare from the rate card. It carries no names on the face of the invoice; the reference links to HTAF's own record.
3. **Review on both sides.**
   - Harvey Taxi finance reviews and issues the draft.
   - HTAF reviews it in its own admin view, can dispute single lines, and pays through its own banking process.
   - **The app never charges HTAF and never moves HTAF money** (`docs/agent-action-rules.md`: agents never move money).
4. **Drivers.**
   - The driver is paid by Harvey Taxi for the trip as normal, whether or not HTAF has paid yet.
   - Harvey Taxi carries the receivable and any non-payment risk. **[Recommendation; counsel to confirm]**
5. **Grant tracking.**
   - Each authorization can carry the HTAF fund or grant it is charged to, so HTAF can report spending per grant (§F question 23).
   - Form 990 Schedule L reporting is HTAF's, from these totals (§F question 24).

**Alternatives counsel may prefer (§F question 26):**
- **(a) Reimbursement.** The participant pays by card and HTAF reimburses them. This is simpler for the LLC but puts a cost up front on people who need help.
- **(b) Several providers.** HTAF buys rides from several unaffiliated providers as well as Harvey Taxi. This reduces related-party concentration.
- **(c) Prepaid vouchers.** HTAF buys a fixed block at an approved price. This is simpler to approve, but unused balances need terms.

The design above (invoice after the trip) fits (b) and (c) with small changes. **[Unresolved]**: counsel's choice.

## 6. Records (proposed data model, not created)

All tables would be server-only (RLS on, no client access), following the existing pattern.

| Table | Holds | Owner of the data |
|---|---|---|
| `htaf_ride_authorizations` | HTAF application id, program, limits, valid dates, allowed destination, fund or grant reference, status (active, paused, ended), issued by (HTAF caseworker), link code hash | HTAF |
| `htaf_authorization_links` | authorization id ↔ Harvey Taxi rider id, consent text version, consent time, unlinked time | Shared record of consent |
| `htaf_funded_trips` | ride id, authorization id, rate card id, fare, status (pending, completed, cancelled, disputed) | Shared record per trip |
| `htaf_rate_cards` | price rules, effective dates, board approval reference | HTAF (approval) and LLC (pricing) |
| `htaf_invoices`, `htaf_invoice_lines` | monthly draft and issued invoices, line disputes and resolutions | Both |

Every change is written to the audit log with who did it and which approval reference applies.

**Retention [Unresolved]:** grantors and the IRS may require keeping trip and invoice records for several years. Counsel to set the period. The 90-day IP retention job (`lib/auditRetention.js`) already applies to audit-log IP and browser fields only.

## 7. Privacy and data separation

- **What HTAF does not send to Harvey Taxi:**
  - the application;
  - income;
  - need description;
  - documents;
  - any medical detail.

  An allowed destination is an address. It is not a diagnosis, and it is not labelled with a clinic's specialty.
- **What Harvey Taxi sends to HTAF** (only for linked authorizations): trip date and time, pickup and drop-off area or address, fare, status, and cancellations. It does not send GPS traces or driver identity beyond a first name.
- **Access.**
  - The existing HTAF capabilities (`requireHtafCapability`, `htaf_caseworker` role) gate HTAF's side.
  - Harvey Taxi support and dispatch roles see only "HTAF ride assistance" on a ride, not the program or the authorization.
- **HIPAA.** **[Unresolved]** This is §F question 25. If any participant is referred by a covered entity (for example a clinic), counsel must say whether a business associate agreement (BAA) is needed and with whom. Until then, no clinic referral flow is built.
- **Privacy policies.**
  - Both privacy policies need a section on ride assistance, written by counsel.
  - The HTAF policy's provider-sharing disclosure is still pending counsel review (`docs/htaf-activation-checklist.md`).

## 8. Switches and approval record

Everything is off by default. The proposed environment record follows `lib/htafActivation.js`:

| Variable | Meaning |
|---|---|
| `HTAF_FUNDING_ENABLED` | Rider-facing option; ignored unless all references below are set |
| `HTAF_PROVIDER_AGREEMENT_REF` | Already exists: the executed HTAF–LLC services and data agreement (#137) |
| `HTAF_CONFLICT_REVIEW_REF` | Already exists: board conflict review |
| `HTAF_RATE_CARD_APPROVAL_REF` | New: board minutes approving the rate card |
| `HTAF_FUNDING_APPROVED_BY`, `HTAF_FUNDING_APPROVED_AT` | New: who approved activation, and when |
| `HTAF_INVOICING_ENABLED` | Separate, later switch for drafting invoices. Never sends or charges by itself |

These values are references (document ids, minute numbers, dates), not secrets.

**[Verified 2026-10-23, local tests]** Built switched off (owner decision 2026-10-23: "Switches only, off"). See `resolveHtafFunding()` in `lib/htafActivation.js` and `docs/htaf-activation-checklist.md` §2a. No feature sits behind them yet, so a complete record still leaves both off.

## 9. Risks and how the design handles them

| Risk | Handling |
|---|---|
| Private benefit or excess benefit to the LLC (§F question 20) | Board-approved rate card with comparables; interested director recused; per-trip records; option (b) or (c) if counsel prefers |
| HTAF data reaching Harvey Taxi staff | Minimum fields; role gating; audit log; consent at linking |
| Fraud: shared link codes, or trips outside purpose | Code works once and is tied to one rider account; destination rules; HTAF sees every trip; staff flag patterns to HTAF, without automatic action against a person |
| Billing errors | Draft invoice, review on both sides, line-level disputes |
| Confusion between the two organizations | The rider sees "HTAF ride assistance, provided by Harvey Transportation Assistance Foundation, a separate nonprofit". The neutral website wording stays (status §79) |
| HTAF does not pay | LLC bears it; drivers still paid; authorizations can be paused by HTAF staff. Any pause by Harvey Taxi needs a decision by a person |

## 10. Build plan (each phase needs its own owner approval)

| Phase | Scope | Moves money? | Depends on |
|---|---|---|---|
| 0 | This design document | No | — |
| 1 | Counsel and board answers to §F; executed agreement; rate card approved | No | Owner sends brief §F |
| 2 | Authorization records in HTAF admin; rider linking with consent; checkout option in test mode only; migration (separate approval) | No (test rides only) | Phase 1 |
| 3 | Live HTAF-funded rides for a small pilot group (for example 5 participants) | No money is collected; trips are recorded as receivable | Phase 2; insurer confirmation |
| 4 | Draft monthly invoices; HTAF review screen | No: invoices are drafted, and payment is by HTAF's own process | Phase 3; counsel on records |

**Costs [Recommendation]:** none expected from hosting or Stripe for phases 2–4, since no card charge is involved. Counsel and board time are the main costs. No paid upgrade is needed.

## 11. Decisions needed

**Owner**
1. Send brief §F (questions 20–26) to counsel, with this document.
2. Choose the cancellation and no-show rule for HTAF trips (section 4).
3. Confirm "no co-pay" for the first version.

**HTAF board** (interested director recused)
1. Approve or reject the model in principle: direct billing, reimbursement, several providers, or vouchers.
2. Adopt or confirm the conflict-of-interest policy, and appoint the members who approve the rate card.

**Counsel**
1. Answer §F questions 20–26.
2. Write the privacy-policy sections and the consent wording at linking.
3. Set the retention period for trip and invoice records.

**Insurer**
1. Confirm that coverage is unchanged for trips paid by a third party.

**Next authorized action:** merge this document (docs only) when the owner approves. No build starts before phase 1 is complete.
