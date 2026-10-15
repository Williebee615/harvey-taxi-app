# Retention schedule: implementation gaps and required exceptions

**Status:** analysis for owner review, prepared 2026-10-15.
- This uses `docs/assistant-data-retention-policy.md` as the proposed schedule.
- **Nothing has been deleted, and nothing here authorizes deletion.**
- Automatic deletion stays disabled until you approve the final policy and its implementation (policy §8).

**Labels:**
- **[Verified 2026-10-15]:** read from production (read-only SQL) or from the code on `main` (`44ec21b`).
- **[Unresolved]:** needs information this environment can't see.
- **[Exception]:** the policy can't be met as written; it needs your decision.

## 1. Production inventory (read-only counts, 2026-10-15)

| Table / category | Rows | Older than 90 days | Older than 12 months | Oldest |
|---|---|---|---|---|
| `audit_logs` (all actions) | 1,382 | 26 | 0 | 2026-07-04 |
| `audit_logs` `server_error` | 832 | 2 | 0 | 2026-07-04 |
| `htaf_assistant_questions` | 5 (includes the test row id=1, which you asked to keep) | 0 | 0 | 2026-10-14 |
| `audit_logs` `assistant_pilot_gap` | 1 | 0 | 0 | 2026-10-14 |
| Synthetic `@example.test` HTAF applications / drivers | 0 / 0 | — | — | — |

Notes on the inventory:
- Nothing is past the 12-month audit limit.
- The 26 audit rows past 90 days are mostly `server_error` rows and other technical rows. Some of them predate #240's structured logging and carry query strings (see the historical-log report). Policy §7 needs an inventory review and your approval of the cleanup scope before anything is removed.

## 2. Gaps, by policy section

