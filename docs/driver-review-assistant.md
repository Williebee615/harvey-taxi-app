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
- **Who:** a new permission, `drivers.review_assist`, is always enforced. It is held by **dispatcher** (Harvey Taxi's onboarding role: it also approves and rejects drivers) and the **owner** (super_admin, admin token).
- **Refused:** HTAF caseworkers, support, finance, compliance, board, volunteers and admins with no role. They are refused before any record is read, and the denial is logged.

## Human decision
- **No decisions:** the assistant never approves, rejects, activates or suspends a driver, and never changes any field. The routes write nothing to `drivers`.
- **Labelled:** "Automated suggestions from Harvey Taxi's own onboarding rules (no AI model). Not a decision: staff approve, reject, activate or suspend every driver. Check each item before acting."

## Records
- **Not stored:** suggestions. They are recalculated on request.
- **Audit entries:** `driver_review_assist_run`, `driver_review_assist_feedback`, `driver_review_assist_blocked`, `driver_review_access_denied`. They hold the staff email, driver account ID, rule version and check names. They hold no driver name, contact details or document numbers.
- **Proposed retention:** 12 months, owner decision. The same SQL pattern as HTAF's assistant applies.

## Proposed migration (not applied)
`supabase/migrations/20261014010000_driver_document_expirations.sql` adds nullable `license_expires_on`, `insurance_expires_on` and `registration_expires_on` dates.
- Staff would enter these after checking the documents; nothing fills them automatically.
- The assistant works without them, reporting "not recorded", and uses them once they exist.
- Applying the migration needs owner approval. A staff field to enter the dates is a separate small change.

## Turning it on and off
- **On (owner approval):** set the system flag `driver_review_assist_enabled` to `true`.
- **Off:** set it to `false`.

## Open decisions (owner)
1. Merge and activation.
2. Should **compliance** staff also have access? Only dispatcher and the owner have it now.
3. Apply the expiration-date migration, and add a staff field to record the dates.
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
