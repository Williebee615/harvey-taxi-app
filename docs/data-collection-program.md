# Data Collection program (optional, approved drivers only)

**Status: built for review. Not deployed, migration not applied, every switch off.**
Enrollment and collection must stay disabled until the blockers in
[Before enrollment opens](#before-enrollment-opens) are resolved.

Harvey Taxi Service LLC manages the program. Drivers who are separately
approved for it perform eligible **non-driving** tasks at an approved
commercial location and record them in the **Minute** app. Harvey Taxi
tracks applications, agreements, equipment, accepted recording hours and
program earnings. Recording and uploading stay entirely in Minute.

## What it does

**Driver dashboard** (`public/driver-dashboard.html`, section hidden unless the program switch is on)

- Application form: phone model, country (U.S. only), proposed commercial location and state, up to five proposed tasks, and a required acknowledgement that driving, seated and repetitive tasks are ineligible.
- Application status, contributor agreement and consent status, and equipment checklist.
- Minute download links and, only when every condition below holds, the organization code.
- Accepted recording hours, estimated earnings, hours under review, amounts paid and payment status. The driver never sees the company rate or margin.

**Admin page** (`public/admin-data-collection.html`, linked from the admin dashboard)

- Review applications: approve, reject, suspend, reinstate (reasons required for reject and suspend).
- Link each participant's Minute contributor id, record agreements and consents (append-only history), assign equipment and track its status.
- Import a Minute session-level CSV: map the file's own columns, preview and validate every row (nothing is saved), then commit.
- Audited manual hours entry, for use until a sample Minute export is available.
- Move hours through review and payout statuses; see open import exceptions and the audit log.

## What it deliberately does not do

- No Minute password, raw recording, portal scraping, or assumed Minute API.
- No hardcoded Minute export format. Column names come from the admin's mapping of a real file.
- No payments are sent. "Paid" records a payment made outside this system and requires its payout reference.
- No equipment costs are deducted. The equipment table has no cost columns.
- Program earnings never touch `driver_earnings` (ride earnings). Tests check this.
- No changes to the iOS build (`mobile/`). The iOS app is a WebView over the website, so the driver section reaches it only after a web deploy and only when the program switch is on.

## Switches (system_flags; a missing row means off)

| Flag | When on | Requires |
|---|---|---|
| `data_collection_program_enabled` | Drivers see the section; the program API answers | none |
| `data_collection_enrollment_enabled` | Drivers can apply; admins can approve | program |
| `data_collection_collection_enabled` | Participants see links and the code (if eligible); admins can record hours | program |

Enrollment or collection set to `"true"` without the program switch stays off. Reject, suspend, review and payout actions are not gated, so an admin can always stop a participant or settle hours already accepted. Nothing in this change creates the flag rows.

## Who sees the organization code

All of these must hold, and the server re-checks them on every request:

1. Program and collection switches are on.
2. The driver's program application is `approved`. Ordinary driver approval only makes a driver eligible to apply; it never grants program access.
3. Every required agreement's latest record is `signed`.
4. `MINUTE_ORGANIZATION_CODE` is configured.

The code lives only in the server environment: it is not stored in the database, logged, or returned to admins (the admin overview shows only whether it is configured).

## Access control

- **Drivers** use `requireDriverSelf`: the driver comes from the signed session, never from a request field, and admin credentials cannot act as a driver. To apply, a driver must be ordinarily approved, active, not blocked or disabled, and not a review account.
- **Admins** pass `requireAdmin` plus a capability check (`lib/adminRbac.js`, deny by default):

  | Capability | Allows | Roles besides super_admin |
  |---|---|---|
  | `data_collection.read` | Overview, lists, exceptions, audit log | finance, compliance |
  | `data_collection.manage` | Application status, contributor link, agreements, equipment | compliance |
  | `data_collection.hours.manage` | Import preview/commit, manual entry, accept/reject/reopen hours | none |
  | `data_collection.payouts.manage` | Mark payable or paid | finance |

  Today every admin login resolves to super_admin (RBAC Phase 1), so current admins keep full access. Per-role access starts working when admin roles are wired to logins.
- **Database:** RLS is on for every program table, with no policies, and `anon`/`authenticated` have no table or function privileges. Drivers authenticate with server-signed tokens, not Supabase JWTs, so a JWT-based "own rows" policy would never match a real driver. Denying every direct client path, with the server as the only route in, is the strictest correct setting here. The audit log is append-only: update, delete and truncate raise errors.

## Earnings

- Proposed driver rate is **$10.00** and current company rate is **$15.00** per accepted recording hour. The **$5.00** difference is gross margin before expenses. Rates are snapshotted on every record.
- Durations are stored as whole seconds (at most 24 hours per session). Amount = seconds × rate ÷ 3600, rounded half-up to the cent, in integer arithmetic. Each record is rounded once, and totals are sums of rounded records, so totals always equal their line items. Margin = company − driver per record. The database enforces the same formula with check constraints.
- Statuses are kept separate: `pending` → `accepted` | `rejected`; `accepted` → `payable` | `rejected`; `payable` → `paid` | `accepted`; `rejected` → `pending`. `paid` is final. Rejecting needs a reason and paying needs a payout reference. Estimated earnings count accepted, payable and paid records.

## Importing hours

1. Choose a CSV and map its columns to contributor id, session id, session date (`YYYY-MM-DD` only; ambiguous formats are refused), and duration with its unit (seconds, minutes, decimal hours, or H:MM:SS).
2. Preview classifies each row as ready, duplicate (already stored, or repeated in the file), unmatched contributor, inactive participant, or invalid. Any invalid row blocks the import. Preview writes nothing.
3. Commit recomputes the preview on the server and refuses (409) if anything changed since the admin's preview. It also requires explicit confirmation to re-import an identical file. Batch, records, exceptions and audit entry are saved in one transaction (`data_collection_commit_hours`). A unique index on the session id (case-insensitive) rejects duplicates even under concurrency.
4. Unmatched or inactive rows become open exceptions, not hours. After linking the contributor, re-import the file: stored sessions are skipped as duplicates, the newly matched sessions are saved, and their exceptions are resolved.

Manual entry goes through the same function and needs the Minute session id, so a later import of that session is rejected as a duplicate.

## Configuration (server environment)

| Variable | Purpose |
|---|---|
| `MINUTE_ORGANIZATION_CODE` | Shown only to fully eligible participants |
| `MINUTE_IOS_APP_URL`, `MINUTE_ANDROID_APP_URL` | Download links (https only; unset shows "links will be provided") |

No URLs or codes are hardcoded. Use the values Minute provides.

## Migration

`supabase/migrations/20261003120000_add_data_collection_program.sql` adds seven tables and two functions. It is **not applied anywhere**. When approved:

1. Apply to a staging or branch project first, never straight to production.
2. Verify: `select relname, relrowsecurity from pg_class where relname like 'data_collection_%';` (all `true`), and that `anon` cannot `select` from any of them.
3. Apply to production only with explicit approval. The tables are new and additive; no existing table, row or function changes.
4. Rollback: `docs/data-collection/rollback-20261003120000_add_data_collection_program.sql`. It is destructive (drops program data), so export first.

The switches stay off after the migration. Turning them on is a separate, deliberate step.

## Before enrollment opens

- Jackson's approval of the contributor model.
- Contract terms (driver ↔ Harvey Taxi Service LLC, and Harvey Taxi ↔ Minute), including payment terms and worker classification.
- Insurance coverage for the activity and the equipment.
- Legal review of the required agreements. `REQUIRED_AGREEMENTS` in `lib/dataCollection.js` holds placeholders (contributor agreement, recording and data-use consent); the documents themselves are not part of this change.
- Confirmation of the rates (the $10 driver rate is proposed).
- Minute's organization code and download links.

Before relying on imports, also get a **sample Minute export**. Until then, use manual entry.

## Tests

- `lib/dataCollection.test.js`: gates, rounding and totals (every duration up to 2 hours), transitions, eligibility, U.S.-only validation, task flags, organization-code conditions, duration, date and CSV parsing, import classification and digest.
- `test/server.data-collection.test.js`: disabled-by-default behaviour, driver ownership, separate program approval, code visibility, admin authorization, approval re-checks, import preview/commit/duplicates/stale previews/re-imports, manual entry, payout flow, and separation from ride earnings.
- `test/dataCollectionRoutes.capabilities.test.js`: admin identities without a role are refused on every admin route; role grants.
- `test/db/dataCollection.db.test.js` (real Postgres, CI `db-functions` job): RLS and privileges, constraints, amount checks, atomic commit and duplicate rejection, status function, append-only audit log, and the rollback script.
- `test/data-collection.browser.test.js` (local Chromium; skipped in CI like the other browser tests): hidden when off, then the full apply → approve → sign → import → accept flow, at desktop and phone widths.
