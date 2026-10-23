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

---

## 12. Partner model: delegated guardrails (added 2026-10-23)

**[Owner decision 2026-10-23]** "Approved, update the design doc with the partner model." This section adds the model; nothing is built, signed up for or switched on. The earlier sections (rider-linked authorizations, Harvey Taxi as provider) stay as one option; this section is the other.

### 12.1 The idea in one paragraph

The Executive Director stops dispatching rides and sets policy instead. Each partner establishment (for example a shelter, clinic or workforce centre) gets limits set by HTAF; trusted partner staff book rides for their clients within those limits; HTAF hears only about exceptions. Rides are provided by unaffiliated companies (Uber Health, Lyft), with Harvey Taxi only as an optional provider if counsel and the board clear it. Using unaffiliated providers removes most of the related-party risk in §F questions 20 and 26 **[Recommendation; counsel to confirm]**.

### 12.2 Roles

| Role | Decides | Cannot |
|---|---|---|
| Executive Director (with the board) | Which partners, their limits, overrides on exceptions | Book routine rides (not needed) |
| HTAF board (interested director recused) | Partner agreements, the overall budget, the provider choice | — |
| Partner coordinator (named, trained staff) | Which of their clients needs a ride, within HTAF's limits | Exceed limits; ride for themselves; change limits |
| The system | Enforces limits; sends alerts | Decide eligibility, approve over-limit rides, or start a charge without a person's request (`docs/agent-action-rules.md`) |

Each partner signs a written agreement with HTAF before any access: who may book, eligibility the partner applies, data handling, misuse and repayment, termination. **[Unresolved: counsel drafts; board approves.]**

### 12.3 Guardrails HTAF sets per partner

| Guardrail | Example | Enforced how |
|---|---|---|
| Location lock | Every ride starts or ends at the partner's address | Phase 1: provider dashboard rules where offered (Lyft Pass allows pickup/drop-off restrictions); Phase 2: our server |
| Budget cap | $1,500 or 75 rides per month, whichever first | Provider program budget (Phase 1); our server (Phase 2) |
| Service window | Monday–Friday, 6 AM–8 PM | Provider rules / our server |
| Ride type | Standard tier only | Provider rules / our server |
| Distance or cost ceiling | Over 25 miles or over $50 needs the Executive Director's approval | Phase 2 only: held for a one-tap approve/deny |
| Per-client limit | e.g. 8 rides per client per month | Phase 2 |

Example figures are placeholders; the board sets the real ones.

### 12.4 Providers: what is verified (searched 2026-10-23, official sites)

