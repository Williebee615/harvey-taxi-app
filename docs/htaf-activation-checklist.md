# HTAF ride transfer and AI triage — activation checklist

Tracks: #133 (HTAF alerts), #134 (HTAF access), #135 (ride creation),
#136 (AI triage), #137 (provider agreement).
Code: `lib/htafActivation.js`, the two gates, `requireHtafCapability()`
and `sendAdminApplicationAlert()` in `server.js`.

Both actions ship **off**. Setting the feature flag alone does nothing:
the server also requires a complete approval record in the environment,
and ignores the flag (logging an error at start-up) until every item is
present. The approval record is attached to every audit row the action
writes, so each transfer can be traced to the approval that authorized it.

Approval values are references (document IDs, minute numbers, names,
dates). They are not secrets and must never contain applicant data.

---

## 0. Always-on separation (no activation step)

These ship enforced and need no approval record.

**HTAF alerts.** New-application alerts go only to `HTAF_ADMIN_EMAIL`. There
is no fallback to `ADMIN_EMAIL` (a Harvey Taxi mailbox). While it is unset,
no alert is sent: the server logs an error and writes a critical
`htaf_admin_alert_not_configured` audit row (application ID and code only).
The email itself carries only the application code and a link to the admin
portal, with no name, contact details, location, program, income or need
text. `GET /api/health` (admin) reports `features.htaf_admin_alerts`.

**HTAF admin permissions.** Every HTAF admin route (applications list,
detail, update, export, schema check, triage, ride creation, assistant
questions) requires the route's HTAF capability from the admin's
`admin_roles` role (`lib/adminRbac.js`): `super_admin` or
`htaf_caseworker`. Harvey Taxi-only roles (dispatcher, support, finance,
compliance), unknown roles and identities without a role row are denied
with 403 and an `htaf_access_denied` audit row. The configured
`ADMIN_EMAIL` identity falls back to `super_admin` when it has no row or
the role lookup fails, so the owner cannot be locked out. Every decision
is recorded in `admin_rbac_shadow_log`. `HTAF_RBAC_ENFORCED=false` reverts
to log-only and is for emergency rollback only.

---

## 1. HTAF → Harvey Taxi ride creation (#135, #137)

Transfers the applicant's name, phone, pickup and destination into the
Harvey Taxi `rides` table.

### Prerequisites (owner / board / counsel — not code)

- [ ] Written HTAF–Harvey Taxi services and data-processing agreement
      executed, covering all 12 points in #137:
      separate legal identities; scope of services; permitted data fields
      and purposes; confidentiality and security; access controls;
      retention and deletion; incident notification; insurance and
      licensing; pricing or cost allocation; conflicts of interest and
      board approval; recordkeeping and audit rights; termination and
      return/deletion of data.
- [ ] Agreement approved through HTAF conflict-of-interest governance
      (interested parties recused; approval minuted).
- [ ] HTAF Privacy Policy provider-sharing disclosure finalized by counsel
      (currently marked pending counsel review).
- [ ] `HTAF_ADMIN_EMAIL` set to an HTAF-controlled mailbox (section 0).
- [ ] Only intended people hold `super_admin` / `htaf_caseworker` in
      `admin_roles` (section 0).

### Environment (Render)

| Variable | Value |
|---|---|
| `HTAF_PROVIDER_AGREEMENT_REF` | Executed agreement identifier |
| `HTAF_CONFLICT_REVIEW_REF` | Board/conflict review reference (e.g. minutes and item) |
| `HTAF_RIDE_TRANSFER_APPROVED_BY` | Approving person or body |
| `HTAF_RIDE_TRANSFER_APPROVED_AT` | Approval date, `YYYY-MM-DD`, not in the future |
| `HTAF_RIDE_CREATION_ENABLED` | `true` — set **last** |

---

## 2. HTAF AI triage (#136)

Sends the minimized triage facts (status, program type, applicant type,
service-area yes/no answers, ride date, presence flags, submission time)
to the configured AI provider. Names, contact details, addresses, income,
household size, uploads and free text are excluded, and
`lib/htafOperations.test.js` fails if any of them enter the payload.

### Prerequisites

- [ ] Privacy/security review of the triage data contract approved.
- [ ] AI provider's data-use and retention terms reviewed and acceptable
      (no training on submitted data; retention period documented).
- [ ] Only intended people hold an HTAF role in `admin_roles` (section 0);
      no other role can run triage.

### Environment (Render)

| Variable | Value |
|---|---|
| `HTAF_AI_PRIVACY_REVIEW_REF` | Privacy review reference |
| `HTAF_AI_TRIAGE_APPROVED_BY` | Approving person or body |
| `HTAF_AI_TRIAGE_APPROVED_AT` | Approval date, `YYYY-MM-DD`, not in the future |
| `HTAF_AI_TRIAGE_ENABLED` | `true` — set **last** |

An AI provider key must also be configured; without one, triage stays off
with reason `no AI provider configured`.

---

## 3. Validation after the change is deployed

1. Render logs at start-up show, for the action being enabled:
   `HTAF ride creation: ON (enabled with a complete approval record)` (or
   the AI triage equivalent). An `OFF (approval record incomplete: …)`
   line logged as an error means a variable is missing or malformed.
2. As an admin, `GET /api/health` → `htaf_activation.<action>`:
   `enabled: true`, `missing_approvals: []`, `approvals` showing the
   recorded references. The other action must still read `enabled: false`.
3. Perform one supervised action on a test application and confirm the
   audit row (`htaf_application_converted_to_ride` or
   `htaf_application_ai_triaged`) carries `metadata.approval`.
4. Record the deploy commit, date, operator and the results above in the
   issue before closing it.

## 4. Rollback

Set `HTAF_RIDE_CREATION_ENABLED` / `HTAF_AI_TRIAGE_ENABLED` to `false`
(or delete it) and redeploy. The route immediately returns 403 and records
`htaf_ride_creation_blocked` / `htaf_ai_triage_blocked` by application ID
only. Removing any approval variable has the same effect. Rides already
created are not deleted by rollback; handle them under the agreement's
retention and deletion terms.
