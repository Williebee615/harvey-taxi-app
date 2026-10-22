# Data retention policy (DRAFT, not adopted)

**Status:** **[Recommendation, 2026-10-14]** A draft for owner and counsel review. Nothing here is in force. **No automatic deletion is implemented** for any category below, and none will be until the owner approves this policy and any legal hold or preservation requirement has been checked.

**Assistant records:** the owner's own draft, `docs/assistant-data-retention-policy.md` (PR #244), governs assistant-related categories. Where the two differ, that draft wins.

**Applies to:** Harvey Taxi Service LLC and the Harvey Transportation Assistance Foundation (HTAF). The two organizations' records are listed separately and must not be merged.

## 1. Principles
- Keep personal information only as long as there is a stated purpose: service, safety, legal, tax or audit.
- Prefer removing personal fields (redaction) over deleting whole records when the record itself must be kept, for example an audit trail.
- A legal hold, dispute, insurance claim, regulator request or open safety report pauses deletion for the affected records.
- Every deletion run is logged with counts only, never the deleted content.

## 2. Categories and proposed periods (for review)
| Category | Where | Proposed period | Notes / open questions |
|---|---|---|---|
| Server error audit rows (`audit_logs` `server_error`) | Supabase | 90 days (matches the owner's draft for technical error logs) | 832 historical rows (2026-07-04 → 2026-10-13) hold raw messages, full paths (521 with query strings) and IP and user agent. **Recommendation:** after review, either redact those fields in place or delete rows older than 90 days. See §3. |
| Operational audit rows (logins, ride events, approvals) | `audit_logs` | 2 years | Needed for disputes and safety. IP and user agent are proposed to be cleared after 90 days. |
| Review-assistant audit rows (HTAF and driver) | `audit_logs` | 12 months | Identifiers only; already proposed in the assistant docs. |
| RBAC decision log | `admin_rbac_shadow_log` | 12 months | Staff emails and routes only. |
| HTAF unanswered-question log | `htaf_assistant_questions` | 90 days (owner's assistant policy draft) | Topic labels only since #234. |
| Driver document expiration records | `driver_document_records` | Life of the driver account + 3 years | Insurance and licensing evidence may be needed for claims. **Counsel to confirm.** |
| Driver onboarding records | `drivers` | Life of the account + 3 years | **Counsel to confirm** for TN and any airport permit conditions. |
| Rider accounts | `riders` | Until deletion is requested, plus the legal minimum | The existing deletion-request flow applies. |
| Ride and payment records | `rides`, `payments` | 7 years | Tax and accounting; **accountant to confirm**. |
| HTAF applications | `htaf_applications` | **To be set by the HTAF board** | Grant reporting and funder requirements may set a minimum. |
| Staff override reasons (free text) | `audit_logs` `metadata.reason` | With the audit row (2 years) | 3 rows (2026-10-17) contain an email address typed by staff. **Recommendation:** mask contact details on save; ask staff not to type them. |
| Store applications and store users | `merchants`, `merchant_users` | Life of the store relationship + 3 years | Added 2026-10-22. Business contact details. **Counsel to confirm.** |
| Partnership inquiries | `partnership_inquiries` | 2 years from the last contact | Added 2026-10-22. 0 rows today. |
| Store orders and order events | `orders`, `order_events` | 7 years (payment records) | Added 2026-10-22. Delivery addresses are proposed to be cleared after 90 days, with the order kept. **Accountant to confirm.** |
| Fleet records | `fleets`, `fleet_vehicles`, `fleet_vehicle_documents`, `fleet_memberships`, `vehicle_assignments` | Life of the fleet + 3 years | Added 2026-10-22. Switch off, 0 rows. Insurance evidence, as for drivers. **Counsel to confirm** with the fleet agreement. |
| Driver bounty proposals | `ride_driver_bounties` | With the ride (7 years) | Added 2026-10-22. Table not created (migration not applied). |
| Dispatch reassignment notes | `audit_logs` `dispatch_ride_reassigned` | With the audit row (2 years) | Added 2026-10-22. Free-text staff note; same guidance as override reasons. |
| Push subscriptions | `push_subscriptions` | Until the device unsubscribes or the account is deleted | Added 2026-10-22. 0 rows today. |
| Rider live location | ride row (`rider_live_*`) | 10 minutes (in force) | Already enforced by `purgeRiderLocations` (`lib/liveLocation.js`). |
| Server log output | Render logs | Provider default; **to be checked** | Since 2026-10-22 every line is masked for email, phone, Postgres row values and credentials (`docs/log-privacy-audit-2026-10-22.md`). |
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

**Applied 2026-10-22 (UTC), steps 1 and 2 only, as a one-off [Owner decision 2026-10-22]** after the preservation check (no support cases, safety or incident reports, emergency alerts, refunds or disputes in the database; the owner confirmed no legal hold, claim, regulator request or Stripe dispute):
- 832 `server_error` rows: `message` and `path` removed, `error_code` set to `legacy`, IP address and user agent cleared. `method`, `build_sha`, origin host and CORS reason kept.
- 25 other audit rows older than 90 days: IP address and user agent cleared. The rows themselves are kept.
- Recorded as `audit_logs` row 1619 (`retention_cleanup_applied`), counts only.
- **Not yet automatic:** rows reaching 90 days from now on keep their IP address and user agent until a scheduled job is built and approved (§4).

## 4. Implementation (after approval only)
- A scheduled job per category, **off by default** behind a system flag, with a dry-run mode that reports counts.
- Legal-hold exclusion list checked before every run.
- Tests prove that held records are never touched.