- **Uber Health:**
  - Coordinators book rides for patients from a dashboard or API, and riders need no smartphone.
  - **Flexible rides exist.** The rider gets an SMS link and requests the ride when ready. In the API this is `deferred_ride_options.pickup_day` on Create Health Trip, and it needs a mobile number.
  - Uber states it will sign a business associate agreement (BAA).
  - Pricing is described as usage-based with no sign-up fee. Prices can rise during high demand.
  - Sources: [Create Health Trip](https://developer.uber.com/docs/health/references/api/v1/health-trips-post), [Arranging Uber Health rides](https://help.uber.com/en/business/article/arranging-uber-health-rides?nodeId=16571e08-7395-4e1c-afe5-61168031f154), [Uber Health FAQ](https://www.uberhealth.com/us/en/faq/), [Uber Health Business Associate Addendum](https://www.uber.com/us/en/legal/uber-health-business-associate-addendum/).
- **Lyft:**
  - **Lyft Concierge** lets organizations book rides for patients by dashboard or API. Lyft describes flexible, pre-authorized on-demand rides up to 30 days ahead, and says it signs BAAs with healthcare partners. These are vendor statements, and some pages are several years old.
  - **Lyft Pass** lets an organization set a total budget, rides per rider, a maximum dollar amount per ride, and pickup/drop-off, ride-type and time restrictions. **If a fare exceeds the pass, the rider's own payment method is charged the full amount.** That must be explained to clients, or avoided with Concierge.
  - Sources: [Lyft Healthcare](https://www.lyft.com/healthcare), [SafeRide Health customer story](https://www.lyft.com/business/customer-stories/saferide-health), [About Lyft Pass](https://help.lyft.com/business/hc/en-us/articles/25023162405267-About-Lyft-Pass), [Lyft Pass](https://www.lyft.com/business/products/lyftpass).
- **Blocker on "cheapest of Uber or Lyft" routing:** Uber's API Terms of Use prohibit including Uber in an aggregated view with competitors and aggregating Uber data with competitors' data. Uber's price-estimate documentation says offering price comparisons with competing services through the API violates the terms. Automatically comparing live Uber and Lyft prices per ride is therefore **not planned** unless Uber gives written permission. Sources: [Uber API Terms of Use](https://developer.uber.com/docs/riders/terms-of-use), [GET /estimates/price](https://developer.uber.com/docs/v1-estimates-price).

  **[Recommendation]** Assign each partner one provider by rule instead, for example by the partner's needs or a periodic cost review done by a person. **[Unresolved]** The Health API may have its own terms; counsel or Uber to confirm.
- **Not verified:** current per-ride rates; no-show and cancellation fees charged to the organization; production API access requirements; nonprofit terms. These come from each provider's sales team before any commitment.

### 12.5 Return trips

Use each provider's flexible ride (above) for appointments with unknown end times: the partner books the day, the client taps the SMS link when ready. Clients without a mobile phone cannot use it (Uber requires a mobile number); for them the partner books the return when called. Whether this avoids no-show fees depends on each provider's terms **[Unresolved]**.

### 12.6 Exception alerts to the Executive Director

- A partner reaches 80% of its monthly budget or ride count.
- A ride is over the distance or cost ceiling. It waits for a one-tap approve or deny, and is never approved automatically.
- A driver cancels or a client is marked no-show. These are reported to HTAF; no action against the client is automatic.
- A partner books outside its window or location rules (Phase 2), or a provider rejects a booking.

Channels: SMS and email (Slack optional). Alerts carry the partner, ride reference and amount, not the client's medical details.

### 12.7 Data and privacy

- A partner enters the client's name, phone number and the two addresses. These go to HTAF (Phase 2) and to the provider.
- Medical details never go to HTAF or the provider; a clinic address is an address.
- Clinic partners are HIPAA covered entities, so before any clinic partner starts, counsel must settle which BAAs are needed (partner ↔ HTAF, HTAF ↔ provider) (§F question 25).
- Clients are told who will see their details. The consent wording is written by counsel.

### 12.8 Phased rollout

| Phase | What | Code | Money | Needs |
|---|---|---|---|---|
| A | Counsel and board: partner agreement, budget, provider choice, BAAs | None | None | Owner sends brief §F and this section |
| B | Pilot 3–5 partners on the providers' own dashboards (Uber Health organization or Lyft Pass/Concierge), billed to an HTAF account with caps | None | Yes, HTAF pays the provider | Board approval; HTAF signs up (owner action, paid) |
| C | Review the pilot: volume, cost per ride, no-shows, misuse, staff time | Report only | No | 2–3 months of pilot data |
| D | HTAF partner portal and guardrail server (built switched off, like §8), connected to a provider's API after production access is granted | Yes | Only through the provider, within caps | Owner approval per step; provider API approval |

**[Recommendation]** Phase B first. It tests demand without code. Phase D is worth building only if the pilot shows the volume.

### 12.9 Added decisions

**Owner**
1. ~~Harvey Taxi's role in HTAF rides.~~ **Decided 2026-10-23** (see 12.10).
2. Which provider to approach first for the pilot.

**Board**
1. Approve the partner model, the pilot budget and the first partners.
2. Adopt the partner agreement.

**Counsel**
1. Draft the partner agreement.
2. Settle the BAAs and the HIPAA position for clinic partners.
3. Confirm the client consent wording.
4. Confirm whether Uber's API terms permit any per-ride provider selection.

**Insurer**
1. Confirm that HTAF has no exposure for rides provided and insured by Uber or Lyft.

### 12.10 Owner decision: provider policy (2026-10-23)

**[Owner decision 2026-10-23]** "Harvey Taxi should always remain optional for HTAF. HTAF is a nonprofit organization that wants collaboration with every rideshare company agreed to HTAF partnership."

What this means for the design:
- **Open to many providers.** HTAF may work with any rideshare or transportation company that agrees to HTAF's partnership terms, for example Uber Health, Lyft, or a local licensed company. No provider is exclusive.
- **Harvey Taxi is always optional.** HTAF is never required to use Harvey Taxi, and no partner, rider or program is steered to it.
  - If Harvey Taxi is ever used, it follows the related-party controls in §5 and brief §F: board approval with the interested director recused, market-rate evidence, and per-trip records.
  - It joins on the same terms as any other provider.
- **One set of partnership terms for every provider [Recommendation; counsel drafts].** The terms would cover:
  - licensing and insurance;
  - data handling (including BAAs where HIPAA applies);
  - pricing disclosure;
  - no-show and cancellation terms;
  - safety and incident reporting;
  - termination.
- **Choosing a provider for a ride stays with a person or a fixed rule** (for example one provider per partner, reviewed periodically). It is never an automatic live price comparison between Uber and other companies, because Uber's API terms prohibit that (12.4).
- **The fair-treatment rule is written down so it can be shown to the IRS and grantors.** Providers are chosen on cost, availability, accessibility and service to clients, recorded per partner.


### 12.11 Partner access built, switched off (2026-10-23)

**[Owner decision 2026-10-23]** Partner organizations' limited access is optional and in the owner's hands: a master switch plus a switch per partner, both off by default. A partner coordinator can view their own clients' applications and submit new ones. Ride booking by partners (§12.3 guardrails, phase D) is **not** part of it. Implementation and approvals: `docs/project-status.md` §90.
