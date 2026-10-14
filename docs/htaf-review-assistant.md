# HTAF review assistant (application triage)

Prepared 2026-10-13; hardened 2026-10-14 (rules v2). **Off in production.** It was switched on at 00:19 UTC on 2026-10-14 and switched off at 00:32 UTC, pending this hardening; it was never used. Turning it on needs the owner's separate decision.

## 1. The former external "AI triage" (removed 2026-10-14)
The earlier `POST /api/admin/foundation/applications/:id/triage` route sent reduced application facts to **OpenAI**. It was locked behind `HTAF_AI_TRIAGE_ENABLED` plus an approval record.
- **[Verified 2026-10-13, production audit log]** It never ran, so no application data was ever sent to OpenAI.
- **[Owner decision 2026-10-14]** It was removed: the route, its activation gate and the `HTAF_AI_TRIAGE_*` settings, and its facts builder.
  - Calls to the old path now return 404 under any configuration, and a test enforces this.
  - Its history remains in Git.
  - Any future external AI integration is a separate reviewed project.

## 2. What this PR adds: an internal review assistant
- **Code:**
  - `lib/htafReviewAssist.js` (the rules);
  - `POST /api/admin/foundation/applications/:id/review-assist`;
  - `POST /api/admin/foundation/applications/:id/review-assist/feedback`;
  - the "Review Assistant" panel in `admin-htaf.html`.
