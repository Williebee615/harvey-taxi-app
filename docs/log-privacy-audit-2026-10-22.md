# Log privacy audit, 2026-10-22 (UTC)

**[Owner decision 2026-10-22]** "Approved, start the log privacy audit." Scope: find personal data in server logs and log tables, redact it in code, and update the draft retention policy. **Nothing was deleted or rewritten in the database.** Historical records stay untouched until the retention review.

## 1. Result in one line
The application's log output now masks email addresses, phone numbers, Postgres row dumps and credentials on every line. Two failed-insert logs that could print a whole applicant or ride row now log an error code only. No personal data was found in database log tables beyond what the 2026-10-14 review already recorded, plus three staff notes (below).

## 2. Server log output (`console.*`) [Verified 2026-10-22, code review of all 191 calls]
| Finding | Risk | Fix in this PR |
|---|---|---|
| HTAF application insert failure logged Postgres `details` and `hint` | **High.** A failed insert's `details` is "Failing row contains (…)": the applicant's whole row (name, address, income answers). | Error code and column names only (`dbErrorEntry`). |
| Ride insert failure logged `details` and `hint` | **High.** Same: rider name, phone, pickup and drop-off addresses. | Error code only. |
| Rider session check logged the whole database error object | Medium | Error code only. |
| "Email skipped" logged the recipient's full email address | Medium. Only when email sending is off; it is on in production. | Recipient domain only. |
| Persona and Checkr failures logged the provider's error text | Medium. Provider validation text can echo the applicant's details. Both are switched off today. | HTTP status only. |
| Unhandled rejections and uncaught exceptions logged the raw object | Medium. It can be a database error with `details`. | Covered by the safety net below. |
| ~150 calls log `error.message` from the database, Stripe or our own code | Low. These messages rarely contain values; one exception is Postgres "invalid input syntax … \"value\"". | Covered by the safety net below. |
| Already safe before this audit | | The server error handler (allowlisted fields, no URL or body), Twilio errors (code and status only), "SMS skipped" (last 2 digits, no body), payment alerts (allowlisted), route failures (enum values only), audit-log failures (code only). |

**Safety net (`installConsoleRedaction`, `lib/safeLog.js`):** every `console.log/info/warn/error/debug` argument is masked before it is written: email addresses → `[email]`; phone numbers in E.164 or US format → `[phone]`; Postgres "Failing row contains" and "Key (…)=" → `[values redacted]`; Stripe keys, webhook secrets and bearer tokens → `[secret]`. Error objects are written as their redacted stack. IDs, commit SHAs, timestamps and amounts are left alone (tested).

**Limit:** pattern matching cannot recognise names or street addresses. Allowlisted log fields stay the primary control; new log lines should use `serverErrorEntry` / `dbErrorEntry`, not raw error objects.

## 3. Database log tables [Verified 2026-10-22, read-only counts; no content read]
| Table | Rows | Finding |
|---|---|---|
| `audit_logs` | 1,618 (since 2026-07-04) | 1,525 rows store an IP address and user agent; 27 of them are older than 90 days. No phone numbers or Postgres row dumps in `metadata`. |
| `audit_logs` `server_error` | 832, all before 2026-10-14 | No new rows since the 2026-10-14 fix. The historical rows still hold raw messages and paths (2026-10-14 review). |
| `audit_logs` `actor_id` | 120 rows | Staff email addresses (6 staff accounts) as the actor. Expected: it identifies who acted. |
| `audit_logs` `metadata.reason` | 3 rows (2026-10-17) | Staff typed an email address into the free-text reason for a driver override (`driver_compliance_override`, `driver_contact_verification_override`). Not changed. |
| `admin_rbac_shadow_log` | 579 | Staff emails and routes (already in the draft policy). |
| `htaf_assistant_questions` | 7 | Topic labels only since #234; includes the test row id=1, kept. |
| `agent_model_usage` | 76 | Usage counts. |
| Others (`notification_logs`, `trip_events`, `trip_timelines`, `events`, `emergency_alerts`, `driver_locations`, `order_events`, `delivery_status_events`) | 0 | Nothing stored. |

Row counts are Postgres table statistics (estimates) except `audit_logs`, which was counted exactly.

## 4. Not reviewed (no access from this environment)
- **Render request logs:** they hold full URLs, including query strings. Retention and who can view them are owner checks.
- **Supabase API and Postgres logs** (provider side) and **Stripe, Twilio and SendGrid dashboards:** provider retention applies.

## 5. Recommendations for the owner
1. **[Recommendation]** Approve the retention policy draft's cleanup scope (`docs/data-retention-policy.md` §3), after the preservation check: redact the 832 historical `server_error` rows and clear IP address and user agent on audit rows older than 90 days. Nothing runs until approved.
2. **[Recommendation]** Ask staff not to type contact details into override reasons. A later change can mask emails and phone numbers in that field when it is saved.
3. **[Owner check]** Render: log retention period and the list of people with dashboard access.