| # | Policy requirement | Current state | Gap | Proposed fix |
|---|---|---|---|---|
| G1 | §3 Daily deletion job by retention date | **[Verified]** None exists. The only automatic deletions are operational: expired push subscriptions, rider-shared locations past pickup, and dead driver push tokens. | No job and no retention dates. | A `runRetentionSweep` job, off behind the `retention_deletion_enabled` flag. Per-category retention lives in code, reviewed by you. Dry-run mode records counts only. |
| G2 | §3 Record only time, category, count and outcome; alert on failure; never report success for skipped rows | **[Verified]** No such record. | Needs a run record and an alert path. | A `retention_runs` table: run_at, category, eligible, deleted, held, outcome, error_code. On failure, notify the policy owner via the existing admin email. |
| G3 | §4 Preservation holds (scope, responsible person, start date, review date) | **[Verified]** No holds table. | Deletion can't honor holds. | A `retention_holds` table (category, optional entity id or date range, reason code, responsible person, start, review_by, released_at). The sweep skips held rows and counts them as `held`. |
| G4 | §2 Audit records: 12 months for review-assistant rows; 90 days for technical and security logs | **[Verified]** All categories share `audit_logs`. Retention can only be decided by `action`. | Needs a category map. | A fixed allowlist mapping each `action` to a category. Unmapped actions are **never** deleted and are reported as `unclassified`. |
| G5 | §2 Review-assistant audit rows store organization, rule version and fixed reason codes | **[Verified]** Rows hold actor (admin email), `entity_type`, entity id, `engine` (e.g. `htaf-review-assist-v2`, which serves as the rule version), check ids, verdict and reason. There is **no organization field**; it can only be inferred from `entity_type` / action prefix. IP address and user agent are also stored, because `auditLog` is called with `req`. | Organization not explicit. IP and user agent are not in the policy's field list. | Add `org` to the metadata of the four review actions. Stop passing `req` for those actions, as #240 did for `server_error`. A small code PR. |
| G6 | §2 Public unanswered-question analytics: 90 days, topic codes only | **[Verified]** Topic-only storage was confirmed live (2026-10-14). No deletion. | Covered by G1. | Sweep category `assistant_gap` (90 days) for `htaf_assistant_questions` rows with intent `htaf_assistant_pilot`, and for `assistant_pilot_gap` audit rows. **Exception you set:** keep test row id=1. That needs a hold (G3) or an explicit exclusion. |
| G7 | §2 Technical error and security logs: 90 days, no query strings | **[Verified]** New rows are structured (#240). 521 historical `server_error` rows include query strings (parameter names `status`, `rest_route`, `_sm_byp`; no emails found). | Historical rows predate the policy. | §7 path: you approve the cleanup scope first. Option A: let the 90-day sweep remove them as they age (the last will age out around mid-January 2027). Option B: an approved one-time cleanup. |
| G8 | §2 Synthetic test records: delete within 7 days after verification | **[Verified]** None exist now. The smoke-test doc deletes them "afterwards" without a deadline. | Wording. | Update `docs/review-assistant-smoke-tests.md` §4 to say "within 7 days after verification". |
| G9 | §2 Public conversation text: no persistent storage | **[Verified 2026-10-14, tests]** The server stores none. | None. | — |
| G10 | §5 Backups: document actual retention; target maximum 90 days | **[Unresolved]** Supabase backup retention depends on the plan. Your plan tier and the Pro upgrade are unresolved, and point-in-time recovery status isn't visible here. | Unknown. | You confirm the plan's backup retention in the Supabase dashboard (Database → Backups). If above 90 days, see E1. |
| G11 | §5 Platform logs | **[Unresolved]** Render's log retention for your plan isn't visible here. Supabase API and Postgres logs also have plan-based retention. | Unknown. | You confirm in the Render and Supabase dashboards. These logs are outside our deletion job. |
| G12 | §5 After restoring a backup, reapply deletions and holds | **[Verified]** No mechanism. | Missing. | Rely on G1: run the sweep before reopening the restored database. Document it in the restore runbook. Test it in staging (policy §8). |
| G13 | §6 Audit retention-setting changes | Not built. | Missing. | Changes to retention flags and holds write an audit row. |
| G14 | §2 note: application files, driver documents, consent, financial, payment and incident records | Out of scope by the policy's own text. | Needs separate schedules. | The driver-document schedule is drafted in `docs/data-retention-policy.md` (#243). Financial and payment schedules come after reconciliation is reviewed. |

## 3. Required exceptions (your decision)

| # | Exception | Why | Options |
|---|---|---|---|
| E1 | **Backups** may exceed the 90-day target | Plan-dependent; unknown (G10). | Accept the documented platform retention, or choose a plan or setting that meets 90 days. |
| E2 | **Platform logs** (Render, Supabase) are outside our deletion job | We can't delete provider-held logs line by line. | Accept the provider retention as documented, with structured logging limiting what they contain. |
| E3 | **Anthropic API retention** (only if model mode is approved) | Inputs and outputs are kept up to 30 days by default; flagged content can be kept longer (secondary sources; see `docs/assistant-model-proposal.md` §2). This exceeds "no persistent storage" for conversation text. | Request zero data retention, or approve a documented 30-day exception. Model mode stays off meanwhile. |
| E4 | **Test row** `htaf_assistant_questions` id=1 | You asked to keep it. | Keep it under a named hold with a review date, or release it when the 90-day rule applies. |
| E5 | **Historical `server_error` rows** with query strings | §7 forbids silent cleanup. | Age-out (Option A) or approved one-time cleanup (Option B) (G7). |

## 4. Recommended order (each step needs your approval when it changes production)

1. **Code-only PR, off by default.**
   - Category map (G4), holds and runs tables (G2, G3).
   - Sweep in **dry-run** mode: counts only.
   - Review-audit `org` field and IP/user-agent removal (G5).
   - Smoke-test wording (G8).
   - Tests: expiration boundaries, organization separation, holds, failed deletion, unclassified actions.
2. **Your dashboard confirmations:** G10, G11; decide E1–E5.
3. **Apply the migration** (approval), then run dry-run in production for a week and review the counts.
4. **Enable deletion** for one category at a time (approval). Start with `assistant_gap`, which has no historical baggage.
