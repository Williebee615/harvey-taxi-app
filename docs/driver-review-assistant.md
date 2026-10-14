# Harvey Taxi driver review assistant

Prepared 2026-10-14 at the owner's request. **Off in production.** Turning it on needs the owner's approval. It is separate from HTAF's review assistant: its own code, permission, flag and records, and no access to HTAF applications.

## What it does
For one driver application, Harvey Taxi onboarding staff get:
- a summary line;
- a status table:
  - email and phone verification;
  - identity (Persona) and background check (Checkr);
  - license, vehicle and insurance;
  - expiration dates;
- items to check, each with **Wrong** / **Not needed** buttons. Feedback is recorded with fixed choices only.

It runs on fixed rules on Harvey Taxi's server: **no AI model, no external provider, no telemetry**. Nothing about the driver leaves the server.

## Status rules (owner's states)
| Item | Shown as |
|---|---|
| Persona, Checkr | **not configured** (integration key missing or switched off) · **not started** · **pending** · **verified** · **result needs staff review** (declined / consider / suspended) · **recorded by staff (not confirmed by the integration)** |
| "verified" for Persona | Only when Persona's inquiry ID is on file **and** the integration recorded an approved result |
| "verified" for Checkr | Only when Checkr's candidate ID is on file, the integration recorded a clear result, **and** no staff compliance override is on record |
| License | "entered, not verified" unless staff marked it verified. A number being entered is not verification. |
| Insurance | "confirmed by driver only" unless staff marked it verified. The driver's checkbox is not verification. |
| Expiration dates | **Not recorded today.** Harvey Taxi stores no license, insurance or registration expiration dates, so the assistant says "not recorded" and asks staff to check the documents. When dates exist, expired and within-30-days dates are flagged. |
| Possible duplicates | Another account with the same email, phone (any format), license number or plate. Shown by account ID, status, date and which identifier matched, as "a prompt to compare the accounts, not evidence of fraud". |

## Fields read
- **From `drivers`:**
  - **verification flags and dates:** email, phone and SMS verified;
  - **Persona and Checkr records:** status fields, inquiry ID, candidate ID;
  - **license:** number (presence only) and status;
  - **vehicle:** make, model, year and plate (presence only);
  - **insurance:** confirmed flag and status;
  - **consents:** terms, background-check consent, driver policy;
  - email, phone, license number and plate, used only to find possible duplicates and never shown;
  - account ID, created date and approval status.
- **From `audit_logs`:** whether a staff compliance override is on record.
- **Never read:** names, addresses, location, password or verification codes and hashes, payment or Stripe IDs, ratings, ride history. Also never read: HTAF applications.

## Access
**[Owner decision 2026-10-14]** Compliance access requires an explicit onboarding-review permission, separate from driver approval authority.

- **Permission:** `drivers.onboarding_review`, always enforced; the `HTAF_RBAC_ENFORCED=false` rollback does not relax it.
- **No role holds it, except the owner** (super_admin and the admin token). Having `drivers.approve` (dispatcher) or the compliance role is **not** enough.
- **Staff need an explicit per-person grant** in `public.admin_capability_grants`, which records who granted it, when and why, and is revoked by setting `revoked_at`. A grant counts only for a **dispatcher** or **compliance** admin. A grant held by an HTAF caseworker, support, finance, board or volunteer account is ignored.
- **Refused:**
  - every other admin;
  - a dispatcher or compliance admin with no active grant;
  - anyone if the grant lookup fails (fails closed). The owner keeps access.

  Refusals happen before any record is read, and the denial is logged with its reason (`no_grant`, `role_not_eligible`, `grant_lookup_failed`).
- **Grant table:** migration `20261014050000_admin_capability_grants.sql`, **not applied** (needs owner approval). Until it is applied, only the owner can use the assistant.

## Human decision
- **No decisions:** the assistant never approves, rejects, activates or suspends a driver, and never changes any field. The routes write nothing to `drivers`.
- **Labelled:** "Automated suggestions from Harvey Taxi's own onboarding rules (no AI model). Not a decision: staff approve, reject, activate or suspend every driver. Check each item before acting."

## Records
- **Not stored:** suggestions. They are recalculated on request.
- **Audit entries:** `driver_review_assist_run`, `driver_review_assist_feedback`, `driver_review_assist_blocked`, `driver_review_access_denied`. They hold the staff email, driver account ID, rule version and check names. They hold no driver name, contact details or document numbers.
- **Proposed retention:** 12 months, owner decision. The same SQL pattern as HTAF's assistant applies.

## Document expiration dates (separate PR)
**[Owner decision 2026-10-14]** Expiration fields belong in a separate PR, and must preserve where each date came from and whether it was verified.
- This PR only **reads** `license_expires_on`, `insurance_expires_on` and `registration_expires_on` if they exist.
- Until then it reports "not recorded".
- The columns, with source and verification status, come in their own PR.

## Corrections
Staff can mark a suggestion helpful, wrong or not needed, with an optional **fixed reason code**:
- `information_is_present`
- `verified_elsewhere`
- `expiration_is_correct`
- `not_a_duplicate`
- `already_resolved`
- `not_relevant`

Free text is rejected (400), and a correction for an unknown driver returns 404.

## Logs
Logs containing URLs and error messages are not automatically free of personal information.
- **[Verified 2026-10-14, code review]** These routes carry only the driver account ID in the URL, with no query string. Request bodies and review results are not logged.
- **[Unresolved]** The shared error handler logs an unexpected error's message, and Render's own request logs have not been reviewed. That review is tracked separately.

## Turning it on and off
- **On (owner approval):** set the system flag `driver_review_assist_enabled` to `true`.
- **Off:** set it to `false`.

## Open decisions (owner)
1. Merge and activation.
2. Apply the grant-table migration, and name which dispatcher or compliance staff receive `drivers.onboarding_review`.
3. Expiration-date columns, with source and verification status: separate PR.
4. 12-month retention for the audit entries.

## Next: support-case triage (proposal only)
- **Scope:** the same model. Internal rules, suggestions only, staff handle every case, its own permission (support role and the owner), off until approved.
- **Suggestions:**
  - case type (billing, lost item, account, ride problem, safety);
  - missing details (ride ID, date, payment reference);
  - suggested follow-up questions;
  - same-ride or same-account case grouping.
- **Safety reports always reach staff.** Safety and emergency wording is routed by the existing support and safety paths **before and independently of** the assistant. If the assistant is off, down or fails, safety reports still go straight to staff.
  - Tests would prove this by running the assistant failed or disabled and checking that the safety notification still fires.
  - The assistant may add a "safety" label but can never hide, close, delay or down-rank a report.
