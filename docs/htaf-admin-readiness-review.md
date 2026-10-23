# HTAF admin: production readiness review

**Date: 2026-10-23 (UTC). Review only: nothing was changed.** Requested by the owner: "I don't think HTAF admin is ready for live production" → "Readiness review first".

Labels: **[Verified]** (with how) · **[Recommendation]** · **[Unresolved]**.

## Verdict

**Not ready for routine live use by HTAF staff.** It is safe as it stands for the owner alone to view applications: access is locked down, and nothing it does moves money or rides. Before caseworkers use it, or before it is described to applicants, funders or partners as HTAF's operating system, the P0 items below need fixing.

The bigger gap is that it is an application-review tool only. The partner model the owner has described (partner portal, guardrails, several ride providers, exception alerts) is designed (`docs/htaf-ride-funding-design.md` §12) but none of it is built. That is expected; it waits on counsel, the board and a pilot.

## What is in place [Verified 2026-10-23, code and production database]

- **Access is locked down:**
  - Only the foundation domain serves the page (#325).
  - It requires admin sign-in, and every HTAF route also requires an HTAF role.
  - The only admin role in production is one `super_admin` (the owner).
  - Search engines are told not to index it.
- **Changes and exports are recorded:**
  - Every status change is written to the audit log (`htaf_application_updated`).
  - A CSV export needs a stated reason, and **the export is refused if its audit record can't be written**.
- **Nothing moves rides or money from here.** HTAF ride creation is switched off and needs a recorded approval to turn on. AI triage was removed. The review assistant gives suggestions only.
- **Alert emails carry no applicant details.** They send only the application code and a link.
- **Texting applicants is built:** it records consent and handles STOP/HELP (`sendHtafSms`, which checks consent before every text). Nothing sends status texts today.

## Applications today [Verified 2026-10-23, production counts only]

| Status | Program | Count | Submitted |
|---|---|---|---|
| Submitted (no decision yet) | Medical | 4 | 2026-07-06 to 2026-08-19 |
| Submitted (no decision yet) | Employment | 1 | 2026-08-05 |
| Denied | Medical | 1 | 2026-07-08 |

Five applications have waited 65–109 days without a decision. Nothing tells applicants about progress unless they look up their status by code. **[Unresolved]** Some of these may be the owner's own test submissions. The owner confirms which are real.

## Gaps, ranked

### P0: fix before HTAF staff use it live

| # | Gap | Why it matters | Fix (proposed) |
|---|---|---|---|
| 1 | **Applicants are never told about decisions.** "Request Additional Documents" says it will *send a document request to the applicant*, but it only changes the status and adds a note. Approvals and denials send nothing either. | Applicants wait without knowing. The button text is misleading. | Short term: correct the wording, and add a "contacted applicant" log (who, when, how). Then send consented status texts through the existing `sendHtafSms`, using wording the board or counsel approves. |
| 2 | **Technical and internal wording:** "HTAF Phase 11 Operations", "Server J", "Requires Server J admin authorization", "Verify … Server J route, and requireAdmin authorization". | Confusing for staff; looks unfinished. | Replace with plain HTAF wording. |
| 3 | **Actions that are switched off still show.** "Schedule Transportation: create an approved ride request" appears although ride creation is off. | Staff will think rides were booked. | Hide it unless the ride-creation gate is on. Otherwise show "Not available yet". |
| 4 | **No second sign-in step (MFA)** on admin accounts that can read applicant income, needs and contact details. | A stolen password exposes every applicant. | Add a one-time code at sign-in for HTAF roles, built switched off and turned on with approval. |
| 5 | **Test and real applications are mixed** in the live queue. | Wrong counts in reports and funder figures; risk of acting on a test. | Owner identifies the test records. Mark them as test, and exclude them from counts and exports (the public totals already exclude `example.test`). |
| 6 | **No retention period** for HTAF applications (`docs/data-retention-policy.md`: "to be set by the HTAF board"). | Applicant data kept indefinitely. | Board sets the period. A retention job follows, built switched off. |
| 7 | **No written denial process:** no reason codes, no applicant notice, no reconsideration path. | Fairness and consistency. A funder or regulator may ask. | Board adopts denial reasons and a reconsideration step. Then add a required reason code when denying. |

### P1: fix soon after

| # | Gap | Fix (proposed) |
|---|---|---|
| 8 | The queue search box can be autofilled by the browser (the owner saw "TN" hiding all records). | Add a visible "Clear" button and stronger autofill blocking, and show "filtered" when a search is active. |
| 9 | No caseworker assignment, and no age indicator ("waiting 109 days"). | Assigned-to and days-waiting columns, with oldest first by default. |
| 10 | The CSV export includes all detail fields for any HTAF role. | Owner-only export, a reduced default column set, and an export log visible in the admin. |
| 11 | HTAF data lives in Harvey Taxi Service LLC's database and hosting (`docs/htaf-separation-plan.md` steps 3–4). | Follow the separation plan: an HTAF-owned project, or at least HTAF-only database roles, under a written services agreement. |
| 12 | No guide for staff. | A one-page operating guide (statuses, what each button does, privacy rules). |

### P2: the target partner architecture (owner's plan, 2026-10-23)

| Element | Status | Note |
|---|---|---|
| Partner portal with guardrails (location lock, caps, hours, ceilings) | Designed (§12), not built | Waits on counsel, the board and the Phase B pilot on providers' own dashboards |
| Exception-only alerts to the Executive Director | Designed, not built | Payment alerts already exist for Harvey Taxi; the same pattern applies |
| Common trip format with one adapter per provider (Uber Health, Lyft Concierge, others) | Not built | A good fit for "open to every provider" (§12.10). Build only after a provider grants production API access. |
| OAuth token manager for provider APIs | Not built | Needed only with provider APIs (phase D) |
| Provider status updates through a queue (answer quickly, process after) | Not built | Harvey Taxi's Stripe webhook already uses claim-then-process; a queue can follow volume |
| One booking per click (idempotency keys) | Pattern exists | Harvey Taxi already sends idempotency keys to Stripe; the same approach applies to provider bookings |
| Addresses converted to exact map points before dispatch | Exists for Harvey Taxi | Mapbox geocoding (`lib/mapboxClient.js`) is reusable. The plan names Google Places; Mapbox already covers it. |
| Automatic "cheapest of Uber or Lyft" | **Not planned** | Uber's API terms prohibit price comparison (§12.4) |

### HIPAA readiness [Verified 2026-10-23, providers' official sites; counsel to confirm applicability]

Whether HTAF handles protected health information (PHI) at all depends on counsel's answer (brief §F, question 25). It may if clinics refer clients or if trips reveal treatment. If it does, today's setup is **not HIPAA-ready**, and each fix below is a **paid upgrade needing the owner's approval**:

- **Supabase (database):**
  - Requires the Team plan, which the pricing page lists at $599/month, plus a paid HIPAA add-on (price not published) and a signed BAA.
  - Projects must then be set to "High Compliance". Point-in-time recovery needs at least a small compute add-on.
  - Sources: [HIPAA Projects](https://supabase.com/docs/guides/platform/hipaa-projects), [Shared Responsibility Model](https://supabase.com/docs/guides/deployment/shared-responsibility-model), [Pricing](https://supabase.com/pricing).
- **Render (hosting):**
  - Requires a Scale or Enterprise plan and a HIPAA-enabled workspace. Enabling it is **irreversible**, adds a 20% usage fee, and briefly redeploys services.
  - Service logs and build artifacts must never contain PHI.
  - Source: [HIPAA on Render](https://render.com/docs/hipaa-compliance).
- **SendGrid (email): not HIPAA-eligible.** Twilio will not sign a BAA for it. HTAF alert emails already carry no applicant details and must stay that way. Source: [Is SendGrid HIPAA Compliant?](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/hipaa-compliant).
- **Twilio SMS:** HIPAA-eligible only on a HIPAA account (Security or Enterprise Edition) with a signed BAA. Source: [HIPAA Accounts](https://www.twilio.com/docs/iam/twilio-editions/hippa).
- **Encryption:** the plan's claims (AES-256 at rest, TLS 1.3 in transit) were not verified for our current setup; the database's own docs are the reference.

**[Recommendation]** Keep medical details out of HTAF records until counsel answers. An application should record the program ("Medical") and a destination address, never a diagnosis or a clinic specialty. The current form asks for a "transportation need" in free text; its guidance should tell applicants not to include medical details.

## Recommended order

1. **Quick fixes PR** (P0 items 2, 3 and 8, the wording part of item 1, and labelling test records once the owner identifies them). Small and low risk; one approval.
2. **Applicant updates and MFA** (P0 items 1 and 4). Built switched off; notification wording approved first.
3. **Board decisions** (P0 items 6 and 7): retention period, denial reasons and reconsideration. Then the matching features.
4. **Separation and P1 items** (9–12).
5. **Partner architecture** (P2) after counsel, the board and the Phase B pilot. HIPAA upgrades only if counsel says PHI is involved.

Until step 1 is merged: **[Recommendation]** only the owner uses the HTAF admin, as today. No caseworker accounts are created.
