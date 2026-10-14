# Harvey Taxi Service & HTAF — Assistant Data Retention Policy

**Status:** Draft for owner approval
**Policy owner:** Willie Harvey IV
**Applies to:** Harvey Taxi Service LLC and Harvey Transportation Assistance Foundation (HTAF)
**Source:** text provided by the owner on 2026-10-14, recorded verbatim below. Pilot compliance notes follow in §9 (added by Claude Code, labelled).

## 1. Purpose and separation

Retain only information needed to operate, secure, and review assistant services. Harvey Taxi and HTAF records must remain separated by organization and accessible only to authorized personnel.

## 2. Retention schedule

| Record type | Retention | Requirements |
|---|---|---|
| Internal review-assistant audit records | 12 months from the event | Store actor ID, organization, record ID, timestamp, rule version, check identifiers, action, and fixed correction reason codes. Exclude applicant details, document contents, staff notes, and generated summaries. |
| Generated review suggestions | No persistent storage | Generate on demand. Do not copy into logs, analytics, or conversation memory. |
| Public unanswered-question analytics | 90 days | Store only approved topic codes and necessary operational metadata. Never retain visitor wording. |
| Public assistant conversation text | No persistent storage by default | Use temporary session context only. Discard server-side context when the session ends or after 30 minutes of inactivity. Do not restore transcripts after restart. |
| Future opt-in conversation history | Disabled until separately approved | Proposed maximum: 90 days from the last activity. Provide user deletion controls and a clear notice before enabling. |
| Technical error and security logs | 90 days | Use structured, allowlisted fields and fixed error codes. Exclude request bodies, query strings, credentials, raw database values, and personal message text. |
| Synthetic test records | Delete within 7 days after verification | Label clearly and exclude from public totals, dispatch, notifications, charges, and payouts. Retain minimal verification evidence under the audit schedule. |

Application files, driver documents, consent records, financial records, payment records, and incident reports require separate retention schedules. This policy does not authorize deleting those underlying records.

## 3. Deletion process

Run a daily deletion job using each record's applicable retention date. Delete expired records from active storage and associated caches or indexes.

Record only deletion-job time, category, count, and outcome. Alert the policy owner when deletion fails. Never report success for records that were skipped or could not be deleted.

## 4. Preservation holds

Suspend deletion for records covered by a documented legal, regulatory, funding, dispute, or security-investigation hold.

Record the hold's scope, responsible person, start date, and review date. Limit access and review holds regularly. When a hold is released, delete records whose retention period has already expired.

## 5. Backups and external providers

Document each backup and provider's actual retention and deletion capabilities before activating automatic deletion.

Use a target maximum backup retention of 90 days. If a platform cannot meet that target, document the exception for owner approval. Deleted records may remain in restricted backups until those backups expire.

After restoring a backup, reapply deletion records and preservation holds before returning restored data to normal use.

External AI providers must have documented data handling, retention, and deletion terms before receiving approved data. Do not claim immediate or complete deletion when provider or backup limitations prevent it.

## 6. Access and user deletion

Restrict access by organization and assigned duties. Audit administrative access and retention-setting changes.

For any approved conversation-history feature, process deletion requests within 30 days, subject to documented preservation requirements. Explain any retained categories and the reason for retention.

## 7. Existing records

Inventory historical logs before cleanup. Identify records that contain unnecessary personal information, review preservation requirements, and obtain approval for the cleanup scope. Do not silently rewrite or delete historical audit evidence.

## 8. Review and implementation

Review this policy annually and whenever assistant capabilities, providers, funding requirements, or data flows change.

Before implementation, confirm applicable recordkeeping obligations and approve the final schedule. Test expiration boundaries, organizational separation, holds, failed deletion, and backup restoration.

Automatic deletion remains disabled until the final policy and implementation are approved.

---

## 9. Assistant pilot compliance (added 2026-10-14 by Claude Code; not part of the owner's text)

| Policy row | Assistant pilot behavior | Label |
|---|---|---|
| Public assistant conversation text: no persistent storage | The server stores nothing. The visitor's page holds recent turns in memory and sends them with each message. They are lost on reload, and the page uses no `localStorage`, `sessionStorage` or cookie (browser test). The server keeps no session context between requests, so there is nothing to discard after 30 minutes and nothing to restore after a restart. | **[Verified 2026-10-14, tests]** |
| Public unanswered-question analytics: topic codes only, 90 days | The pilot logs only a fixed topic label, e.g. "Unanswered question about: accessibility": in `htaf_assistant_questions` for HTAF, and in an `audit_logs` `assistant_pilot_gap` row for Harvey Taxi. The visitor's wording is never stored (route test). **[Unresolved]** The 90-day deletion job is not built; automatic deletion stays disabled until approved. | Mixed |
| Technical error and security logs | Errors from the pilot route go through the structured logger (#240): error code, class, route template and method only. | **[Verified 2026-10-14, tests]** |
| External AI providers: documented terms before receiving data | The model is off. It runs only when the per-organization model flag is on **and** `ASSISTANT_PILOT_MODEL_APPROVED=true` is set on the server. **[Unresolved]** Anthropic's current data-handling and retention terms must be documented for owner review before either is enabled. | **[Owner decision pending]** |
| Future opt-in conversation history | Not built. | — |
| Synthetic test records: delete within 7 days | The pilot creates no records. The review-assistant smoke-test records follow `docs/review-assistant-smoke-tests.md`. **[Recommendation]** Align its cleanup step to "within 7 days after verification". | **[Recommendation]** |