- **How it works:** fixed rules running on HTAF's own server, with **no AI model and no network call made by the assistant**. Applicant facts are not sent to any AI provider or any telemetry, analytics or error-reporting service (see §3 for every place data goes).
- **What staff get:**
  - **Summary:** program category, who is applying (self or on someone's behalf), ride date, county, whether a trip description exists, status and how long ago it was received.
  - **Missing-information checks:** name, contact details, county, pickup city, destination, ride date, trip description, program.
  - **Items to check:**
    - county not a recognised Tennessee county (it may be misspelled; a "possibly …" suggestion is shown; a missing county is a separate check);
    - ride requested for today (Central time);
    - ride date already passed;
    - very short trip description;
    - possible duplicate: another application with the same email or phone, shown by application code, status and date only. The wording states that households, caregivers and caseworkers often share contact details and that this is not a reason to deny.
  - **Staff checks, always shown:** funding available, transportation available on the date, eligibility and approval. HTAF's stated coverage is Tennessee statewide, but a recognised county never confirms funding, a ride, eligibility or approval.
  - **Suggested follow-up questions** for each gap, in neutral wording.

## 3. Data flow (precise)
```
Staff (HTAF role) clicks "Review Assistant"
  → server checks: signed-in admin session; HTAF capability from admin_roles
    (always enforced, even if HTAF_RBAC_ENFORCED=false); flag exactly "true"
  → database read: ONE application, only the columns in §4
  → database read: up to 5 other applications with the same email (lower-cased)
    or phone (last 10 digits, every stored format): id, code, status, dates only
  → rules run in memory on the server
  → response to the staff member's browser: summary, checks, staff checks, questions
  → audit_logs row: staff email, application id, rule version, check ids
```
**Where data goes, and where it doesn't:**

| Destination | What reaches it |
|---|---|
| Database (Supabase, HTAF's existing database host) | Reads as above. Audit rows hold identifiers only. Nothing is written to the application. |
| The authorised staff member's browser | The review result. It contains categories, dates, a recognised county name, other applications' codes and statuses, and fixed wording. It does not contain name, contact details, addresses, trip description, income, household size or notes. |
| Server logs (Render) | Request line (URL with the application id) and, on an error, the error message only. There are no request bodies and no review results. |
| AI providers | **None.** The module has no network code (enforced by a test), and the route made no outbound requests in tests. |
| Telemetry, analytics, error-reporting services | **None configured.** Checked 2026-10-14: no Sentry, Datadog, PostHog, Segment or similar in the server or the HTAF admin page. |

## 4. Fields read
| Field | Used for |
|---|---|
| first_name, last_name | whether they are filled in (never shown) |
| email, phone | whether filled in; server-side lookup of other applications with the same value (never shown) |
| county | normalised (case, spacing, punctuation, "County/Co./Cnty", ", TN") and checked against Tennessee's 95 counties; the recognised name is shown. If unrecognised, the closest county within 2 letters is offered as "possibly", never applied |
| pickup_city, destination | whether filled in (never shown) |
| ride_date | missing, before today, today (same-day), shown. Dates are evaluated in **America/Chicago**; date-only values are calendar dates |
| transportation_need | length only: missing, brief or provided (text never shown) |
| program_type, applicant_type, status, submitted_at/created_at | shown as categories and dates |

**Not read:** household size, monthly income, staff notes, review notes, city, assigned staff member.

## 5. Who can use it
- **Access:** HTAF staff with the `htaf.applications.triage` capability, which means the `htaf_caseworker` or `super_admin` role in `admin_roles`.
- **Refused:**
  - Harvey Taxi roles (dispatcher, support, finance, compliance);
  - board and volunteer roles;
  - admins with no role.

  These are refused before any application is read, and the denial is logged.
- **No sign-in or a forged session:** 401.

## 6. Human decision only
- **Suggestions only.** The assistant never approves, denies, ranks or scores an application, and never changes its status. It never creates or schedules a ride, and never contacts the applicant: it has no email or SMS path.
- **Clear labelling.** Every result carries the label: "Automated suggestions from HTAF's own review rules (no AI model). Not a decision: a person approves or denies every application. Check each item before acting."
- **Staff can correct or ignore any suggestion:**
  - "Wrong" or "Not needed" on any item hides it and records the check id, the verdict and a fixed reason code (`information_is_present`, `county_is_valid`, `date_is_correct`, `not_a_duplicate`, `already_resolved`, `not_relevant`). There is no free text, no suggestion text and no applicant facts. The application must exist, and the same role checks apply;
  - "Dismiss" closes the panel.
- **Follow-up questions** are copied into the staff notes box only when staff tick them. Staff still choose whether to save the notes, and whether and how to contact the applicant.
- **Decisions** go through the existing status update, made by a person.

## 7. What is stored, retention and deletion
- **Suggestions are not stored.** They are recalculated on request, and the same application gives the same result.
- **Audit entries:**
  - `htaf_review_assist_run`: staff email, application id, rule version, list of check names;
  - `htaf_review_assist_feedback`: the same, plus check name and verdict;
  - `htaf_review_assist_blocked`: attempts while the assistant is off.

  None contains applicant name, contact details, addresses, income or text.
- **Proposed retention, an owner decision:** delete these audit entries after **12 months**. Feedback is only needed to tune the rules; run records are for accountability. The deletion is a manual or scheduled statement:
  ```sql
  delete from public.audit_logs
  where action in ('htaf_review_assist_run','htaf_review_assist_feedback','htaf_review_assist_blocked')
    and created_at < now() - interval '12 months';
  ```
- **Follow-up questions saved to notes** become part of the application record. They follow the application's retention: 7 years if approved, 3 years if denied or withdrawn (HTAF privacy notice §10, pending counsel review).

## 8. Privacy notice check
- **Current HTAF privacy notice:** §4 says information is used "to review applications and determine eligibility"; §6 lists service providers.
- **This assistant** adds no service provider, makes no automated decision, and is a staff review aid covered by §4.
- **[Recommendation]** An update is not strictly required. A transparency sentence is proposed for owner and counsel review, and **is not changed in this PR**:
  > "HTAF staff may use automated, rule-based checks within HTAF's own systems to summarize an application and point out missing or unclear information. These checks do not use artificial intelligence and do not make decisions: HTAF staff review every application and make every approval or denial."
- **If an external AI service were ever used,** the notice would need updating, after a separate reviewed project.

## 9. Open decisions (owner)
1. Turn the review assistant on in production (set the system flag `htaf_review_assist_enabled` to `true`). It stays off until approved.
2. Approve the 12-month retention for review-assistant audit entries, and whether to schedule the deletion.
3. Approve, edit or decline the privacy-notice sentence in §8 (counsel review).
4. Remove the unused external OpenAI triage route, or keep it locked.
5. Coverage: the rules use Tennessee statewide (all 95 counties) as the stated coverage goal, kept separate from funding, transportation availability and eligibility (staff checks).
6. Apply migration `20261014020000_htaf_applications_phone_idx.sql` (phone index for the duplicate check). It is additive. The check works without it; the index keeps it fast as applications grow.

## 10. Turning it on and off
- **On (owner approval):** `insert into system_flags (key, value) values ('htaf_review_assist_enabled','true') on conflict (key) do update set value='true';`
- **Off:** set the flag to `false`. It takes effect on the next request.

## 11. Pre-activation checks (2026-10-14)
The owner made activation conditional on preparation, a privacy review and tests passing. These are separate from #232.

| Check | Result |
|---|---|
| Processing location | **Pass.** `lib/htafReviewAssist.js` has no `require`, network, AI or database code (enforced by a test). The routes make no outbound requests: the server tests record any request leaving the machine and found none. |
| Data minimisation | **Pass.** Only the columns in §4 are selected. Income, household size and notes are never read; a test proves the output is identical with and without them. The output contains no name, contact details, address, description or notes. |
| Access | **Pass.** The role matrix allows only `htaf_caseworker` and `super_admin`. Harvey Taxi roles, board, volunteer and no-role admins are refused before any read. A forged session or no sign-in gets 401. |
| Human decision | **Pass.** No status change, ride creation or message in any test path. Applications are byte-for-byte unchanged after runs and feedback. There is no decision vocabulary in the output. |
| Labelling and correction | **Pass.** The label is shown. In the browser test, "Wrong" removes the item and records fixed-choice feedback only; follow-up questions are copied to notes only when ticked. |
| Storage and retention | **Pass.** Suggestions are not stored. Audit entries hold no applicant details (tested). 12-month deletion is proposed and awaits the owner's decision; nothing personal is kept in the meantime. |
| Privacy notice | **No change required.** No new provider and no automated decision; §4 already covers "to review applications". An optional transparency sentence awaits counsel review (§8). |
| External AI triage | **Stays off.** Still locked, and never run in production. |
| Tests | 12 rule tests, 18 server tests, 1 browser test and the role matrix. Full suite: 2,169 passed, 0 failed, on the branch merged with current `main`. |
