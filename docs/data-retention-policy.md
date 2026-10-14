# Data retention policy (DRAFT, not adopted)

**Status:** **[Recommendation, 2026-10-14]** A draft for owner and counsel review. Nothing here is in force. **No automatic deletion is implemented** for any category below, and none will be until the owner approves this policy and any legal hold or preservation requirement has been checked.

**Applies to:** Harvey Taxi Service LLC and the Harvey Transportation Assistance Foundation (HTAF). The two organizations' records are listed separately and must not be merged.

## 1. Principles
- Keep personal information only as long as there is a stated purpose: service, safety, legal, tax or audit.
- Prefer removing personal fields (redaction) over deleting whole records when the record itself must be kept, for example an audit trail.
- A legal hold, dispute, insurance claim, regulator request or open safety report pauses deletion for the affected records.
- Every deletion run is logged with counts only, never the deleted content.

## 2. Categories and proposed periods (for review)
| Category | Where | Proposed period | Notes / open questions |
|---|---|---|---|
| Server error audit rows (`audit_logs` `server_error`) | Supabase | 90 days | 832 historical rows (2026-07-04 → 2026-10-13) hold raw messages, full paths (521 with query strings) and IP and user agent. **Recommendation:** after review, either redact those fields in place or delete rows older than 90 days. See §3. |
| Operational audit rows (logins, ride events, approvals) | `audit_logs` | 2 years | Needed for disputes and safety. IP and user agent are proposed to be cleared after 90 days. |
| Review-assistant audit rows (HTAF and driver) | `audit_logs` | 12 months | Identifiers only; already proposed in the assistant docs. |
| RBAC decision log | `admin_rbac_shadow_log` | 12 months | Staff emails and routes only. |
| HTAF unanswered-question log | `htaf_assistant_questions` | 6 months | Topic labels only since #234. |
| Driver document expiration records | `driver_document_records` | Life of the driver account + 3 years | Insurance and licensing evidence may be needed for claims. **Counsel to confirm.** |
| Driver onboarding records | `drivers` | Life of the account + 3 years | **Counsel to confirm** for TN and any airport permit conditions. |
| Rider accounts | `riders` | Until deletion is requested, plus the legal minimum | The existing deletion-request flow applies. |
| Ride and payment records | `rides`, `payments` | 7 years | Tax and accounting; **accountant to confirm**. |
| HTAF applications | `htaf_applications` | **To be set by the HTAF board** | Grant reporting and funder requirements may set a minimum. |
| Hosting request logs | Render dashboard | Provider default; **to be checked** | Contain full URLs, including query strings. Review retention and who has access. |

## 3. Historical sensitive data found (2026-10-14, counts only)
- **`audit_logs` `server_error`, 832 rows:**
  - all contain the raw error message, the full path and the client IP and user agent;
  - 521 paths carry a query string, but the only parameter names found are `status` (an admin filter), `rest_route` (WordPress scanner probes) and `_sm_byp`;
  - no email addresses were found, and the phone-like matches were build SHAs, not phone numbers;
  - no database-detail text (`Key (…)=(…)`, `Failing row`) was found.
  - **Residual risk:** free-text messages can't be proven free of names by pattern matching. 42 rows come from the rider and driver signup routes and warrant manual review.
- **Most other `audit_logs` actions** store the IP and user agent per row.
- **`notification_logs`, `trip_events` and `trip_timelines`** are empty. **`admin_logs`** has 4 rows from 2026-04-10.
- **Render request logs** were not reviewed: there is no access from this environment.

**Proposed cleanup scope, for approval and after preservation review:**
1. In `server_error` rows, replace `message` and `path` with the new structured fields (`error_code` cannot be derived for old rows, so set it to `legacy`), and clear `ip_address` and `user_agent`.
2. Clear `ip_address` and `user_agent` on audit rows older than 90 days.
3. Run nothing until the owner approves, and record the before and after counts.

## 4. Implementation (after approval only)
- A scheduled job per category, **off by default** behind a system flag, with a dry-run mode that reports counts.
- Legal-hold exclusion list checked before every run.
- Tests prove that held records are never touched.
