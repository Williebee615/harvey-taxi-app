# HTAF Assistant

Harvey Transportation Assistance Foundation's own help assistant, on harveytransportationfoundation.com (home, application and contact pages). It is separate from the Harvey Taxi assistant: its own knowledge, wording, widget, routes, switch and records.

## What it answers
It answers only from HTAF's published pages: the home page, application, contact, privacy policy, terms and service providers.
- **Common questions** (programs, who can apply, how to apply, documents, guarantee, service area, relationship to Harvey Taxi, nonprofit status, contact): it uses sentences copied word for word from those pages (`lib/htafAssistant.js` `TOPICS`).
  - At startup each sentence is checked against the live page.
  - If a page no longer contains a sentence, that topic is dropped rather than answered from a stale copy. The admin list shows dropped topics.
- **Other questions:** it quotes the best-matching section of those pages, using the same search engine as the Harvey Taxi assistant but with an HTAF-only index.
- **Never quoted:** draft labels ("pending counsel review") and page furniture.

## What it never does
- **Eligibility:** it never decides, predicts or promises eligibility, approval or funding.
  - "Am I eligible?" gets the no-guarantee text and a referral to HTAF review.
  - Unpublished rules (income limits, ride limits, timelines, costs) are gaps.
- **Actions:** it takes none. It can't book rides, send texts, change or withdraw applications, or make funding or approval decisions.
- **Applicant records:** it reads none.
  - HTAF has no applicant sign-in and no online status check. Status questions get the contact page's own wording (email or call HTAF with the application code).
  - A Harvey Taxi rider session is not accepted as HTAF identity.
- **No model:** no Claude or other model is called, so there is no per-question cost.

## Records
- **Unanswered questions:** a redacted excerpt only, with no IP and no identity, goes to `htaf_assistant_questions`.
  - Emails, phone numbers, card and long numbers, SSN-like numbers and HTAF application codes are removed.
  - Staff see the list in the HTAF admin page, under "HTAF Assistant: unanswered questions" (`GET /api/admin/htaf/assistant-questions`, admin only).
- **Answered questions:** not stored.
- **Conversations:** kept in the visitor's page only, never stored.

## Turning it on
1. Apply migration `20261005130000_htaf_assistant_questions.sql`.
2. Deploy.
3. Set the system flag `htaf_assist_enabled` to `true`. While off, the widget doesn't render.

## Limits
- 20 questions per minute per IP.
- 60 per visitor and 5,000 in total per UTC day (in memory).

## Adding an approved answer
Publish the text on an HTAF page (with the owner's approval). The assistant picks it up on the next deploy. A new common-question topic is added in `TOPICS`, quoting the published sentences exactly; a test checks they match the page.

## Approved programs (owner confirmed 2026-10-05)
The approved programs are Medical Transportation, Employment Access, Education Access, Senior Mobility, Disability Transportation and Veteran Transportation.
- The foundation page, the application form's choices and the assistant all use this list; a test keeps them aligned.
- "Community Assistance" is no longer offered on the form.
