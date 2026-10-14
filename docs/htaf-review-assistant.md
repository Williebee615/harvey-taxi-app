# HTAF review assistant (application triage)

Prepared 2026-10-13 at the owner's request. **Off in production.** Turning it on needs the owner's separate approval.

## 1. What existed before: "AI triage" sent data to OpenAI
The existing `POST /api/admin/foundation/applications/:id/triage` route is **not internal**. It sends a reduced set of facts about the application to **OpenAI** (`openai.chat.completions.create`, model `OPENAI_MODEL`). Those facts are:
- status, program type and applicant type;
- service-area true/false values;
- ride date;
- how detailed the trip description is;
- whether staff notes exist;
- submission time.

That route stays locked behind `HTAF_AI_TRIAGE_ENABLED` plus a recorded privacy review and approval (`lib/htafActivation.js`). It is off.

**[Verified 2026-10-13, production audit log]** It has never run: there are no `htaf_application_ai_triaged` or `htaf_ai_triage_blocked` entries. No application data has been sent to OpenAI.

This PR does not use it. Staff now see the internal review assistant instead. Whether to delete the OpenAI route is an open decision (§9).

## 2. What this PR adds: an internal review assistant
- **Code:**
  - `lib/htafReviewAssist.js` (the rules);
  - `POST /api/admin/foundation/applications/:id/review-assist`;
  - `POST /api/admin/foundation/applications/:id/review-assist/feedback`;
  - the "Review Assistant" panel in `admin-htaf.html`.
- **How it works:** fixed rules running on HTAF's own server. There is **no AI model, no network call and no third-party provider**: nothing about an application leaves the server.
- **What staff get:**
  - **Summary:** program category, who is applying (self or on someone's behalf), ride date, county, whether a trip description exists, status and how long ago it was received.
  - **Missing-information checks:** name, contact details, county, pickup city, destination, ride date, trip description, program.
  - **Items to check:**
    - county not a recognised Tennessee county (it may be misspelled);
    - ride date already passed;
    - very short trip description;
    - possible duplicate: another application with the same email or phone, shown by application code, status and date only.
  - **Suggested follow-up questions** for each gap, in neutral wording.

## 3. Data flow
```
Staff (HTAF role) clicks "Review Assistant"
  → server checks: signed in as admin, HTAF capability (htaf.applications.triage), feature flag on
  → reads ONE application, only the columns in §4
  → reads other applications with the same email/phone: id, code, status, dates only
  → rules run in memory on the server (lib/htafReviewAssist.js)
  → returns summary, checks, questions to the staff member's browser
  → audit log: who ran it, application id, rule version, which checks fired (no applicant details)
Nothing is written to the application. Nothing is sent outside HTAF's server.
```

## 4. Fields read
| Field | Used for |
|---|---|
| first_name, last_name | whether they are filled in (never shown) |
| email, phone | whether filled in; server-side lookup of other applications with the same value (never shown) |
| county | checked against Tennessee's 95 counties; shown in the summary when recognised |
| pickup_city, destination | whether filled in (never shown) |
| ride_date | missing, past, and the date shown |
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
  - "Wrong" or "Not needed" on any item hides it and records the feedback (fixed choices only, no free text);
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
- **Current HTAF privacy notice:**
  - §4 says information is used "to review applications and determine eligibility";
  - §6 lists service providers (database, website hosting, email, fonts, donations, transportation providers).
- **This assistant:**
  - adds no new service provider and sends no data outside HTAF;
  - makes no automated decision;
  - is a staff tool for reviewing applications, which §4 already covers.
- **[Recommendation]** An update is not strictly required, but a transparency sentence is advisable. Proposed for §4, for counsel review, and **not changed in this PR**:
  > "HTAF staff may use automated checks within HTAF's own systems to summarize an application and identify missing information. These checks do not make decisions; a person reviews and decides every application."
- **If the external OpenAI triage were ever turned on,** the notice **would** need updating, because it would add an AI service provider to §6, and counsel review would be needed. That route stays off.

## 9. Open decisions (owner)
1. Turn the review assistant on in production (set the system flag `htaf_review_assist_enabled` to `true`). It stays off until approved.
2. Approve the 12-month retention for review-assistant audit entries, and whether to schedule the deletion.
3. Approve, edit or decline the privacy-notice sentence in §8 (counsel review).
4. Remove the unused external OpenAI triage route, or keep it locked.
5. The old triage treated only Nashville or Davidson as "in service area". HTAF's published service area is Tennessee statewide, and the new rules use all 95 counties. Confirm that statewide is correct.

## 10. Turning it on and off
- **On (owner approval):** `insert into system_flags (key, value) values ('htaf_review_assist_enabled','true') on conflict (key) do update set value='true';`
- **Off:** set the flag to `false`. It takes effect on the next request.
