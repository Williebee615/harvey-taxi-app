# Harvey Taxi platform: project status (shared record)

**Last updated: 2026-10-14 (UTC)** by Claude Code (session `session_01NLS9NQfpaLwc6iu7ve7HfQ`).

App records: [Harvey Taxi Mobile (rider)](harvey-taxi-mobile-status.md) · [Harvey Taxi Driver](harvey-taxi-driver-status.md).

## How to read and maintain this record

Every statement carries one of these labels:

| Label | Meaning |
|---|---|
| **[Verified]** | Checked directly (Git, CI, production endpoint, store screenshot from the owner, EAS) on the date shown |
| **[Owner decision]** | Decided or approved by the owner (Willie Harvey IV), with the date and exact scope |
| **[Recommendation]** | Claude's recommendation; not approved |
| **[Unresolved]** | Open question or unconfirmed claim |

Rules for every update:
- Date each update, and update this file and the app files after every meaningful change.
- "Tests passed" is not "deployed". "Built" is not "uploaded". "Uploaded" is not "released".
- Record credential **names and where they are stored** only. Never record tokens, passwords, private keys or review-account credentials.
- End every session with the handoff section at the bottom: completed work, remaining work, and the next authorized action.

## 1. What is live in production

| Item | Status |
|---|---|
| `main` | `6bae686` (#241) **[Verified 2026-10-14, Git]**. **Production runs `6bae686`** **[Verified 2026-10-14 02:03 UTC, `/api/health` `version`]**. See §9. |
| Production web/API (Render, harveytaxiservice.com) | Website files from #224–#227 are live: the changed pages are byte-identical to their merge commits, the last being `5b24bad` (#226) **[Verified 2026-10-13]**. **#221 (`3cd8763`):** **Deployed, owner-confirmed by Render screenshot (2026-10-13)**: Render's deploy list shows `3cd8763` as the current live deploy (auto-deploy, 47.3 s). Production now runs `3cd8763`. Public pages and `/api/health` returned 200 after the merge **[Verified 2026-10-13, about 16:38 UTC]**. |
| Database | Supabase project `harvey-taxi-app` (`orgahzncmzptljapqffj`). The Pro/Micro upgrade was approved 2026-10-04, but **whether it was applied is [Unresolved]**. The owner is handling the billing decision separately. The staging project `harvey-taxi-staging-pr130` stays intact. |

### Production switches (as last recorded; recheck before relying on them)

| Switch | State | Basis |
|---|---|---|
| Harvey Assistant (`agent_assist_enabled`) | On | Merged and enabled with #179 (2026-10-04) |
| Claude model answers | Synthetic and review accounts only; $10/month cap enforced on the server; public access off | **[Owner decision 2026-10-04, 2026-10-09]** |
| Review **driver** account | Removed from the model test list, so it gets rules-based answers | **[Owner decision 2026-10-10]**, done that day |
| Specialists | 5 non-HTAF specialists for review accounts only; HTAF specialist off | **[Owner decision 2026-10-09]** |
| Cancellations | Free ($0, enforced in the database); no-show button off | **[Owner decision 2026-10-04]** |
| HTAF SMS sending, HTAF assistant, reviewer demos | Off | **[Owner decision]**, repeated 2026-10-08 |
| HTAF ride creation and external AI triage | Blocked by default (#205) | Merged 2026-10-08 |
| Payment automation, refunds, reconciliation, hold sweeps | Off | **[Owner decision 2026-10-09]** |
| Offer-time verification recheck (#221) | Merged and deployed as `3cd8763`, owner-confirmed by Render screenshot (2026-10-13) | **[Owner decision 2026-10-13]** |
| Harvey Assistant answer mode | Rules-only (no Claude, no OpenAI) | **[Owner decision 2026-10-12, repeated 2026-10-13]** |
| Driver verification gate | `ENABLE_CHECKR` = on, `ENABLE_PERSONA` = on in production | **[Verified 2026-10-11]** via the public `/api/config/public` (`checkr_enabled`, `persona_enabled`), read only, nothing changed |
| Admin pages | `admin-home.html` approves through `PATCH /api/admin/drivers/:id/approve`; `/admin` and `/admin.html` redirect (301) to `admin-dashboard.html`; admin APIs return 401 without a session | **[Owner decision 2026-10-11]** #220 approved; merged as `8bee024`; **[Verified 2026-10-11]** live by HTTP checks |
| Old website chat endpoint `/api/ai/support` (OpenAI) | Enabled state **[Unresolved]**. It is not exposed publicly. Confirm via admin `/api/health` → `integrations.openai`, or `OPENAI_API_KEY` on Render. | Checked 2026-10-10 |

## 2. Pull requests

As recorded on 2026-10-11 **[Verified 2026-10-11, GitHub]**. Since then, #212, #214, #215 and #219 were folded into #223 (merged 2026-10-12), and #220–#227 are merged. See §6 for the dated updates.

### Stack A: assistant and rider chat (merge order #212 → #210 → #214 → #215)

| PR | Content | Base | CI on current head | Needs |
|---|---|---|---|---|
| #212 | Assistant panel styling to match the rider pages and the driver app | main | Green **[Verified 2026-10-10]** | Owner approval |
| #210 | Explicit AI consent (riders and drivers), driver AI label, separate specialist list. **Includes a DB migration** (`agent_ai_consents`). | #212 | Green **[Verified 2026-10-10]** | Owner approval for merge, migration and deploy. The driver part needs a driver build. |
| #214 | Index page: shared Harvey Assistant; Assistant tab on phones | #212 | Green **[Verified 2026-10-10]** | Owner approval |
| #215 | Rider sign-up and Settings: Harvey Assistant replaces the old OpenAI widget; Settings width fix | #214 | Green **[Verified 2026-10-10]** | Owner approval |

Combined local run of #212 + #210 + #214 + #215: 34/34 browser tests passed with none skipped, and 1,806 unit tests passed. **[Verified 2026-10-10]** This is not a deployment.

### Stack B: markets and Africa payments (merge order #213 → #216 → #217)

| PR | Content | Base | CI on current head | Needs |
|---|---|---|---|---|
| #213 | Markets: Nashville unchanged; Harare, Lagos and Accra in simulated test mode; `market_id` migration written, **not applied** | main | Green **[Verified 2026-10-10]** | Owner approval |
| #216 | Zimbabwe in-app EcoCash marketplace design and sandbox; commission configurable and unset | #213 | Green on `01b7ae5`. Head `b5b7d9b` (doc change, 2026-10-11) not yet re-checked. | Provider confirmation, then owner approval |
| #217 | Cash trips with a driver commission ledger (sandbox): dispute safeguards, audited admin override, in-app exclusion only when verified | #216 | Green on `ba87578`. Head `ac9cd65` (2026-10-11) not yet re-checked; it passed the unit suite and browser tests locally. | Owner approval |

### Other open PRs

| PR | Status |
|---|---|
| #219 | Old website chat `/api/ai/support`: no OpenAI call unless the flag `legacy_ai_support_enabled` = true (off by default). CI pending; 3 new tests pass; unit suite 1,799 passed. Part of the rider consent fix; needs owner approval. |
| #207 | Draft privacy policy (Harvey Assistant AI section). **Do not merge or publish**; it awaits the owner's Anthropic Console checks and wording approval. |
| #209 | Driver listing materials for build 1.0.0 (13); ready for review |
| #203 | Driver build-candidate CI check only; **keep unmerged** (owner, 2026-10-08) |
| #192 | Cancellation policy and fee proposal; **keep as draft**, do not publish |
| #166 | Data Collection program; on hold (owner, 2026-10-08) |
| #156 | Operations assistant; on hold (owner, 2026-10-08) |

## 3. Owner approvals and their exact scope (recent, still relevant)

| Date (UTC) | Approval | Scope limits |
|---|---|---|
| 2026-10-04 | Claude Haiku for both apps, **$10/month total cap** | Synthetic/test accounts first; no automatic credit reloads; public access needs the privacy disclosure approved |
| 2026-10-04 | Supabase Pro + Micro compute | Applied state [Unresolved]; owner handling billing separately |
| 2026-10-09 | Step A (specialist scope, AI label) and Step B (5 non-HTAF specialists for review accounts) | Non-review native drivers stay rules-based until their app shows the AI label; HTAF, payment automation, SMS and public submissions on hold |
| 2026-10-10 | Rider iOS bundle fix (#208), merged | Public rider destination: Apple ID 6761548295, bundle `com.harveytaxi.HarveyTaxi` |
| 2026-10-10 | Rider iOS cloud build on 1 November | Free allowance only; no paid upgrade; no upload or submission without approval |
| 2026-10-10 | Remove only the review driver from the AI model test list | Rider settings unchanged |
| 2026-10-10 | Merge and deploy #211 (rider layout) | Only #211; done and live |
| 2026-10-10 | Release direction: next driver iOS build carries AI consent and labeling; **never submit build 13** | Does not approve merging #210/#207, deploying, publishing or building |
| 2026-10-11 | #217 safeguards (disputes, override, verified exclusion); 15% labelled as a demonstration rate | No merges, deployments or builds |
| 2026-10-11 | **Submit Harvey Taxi Driver 1.0 with build 1.0.0 (13) for Apple review** (supersedes "never submit build 13") | Manual release stays selected; build 13 rules-based with no third-party AI; no new build, paid upgrade, public release or African-market activation |

Standing rules **[Owner decision]**:
- Keep keys and passwords out of chat and GitHub.
- No paid upgrades without approval.
- Use test data only.
- Keep untested device flows marked unverified.
- No Twilio submission.
- Public store releases on hold.
- Every merge needs explicit approval.
- Use mocked or clearly identified test paths for safety testing.

## 4. Shared platform areas

| Area | Status |
|---|---|
| **Backend** | One Node/Express server (`server.js`) and one Supabase database serve both apps and the website. |
| **AI consent** | Not live. #210 (draft) adds the "Allow AI answers?" notice and stored consent. Riders get it by deploying the website; drivers need a new driver build. Until then the server gives no model answers to any driver build. **[Verified behaviour on main: build 1.0.0 (13) can never get a model answer]** |
| **Privacy** | The AI section is drafted in #207. It is unpublished and awaits the owner's checks of Anthropic retention and training settings for the actual account. **Do not publish** "Anthropic does not keep this information" unless the terms support it. |
| **Payments (US)** | Stripe card payments; cancellations $0; unchanged by every Africa PR. |
| **Payments (Africa)** | Everything is disabled. In-app EcoCash marketplace model (#216): **not confirmed** by Paynow or EcoCash. Cash with driver commission ledger (#217): sandbox only. Provider eligibility, fees and tax are **[Unresolved]** until current official sources or written advice support them. |
| **Market settings** | `lib/markets.js` in #213 (not merged). The US/Nashville record is kept separate and unchanged. |

### Africa readiness (all test mode; nothing live) **[Verified in code on the PR branches, 2026-10-11]**

| Market | Pilot city | Payments | Commission | Live approval |
|---|---|---|---|---|
| Zimbabwe | Harare | In-app EcoCash (disabled, model unconfirmed); cash plus commission ledger (disabled, sandbox) | Not set | No |
| Nigeria | Lagos | Provider not chosen; cash ledger configurable, disabled | Not set | No |
| Ghana | Accra | Provider not chosen; cash ledger configurable, disabled | Not set | No |
| United States | Nashville | Stripe card (live), unchanged | Existing pricing | Live |

Readiness checklists: `docs/markets/zimbabwe.md`, `nigeria.md`, `ghana.md`, `zimbabwe-payments.md`, `cash-commission.md`.

Key blockers:
- Permission to operate (the Zimbabwe moratorium is not permission).
- Dispatch by market is not built.
- The `market_id` migration is not applied.
- Provider confirmations and tax advice.
- Local emergency numbers to confirm.
- Data-protection registrations.

## 5. Costs (current and pending)

| Item | Cost | Status |
|---|---|---|
| Anthropic Claude API | At most $10/month, enforced on the server | Approved |
| EAS builds | Free plan, $0. 15 iOS and 15 Android builds a month; resets 1 November 00:00 UTC. | **[Verified 2026-10-10]** iOS 15/15 used; Android 12/15 used |
| Supabase | Estimated $25–35/month on Pro + Micro (staging adds about $10) | Applied state [Unresolved] |
| Paynow / EcoCash / Paystack | Reported percentages only (for example 2.5%) | **[Unresolved]**; nothing contracted |

## 6. Decisions needed from the owner

**Before submitting Harvey Taxi Driver 1.0 (13)** **[Owner decision 2026-10-11]**: rider AI stays on for reviewers. Instead, consent on the rider website must be fixed for everyone first. The package awaiting approval:
- #212 + #210: merge, `agent_ai_consents` migration, deploy;
- #219 (old OpenAI chat off);
- the #207 privacy section, published with only confirmed statements.

#214/#215 are recommended but not required for consent.

1. Approve merging Stack A (#212 → #210 → #214 → #215), including #210's migration and deploy.
2. Privacy policy (#207): complete the Anthropic Console checks and approve the wording before publication and any public AI.
3. Approve Stack B (#213 → #216 → #217) for merge as test-mode code only, or keep it as drafts.
4. Africa: send written questions to Paynow and EcoCash. Set commission rates, unpaid limits and dispute allowances per market. Decide cash approval per market.
5. Driver iOS build with AI consent (after #210): approve the build in the 1 November allowance.
6. Old `/api/ai/support` endpoint: confirm its status; decide whether to turn it off or delete it after #214/#215.
7. Supabase plan and staging project decision.
8. **Driver account cleanup (27 approved, unverified, non-review accounts)** **[Verified 2026-10-11, read-only production queries]**. Production has both checks on; none of the 27 can go online. No record has rides, offers, sign-in sessions, Checkr/Persona IDs, recorded terms or background-check consent. One owner record shows Checkr "clear" with no Checkr candidate or report ID on file, so it isn't evidence of a completed check **[Unresolved]**. Sign-up still allows duplicates (no email or phone check, no unique index) **[Verified in code 2026-10-11]**.
   **[Owner decision 2026-10-11]** Prepare the cleanup: choose the record kept for each person by verified information and completeness, not simply the newest; deactivate duplicates; preserve history.
   **[Recommendation, prepared, not run]** 9 kept records return to pending verification (8 applicants: earliest record kept because their records are identical on every measure; owner: the most verified record). 15 duplicates and 2 test accounts are deactivated, nothing is deleted, and each change writes an audit row. The owner's second-email record is left for the owner to decide. The SQL is held outside the repository because it lists personal records. It was dry-run on a disposable local database (9 / 15 / 2, 26 audit rows; a second run is blocked by its guard). It needs owner approval to run on production.
9. **Offer-time verification recheck:** PR #221 is **merged** as `3cd8763` (2026-10-13, owner-approved). It is **deployed, owner-confirmed by Render screenshot (2026-10-13)**. Offers, acceptance and admin assignment re-check verification; dispatch fails closed; trips under way are untouched. Details in the 2026-10-13 updates below.
10. **Privacy policy (#207) providers** **[Verified 2026-10-11, code and live page scan]**: the draft didn't name Google Analytics (G-814LXYV9DN) or Google Ads (AW-18161547185), whose tags are live on the home and Settings pages; Google Maps Platform (Routes API, used when `GOOGLE_ROUTES_API_KEY` is set; production value **[Unresolved]**); Google Fonts; browser push services; or Render and Supabase by name. Added to the draft (`c85d78b`). **[Unresolved, legal]** Whether the Google Ads tag is consistent with "We do not sell personal information" (sharing for advertising) and whether a cookie notice is needed.


**2026-10-12 updates**
- **[Owner decision 2026-10-12]** Keep `ENABLE_CHECKR` and `ENABLE_PERSONA` on. No change made.
- **[Owner decision 2026-10-12]** Remove the review rider from `agent_model_test_accounts` until consent ships, keeping standard answers and the ride workflow. **[Unresolved]** Not yet applied: the Supabase connector failed (503) before the write; nothing was written. Effect once applied (checked with the server's own policy code): the reviewer gets no Claude answers and no specialists, and gets the standard rules-based assistant every rider has. The ride workflow does not depend on the assistant.
- **[Owner decision 2026-10-12]** Don't run the cleanup SQL. Leave the willieharvey735@yahoo.com record untouched (it is excluded from the script).
- **[Verified 2026-10-12, `docs/production-incidents.md` 2026-07-30, code review]** DRV-85708D8A35's Checkr "clear" was written by a one-off direct Supabase update during the July 30 smoke test, as a "one-time testing exception". No Checkr check ran. The Checkr webhook can't have set it (it matches on `checkr_candidate_id`, which is empty), and no audited override exists. **It must not be treated as verified.** **[Recommendation]** Reset it to `not_started` through the audited compliance override, with owner approval.
- **[Owner decision 2026-10-12]** #207 stays unpublished until actual provider use and advertising data flows are confirmed. A Google Ads tag alone doesn't settle whether data is sold or shared.
- AI setup audit: [ai-setup-audit.md](ai-setup-audit.md).

**2026-10-12 later updates**
- **[Verified 2026-10-12, owner-provided IRS Letter 947 dated 2026-04-15]** HTAF, EIN 41-5115030: 501(c)(3), effective 2026-04-10; public charity under 170(b)(1)(A)(vi); contributions deductible; Form 990 filing required.
- PR #222 (draft): website accuracy fixes, waitlists, admin noindex, broken-link fixes, `docs/htaf-separation-plan.md` and `docs/legal/terms-privacy-reconciliation.md`. Full suite 1,989 passed. Needs owner approval.
- **[Verified 2026-10-12]** Production returns 404 for `delete-account.html` (linked from the home page), `manifest.json`, the icons and the share image. Fixed in #222.
- **[Verified 2026-10-12]** Two Harvey Taxi privacy policies are live: `/privacy.html` (footer) and `/privacy-policy.html` (driver app, store listing, #207). `robots.txt` blocks the latter. **[Recommendation]** Single policy after #207.
- **[Owner decision 2026-10-12]** Airport service is available through Harvey Taxi Service (owner-confirmed). #222 lists "Airport trips: Available. Request an airport trip the same way as any other ride." **[Unresolved, outstanding item]** Permit or agreement documentation and its scope. Until it is documented, no airport name, pickup location or permit coverage is claimed.
- #222 follow-ups (2026-10-12):
  - hero and footer copy describe today's service;
  - the welcome note sits in the page and closes after 4 s;
  - on phones the assistant button is docked in the bottom bar;
  - service cards are tighter;
  - the old chat widget no longer offers "autonomous pilot".
  Tested with Larger Text on at 360 and 390 px. Full suite 1,999 passed.
- **[Verified 2026-10-12, owner screenshot]** The staging project `harvey-taxi-staging-pr130` was restored by the owner and is online. Not used by this session.
- **[Owner decision 2026-10-12]** #223 authorized to merge and deploy once checks pass. It replaces the old OpenAI chat with Harvey Assistant on the home page, rider sign-up, Settings and the admin dashboard, and supersedes #212/#214/#215/#219.
  - **[Verified 2026-10-12]** All 6 checks passed on `b11f058`. Merged as `252d8d4`; Render deployed within about 75 s.
  - Production checks: the 5 pages load `agent-assist.js` once and no old-widget tag; `ai-support-widget.js` and `.css` return 404; `/api/agent/status` reports `answer_mode: "rules_only"`; checked pages and `agent-assist.js` are byte-identical to `252d8d4`. 229 review-account, driver-app, handoff and assistant tests pass on the deployed commit.
  - **External AI answers are locked off for everyone, test and review accounts included**, until `AGENT_MODEL_CONSENT_READY=true` is set on Render when #210 ships.
- **[Verified 2026-10-12, code and docs]** Supabase project `harvey-taxi-staging-pr130` (`yryfdobxhvklanmbotfu`) was created 2026-09-28 only to test PR #130's migrations (merged). Nothing in the server, CI or app configs uses it. **[Recommendation]** Safe to delete; the owner deletes it in the Supabase dashboard.
- **[Owner decision 2026-10-12]** #222 approved to merge and deploy (this approval covers #222 only). Harvey Assistant stays rules-only; Claude stays off and the old OpenAI chat stays removed without owner approval. Staging deletion is kept separate and not done. The owner is testing the live rider and driver sign-ins.
  - **[Verified 2026-10-12]** All 6 checks passed on `53cac53`. Squash-merged as `9bb286c`; Render deployed within about 90 s.
  - Production checks: 10 pages and `agent-assist.js` byte-identical to `9bb286c`; 3 waitlist buttons are `mailto:support@…` with subjects; airport line "Available. Request an airport trip the same way as any other ride."; HTAF links and `settings.html#account-deletion` return 200; all 24 internal links on 16 public pages resolve; manifest, icons and share image return 200; admin pages send `X-Robots-Tag: noindex`; admin data returns 401 without sign-in; `/api/agent/status` reports `rules_only`.
  - 229 review-flow, site, assistant, admin-protection and handoff tests pass on `9bb286c`.
- **[Unresolved]** The Supabase connector failed (503) on 2026-10-12. The approved removal of the review rider from the AI test list is not yet applied.

**2026-10-13 updates**
- **#224 Rider dashboard "Home"** goes to the site home page on the website; inside the rider app, the dashboard stays home.
  - **[Owner decision 2026-10-13]** Approved.
  - **[Verified 2026-10-13]** All 6 checks passed on `f090487`. Squash-merged as `5ece5a5`. The live `rider-dashboard.html` is byte-identical to `5ece5a5`.
  - **[Unresolved]** The owner's check of the live sign-in screen on a phone.
- **#225 Languages:**
  - owner wording for the home-page Languages section, and tiles that switch the language;
  - one language preference (`harvey_language`, stored in the browser), set in Settings and followed by the home page, Settings and both sign-up pages; English where a page lacks the translation;
  - "Open AI Support" renamed "Open Harvey Assistant".
  - **[Owner decision 2026-10-13]** Approved to merge once checks pass. The rename was added after the approval and before the merge, and the owner was told.
  - **[Verified 2026-10-13]** All 6 checks passed on `842d509`. Squash-merged as `10c3ec3`. 6 changed files are byte-identical live.
- **#227 Rider pages cleanup:**
  - Settings "Ask AI Support", "AI Support" and "Open AI" renamed Harvey Assistant (en/es/fr/ar);
  - the Driver tab and driver-dashboard links removed from the home page, Settings and rider dashboard (driver sign-up, account deletion and every page the Driver app opens are kept);
  - Settings bottom-bar labels wrap instead of being cut off;
  - translation gaps filled on Settings (es/fr/ar) and in the home-page notice, app card and bottom bar (10 languages). "DELETE" stays literal.
  - **[Owner decision 2026-10-13]** Approved.
  - **[Verified 2026-10-13]** All 6 checks passed on `639e1fb`. Squash-merged as `3db813a`. `index.html`, `settings.html` and `rider-dashboard.html` are byte-identical live. The 6 pages the Driver app opens return 200.
  - **[Verified, by design]** Most of the home-page body has no translations and stays English. The Settings activity log stays English.
- **#226 HTAF "Partner With Us"** section and HTAF contact form (`POST /api/foundation/inquiry`):
  - emailed to HTAF's inbox, with HTAF as the sender name and the visitor as reply-to;
  - nothing stored; the audit log keeps the topic and outcome only;
  - fails closed;
  - a sentence added to the HTAF privacy policy.
  - **[Owner decision 2026-10-13]** Approved.
  - **[Verified 2026-10-13]** All 6 checks passed on `a23b5c2`. Combined with #227, the full suite passed (2,089). Squash-merged as `5b24bad`.
  - **[Verified 2026-10-13]** Live checks through harveytaxiservice.com: `foundation.html` and `contact.html` are byte-identical. The inquiry route is live: an incomplete submission returned 400 with per-field messages and sent nothing.
  - **[Unresolved]** `harveytransportationfoundation.com` couldn't be fetched from this environment (blocked by the network policy). The owner views the page.
  - **[Unresolved]** Production email delivery. It depends on `SENDGRID_API_KEY`, `ENABLE_REAL_EMAIL`, and `HTAF_INQUIRY_EMAIL` or `HTAF_ADMIN_EMAIL` (Render environment; names only). The owner sends one labelled test inquiry and confirms receipt.
  - **[Unresolved]** The sender address is the existing Harvey Taxi SendGrid sender (HTAF display name). An HTAF-domain sender is part of `docs/htaf-separation-plan.md`.
- **#221 Offer-time verification recheck:**
  - Brought up to date with `main` twice (`b0b2637`, `161e388`), with no conflicting lines. The full suite passed locally (2,095).
  - **[Owner decision 2026-10-13]** Approved.
  - **[Verified 2026-10-13]** All 6 checks passed on `161e388`. Squash-merged as `3cd8763` at about 16:29 UTC.
  - **Deployed, owner-confirmed by Render screenshot (2026-10-13)**: Render's deploy list shows `3cd8763` as the current live deploy (auto-deploy, 47.3 s).
  - **[Verified 2026-10-13, read-only]** After the merge: public pages and `/api/health` return 200; `checkr_enabled` and `persona_enabled` are true; `DRIVER_GPLAY_REVIEWER` passes readiness (email and phone verified, Persona `verified`, Checkr `clear`, approved, vehicle on file).
  - **[Unresolved, owner]** Review ride check with the test accounts only.
- **#228 HTAF application page dashboard:** the four cards (submitted, pending review, approved, scheduled) now read `GET /api/foundation/public-stats` (counts only, from `htaf_applications`), so status changes in the HTAF admin portal show there. Previously they counted only this browser's submissions. If the totals can't be read, the cards show "—".
  - **[Owner decision 2026-10-13]** Approved.
  - **[Verified 2026-10-13]** All 6 checks passed on `1266a7d`. Squash-merged as `25d2b36`. The live `htaf-application.html` is byte-identical. **Deployed, owner-confirmed by Render screenshot (2026-10-13)**: Render shows `25d2b36` as the current live deploy (auto-deploy, 47.7 s).
  - **[Verified 2026-10-13]** `/api/foundation/public-stats` returns 6 submitted, 6 pending review, 0 approved, 0 scheduled.
  - **[Verified 2026-10-13, owner screenshots ~19:29 UTC]** The HTAF admin portal (`admin-htaf.html`) loads from `/api/admin/foundation/applications` with admin sign-in: "Connected. 6 HTAF applications loaded"; cards show 6 total, 6 new, 0 approved, 0 pending documents, matching the public application-page counts. Two of the six appear to be the same applicant submitting twice on 2026-08-19 (two different codes); left for HTAF to review.
  - **[Unresolved, owner]** All 6 applications (received 2026-07-06 to 2026-08-19) are still "submitted". Whether any are tests, and their review, are for HTAF in the admin portal.
- **#229 Languages (HTAF pages + five African languages):** one shared list of 15 languages (`public/language-pref.js`) drives every selector: Harvey Taxi home, Settings, and the HTAF home, application and contact pages.
  - Added: Hausa and Igbo (Nigeria, with Yoruba), chiShona and isiNdebele (Zimbabwe), Twi/Akan (Ghana). "Chinese" is labelled Simplified (`zh-Hans`) and Portuguese is labelled Brazil (`pt-BR`); Traditional Chinese and European Portuguese are not offered.
  - **[Owner decision pending]** Ga and Ewe deferred (Twi covers the Accra pilot); isiZulu, isiXhosa and Afrikaans not added (South Africa is not a planned market).
  - HTAF pages: 242 strings × 14 languages. SMS consent and certification stay English, with a translated summary. Five strings stay English by design: "Privacy Policy", "and", "Terms of Use" (inside the English consent), "Leave this empty" (hidden spam-trap label), "Tennessee".
  - `?lang=xx` sets the preference; unsupported codes fall back to English; links between harveytaxiservice.com and harveytransportationfoundation.com carry `lang=` and keep their other parameters and anchors. Arabic is right-to-left.
  - **[Verified 2026-10-13]** 18 new browser tests; full suite 2,117 passed, 0 failed (165 skipped). All 6 checks passed on `c24d09d`. Squash-merged as `6fb8494` (owner pre-approved merge and deploy once checks passed).
  - **[Verified 2026-10-13, about 18:18 UTC]** Deployed: the 8 changed site files served by harveytaxiservice.com (`language-pref.js`, `htaf-i18n.js`, `htaf-translations.js`, `index.html`, `settings.html`, `foundation.html`, `htaf-application.html`, `contact.html`) are byte-identical to `main` at `6fb8494`. The foundation domain itself is blocked from this environment.
  - **[Unresolved]** All translations are automated and not reviewed by fluent speakers; review recommended for Ndebele, Twi, Shona, Igbo and Hausa before relying on them for the application form. Not checked on a real device or on the foundation domain (blocked from this environment).
- **Supabase security email (owner screenshot, issues as of 2026-10-11) "Table publicly accessible / rls_disabled_in_public"** **[Verified 2026-10-13 ~20:35 UTC, read-only advisors + catalog query]**: the only table flagged is `public.spatial_ref_sys`, the PostGIS coordinate-reference table (about 8,500 rows of public reference data, no customer or HTAF data). Every application table has RLS enabled. The finding is the known open item from 2026-08-04 (`docs/security-remediation/pr-04-rls-hardening.md`): `anon`/`authenticated` still hold INSERT/UPDATE/DELETE/TRUNCATE; the table is owned by `supabase_admin`, so this project's `postgres` role cannot revoke them (attempted 2026-08-04, verified no-op). **[Recommendation]** The owner files the drafted Supabase support request (dashboard → Support) asking Supabase to revoke write grants and keep SELECT; do not enable RLS on it or move PostGIS without a tested plan. **[Unresolved, owner]** Support request not yet filed.
- **#230 Pin search_path on 7 flagged functions (Supabase lint 0011)** **[Owner decision 2026-10-13]** approved merge and applying the migration to production. One migration (`20261013210000_pin_function_search_path.sql`) sets `search_path = pg_catalog, public`; bodies, grants and ownership unchanged.
  - **[Verified 2026-10-13]** Database suite 120 passed; full suite 2,117 passed, 0 failed. All 6 checks passed on `ff91d74`; squash-merged as `41f9288`.
  - **[Verified 2026-10-13 ~20:58 UTC]** Applied to production (`orgahzncmzptljapqffj`, migration `pin_function_search_path`). All 7 show `search_path=pg_catalog, public` and remain SECURITY INVOKER. The security advisor no longer lists lint 0011. Function check, rolled back: a location update on `DRIVER_GPLAY_REVIEWER` with the caller's search_path set to `pg_temp` still set `geog` (36.1627, -86.7816); nothing saved.
  - Rollback if ever needed: `alter function … reset search_path` per function.
  - **Remaining advisor items:** `spatial_ref_sys` (ERROR, Supabase support request, owner); PostGIS in `public` and `st_estimatedextent` callable publicly (WARN, PostGIS built-ins, no change recommended now); 48 "RLS enabled, no policy" (INFO, intended: server-only tables).
- **#231 HTAF logo (background + header)** **[Owner decision 2026-10-13]** approved merge. The foundation logo (cut from the owner's image; `htaf-logo.webp` 102 KB, `htaf-logo-192.webp` 21 KB) is a 13%-opacity background on the HTAF home page (behind content, hidden in High Contrast and print), and replaces the "HT" fallback in the header of the home and application pages (the header pointed to `/images/foundation-logo.png`, which was never added). **[Verified 2026-10-13]** 7 new browser tests; all HTAF browser tests 54 passed; all 6 checks passed on `43291ff`; squash-merged as `a141036`; at ~22:33 UTC the 4 changed files served by harveytaxiservice.com are byte-identical to `main`. **[Unresolved]** Not viewed on harveytransportationfoundation.com itself (blocked from this environment) or on a real device.
- **GitLab for Nonprofits assessment (2026-10-13, owner request; GitHub stays primary, no migration, no credentials in GitLab, deployment off).**
  - **[Unresolved]** The approved plan was not verified: the approval email was not readable (Gmail connector returned an error), and gitlab.com is not reachable from this environment. The owner needs to supply the approval or Customer Portal details.
  - **[Verified 2026-10-13, public program page via web search]** The program offers a free Ultimate license for 1 year, up to 20 seats, with no GitLab support. It is governed by the GitLab Subscription Agreement and renewed annually by the same person who created the subscription. Compute minutes for this program are not stated (the Education and Open Source programs list 50,000 per month).
  - **[Unresolved]** Whether the license may cover the shared HTAF/Harvey Taxi repository is not confirmed. The license is issued to HTAF; Harvey Taxi Service LLC is a separate for-profit. **[Recommendation]** Get written confirmation from GitLab before any pilot; no GitLab configuration PR was prepared.
  - **[Verified 2026-10-13]** The repository is public, so GitHub's code scanning (CodeQL), secret scanning with push protection, and Dependabot are available at no cost, but none is configured. The 35 browser test files (HTAF forms, consent, languages) skip in GitHub Actions because Playwright is not installed there.
- **HTAF website assistant enabled** **[Owner decision 2026-10-13]** "Enable HTAF agent"; the owner chose the website assistant (not AI triage, not GitLab Duo). Production `system_flags.htaf_assist_enabled` was set to `true` at 23:32 UTC; it was previously unset (off).
  - Rules-only: answers only from HTAF's published pages (home, application, contact, privacy, terms, service providers). No AI provider, no applicant records; daily limits of 60 per visitor and 5,000 overall.
  - **[Verified 2026-10-13]** Assistant tests: 55 + 5 browser tests passed. Live: `/api/htaf/assist/status` returns `assist_available: true`, and "How do I apply?" returns the application-page steps.
  - Unanswered questions are logged (redacted) to `htaf_assistant_questions`. Locally it declined questions on partnering, languages and 501(c)(3) status; HTAF can add approved answers.
  - Rollback: set the flag to `false` (takes effect immediately).
  - HTAF AI triage stays off (approval record not present).
- **#232 HTAF assistant answers** (partnership, Hausa, 501(c)(3)) and stronger redaction of unanswered questions (names, addresses, ZIP codes, dates). **[Verified 2026-10-13]** Full suite 2,138 passed. **[Unresolved]** Not merged (owner approval).
- **#233 HTAF review assistant** (2026-10-14; owner authorized preparation and testing only).
  - **[Verified 2026-10-13]** The existing "AI triage" route sends application facts to OpenAI. It is locked and has never run (no audit entries).
  - #233 adds an internal, rules-only assistant: summary, missing information, possible duplicates and follow-up questions. No AI model, no external provider, a person decides, HTAF roles only; suggestions are not stored and audit entries hold no applicant details. Off by default (`htaf_review_assist_enabled`).
  - **[Verified 2026-10-14]** 31 new tests on synthetic applications; full suite 2,154 passed, 0 failed.
  - **[Unresolved, owner]** Merge; activation; 12-month audit retention; privacy-notice sentence (counsel); remove or keep the OpenAI route; statewide service area.
- **Live 2026-10-14 (owner approvals 2026-10-14):**
  - **#232** merged `535b288`. **[Verified ~00:03 UTC, live]** The three answers return the owner's wording with links: partnership → `/contact.html?topic=partnership#inquiry`; Hausa → `/`; 501(c)(3) → `/`.
  - **#234** merged `26733fc` (owner: "disable message-text logging if removal cannot be guaranteed"). Unanswered questions are stored as a fixed topic only. **[Verified 00:19 UTC, live]** A test question with a made-up name was stored as "Unanswered question about: accessibility". Before this, `htaf_assistant_questions` held one row: the assistant's own test question "Can I become a partner?" (no personal information). The owner cancelled its deletion, so it stays.
  - **#233** merged `534ee5e`. Pre-activation checks recorded in `docs/htaf-review-assistant.md` §11: full suite 2,169 passed on main with #232–#234. **[Verified 00:18 UTC]** The admin page is byte-identical to `main` and the review route returns 401 without sign-in. `system_flags.htaf_review_assist_enabled = true` set at 00:19:17 UTC.
  - **[Unresolved, owner]** First real use by an HTAF caseworker. The assistant can't be exercised in production without an HTAF staff sign-in.
  - External OpenAI triage still locked.
- **#235 Harvey Taxi driver review assistant** (2026-10-14; owner asked for a focused PR, activation off). Internal rules, onboarding staff (dispatcher) and owner only, no HTAF access. Persona/Checkr shown as not configured / not started / pending / verified (verified only when the integration recorded it). **[Verified 2026-10-14]** Full suite 2,199 passed. **[Unresolved, owner]** Merge; activation (`driver_review_assist_enabled`); compliance-role access; expiration-date migration (proposed, not applied); retention. Support-case triage proposed in `docs/driver-review-assistant.md`.
- **Senior-engineering review program (owner request 2026-10-14).**
  - **[Owner decision 2026-10-14]** Strengthen #233 before activation. **[Verified 00:32 UTC]** `htaf_review_assist_enabled` set back to `false`. It had been on since 00:19 UTC under the previous instruction and was never used (no audit entries).
  - **#236** HTAF review assistant v2 hardening. Access is always enforced; the column boundary, flag and duplicate rules, county normalisation, Central-time dates, coverage-vs-capacity staff checks and correction reason codes are all tested; precise data-flow doc; draft transparency sentence. Phone-index migration proposed, not applied. Full suite 2,188 passed. **[Unresolved]** Merge; activation decision.
  - **#237** (stacked on #236) removes the unused external OpenAI triage. Every call to the old path returns 404 under any configuration. Full suite 2,174 passed. **[Unresolved]** Merge.
  - **#238** Stripe webhook forward-only transitions: late, duplicate and out-of-order events no longer regress or overwrite rides. No production impact so far (all 20 rides `not_required`). Full suite 2,191; card-flow suite 31; database suite 120. **[Unresolved]** Merge.
- **Server errors:** 26 `server_error` entries ("CORS origin blocked", `/api/health`) between 16:29 and 16:38 UTC were caused by this session's blocked-origin requests, which tried to read the deployed version **[Verified 2026-10-13, audit log]**. **[Owner decision 2026-10-13]** No more such requests. **[Recommendation]** Blocked origins currently return 500 and are logged as server errors; a small separate fix could return 403 without an error entry.
- **`driver_1`** **[Verified 2026-10-13, read-only]**: marked online and approved; created and last seen 2026-04-12; no email, phone, Persona or Checkr verification; no vehicle; no location. **[Owner decision 2026-10-13]** Leave it unchanged for now. Once #221 is deployed, it can't be offered or assigned rides.
- **[Owner decision 2026-10-13]** Harvey Assistant stays rules-only.
- **[Unresolved, owner]** Review ride result; HTAF test-inquiry receipt.

## 7. Scheduled checks **[Verified 2026-10-11, Routines]**

| Routine | When | What it does |
|---|---|---|
| `trig_01EQw4n15urNHMHP1dz5SrRz` "Rider iOS 1.0.2 (11) cloud build day" | 2026-11-01 14:05 UTC | Checks the allowance reset ($0), signing, main settings and tests, and stored build number 10. Then it starts exactly one rider iOS build. It never uploads or submits. It starts a driver build only with explicit owner approval. |
| `trig_018F8fjW1v3aiHoGsBSHu3Je` "HTAF Grant Pipeline Watch" | Monthly, 1st, 14:00 UTC | HTAF grant openings (separate from Harvey Taxi) |

## 8. Session handoff (2026-10-13)

**Completed (2026-10-12 to 2026-10-13):**
- #220, #222, #223, #224, #225, #226, #227, #221, #228 and #229 merged.
- Website changes from #222–#227 verified live, byte-identical.
- #221 deployed (`3cd8763`), owner-confirmed by Render screenshot.

**Remaining:**
- **[Owner]** Review ride with the test accounts.
- **[Owner]** HTAF:
  - send a labelled test inquiry and confirm receipt;
  - view `harveytransportationfoundation.com`.
- **[Owner]** Native-speaker review of the #229 translations; decide on Ga, Ewe and South African languages.
- **[Owner decision]** `driver_1` (left unchanged); the 27-account cleanup SQL (not run); the DRV-85708D8A35 Checkr reset.
- Earlier items still open: #210 consent (migration and deploy) before any external AI; #207 privacy wording; Stack B; Supabase plan; staging deletion (separate); airport permit documentation; HTAF governance documents.
- Rider iOS submission of 11:45 AM: removal not yet confirmed.
- **[Owner]** Review the 6 HTAF applications still in "submitted" status (the page now shows these counts publicly).

**Next authorized action:** none beyond the 1 November rider iOS build check (scheduled). Harvey Assistant stays rules-only. Nothing else is authorized to merge, deploy, build, upload, submit or change in production data.

## 9. Update 2026-10-14 (UTC)

Every statement below carries its label. Three different things are kept apart: verified in production, verified in CI or tests only, and blocked or unverified.

### 9.1 Merged to `main` today **[Verified 2026-10-14, Git; 6/6 checks on each PR's final commit]**
| PR | Merge commit | Owner approval (scope) |
|---|---|---|
| #238 Stripe webhook compare-and-swap transitions | `61d673f` | **[Owner decision 2026-10-14]** Merge and deploy once checks pass and review finds no unresolved issues |
| #236 HTAF review assistant v2 | `2876b8b` | **[Owner decision 2026-10-14]** #236 then #237, after checking against current main |
| #237 Remove OpenAI HTAF triage | `d6a2cf3` | Same |
| #235 Driver review assistant (explicit grant) | `e496dba` | **[Owner decision 2026-10-14]** Merge after the required checks pass |
| #239 Phone index migration file | `d825e48` | **[Owner decision 2026-10-14]** Merge if checks pass and the diff is only the index and tracking work. Verified: the diff was the migration, its test and the migration-order list. |
| #240 Structured error logs | `5e415de` | **[Owner decision 2026-10-14]** Complete review, merge and deploy if checks pass |
| #241 Health version identifier | `6bae686` | **[Owner decision 2026-10-14]** "Add a minimal version identifier" |

### 9.2 Production verification
**[Verified in production 2026-10-14]**
- **Running commit:** `/api/health` reports `version: 6bae686` (02:03 UTC). That build contains every merge above.
- **#235:** the `admin-dashboard.html` driver review code is served, and the review route returns 401 without sign-in.
- **#236:** the `admin-htaf.html` review-assistant code is served. The HTAF review routes return 401 without sign-in, and so does the removed triage path.
- **Phone index:**
  - built with `CREATE INDEX CONCURRENTLY`;
  - `indisvalid` true;
  - the outcome recorded as `already_present`;
  - the planner uses the index with sequential scans disabled.
- **Grant table (`admin_capability_grants`):**
  - applied;
  - RLS on with no policies;
  - no `anon` or `authenticated` access; `service_role` can read;
  - 0 rows;
  - the server only reads it (no route writes it).

  A grant and revocation test ran inside a block that rolled back:
  - grant: ok; duplicate active grant: rejected; other capability: rejected; mixed-case email: rejected;
  - revoke without naming who: rejected; revoke: ok, with 0 active grants after;
  - re-grant: ok, with history kept;
  - 0 rows after the rollback.
- **Flags (system_flags, 01:30 UTC; nothing changed since):**
  - `htaf_review_assist_enabled` = `false`;
  - `driver_review_assist_enabled` not set (off);
  - `htaf_assist_enabled` = `true`;
  - `agent_assist_enabled` = `true`.

**[Verified in CI or tests only, not in production]**
- **#238 webhook behavior:** signatures, duplicates, concurrent writers (including a real-Postgres race across two server instances) and failure recovery.
- **Isolated card flow against Stripe test mode on `61d673f`:** 31 passed, 1 skipped.
- **#240:** no raw messages, query strings, bodies, headers or Postgres details are logged.

**[Blocked / unverified]**
- **Stripe webhook in production** returns **503 "Stripe webhook not configured."** See §9.3. Signed delivery, processing and controlled redelivery cannot be verified until it is configured.
- **Authenticated smoke tests** for both review assistants need the owner signed in. See §9.4.
- **Render request logs:** not reviewed; there is no access from this environment.

### 9.3 Stripe configuration **[Verified 2026-10-14; no secret values read or printed]**
- **API key: configured.** The public `/api/config/public` reports `stripe_enabled: true`.
- **Mode: test.** The public publishable key starts `pk_test_`.
- **Account:** production's publishable key belongs to the same Stripe test-mode account this environment can read. This was checked by comparing account identifiers without printing them.
- **Missing: `STRIPE_WEBHOOK_SECRET`.** The webhook returns 503 only when the API key or this secret is absent, and the key is present.
- **The account has no webhook endpoints registered in test mode.** So Stripe never attempted delivery: there is no failed-delivery history, only events that were never sent.
- **Reconciliation:**
  - test mode holds 166 PaymentIntents, all `canceled`, none open;
  - 144 come from the isolated test suite, and the other 22 from earlier test-mode validation runs (2 Oct, 4 Oct, 14 Oct);
  - production has 0 `payments` rows and 0 rides with a `payment_id`.

  **No production record depends on a missed event, and nothing needs replaying.** Live-mode Stripe was not checked; there is no access from here.

**Owner steps (test mode, the same account):**
1. **Stripe Dashboard:**
   - Make sure **Test mode** is selected (top right).
   - Go to **Developers → Webhooks → Add endpoint** and enter `https://harveytaxiservice.com/api/stripe/webhook`.
   - Select these events: `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`.
   - Click **Add endpoint**, then on the endpoint page **Signing secret → Reveal**. Copy it straight into Render (step 2); don't paste it anywhere else.
2. **Render Dashboard:**
   - Go to the web service → **Environment → Add Environment Variable**.
   - Key `STRIPE_WEBHOOK_SECRET`, value: the signing secret.
   - **Save changes**. Render redeploys.
3. **Tell Claude.** Claude then verifies in this order:
   1. an unsigned request returns 400, not 503;
   2. a **Send test webhook** from the Dashboard is processed; check the response code in Stripe's delivery log and `stripe_webhook_received` in `audit_logs`;
   3. a test-mode PaymentIntent created with synthetic metadata produces the expected events, and is then cancelled;
   4. one controlled **Resend** of an already-processed event is a no-op;
   5. no secrets appear in logs.
4. **For live mode later:** repeat in live mode with a separate endpoint and secret, only when card payments are approved to go live.

### 9.4 Supervised smoke tests **[Owner decision 2026-10-14]**
**Conditions:**
- both assistants stay off until the owner is signed in and ready;
- one assistant at a time;
- an assistant may stay on only if authorization, corrections, minimal audit records and an unchanged status all pass, and is otherwise turned off;
- synthetic records must be excluded from public totals and must not trigger messages, dispatch, charges or payouts.

**Prepared:** `docs/review-assistant-smoke-tests.md` (in PR #242) holds the runbook, the synthetic-record SQL (`HTAF-SMOKE-0001`, `DRV-SMOKE-0001`, `@example.test`, 555-01xx numbers), the verification queries and the cleanup steps.
- **Side-effect review [Verified 2026-10-14, code and database]:** see the #242 description. No trigger or scheduled job messages, dispatches, charges or pays these records.
- **Dry run:** both inserts were validated in production inside a block that rolled back.
- **Public totals:** #242 excludes `example.test` applications from `/api/foundation/public-stats`. **The synthetic HTAF record will be inserted only after #242 is deployed.**

### 9.5 Historical logs **[Verified 2026-10-14, counts only; nothing deleted]**
`audit_logs` `server_error`:
- **832 rows** (2026-07-04 → 2026-10-13), all with a raw message, the full path, and the client IP and user agent;
- **521 paths with a query string**, whose only parameter names are `status`, `rest_route` (scanner probes) and `_sm_byp`;
- no emails found; the phone-like matches were build SHAs;
- no Postgres detail text;
- 42 rows from the signup routes need manual review, because free text can't be cleared by pattern.

Most other actions store the IP and user agent. `notification_logs`, `trip_events` and `trip_timelines` are empty.

**Proposed cleanup scope** (`docs/data-retention-policy.md`, draft, in PR #243): redact the old `server_error` messages, paths and IP/user agent; clear IP/user agent after 90 days. **Nothing runs until the retention and preservation review is approved.**

### 9.6 Open PRs
| PR | What | State |
|---|---|---|
| #242 | Synthetic-record exclusion from public totals; smoke-test runbook | Checks re-running after merging main. Needed before the HTAF smoke test. |
| #243 | `driver_document_records` (expiration dates with source and verification status); assistant v2; draft retention policy | Checks green; **migration not applied**. Needs owner approval to merge and apply. |
| This PR | Status records | Documentation only |

### 9.7 Remaining work, in owner priority order
1. **Payment reconciliation and refunds:** reconciliation code exists but is off by flag (`stripe_reconciliation_enabled`). Refunds and charge events are not handled yet. This is next.
2. **Simulated-account isolation.**
3. **Recovery after app restarts.**
4. **HTAF:** submission retry protection, concurrent-edit protection, case history, test-application separation (#242 is the first part).
5. **Logging:** the remaining ~160 `console.*` calls; Render log retention and access.

### 9.8 Rollback
| Change | Rollback |
|---|---|
| #238 | Revert `61d673f` (prefer a forward fix once payments start) |
| #236 / #237 / #235 | Revert `2876b8b` / `d6a2cf3` / `e496dba`; the assistants are off |
| #240 | Revert `5e415de` (logs return to raw messages) |
| #241 | Revert `6bae686` |
| Phone index | `drop index concurrently if exists public.htaf_applications_phone_idx;` |
| Grant table | `drop table public.admin_capability_grants;` (0 rows) |
| Flags | Set to `false`; it takes effect on the next request |

### 9.9 Session handoff (2026-10-14)
**Completed:**
- 7 PRs merged and verified live, with the production commit confirmed.
- Grant table applied and tested.
- Stripe root cause found and reconciliation done, with no secrets read.
- Historical-log inventory.
- Smoke-test runbook, synthetic records and their exclusion.
- Expiration-records PR and draft retention policy.

**Remaining:**
- Owner configures `STRIPE_WEBHOOK_SECRET` (§9.3).
- Merge #242, then the smoke tests with the owner signed in.
- Decisions on #243 and the retention policy.
- Reconciliation and refunds, then the rest of §9.7.

**Next authorized actions:**
- Merge #242 once its checks pass (owner requirement for the smoke tests).
- During the owner's supervised session: insert the synthetic records, enable one assistant at a time, and keep it on only if every check passes.
- After the owner configures Stripe: verify signed delivery, processing and one controlled redelivery.

Nothing else is authorized to merge, deploy, migrate or activate.

## 10. Update 2026-10-14 (UTC), later: assistant pilot
- **[Owner decision 2026-10-14]** "Approved" → merge #244. **[Verified]** Merged as `44ec21b`; production `/api/health` reported `version: 44ec21b` at 11:52 UTC.
- **[Owner decision 2026-10-14]** "Activate" → read as the quote-only pilot (no external processing) for both organizations. **[Verified 11:53 UTC]** `assistant_pilot_harvey_taxi_enabled` and `assistant_pilot_htaf_enabled` are set to `true` in `system_flags`.
- **[Verified 2026-10-14, Harvey Taxi domain, synthetic questions]**
  - A supported question gets a quoted answer (`extractive`) with sources on harveytaxiservice.com and their versions, plus 3 follow-ups.
  - A private-record question gets the `boundary` answer and the support link.
  - A request naming HTAF gets 403.
  - SSE streaming sends the events meta, delta, sources, followups and done.
- **[Unverified]** The HTAF domain can't be reached from this environment. It is enabled by the same flag mechanism but has not been checked live.
- **Still off:**
  - **Model mode:** no `assistant_pilot_*_model_enabled` flags; `ASSISTANT_PILOT_MODEL_APPROVED` not set; migration `20261014070000` not applied.
  - The HTAF and driver review assistants.
- **Not linked:** `/assistant-pilot.html` isn't linked from any page.
- **Rollback:** set either flag to `false`; it takes effect on the next request.

## 11. Update 2026-10-15 (UTC): verified facts and outstanding checks

### 11.1 Production state **[Verified 2026-10-15 01:42 UTC unless noted]**
- **Version:** `/api/health` reports `version: 44ec21b` (#244) and `database: connected`.
- **Merged since 2026-10-13:**
  - #239 `d825e48`: phone index and outcome tracking;
  - #240 `5e415de`: structured error logs;
  - #241 `6bae686`: version in health;
  - #242 `9d07b18`: synthetic records excluded from totals, smoke-test plan;
  - #244 `44ec21b`: assistant pilot.
- **`system_flags`:**
  - `assistant_pilot_harvey_taxi_enabled` = `true` and `assistant_pilot_htaf_enabled` = `true` (set 2026-10-14 11:53).
  - `htaf_review_assist_enabled` = `false`.
  - These have no row, so they are off: `driver_review_assist_enabled`, `stripe_reconciliation_enabled`, `unused_hold_sweep_enabled`, and all `assistant_pilot_*_model_enabled` flags.
- **`admin_capability_grants`:** applied, 0 rows.
- **Not applied:**
  - `driver_document_records` (#243, migration 060000);
  - migration `20261014070000` (visitor role in the usage ledger).
- **Payments:** 0 `payments` rows; 0 rides with `payment_id`. Stripe is in test mode (`pk_test_`). `STRIPE_WEBHOOK_SECRET` is not set, so the webhook returns 503. No webhook endpoints are registered. 166 test PaymentIntents, all cancelled (2026-10-14).

### 11.2 Assistant pilot: verification results
- **[Verified 2026-10-14, Harvey Taxi domain]** The pilot is quote-only. Results:
  - A supported question gets a quoted answer with sources.
  - A private-record question gets the boundary answer.
  - Naming the other organization gets 403.
  - SSE streaming works.
- **Correction to an earlier report:** the 2026-10-14 summary said all four test questions behaved correctly, but the unsupported question had not been run at that point.
  - **[Verified 2026-10-14 11:59 UTC]** It was then run live and returned mode `unsupported`.
  - Exactly one audit row was written: `assistant_pilot_gap` with metadata `{org: "harvey_taxi", topic: "Unanswered question about: other"}`. It holds no IP address, user agent or question wording.
- **[Verified, tests: #245]** Quote-only mode makes no outbound call even with provider credentials present. The test uses a fake `ANTHROPIC_API_KEY`; with the model flag absent, without the server approval, or set to `"TRUE"`, the answer is extractive, no provider is constructed, and there are zero outbound http, https or fetch calls.
- **[Unverified] HTAF live check:** harveytransportationfoundation.com is blocked by this environment's network policy (proxy 403). The pilot is enabled there but has not been live-verified.
  - Owner test: https://harveytransportationfoundation.com/assistant-pilot.html, ask "How do I apply?"
  - Allowing the host in this environment's network settings would let Claude verify it.

### 11.3 Open PRs (none merged; each merge needs owner approval)
| PR | What | Checks |
|---|---|---|
| #245 | Page label "Assistant preview — answers from published information"; quoted vs AI-generated label; no-provider test | 6/6 green |
| #246 | HTAF Privacy §13 "Children Under 18" (owner's wording) | 6/6 green |
| #247 | Anthropic model proposal (data flow, terms, costs) and retention implementation gaps (docs only) | pending |
| #243 | Driver document records (entry separate from verification; no automatic suspension); main merged in at `83bbd60` | local: 2,338 unit and 135 database tests passed |
| #218 | This status record | — |

### 11.4 Outstanding checks
- **Owner:** HTAF live check (above).
- **Owner:** Anthropic Console data-retention setting / zero data retention, and DPA acceptance (#247).
- **Owner:** Supabase backup retention and Render log retention (#247, G10/G11).
- Supervised review-assistant smoke tests: they wait until you're signed in (`docs/review-assistant-smoke-tests.md`).
- Payment reconciliation and refunds: in progress; read-only and Stripe test mode only; no live refunds.

## 12. Update 2026-10-15 (UTC): merges approved ("Approved to merge all")

- **[Owner decision 2026-10-15]** "Approved to merge all". This covers merging the open PRs. It does **not** cover applying migrations, turning flags on, renting GPUs or enabling refunds; each of those still needs its own approval.
- **[Verified 2026-10-15, Git]** Merged (squash), each on green CI:

  | PR | Commit | What |
  |---|---|---|
  | #245 | `abf0708` | "Assistant preview — answers from published information" label; quote-only can't reach a provider |
  | #246 | `f7943fa` | HTAF Privacy §13 "Children Under 18" (owner wording) |
  | #247 | `aa0d14d` | Anthropic model proposal; retention implementation gaps (docs) |
  | #243 | `6d34d97` | Driver document records (entry separate from verification; no automatic suspension) |
  | #248 | `e3979c7` | Read-only payment reconciliation; test-mode refund ledger (off) |
  | #249 | `5716415` | Membrane: own-model vector search, hybrid RAG, LoRA/QLoRA pipeline (off). CI now installs pgvector from PostgreSQL's archive repository (the PostGIS image is Debian bullseye). |

- **[Verified 2026-10-15 02:28 UTC, production]**
  - `/api/health` reports `version: e3979c7`.
  - The pilot page shows "Assistant preview — answers from published information".
  - The Harvey Taxi pilot answers from published pages, with 2 sources.
  - The refund and reconciliation-report routes return 401 without an admin session.
- **[Unverified]** HTAF §13 live: `/htaf-privacy.html` redirects to harveytransportationfoundation.com, which this environment can't reach. The deployed code contains the new heading.
- **Not applied (each needs separate approval):**
  - `20261014060000` driver document records;
  - `20261015010000` refund ledger;
  - `20261015020000` pgvector store (#249);
  - `20261014070000` usage-ledger visitor role.

  Until applied, the code treats each table as absent (no expiration dates shown, refund ledger "not migrated", keyword-only retrieval).
- **Still off:** all assistant model flags, `refunds_enabled`, vectors flags, and the review assistants.

## 13. Update 2026-10-15 (UTC): four migrations applied

- **[Owner decision 2026-10-15]** "Approved to apply all four migrations."
- **[Verified 2026-10-15 02:31–02:32 UTC, production]** Applied from the repository files, verbatim:

  | Migration file | Recorded as | Result |
  |---|---|---|
  | `20261014060000_driver_document_records.sql` | `20261015023107 driver_document_records` | Table created, 0 rows |
  | `20261014070000_agent_model_usage_visitor_role.sql` | `20261015023112 agent_model_usage_visitor_role` | Role check now allows `visitor`; the existing 76 rows (rider/driver) are unchanged |
  | `20261015010000_payment_refunds.sql` | `20261015023140 payment_refunds` | Ledger and two functions created, 0 rows |
  | `20261015020000_assistant_passage_embeddings.sql` (#249) | `20261015023211 assistant_passage_embeddings` | pgvector 0.8.0 installed in the `extensions` schema; table, HNSW index and match function created, 0 rows |

- **Pre-checks, read-only:**
  - none of the tables existed;
  - existing usage roles fit the new constraint;
  - `drivers.id` is text, matching the new foreign key;
  - pgvector was available but not yet installed.
- **Post-checks:**
  - all three new tables have row-level security on, no access policies, and no anon or authenticated access;
  - the three new functions are executable by `service_role` only;
  - security advisor: the only new notices are the expected "RLS enabled, no policy" ones for these server-only tables.
- **Functional check (rolled back, no rows written):** a first refund reservation was `reserved`, a retry with the same key `replayed`, and a request over the captured amount `exceeds_refundable`. The vector match function returned 0 rows on the empty table.
- **Still off:** `refunds_enabled`, the vectors flags and the model flags. No row was written to any new table.
- **Rollback** (only while the tables are empty):

  ```sql
  drop table public.driver_document_records;
  drop table public.payment_refunds;
  drop function public.reserve_payment_refund;
  drop function public.record_payment_refund_result;
  drop table public.assistant_passage_embeddings;
  drop function public.match_assistant_passages;
  ```

  Restore the role check without 'visitor' only if no visitor rows exist.

## 14. Session handoff (2026-10-15 UTC)

- **Completed:**
  - **[Verified, Git]** #243, #245, #246, #247, #248, #249 and #218 merged.
  - **[Verified, production]** `version 5716415` is live.
  - **[Verified, production]** The four migrations are applied and verified (§13).
- **[Owner decision 2026-10-15]** "Allow huggingface.co and calibrate the embeddings."
  - The owner added `huggingface.co`, `cdn-lfs.huggingface.co` and `cas-bridge.xethub.hf.co` to the cloud environment's allowed domains.
  - **[Verified 02:4x UTC]** This session still gets proxy 403; the policy applies to new sessions.
- **Remaining:** run the calibration in a new session. Tools and steps are in `training/membrane/local/README.md` on branch `claude/membrane-calibration`, which is pushed, with no PR.
- **Next authorized action:** calibration only. It is local and read-only, with no production change. Enabling the vectors flags, setting `MEMBRANE_*` on Render, hosting a membrane, training, and refunds each need a separate approval.

## 15. Calibration attempt (2026-10-15 ~03:05 UTC, separate session)

- **[Verified, owner-relayed report]** A new session was started after the owner edited the allowed domains. It was still refused by the proxy for `huggingface.co` (403), so no model was downloaded and the hybrid calibration did not run.
- **[Unresolved]** Whether the three domains saved in the environment settings. The owner is re-checking.
- **[Verified, same report] Keyword-only baseline** on the 19 calibration questions:
  - 4 of 15 answerable questions found the right page in the top 2;
  - 2 found the wrong page;
  - 9 found nothing;
  - 0 of 4 off-topic questions were answered.

  This is the bar hybrid search must beat.
- **[Verified, this session]** `scripts/membrane-calibrate.js` on this branch now suggests a threshold only when every correct score is above every off-topic score; otherwise it reports "no clean separation". Raised in that session's report.
- **Next authorized action:** re-run the calibration in a new session once Hugging Face is reachable. There is no production change.
## 16. End-to-end wiring audit (2026-10-15 UTC)

**Owner request 2026-10-15:** "make sure the full production from front to back ends are all wired properly." Read-only against production; fixes in PR `claude/production-wiring-fixes`, not merged.

**[Verified 2026-10-15 ~09:30 UTC]**
- **Production version:** `5e09660` (`/api/health`), the head of `main`. CI passed on it and on every merge since #243.
- **Pages:** all 51 pages load (200 or redirect). 11 of 12 linked assets load. The Settings page logo pointed to a missing file and showed an "HT" placeholder; fixed in the PR.
- **Database:** all 30 tables and 14 functions the server code uses exist in production.
- **Apps:**
  - The rider app (`mobile/`) and driver app (`driver-app/`) point to `https://harveytaxiservice.com`.
  - The driver app's trip steps (`enroute`, `arrived`, `start`, `complete`) match server routes.
  - The root-level `App.js`, `src/` and `app.json` are an older, unshipped app; its dead addresses don't affect users.
- **Live endpoints:**
  - health, HTAF public stats, Stripe publishable key (test mode), assistant status and the assistant pilot answer correctly;
  - admin, payment-report and support-handoff routes refuse requests without a sign-in (401).
- **Server errors:** none in the last 72 hours apart from 29 rows from 2026-10-13 (earlier blocked-origin probes).

**Wiring problems found on reachable pages:**

| Problem | Effect | Fix in PR |
|---|---|---|
| Rider dashboard "Send Support Request" called `/api/support/request`, which doesn't exist | Riders' support messages were never sent | Sends to the same support queue as the assistant (`/api/agent/rider/handoff`): opens a case and emails support, and the rider sees the case reference |
| Rider dashboard status refresh called `/api/riders/status`, which doesn't exist (and looked riders up by email) | Approval status could be stale | Uses `/api/riders/:id/readiness`; no lookup by email |
| Support page "Payments" card linked to `payment.html`, whose two calls don't exist | Dead payment page | Card now opens the rider dashboard |
| `POST /api/persona/inquiry` had no sign-in check | Anyone with an account ID could overwrite its Persona inquiry and reset its status. Unused by any page; 0 calls in 30 days | Only the signed-in rider or driver can start a check for their own account |

**Guard tests added:**
- `test/live-api-wiring.test.js`: every API address on live pages and in both apps must be a server route. Known gaps are listed with reasons.
- `test/server.persona-inquiry-auth.test.js`
- `test/rider-dashboard-wiring.browser.test.js`

**[Unresolved] Owner decisions:**
- **[Owner decision 2026-10-15]** "Persona and Checkr should only be handled by back ends; no front-end buttons required."
  - Removed the rider dashboard "Start Persona" button and the driver sign-up "Start Persona Verification" button (the driver one did nothing).
  - A guard test now fails if any page or app offers a control that starts either check.
  - **[Verified, code]** No back-end job starts checks automatically either. `/api/persona/inquiry` (sign-in protected) and `/api/checkr/start` (driver or admin) have no callers. Results arrive through the Persona and Checkr webhooks, so checks are started outside the app (e.g. the Persona and Checkr dashboards).
  - **[Unresolved]** Whether the server should start them automatically at a set step (for example after a driver's phone is verified) is a separate decision.
- **20 pages no link reaches:**
  - old dispatch, GPS and live-map consoles;
  - autonomous-vehicle demos;
  - `test-earnings.html`, `pay.html` and `rider-live-*`.

  Many call routes that don't exist. Recommendation: remove them or mark them internal. `assistant-pilot.html` is unlinked on purpose.
- **Already known:** Stripe webhook secret not set (webhook returns 503); HTAF domain not verifiable from this environment; embedding calibration blocked by network policy.

**Handoff:**
- **Next authorized action:** none. Merging the PR needs owner approval.

## 17. Update 2026-10-15 (UTC): #250 merged; dead pages removed

- **[Owner decision 2026-10-15]** "Authorization granted for all production improvements." Read as covering:
  - merging #250;
  - the recommended removal of unreachable, non-working pages.

  It does **not** cover:
  - automatic Persona/Checkr starts (a product choice, and each check costs money);
  - model, vector or refund activation (model activation stays off until the owner reviews the proposal).
- **[Verified, Git]** #250 merged as `2c20aef` on green CI (6/6).
- **Removed 8 pages** that no page, app or server route links to, whose API calls were all or nearly all dead:
  - `admin-dispatch-console`, `admin-dispatch`, `admin-rider-approval`, `admin-support`;
  - `autonomous-analytics`, `autonomous-test`, `av-control`;
  - `test-earnings`.

  Current admin functions are in `admin-dashboard.html`.
- **Kept:**
  - the five redirect pages (`active-trip`, `rider-trip`, `rider-tracking`, `rider-live-*`), which forward old links to the rider dashboard;
  - `admin-live-dispatch-map` and `mobility-os-prototype`, whose calls all work;
  - `admin-gps`, `pay` and `admin-account--deletion`, which have no dead calls (the last duplicates the dashboard's deletion panel).
- **Handoff:** after this PR merges, verify the production version and that the removed pages return 404.

## 18. Update 2026-10-15 (UTC): embedding service (membrane) for vector search

- **[Owner decision 2026-10-15]** "Approved": an embedding server on Render as a private service, about $25/month (Render Standard; third-party price, to confirm on Render). Covers preparing the service, merging it, and calibrating against it.
  - Turning vectors on for one organization follows calibration, per the approved plan.
  - Vectors stay off until the threshold is set.
- **Added (PR `claude/membrane-service`):**
  - **`membrane-service/`:** Dockerfile, `serve.py`, `fetch.py`.
    - Downloads `intfloat/multilingual-e5-small` at build, falling back to `Xenova/multilingual-e5-small` if the first has no ONNX file, and records the commit and license.
    - Serves `/v1/embeddings` and `/health`.
    - Requires a shared key; never logs request text.
  - **`GET /api/admin/membrane/calibration`:** owner only, read-only. Shows the service's health and the calibration scores, run inside Render where the private address is reachable.
  - **Index building** now allows 60 seconds per batch; a visitor's query keeps the short timeout.
  - **E5 query/passage prefixes** are applied automatically.
- **[Verified 2026-10-15, local]** End to end with a stand-in model in the same ONNX format:
  - health check works;
  - missing key gives 401;
  - 384-dimension vectors come back;
  - the real published pages (31 + 65 passages) embed through the service;
  - the calibration correctly refuses to suggest a threshold when scores overlap.

  Full suite: 2,421 passed.
- **[Verified 2026-10-15, local Docker]** The image builds from this Dockerfile with the stand-in model in place of the download step. Running as Render does (`PORT=10000`, `RENDER=true`):
  - listens on `0.0.0.0:10000` as a non-root user;
  - health check works; missing key gives 401;
  - all 96 passages embed through it;
  - no request text appears in its logs.
- **[Unverified]**
  - The model download step (`fetch.py`): Hugging Face is blocked here. It runs on Render's first build.
  - The real model's quality: it awaits the calibration page.
- **Owner steps:** in `membrane-service/README.md`. Create the private service, set four environment variables on the web service, then open the calibration page.
- **Handoff:**
  - **Next authorized action:** after the owner's Render setup, read the calibration report, set `MEMBRANE_MIN_SIMILARITY`, and enable vectors for one organization.

## 19. Update 2026-10-15 (UTC): membrane live; Harvey Taxi vectors on

**[Verified 2026-10-15 ~11:46 UTC]** **Render private service `harvey-membrane`.**
- **Configuration:** Docker, Standard plan (1 CPU, 2 GB), internal address `harvey-membrane:10000`. Source: the owner's screenshots of Render.
- **[Owner decision]** Price $25/month, confirmed by the owner in Render's plan picker.
- **Model:** `intfloat/multilingual-e5-small`, commit `614241f622f53c4eeff9890bdc4f31cfecc418b3`, license MIT, `onnx/model.onnx`, 384 dimensions. Source: the build log the owner pasted.
- **Credential:** `MEMBRANE_API_KEY` is stored in Render environment variables on both `harvey-membrane` and `harvey-taxi-app-2`. The value is not recorded.

**Web service settings on `harvey-taxi-app-2`:**
- `MEMBRANE_BASE_URL=http://harvey-membrane:10000/v1`
- `MEMBRANE_EMBED_MODEL=multilingual-e5-small`
- `MEMBRANE_TIMEOUT_MS=3000`
- `MEMBRANE_MIN_SIMILARITY=0.81`

The owner set these; the values were read from the calibration page.

**Setup issues, all resolved:**
- the placeholder `abcd` was used in the address;
- the service ID was added into the hostname;
- a stray hyphen was left in the hostname;
- the first calibration run failed with `network`. Probable cause: running 64 passages at once ran out of memory. Not confirmed from logs.

**[Owner decision 2026-10-15]** "Approved to merge #253". **[Verified]**
- Merged as `154f084` after CI passed (6 of 6 checks) and the local full suite passed (2,421).
- Production `/api/health` reported `154f084` at 11:46:42 UTC.
- `harvey-membrane` rebuilt on `154f084` and went live at 11:46:25 UTC.
- #253 changes:
  - the service runs texts through the model 8 at a time;
  - the website sends at most 16 texts per request;
  - a refusal is sent only after the request is read.

**[Verified 2026-10-15 ~11:58 UTC] Calibration** (owner-only page, from the owner's screenshots):
- Index build: Harvey Taxi 31 passages, HTAF 65 passages, about 36 seconds in total on 1 CPU.
- Top-1 vector match: right page for 9 of 15 answerable questions.
- Score ranges overlap: lowest correct 0.805 against highest off-topic 0.806. No threshold was suggested.
- With `MEMBRANE_MIN_SIMILARITY=0.81`, combined search found the right page in the top 2 for **10 of 15** questions, against 4 of 15 for keyword search. Off-topic questions answered: **0** (keyword search also 0).
  - **Harvey Taxi:** 5 of 6. One wrong page: "Can a 12 year old use the app?" returned Legal & Information Pages.
  - **HTAF:** 5 of 9. Three wrong pages, all on eligibility, whether a trip is guaranteed, and who sees requests. One question not found (tax-exempt).

**[Owner decision 2026-10-15]** "Approve Harvey Taxi vectors". Scope: Harvey Taxi only.
- Set `assistant_pilot_harvey_taxi_vectors_enabled = true` in `system_flags` at 12:00:00 UTC.
- HTAF has no vectors flag, so it stays keyword-only.

**[Verified 2026-10-15 ~12:03 UTC] Live answers on harveytaxiservice.com** (streamed requests):

| Question | Retrieval | Sections cited |
|---|---|---|
| "Is a car always available when I request one?" | `hybrid` | Ride Requests and Availability; Support Guidance |
| "Can I get my account erased?" | `hybrid` | 7. Your Choices; Acceptable Use |
| "Do drivers see my phone number?" | `hybrid` | 3. Sharing of Information; Contact Harvey Taxi |
| "Recommend a good pizza place" | `keyword` | none: `unsupported` ("not covered") |
| "Do you fly helicopters?" | `keyword` | none: `unsupported` ("not covered") |

**[Recommendation]**
- Watch Harvey Taxi's "not covered" and wrong-page rate: the off-topic margin is only 0.004.
- Before turning on HTAF:
  - add at least 30 staff-written labeled questions, including off-topic ones;
  - fix the HTAF eligibility mismatches.
- The harmless `membrane 501 HEAD /` line comes from Render's start-up probe; handle `HEAD` in a later change.

**[Unresolved] Owner items:**
- The Render "Payment failed" banner; the workspace runs the live website.
- Persona: `ENABLE_PERSONA` is on with no `PERSONA_API_KEY`, so new drivers can't pass verification without manual admin action. Options:
  - (a) add the key;
  - (b) set `ENABLE_PERSONA=false`;
  - (c) leave it as is.

**Rollback:** set `assistant_pilot_harvey_taxi_vectors_enabled` to `false`; it takes effect on the next question. Unsetting `MEMBRANE_BASE_URL` disables vectors everywhere.

**Handoff:**
- **Completed:** membrane live, #253 merged and deployed, calibration done, Harvey Taxi vectors on and verified live.
- **Remaining:**
  - HTAF vectors, after more labeled questions;
  - the two owner items above;
  - the LoRA training run (separate approval).
- **Next authorized action:** none pending. Each item above needs owner approval.

## 20. Update 2026-10-15 (UTC): security dependency update (#254)

- **[Owner decision 2026-10-15]** "prepare the security update PR", then "Approved to merge #254".
- **What changed** (lockfile only; `package.json` unchanged):

  | Package | Severity | From | To |
  |---|---|---|---|
  | `proxy-addr` | critical | 2.0.7 | 2.0.8 |
  | `axios` | high | 1.18.1 | 1.20.0 |
  | `qs` | moderate | 6.15.3 | 6.16.1 |
  | `body-parser` | moderate | 1.20.6 | 1.20.8 |
  | `express` | moderate | 4.22.2 | 4.22.3 |

  Test-only tools (`brace-expansion`, `js-yaml`) were updated too.
- **[Verified] Before merge:**
  - `npm audit --omit=dev`: 0 vulnerabilities.
  - Local full suite: 2,421 passed. Database suite: 149 passed.
  - CI: 6 of 6 checks passed on `8e65dac`.
- **[Verified] After merge:**
  - Merged as `4e6895b`. Production `/api/health` reported `4e6895b` at 12:26:21 UTC.
  - `/`, `/support.html`, `/terms.html` and `/privacy.html` return 200.
  - The calibration page still returns 401 without a sign-in.
  - Harvey Taxi assistant:
    - right after the restart, it answered with `keyword` retrieval while the vector index rebuilt;
    - about 40 seconds later it answered with `hybrid` retrieval again ("Can I get my account erased?" → 7. Your Choices);
    - off-topic questions still get `unsupported` ("not covered").
- **[Unresolved]** One moderate `sprintf-js` advisory remains inside Jest (test tooling only, not deployed). The only fix npm offers is a downgrade to Jest 25.
- **[Recommendation]** After each deploy, vectors are briefly off until the index rebuilds (about 10–40 s). Answers in that window use keyword search. This is acceptable for the pilot. Switching to the `pgvector` store would remove the gap.
- **Handoff:**
  - **Completed:** #254 merged, deployed and verified.
  - **Next authorized action:** none pending.

## 21. Update 2026-10-15 (UTC): HTS logo on Harvey Taxi pages (#256)

- **[Owner decision 2026-10-15]** Owner's request: "We need to implement HTS Logo everywhere needed." This is a request for the work, not approval to merge or deploy.
- **What changes:**
  - **New asset:** `public/hts-logo-192.png`, a tight crop of the existing app icon (`mobile/assets/icon.png`) without its dark border.
  - **Placeholder marks replaced with the logo** on 12 header marks across 11 pages:
    - the "HT" text badges on `index`, `driver-dashboard` and `admin-dashboard`;
    - the "H" badge in the rider dashboard's ride wizard;
    - the empty marks and colored dots on `rider-dashboard` (2), `rider-signup`, `driver-signup`, `support`, `privacy`, `privacy-policy`, `app-review` and `admin-live-dispatch-map`.
  - `settings` now uses the cropped logo.
  - **Browser-tab and home-screen icons** added to 16 Harvey Taxi pages that had none, including admin and login pages, `terms`, `pay` and `payment`.
  - **HTAF pages** (`foundation`, `htaf-*`, `contact`, `leadership`, `admin-htaf`) keep the HTAF logo and are unchanged.
- **[Verified 2026-10-15, local]**
  - Phone-width (412 px) screenshots of 12 pages: the logo loads and renders at 40–54 px on each.
  - New guard test `test/hts-logo.test.js`:
    - no "HT"/"H" or empty placeholder marks on Harvey Taxi pages;
    - the HTS logo is present on 10 key pages;
    - HTAF pages don't use the HTS logo.
  - Full suite: 2,475 passed.
- **Not changed:**
  - The rider and driver mobile apps already use the HTS icon, splash and logo. They need no change and no new build.
  - `og-image.png` (the link preview) already shows the HTS logo.
- **[Owner decision 2026-10-15]** "Once successfully tested authorization granted to merge". Merged as `ff12bb0` after CI passed 6 of 6.
- **[Verified 2026-10-15 12:47 UTC]**
  - Production `/api/health` reported `ff12bb0`.
  - `/hts-logo-192.png`, `/icon-192.png` and `/favicon.ico` return 200.
  - Live HTML: the logo replaces the old marks on `/` and on `rider-dashboard` (top bar, sign-in screen and the Request Your Ride wizard).
  - `foundation.html` has no HTS logo.
  - HTML is served `no-cache`, and `service-worker.js` handles notifications only, so it doesn't cache pages.
  - The owner's 12:45–12:46 UTC phone screenshots showing "HT" were taken before the deploy.
- **HTAF tab icon:** addressed in §22.

## 22. Update 2026-10-15 (UTC): HTAF tab icon (#257)

- **[Owner decision 2026-10-15]** Owner's request: "Add the HTAF logo as the HTAF tab icon." This is a request for the work, not approval to merge.
- **New files, all made from the existing `public/htaf-logo.webp`:**
  - `htaf-favicon.ico` (16/32/48 px, transparent);
  - `htaf-icon-192.png` (transparent);
  - `htaf-apple-touch-icon.png` (180 px on white, because iOS can't show transparency).
- **Pages:** tab and home-screen icon tags added to `foundation`, `htaf-application`, `htaf-privacy`, `htaf-service-providers`, `htaf-terms`, `contact`, `leadership` and `admin-htaf`. Before, those pages had no icon tags, so browsers fell back to the HTS `favicon.ico`.
- **[Verified 2026-10-15, local]**
  - Guard tests:
    - HTAF pages use the HTAF icons and not the HTS ones;
    - Harvey Taxi pages don't use the HTAF icons;
    - the icon files exist.
  - Full suite: 2,519 passed.
- **[Owner decision 2026-10-15]** "Approved to merge #257". Merged as `487b7fb` after CI passed 6 of 6.
- **[Verified 2026-10-15 13:01 UTC]**
  - Production reported `487b7fb`.
  - The three HTAF icon files return 200.
  - `foundation`, `htaf-application` and `contact` link to the HTAF icons; `/` does not.

## 23. Update 2026-10-17 (UTC): autonomous rides become a waitlist (#258)

- **Context:**
  - Apple's guideline update of 16 October 2026 adds 2.5.19 (no hidden, dormant or undocumented features).
  - **[Verified 2026-10-17, code]** The rider dashboard offered "Autonomous Pilot" as a bookable ride. The server accepted `ride_type: "autonomous"` as an ordinary ride and matched it to human drivers.
  - **[Verified 2026-10-17, code]** The driver sign-up's "Autonomous Pilot" choice was ignored by the server, so those applicants were filed as ordinary human drivers.
- **[Owner decision 2026-10-17]** The owner's vision: AV-owning drivers send their vehicles on Harvey Taxi missions, plus a Harvey Taxi autonomous fleet. The owner approved option (a): a rider waitlist, a vehicle-owner interest list and a server block, so the option stays visible but can't be booked. A lawyer and insurance brief was also requested (`docs/legal/autonomous-vehicles-brief.md`).
- **Changes:**
  - **Rider dashboard:**
    - "AV Pilot" becomes "Autonomous rides: coming soon", linking to an email waitlist (the same pattern the home page already uses).
    - The booking wizard's Autonomous Pilot option is removed.
    - Old `?mode=autonomous` links open the standard ride flow.
    - The "future autonomous pilot systems" wording is removed.
  - **Driver sign-up:**
    - The "Autonomous Pilot" driver mode is removed.
    - New text: "Autonomous Vehicle Owner Program: planned, not available", with a link to register interest by email, and "every Harvey Taxi trip has a licensed human driver".
  - **Server:** `/api/rides/estimate` and every ride request that uses a fare quote refuse `ride_type: "autonomous"` with "Autonomous rides are not available yet". It is never quietly turned into a standard ride. `autonomous` is also removed from the accepted ride types.
  - **No database migration.** The waitlists go to support@ by email, as on the home page. The existing `autonomous_pilot_enabled` flag (false) is unchanged and unused.
  - **New file:** `docs/app-review/review-notes-2026-10.md`, draft Notes for Review for both apps.
- **[Verified 2026-10-17, local]**
  - New tests in `test/server.autonomous-unavailable.test.js`:
    - an autonomous estimate is refused;
    - an autonomous request with a valid quote is refused and creates no ride;
    - standard rides still work;
    - the screens have no booking mode and do have the waitlist links.
  - Full suite: 2,524 passed. One earlier run had the known intermittent `booking-flow.browser` failure; it passes alone and on the re-run.
- **Not changed:** `mobile/src/navigation.js` still lists `autonomous` as a deep-link mode. That's harmless, because the dashboard now opens the standard flow. A change there would need a new app build, so it's left for the next build.
- **[Unresolved]**
  - Whether delivery is enabled in production must be confirmed before the review notes are used.
  - Minimum rider age (owner decision).
- **[Owner decision 2026-10-17]** "Approved to merge #258". Merged as `1316185` after CI passed 6 of 6.
- **[Verified 2026-10-17 17:01 UTC, production]**
  - An `autonomous` fare estimate returns 400 "Autonomous rides are not available yet…"; a `standard` estimate returns 200.
  - The live `rider-dashboard.html` has the waitlist link and no `modeAutonomousBtn`.
  - The live `driver-signup.html` has the owner-program link and no autonomous radio button.

## 24. Update 2026-10-17 (UTC): drivers can't go online; manual verification button (#259)

**[Verified 2026-10-17, production database, read-only]** Driver readiness, excluding test, review and owner accounts.
- 19 drivers have `approval_status = approved`, and **none can go online**:
  - email verified: 0;
  - phone verified: 0;
  - identity (Persona) verified: 0;
  - background check (`checkr_status`): `not_started` for all 19;
  - vehicle on file: 19.
- Riders: 2. Completed paid trips: 0.

**[Owner decision 2026-10-17]** "Turn off Persona requirement for now, admins verify manually", then "Turn off checkr as well".
- These are Render settings: `ENABLE_PERSONA=false` and `ENABLE_CHECKR=false`. The owner makes the change; this session can't reach Render.
- **[Unverified]** Whether they have been set. The owner's screenshot of setting names (17 Oct) shows neither yet.
- **[Recommendation]** Use them for testing and App Review only. Before any real passenger trip, record a background check per driver and confirm Tennessee's requirement with counsel; it's question 3 in the counsel brief.

**[Owner decision 2026-10-17]** "Build the manual verification admin button". The PR:
- **Admin dashboard:** each driver shows ✓/✗ for Email, Phone, ID and Background, plus a **Manual verification** button. Its form has:
  - a tick box for each item the admin checked;
  - a required reason;
  - for ID and background only, a confirmation that equivalent documents were reviewed, and the admin token typed in for that one use. The token is never stored.
- **Existing routes it uses:**
  - email and phone: `PATCH /api/admin/drivers/:id/contact-verification-override`, with ordinary admin sign-in;
  - ID and background: `PATCH /api/admin/drivers/:id/compliance-override`, with elevated (token) sign-in.
  - Each writes the driver change and its audit record in one transaction, or neither. The database functions exist in production (verified 17 Oct).
- **Server change:** the admin drivers list now includes three true/false fields: `email_verified`, `phone_verified`, `persona_verified`. They are flags only, never codes or provider data.
- **[Verified 2026-10-17, local]**
  - New browser test `test/manual-driver-verification.browser.test.js` covers: the status chips; email and phone recorded with the reason; ID and background refused without the documentation tick or the token; a wrong token refused with nothing changed; the correct token records both with `admin_token` auth and `reviewed_documentation`; and the token is in neither the page nor browser storage afterwards.
  - Full suite: 2,525 passed.

**[Unresolved] Render settings, from the owner's screenshot of setting names; values were not shown:**
- **`ADMIN_API_TOKEN` is not set**, and neither is `HARVEY_ADMIN_TOKEN`. Without it, the ID and background part of the new button can't be used. Email and phone work with ordinary sign-in.
- **`ADMIN_SESSION_SECRET` is not set**, so admin sessions are signed with `ADMIN_PASSWORD`. **[Recommendation]** Set a dedicated, generated `ADMIN_SESSION_SECRET`.
- **Not read by the code:** `AV_ENABLED`, `HUMAN_DRIVER_ENABLED`, `DISPATCH_MODE` and `OPENAI_SUPPORT_MODEL` (checked with grep on 17 Oct). They can be removed later; there's no rush.

**[Owner decision 2026-10-17]** "Approved to merge #259". Merged as `3a9a9ca` after CI passed 6 of 6.

**[Verified 2026-10-17 17:40 UTC, production]**
- Production reported `3a9a9ca`.
- The live `admin-dashboard.html` contains the manual verification form and the per-driver status row.
- `/api/admin/drivers` still returns 401 without a sign-in.

**Handoff:**
- **Owner actions in Render:**
  - add `ADMIN_API_TOKEN` (use Generate);
  - set `ENABLE_PERSONA` and `ENABLE_CHECKR` as decided.

## 25. Update 2026-10-17 (UTC): delivery paused; merchant portal planned (#260, merged as `fcfd7f8`)

**[Verified 2026-10-17, production]**
- `/api/rides/estimate` with `ride_type: food` returned 200 with a $11.50 delivery quote: delivery could be booked.
- The home page meanwhile says delivery is "planned and can't be booked".
- `ENABLE_DELIVERY`, `ENABLE_FOOD_DELIVERY` and `ENABLE_GROCERY_DELIVERY` were only reported in status output and never enforced. None is set on Render, according to the owner's screenshot of setting names.

**[Owner decision 2026-10-17]**
- "We need the delivery section to work properly on all ends for merchant, rider and driver."
- Merchant model chosen: **Merchant portal** (stores sign up, receive orders, mark them ready, are paid through Harvey Taxi).
- Until it is ready: **pause delivery**.

**Changes:**
- **Server:**
  - the three switches now default to off, and are enforced: `/api/rides/estimate` and every quoted ride request refuse food and grocery with "Delivery is paused…";
  - `/api/config/public` reports `delivery: {enabled, food, grocery}`;
  - deliveries already in progress are unaffected.
- **Rider Delivery Center:** a "Delivery is paused" notice with a waitlist email. The request buttons show the notice instead of opening the booking flow.
- **Tests:** four delivery test files set the switches on, because they exercise the flow itself. New `test/server.delivery-paused.test.js`.
- **New file:** `docs/merchant-portal-plan.md`. It covers the current state, the target flow, six phases and owner decisions (commission, pricing, exclusions, missing items, substitutions, pilot stores), plus questions for an accountant (Tennessee marketplace-facilitator sales tax), counsel and Stripe.

**[Verified 2026-10-17, local]** Full suite passed (2,524), plus 6 new tests.

**To turn delivery back on later:** set `ENABLE_DELIVERY` (and the food/grocery switch) to `true` on Render. This is an activation, so it needs the owner's approval.

**[Owner decision 2026-10-17]** "Approved to merge #260". Merged as `fcfd7f8`.

**[Verified 2026-10-17 17:48 UTC, production]**
- `/api/health` reports version `fcfd7f8`.
- `/api/rides/estimate` refuses `food` and `grocery` (400, "Delivery is paused…"); `standard` returns 200.
- `/api/config/public` reports `delivery: {enabled: false, food: false, grocery: false}`.
- The production database had 0 food or grocery rides, so no booked delivery was affected.

**Handoff:**
- **Done:** delivery paused and verified live.
- **Next:** see §26.

## 26. Update 2026-10-17 (UTC): merchant terms locked; merchant portal phase 1a (#261, merged as `1d5321b`)

**[Owner decision 2026-10-17]** "Approve the recommended versions" of the six merchant terms. Recorded in `docs/merchant-portal-plan.md` §4:
1. Commission 12% of the item subtotal, on completed orders only; card fees come out of Harvey Taxi's 12%.
2. Merchants set their prices; if higher than in store, riders see a disclosure.
3. Extended list of excluded items (8 groups); applicants must confirm.
4. Missing items: the customer is refunded immediately and the amount deducted from the merchant's payout (48-hour photo-backed dispute window); Harvey Taxi absorbs it when the merchant wins; claims above a monthly limit go to manual review.
5. Substitutions: chosen by the customer per item at checkout; refund after 7 minutes without an answer; 15% card-authorization buffer for groceries.
6. Pilot: 5 stores (3 restaurants, 2 grocery or convenience), only once at least 5 drivers are fully verified.

**[Owner decision 2026-10-17]** Payouts and fees confirmed:
- **Payouts:** weekly, every Monday, for the prior Monday-to-Sunday's completed orders. This is to be set in Stripe Connect in phase 5. Stripe Connect isn't set up yet, so nothing is configured today.
- **Fees:** commission only, 12%. No monthly or fixed fee.

Both terms are recorded in plan §4 (items 7–8) and shown on the application page.

**Phase 1a changes (not merged, not deployed):**
- **Migration (not applied):** `supabase/migrations/20261017010000_merchants.sql` creates `public.merchants` (applications and review status). RLS on, no client access; one open application per contact email; reject/suspend need a reason.
- **Server:** `POST /api/merchants/apply` (public, 5 per hour per address), `GET /api/admin/merchants` and `PATCH /api/admin/merchants/:id/review` (admin sign-in; approve, reject or suspend; conditional update; audit entry). Before the migration is applied, applications return 503 and the admin list shows "not set up".
- **Pages:** new `public/merchant-apply.html` (HTS-branded; says delivery isn't live; lists terms in brief and the exclusions); a "Partner With Us" card on the home page; a "Merchant Applications" section on the admin dashboard. On the HTAF domain the page redirects to the HTAF home page.
- **Not included:** merchant sign-in, catalog, orders and payouts (phases 1b–5). Delivery booking stays paused.

**[Verified 2026-10-17, local]** New tests: `lib/merchants.test.js` (15), `test/server.merchants.test.js` (14), `test/db/merchants.db.test.js` (5, real Postgres), `test/admin-merchants.browser.test.js` (1, Chromium). Full suite: 2,562 passed; the one failure (the migration-list test, which must name each new migration) was fixed and rerun. Database suite: 154 passed, 4 skipped.

**[Recommendation]** Before collecting real applications, have counsel review the terms summary on the application page and the privacy wording.

**Handoff:**
- **Done:** terms recorded; phase 1a built and tested locally.
- **Remaining:** merge; apply the migration; phase 1b (merchant sign-in) onward. Payout schedule and fee terms go into Stripe Connect (phase 5) and into the merchant agreement (counsel).
- **Next authorized action:** none. Applying the `merchants` migration needs the owner's **separate** approval.

**[Owner decision 2026-10-17]** "Approved to merge #261". Merged as `1d5321b`. All six CI checks were green on the merged head.

**[Verified 2026-10-17 18:08 UTC, production]**
- `/api/health` reports version `1d5321b`.
- `/merchant-apply.html` returns 200 and shows "Delivery isn't live yet". The home page links to it.
- `GET /api/admin/merchants` without sign-in returns 401.
- `POST /api/merchants/apply` with an empty body returns 400 (validation). No application was submitted.
- Food and grocery estimates are still refused (400).
- The `public.merchants` table does **not** exist in production (read-only check), so valid applications will get 503 "not open yet" until the migration is applied.
- **[Unresolved]** The redirect of `/merchant-apply.html` on the HTAF domain wasn't checked live, because this session can't reach that host. It is covered by local tests.

**[Owner decision 2026-10-17]** Approved creating the `merchants` table in production "to enable live vendor applications".

**[Verified 2026-10-17 18:11 UTC, production]** Migration `merchants` applied to `orgahzncmzptljapqffj`.
- RLS on, 0 policies. `anon` and `authenticated` have no access; `service_role` can insert and update.
- 19 columns. Indexes: `merchants_pkey`, `merchants_open_contact_email_idx`, `merchants_status_created_idx`.
- A test insert inside a transaction that was then rolled back confirmed:
  - the defaults `pending` and `TN`;
  - a second open application with the same email (different case) is blocked;
  - a rejection with a reason under 10 characters is blocked.
- 0 rows afterwards. No test application was kept.
- **Vendor applications are now open.** A valid submission on `/merchant-apply.html` is stored as `pending` for admin review. Delivery booking remains paused.

**[Owner decision 2026-10-17]** The merchant agreement (counsel) will include: the 12% commission-only structure; weekly Monday payout initiation; late-Sunday adjustments applied to the next week's payout; and that Monday is the transfer date, with bank arrival depending on Stripe and the merchant's bank. The application page wording is updated to match (this PR).

**Handoff (2026-10-17):**
- **Done:** phase 1a live; table applied and verified.
- **Remaining:**
  - counsel drafts the merchant agreement;
  - phase 1b (merchant sign-in, store hours);
  - Stripe Connect (phase 5);
  - the HTAF-domain redirect check, to be done by opening it in a browser.
- **Next authorized action:** none. Merging this status/wording PR needs the owner's approval.

**[Owner decision 2026-10-17]** "Approved to merge #262": merged as `795970a`. **[Verified 2026-10-17 18:15 UTC, production]** `/api/health` reports version `795970a`, and the application page shows the payout-timing wording.

**[Owner decision 2026-10-17]** Approved:
- submitting one clearly marked test application end to end, then deleting it;
- keeping its audit-log entry, which isn't identifying.

**[Verified 2026-10-17 18:12 UTC, production]** End-to-end test through `POST /api/merchants/apply`:
- **What was submitted:**
  - business name "TEST APPLICATION - Claude verification - delete";
  - email `merchant-e2e-test@example.invalid`;
  - phone in the fictional 555-01xx range.
- **What was confirmed:**
  - the response was 201, and the record was stored as `pending` in `TN`;
  - the phone number was normalized to `+16155550100`, and the exclusions confirmation was recorded;
  - a second application with the same email in upper case was refused with 409;
  - one `audit_logs` entry (`merchant_application_submitted`) was written. It contains only the record ID and category, and is kept under the retention rule.

**[Unresolved]** The test record (ID `02ca8c15-00c3-4405-b3c3-45386b601c13`) has **not** been deleted:
- Three delete attempts through the database connector were cancelled at its confirmation step, at about 18:14, 18:20 and 18:25 UTC. This session can't approve that kind of production deletion.
- A read-only check confirmed the row is still present, with status `pending`, and is the only row in `merchants`.
- It appears in the admin dashboard's merchant list until it is removed.
- The owner can delete that one row in the Supabase table editor, or approve the connector's confirmation prompt.
- **[Verified 2026-10-17 18:30 and 18:51 UTC, production]** The owner reported deleting the row in Supabase. Read-only checks afterwards still found it in `orgahzncmzptljapqffj` `public.merchants` (1 row, this ID). **[Unresolved]** The deletion may not have been saved, or may have been made in another project.

## 27. Update 2026-10-17 (UTC): assistant knowledge sources (#264, merged as `9f4abb7`)

**[Owner decision 2026-10-17]** Option A ("add the published merchant application page as a searchable vector source and allow the vector search to read admin-approved articles") and option B (policy facts → draft articles for admin approval).

**[Verified 2026-10-17, code and production database, before this change]**
- The Harvey Taxi pilot corpus, which feeds keyword and vector retrieval, was three published pages: Terms, Privacy Policy and Support.
- Admin-approved articles reached only the rule-based assistant.
- Production had 0 knowledge articles.

**Changes (not merged, not deployed):**
- `lib/knowledge/sources.js`: adds `/merchant-apply.html` as an approved source. This applies to both assistants.
- `server.js`: the pilot's Harvey Taxi corpus is the published pages plus the approved articles from the knowledge store's cached copy. When an article's slug@version set changes, the corpus is rebuilt, which also rebuilds the in-memory vector index. HTAF is unchanged (keyword only, no articles).
- The `pgvector` store mode is not used in production (embeddings table empty), so it is unaffected. **[Unresolved]** It would need re-indexing if it is ever enabled.
- Test: `test/server.assistant-pilot-knowledge-sources.test.js` (4). It covers:
  - a merchant question answered from the page;
  - an approved article quoted with its `/policies.html` link;
  - a retired article no longer quoted;
  - the vector index including the article and being rebuilt without it after retirement.

**[Verified 2026-10-17, local]** Full suite 2,567 passed (21 suites skipped as usual). The assistant evaluation (`test/agent-eval`) passed unchanged.

**[Unresolved]** Option B is waiting on the owner's facts. Policy wording must come from Harvey Taxi. Areas:
- service area;
- pricing beyond the estimate;
- accessibility;
- lost and found;
- vehicle and insurance requirements;
- minimum age;
- account deletion;
- HTAF eligibility, privacy, no-guarantee wording and tax status.

**[Unresolved]** Merchant test record `02ca8c15-…` is still in production. See §26.

**[Owner decision 2026-10-17]** "Approved … merge … PR #264". Merged as `9f4abb7`; all six CI checks were green.

**[Owner decision 2026-10-17]** The owner supplied policy facts for option B. Drafting is recorded in §28.

**Handoff:**
- **Next:** check that the pilot answers a merchant question with the `/merchant-apply.html` source once `9f4abb7` is live.

## 28. Update 2026-10-17 (UTC): policy articles from the owner's facts (option B)

**[Owner decision 2026-10-17]** The owner supplied policy facts and asked for draft articles for admin review.

**[Verified 2026-10-17, code]** Each fact was checked against the app before drafting.
- **Cancellation fee:** the database enforces `rides.cancellation_fee_cents = 0`, and riders are shown $0.00.
- **Fares:** base fare, per mile, per minute and booking fee, with a minimum fare. There is no peak, airport, toll or wait-time charge.
- **Wheelchair-accessible vehicles:** no dispatch option exists.
- **Pet-friendly tiers:** none exist.
- **Account deletion:** a request that staff review, not instant.
- **Lost items:** reported through Support in the app and linked to the latest trip in the last 14 days.

**Created in production as drafts (ids 1–5):**
- `service-area`;
- `lost-and-found`;
- `service-animals-pets-car-seats`;
- `driver-requirements`;
- `rider-age-account-deletion`.

All have status `draft` and version 1, and each has a `knowledge.article_created` audit entry with actor `claude-code-session`. Drafts aren't public or quoted until an admin approves them on `/admin-knowledge.html`.

**Wording changed from the owner's facts, to match the app:**
- Account deletion: "submit a deletion request" instead of "instantly".
- Pets: no "pet-friendly tiers".
- Lost items: no "ride history details" route.
- Insurance: "meets Tennessee's requirements for transportation network company (rideshare) drivers" instead of "commercial or personal". **[Recommendation]** Counsel to confirm.

**[Unresolved] Not drafted, because they conflict with live behaviour (owner decision needed):**
- **Pricing surcharges** (peak, airport, tolls, wait time after 5 minutes): not charged by the app. Airport wording also falls under the standing rule against airport claims.
- **Cancellation fee** after the driver is en route: the app charges $0.
- **Wheelchair-accessible vehicles** via specialized dispatch: not built.
- **HTAF eligibility** "within Davidson County": HTAF's published pages say "eligible Tennessee residents". The other HTAF facts (no guarantee, privacy, 501(c)(3) status, EIN 41-5115030) are already published and answered.

**[Owner decision 2026-10-17]** Option A for the four held items: publish articles describing what the app supports today.
- **Pricing:** base fare, per mile, per minute, booking fee and minimum fare. Unbuilt surcharges are omitted.
- **Cancellation:** the current $0 fee, while counsel reviews any future fee.
- **Wheelchair-accessible vehicles:** standard vehicles today; specialized dispatch is on the roadmap.
- **HTAF eligibility:** use the published wording, "eligible Tennessee residents".

PR #263 merged as `5ab78da`.

**[Verified 2026-10-17 18:54 UTC, production]** Created drafts (ids 6–8), each with a `knowledge.article_created` audit entry:
- `fares`: no airport or surcharge wording;
- `cancellation-fees`: "$0.00, shown before you confirm";
- `wheelchair-accessible-vehicles`: standard vehicles now, specialized dispatch "on the roadmap".

**HTAF:** no change needed. Its published pages already say "eligible Tennessee residents", and its assistant answers from them. Harvey Taxi articles are published on Harvey Taxi's `/policies.html`, so HTAF content doesn't belong there.

**[Recommendation]** Before saying more about accessibility, counsel should advise on ADA duties for rideshare platforms.

**[Unresolved]** The test merchant row `02ca8c15-…` was still present at 18:53 UTC.

**Handoff:**
- **Next authorized action:** the owner, as admin, reads and approves the eight drafts (ids 1–8) on `/admin-knowledge.html`. Approval refreshes the assistant immediately. None has been approved by this session.
- The owner deletes the test merchant row in the Supabase table editor and confirms the dialog.

**[Verified 2026-10-17 18:59 UTC, production]** #265 merged as `849cfad`.
- An admin approved all eight articles (ids 1–8) on `/admin-knowledge.html` between 18:57 and 18:58 UTC. None was approved by this session, and all are still version 1, so the wording is unchanged from the drafts.
- `/api/knowledge/articles` lists all eight.
- The assistant pilot answered "Is there a fee to cancel a ride?" by quoting `cancellation-fees`, with the source `/policies.html#cancellation-fees`.
- Test merchant row `02ca8c15-…`: see the resolution below.

## 29. Update 2026-10-17 (UTC): trusted client IP for rate limits (#266, merged as `2e98bfd`)

**[Owner decision 2026-10-17]** Next step 1: rate-limit hardening against IP spoofing.

**[Verified 2026-10-17 ~19:02 UTC, production, before the fix]** Five empty applications to `POST /api/merchants/apply` (refused with 400, nothing stored) from one spoofed `X-Forwarded-For` value, then a sixth, returned 400 ×5 and then 429. One more with a different spoofed value returned 400, meaning a fresh allowance.
- `getClientIp` used the first `X-Forwarded-For` entry. Render appends to that header rather than replacing it, so the first entry is whatever the client wrote.
- Every rate limit, usage key and audit `ip_address` used this function.

**Responses show `server: cloudflare` and `cf-ray`**, so traffic arrives through Render's Cloudflare edge.

**Change (not merged, not deployed):** `getClientIp` in `server.js` now uses, in order:
1. `CF-Connecting-IP`, when it is a valid IP. Cloudflare sets this header and overwrites any value a client sends.
2. Otherwise `req.ip`, the address the nearest proxy saw (`trust proxy` 1).
3. Otherwise the socket address.

The first `X-Forwarded-For` entry is no longer used. Public `/api/health` is unchanged; it still reports up/down and the version only.

**Test:** `test/server.client-ip.test.js` (3) checks that:
- a client-written `X-Forwarded-For` entry doesn't reset the limit;
- `CF-Connecting-IP` decides the caller whatever `X-Forwarded-For` says, and a different caller keeps its own allowance;
- a malformed edge header is ignored.

**[Verified 2026-10-17, local]** Full suite: 2,570 passed.

**[Unresolved]** Whether Render forwards `CF-Connecting-IP` to the app is an inference from a community report and Cloudflare's normal behaviour; Render's docs don't state it.

**After deploy, verify:**
- Repeat the production test with a changed `X-Forwarded-For` and with a spoofed `CF-Connecting-IP`. Both must not reset the limit.
- Check that new audit `ip_address` values differ between callers. If every caller had the same address, everyone would share one rate-limit bucket.

**[Owner decision 2026-10-17]** "Approved … merge PR #266". Merged as `2e98bfd`; all six CI checks were green. Live at 19:10 UTC (`/api/health` version `2e98bfd`).

**[Verified 2026-10-17 19:10–19:18 UTC, production]**
- **Forged edge header:** a request carrying a client-supplied `CF-Connecting-IP` was refused by Cloudflare with 403 before reaching the app, so the header can't be forged.
- **Real address recorded:** the owner's admin actions after the fix (`dispatch_paused` 19:15:23 and `dispatch_resumed` 19:15:27) recorded the same public address as the owner's article approvals at 18:57–18:58, before the fix. It is not in a Cloudflare or private range, so the app receives Cloudflare's header and keys on the real caller. Addresses are not recorded here.
- **Limiter counts per caller:** this session's test machine sends from a rotating pool of at least 10 addresses (160.79.106.x). 40 empty applications produced 3 × 429, consistent with per-address limits.

**Handoff:**
- **Done:** the IP-spoofing bypass is closed and verified in production.
- **Remaining:** none for this item.

## 30. Update 2026-10-17 (UTC): test merchant row removed

**[Verified 2026-10-17 19:12 UTC, production]** The owner ran the scoped delete in the Supabase SQL editor of `orgahzncmzptljapqffj`; the owner's screenshot shows it returned the row's ID. A read-only check afterwards found 0 rows in `public.merchants`.

Its `merchant_application_submitted` audit entry, which holds only the record ID and category, is kept under the retention rule (owner decision 2026-10-17).

The earlier §26 [Unresolved] item is resolved.

**Handoff:**
- **Done:** the merchant end-to-end test is complete and cleaned up.
- **Next authorized action:** none pending. Open owner choices from the earlier list:
  - the agent-action rule in the docs;
  - merchant screening flags;
  - the refund rules engine, which comes with phase 3 (orders).

## 31. Update 2026-10-17 (UTC): agent action rules (#268, merged as `a31cb3c`)

**[Owner decision 2026-10-17]** "Write agent action rules."

**Changes (documentation and tests only; no behaviour change):**
- **New `docs/agent-action-rules.md`:** every agent action follows propose → check → approve → apply, under eleven rules:
  1. agents read; the server writes;
  2. answers come from approved text;
  3. the check is code, not another model;
  4. automatic actions need an owner-approved switch, starting in shadow mode;
  5. the kill switch overrides everything;
  6. every change is conditional and audited;
  7. decisions about people stay with people;
  8. money moves only with a person's approval;
  9. private data stays private;
  10. heavy model work runs outside the website;
  11. approval doesn't carry over.

  Each rule marks where the code already enforces it. A checklist covers adding a new agent action.
- **New `test/agent-action-rules.test.js`:**
  - the agent tool files make no database writes;
  - every pilot tool is read-only;
  - the kill switch, shadow mode and dispatch pause each prevent automation;
  - every file the document cites exists.
- **`CLAUDE.md`:** one line pointing to the rules.

**Handoff:**
- **Next authorized action:** none. Merging needs the owner's approval.

**[Verified 2026-10-17 19:30 UTC]** #268 merged as `a31cb3c`; production `/api/health` reports `a31cb3c`, healthy. The full suite on `main` passed: 2,584, with the usual 21 suites skipped.

## 32. Update 2026-10-17 (UTC): merchant screening flags (#269, merged as `057c910`)

**[Owner decision 2026-10-17]** Flag suspicious merchant applications for manual admin review; never reject automatically.

**Changes (not merged, not deployed):**
- **New `lib/merchantScreening.js`:** a pure function that works out review flags when the admin list is read. Nothing is stored, no status changes and there is no database migration, in line with `docs/agent-action-rules.md` rules 1 and 7. The flags:
  - throwaway-inbox email domain (a short list; a miss gives no flag);
  - ZIP outside 370–372 (the Nashville pilot area), or no ZIP;
  - street address with no number;
  - placeholder-looking business name;
  - same phone or same street address as another application, with addresses normalized so "Street" and "St." match;
  - same email or phone as a rejected application;
  - a related application within 24 hours.
- **`GET /api/admin/merchants`:** each application now carries `review_flags` (code and label).
- **Admin dashboard, Merchant Applications:** flagged applications show a "⚠ Check before deciding" box listing the reasons, with the note "Flags are hints for staff, not decisions". Approve, reject and suspend are unchanged.

**[Verified 2026-10-17, local]**
- New `lib/merchantScreening.test.js` (5).
- `test/server.merchants.test.js` +1: flags are present, the row is unchanged, and a flagged application can still be approved.
- The browser test checks that the flag box shows on the flagged application only.
- Full suite: 2,590 passed.

**[Recommendation]** Review the flag list after the first real applications, and remove any flag that mostly produces false alarms.

**Handoff:**
- **Next authorized action:** none. Merging needs the owner's approval.

**[Verified 2026-10-17 19:43 UTC, production]** #269 merged as `057c910`.
- `/api/health` reports `057c910`, healthy.
- The live admin dashboard includes the flag display.
- `GET /api/admin/merchants` without sign-in returns 401.
- `merchants` has 0 rows, so no flags show until stores apply.

## 33. Update 2026-10-17 (UTC): refund engine (#270, merged as `e7e80ef`)

**[Owner decision 2026-10-17]** "Build the refund rules engine."

**[Owner decision 2026-10-17] Term 4 conflict resolution:**
- **Approval:** agent rule 8 (human approval) takes precedence over the "refunded straight away" wording in term 4. Missing-item refunds are prepared automatically as proposals, and an authorized admin or staff member approves each one before money moves through Stripe Connect.
- **Claim window:** refund requests must be made within 48 hours of order completion.

**Changes (no behaviour change; nothing calls the engine until phase 3):**
- **New `lib/refundEngine.js`.** Pure functions in whole cents, using Nashville time. Details are in `docs/merchant-portal-plan.md` §4b. It covers:
  - commission;
  - grocery authorization;
  - substitution timeout;
  - the missing-item refund plan, including the 48-hour claim window, the pickup-checklist photo check, the purchase-value cap and the abuse limit;
  - `buildRefundProposal` (frozen, `pending_review`, `requires_human_approval: true`, the same key every time for the same claim);
  - merchant dispute status;
  - payout weeks with rollover.
- **New `lib/refundEngine.test.js` (30 tests):** every rule and refusal, the claim-window edges, the photo-contradiction and no-photo cases, proposal immutability and key, daylight saving and late-Sunday rollover, and a guard that the module never calls Stripe, the database or the network.

**[Recommendation, built in]** On a missing item, the merchant returns its net share, and Harvey Taxi reverses its 12% on that item.

**[Assumption, built in]** If the photos contradict a claim, or there is no photo, a person reviews it; it is never refused automatically.

**[Unresolved: before phase 3 goes live]**
- The monthly claim limit.
- Who bears the refunded sales tax (accountant).

**Handoff:**
- **Next authorized action:** none. Merging needs the owner's approval.

**[Owner decision 2026-10-17]** "Approved to merge #270". Merged as `e7e80ef`; all six CI checks were green.

**[Verified 2026-10-17 20:29 UTC, production]** `/api/health` reports `e7e80ef`, healthy. Nothing calls the engine yet; phase 3 will.

**[Owner decision 2026-10-17]** The monthly claim limit is 3 missing-item claims per customer per calendar month; the 4th and later go to manual review. Set as `MONTHLY_CLAIM_LIMIT` (the default) in `lib/refundEngine.js`, with a test (PR `claude/claim-limit-status`, not merged).

**[Unresolved]**
- Who bears the refunded sales tax: waits on the accountant's written guidance.
- The merchant agreement: waits on counsel's draft.

**[Owner decision 2026-10-17]** Phase 1b approved: merchant sign-in and store hours. It is a separate PR, and its migration needs separate approval.

**Handoff:**
- **Next authorized action:** none. Merging needs the owner's approval.

## 34. Update 2026-10-17 (UTC): merchant portal phase 1b, store sign-in and hours (#272, merged as `5438101`)

**[Owner decision 2026-10-17]** Phase 1b approved: merchant sign-in and store hours.

**Changes (not merged, not deployed):** details are in `docs/merchant-portal-plan.md` §4c.
- **Migration `20261017020000_merchant_users_hours.sql` (not applied; needs separate owner approval):**
  - `merchant_users` (phone sign-ins, `session_version`);
  - `merchant_hours` (one window per weekday);
  - `bump_merchant_user_session_version()`.

  RLS on, no client access.
- **`lib/merchantAuth.js`:** a signed merchant session token (the same design as riders) and store-hours validation.
- **Server:**
  - `POST /api/merchant/session/start|verify|logout`: Twilio Verify SMS, limits per address and per phone, no account enumeration;
  - `GET /api/merchant/me`;
  - `PUT /api/merchant/hours`;
  - admin `POST /api/admin/merchants/:id/users` (approved stores only) and `POST /api/admin/merchant-users/:id/disable` (ends sessions);
  - the admin merchant list now shows each store's sign-in people.

  Every write is audited.
- **New `public/merchant-portal.html`:** HTS-branded, noindex. It redirects on the HTAF domain and is disallowed in `robots.txt`.
- **Admin dashboard:** "Give sign-in access" and "Remove" on approved stores.

**[Verified 2026-10-17, local]**
- New tests:
  - `lib/merchantAuth.test.js` (10);
  - `test/server.merchant-portal.test.js` (10): no enumeration, wrong code, cookie flags, header required, hours saved and refused, sign-out and access removal end sessions, suspended store blocked, forged cookie refused;
  - `test/db/merchantUsersHours.db.test.js` (4, real Postgres);
  - `test/merchant-portal.browser.test.js` (1, Chromium at phone width).
- `test/fakeSupabase.js`: upserts now match on multi-column keys.
- `test/db/merchants.db.test.js`: now clears dependent rows.
- Full suite: 2,643 passed. Database suite: 158 passed.

**[Unresolved: owner setup before stores can sign in]**
1. Approve the migration.
2. Add `MERCHANT_SESSION_SECRET` on Render (name only recorded here).
3. Twilio Verify charges per code.

**[Limitation]** Hours past midnight and split shifts aren't supported yet.

**Handoff:**
- **Next authorized action:** none. Merging needs the owner's approval; the migration needs separate approval.

**[Owner decision 2026-10-17]**
- "Approved to merge #271 and #272". #271 merged as `c521524`; #272 merged as `5438101` after a status-record merge conflict was resolved. All six CI checks were green on each.
- The owner reports `MERCHANT_SESSION_SECRET` set on Render. The value is not recorded.

**[Verified 2026-10-17 20:52 UTC, production]**
- `/api/health` reports `5438101`, healthy.
- `/merchant-portal.html` returns 200.
- `GET /api/merchant/me` with the portal header returns 401 "Please sign in" (not 503), so the session secret is configured.
- Without the header it returns 403; the admin sign-in-access route without admin returns 401.

**[Owner decision 2026-10-17]** "Approved to apply the phase 1b migration".

**[Verified 2026-10-17 20:55 UTC, production]** Migration `merchant_users_hours` applied to `orgahzncmzptljapqffj`, identical to the merged file.
- RLS is on for both tables, with 0 policies. `anon` and `authenticated` have no access; `service_role` can insert.
- `bump_merchant_user_session_version` can be run by `service_role` only.
- Indexes: `merchant_users_pkey`, `merchant_users_active_phone_idx`, `merchant_users_merchant_idx`, `merchant_hours_pkey`.
- 0 rows in each table.
- `POST /api/merchant/session/start` with a phone that isn't set up returns 200 `{sent: true}` and sends no text.

**Store sign-in is now live:** approve a store, then use "Give sign-in access" on the admin dashboard; the store signs in at `/merchant-portal.html`.

**[Unresolved]** No real store has signed in yet. The first real sign-in will be the first end-to-end check of the Twilio Verify text for stores.

**Handoff:**
- **Done:** phases 1a and 1b live.
- **Remaining:**
  - the first pilot store;
  - the accountant's sales-tax guidance;
  - counsel's merchant agreement;
  - phase 2 (catalog).
- **Next authorized action:** none pending.

## 35. Update 2026-10-17 (UTC): #273 merged; merchant portal phase 2, store catalog (PR `claude/merchant-catalog-phase2`, not merged)

**[Owner decision 2026-10-17]** "Approved to merge #273". **[Verified 2026-10-17]** All six CI checks were green on head `44e8ed1`; merged as `03bae5c` (documentation only).

**[Owner decision 2026-10-17]** "Start phase 2 catalog". Scope: items, prices, availability, substitution flags and CSV import; excluded items held for staff review, never rejected automatically; photos deferred; one PR; the migration needs separate approval.

**Changes (not merged, not deployed):** details are in `docs/merchant-portal-plan.md` §4d.
- **Migration `20261017030000_catalog_items.sql` (not applied; needs separate owner approval):** `catalog_items`. One live item per name per store (ignoring case). A hidden item must record who hid it, when, and a reason of at least 10 characters. RLS on, no client access.
- **`lib/catalog.js`:** item validation, price parsing, excluded-category screening (8 categories, whole words), and the CSV parser.
- **Server:**
  - store routes: `GET /api/merchant/catalog`, `POST|PATCH|DELETE /api/merchant/catalog/items`, `POST /api/merchant/catalog/import` (with a preview mode);
  - admin routes: `GET /api/admin/catalog/held`, `POST /api/admin/catalog/items/:id/review` (allow, or keep hidden with a reason).

  Every write is audited.
- **Store portal:** a Catalog card (add, edit, remove, CSV preview and import).
- **Admin dashboard:** "Catalog Items Held for Review".

**[Verified 2026-10-17, local]**
- New tests:
  - `lib/catalog.test.js` (37);
  - `test/server.merchant-catalog.test.js` (9): held vs listed, duplicate names, other stores' items, a hidden item can't be edited back, CSV preview and import, re-import by name;
  - `test/db/catalogItems.db.test.js` (6, real Postgres);
  - the browser tests for the store portal and the admin dashboard now cover the catalog (Chromium).
- Full suite: 2,691 passed (217 skipped: database and environment-gated suites). Database suite: 164 passed, 4 skipped.

**[Unresolved]**
- Customers can't see the catalog yet; that comes with ordering (phase 3).
- Item tax categories wait on the accountant's sales-tax guidance.

**Handoff:**
- **Done:** #273 merged; phase 2 built and tested locally.
- **Remaining:** merge approval for the phase 2 PR; separate approval to apply its migration; then the first pilot store's catalog.
- **Next authorized action:** none. Merging and applying the migration each need the owner's approval.

**[Owner decision 2026-10-17]** "Approved to merge #274". **[Verified 2026-10-17]** All six CI checks were green on head `cb49da3`; merged as `0d209be`.

**[Verified 2026-10-17 21:12 UTC, production]**
- `/api/health` reports `0d209be`, healthy, database connected.
- `/merchant-portal.html` and `/admin-dashboard.html` return 200.
- `GET /api/merchant/catalog` without a session returns 401; `GET /api/admin/catalog/held` without admin returns 401.
- `public.catalog_items` doesn't exist yet (the migration isn't applied). Until it is, the portal hides the Catalog card and the admin section says the catalog isn't set up.

**[Owner decision 2026-10-17]** "Approved to apply the catalog migration".

**[Verified 2026-10-17 21:15 UTC, production]** Migration `catalog_items` applied to `orgahzncmzptljapqffj`, identical to the merged file (same SHA-256 as `main`).
- RLS on, 0 policies. `anon` and `authenticated` have no access; `service_role` can insert.
- 19 columns. Indexes: `catalog_items_pkey`, `catalog_items_store_name_idx`, `catalog_items_merchant_idx`, `catalog_items_held_idx`.
- 0 rows. `/api/health` still healthy on `0d209be`.

**The catalog is now live** for signed-in stores (`/merchant-portal.html`, Catalog card) and for staff (admin dashboard, "Catalog Items Held for Review"). Customers can't see it until ordering (phase 3).

**[Unresolved]** No store has added an item yet; the first real item will be the first end-to-end check in production.

**Handoff:**
- **Done:** phase 2 deployed and its migration applied.
- **Remaining:** the first pilot store's catalog; optional staff view of a store's full catalog (not built; needs the owner's go-ahead); the accountant's sales-tax guidance; counsel's merchant agreement.
- **Next authorized action:** none pending.

## 36. Update 2026-10-17 (UTC): staff view of a store's full catalog (PR `claude/admin-store-catalog-view`, not merged)

**[Owner decision 2026-10-17]** "Build the staff full-catalog view".

**Changes (not merged, not deployed; no migration):** details are in `docs/merchant-portal-plan.md` §4d.
- **Server:** `GET /api/admin/merchants/:id/catalog` (admin only). It returns the store, its live items in every review state with who decided and why, and counts (total, listed, held, hidden, out of stock). Read-only; it writes nothing.
- **Admin dashboard:** "View catalog" on approved and suspended stores opens a read-only table under the store. Store-entered text is escaped. Held items are still decided in "Catalog Items Held for Review".

**[Verified 2026-10-17, local]**
- `test/server.merchant-catalog.test.js`: now 10 tests. The new one checks admin-only access (no session and a store session both get 401), one store's items only, removed items left out, counts, staff decisions shown, an unknown store gets 404, and nothing written or audited.
- `test/admin-merchants.browser.test.js`: now 3 tests (Chromium). The new one checks the button appears only for stores that can have a catalog, the counts and table, reasons shown, removed items left out, a store item name containing HTML is shown as text and not run, no controls in the panel, and nothing changed.

**Handoff:**
- **Done:** the staff full-catalog view is built and tested locally. Full suite: 2,693 passed.
- **Remaining:** merge approval.
- **Next authorized action:** none. Merging needs the owner's approval.

**[Owner decision 2026-10-17]** "Approved to merge #276". **[Verified 2026-10-17]** All six CI checks were green on head `5ad2442`; merged as `46f480d`.

**[Verified 2026-10-17 21:37 UTC, production]**
- `/api/health` reports `46f480d`, healthy, database connected.
- `GET /api/admin/merchants/:id/catalog` without admin returns 401.
- `/admin-dashboard.html` serves the "View catalog" code.
- A request during the switchover got 404 from the previous server; 15 seconds later the route answered 401. Recorded so it isn't mistaken for a fault.

**Handoff:**
- **Done:** the staff full-catalog view is live (no migration).
- **Remaining:** the first pilot store's catalog; the accountant's sales-tax guidance; counsel's merchant agreement.
- **Next authorized action:** none pending.

## 37. Update 2026-10-17 (UTC): vendor onboarding kit and staff-assisted import (PR `claude/vendor-onboarding-kit`, not merged); open owner items recorded

**[Owner decision 2026-10-17]** "Selected Next Milestone: 1. Vendor Onboarding Kit & 2. Staff-Assisted Import", built as one PR. The owner also asked that the open items below go into this PR's record rather than a separate documentation PR.

**Changes (not merged, not deployed; no migration):** details are in `docs/merchant-portal-plan.md` §4d.
- **Onboarding kit:**
  - `public/merchant-catalog-template.csv` (header only) and `public/merchant-catalog-example.csv` (4 sample items);
  - a "How to fill in the file" guide in the store portal's import section;
  - both files redirect on the HTAF domain and are disallowed in `robots.txt`.
- **Staff-assisted import:**
  - `POST /api/admin/merchants/:id/catalog/import` (admin only, approved stores only);
  - "Import a CSV for this store" on the admin dashboard.

  The store and staff imports now share one function, so screening, limits and the hidden-item rule are identical. A staff import is audited as `catalog_imported_by_staff`; its items have no `created_by` store user.

**[Verified 2026-10-17, local]**
- `lib/catalog.test.js`: 2 new tests. The template is only the header row. The example parses with no errors and nothing held, and reads the yes/no columns and a quoted comma correctly.
- `test/server.merchant-catalog.test.js`: 4 new tests:
  - staff import is admin-only and for approved stores only;
  - preview writes nothing; the import adds to the right store only;
  - flagged items are held, and the import is audited as staff;
  - a hidden item is never changed;
  - the downloads are served as CSV and redirected on the HTAF domain.
- Browser tests (Chromium): the portal guide and downloads; the staff import flow (preview first, held item reaches the review list).

**[Unresolved] Open owner items (owner's tracking, 2026-10-17):**
1. **First pilot store's catalog:** waiting for the first vendor's catalog upload. **[Verified 2026-10-17 21:41 UTC, production, read-only count]** 0 merchant applications (none pending or approved), 0 store sign-ins, 0 catalog items. The vendor must first apply at `/merchant-apply.html`; then staff approve it, give sign-in access, and the vendor (or staff, with this PR) imports the catalog.
2. **Sales tax:** waiting for the accountant's written advice on Tennessee marketplace-facilitator rules, including how refunds are treated.
3. **Merchant agreement:** waiting for counsel's draft. It must include the 12% commission, Monday payouts, and the 48-hour missing-item claim window with rollover.

**Monitoring [Owner decision 2026-10-17]:** a daily read-only check, the scheduled task "Merchant onboarding daily check" (08:46 America/Chicago), counts applications by status, active store sign-ins and catalog items (live, held, hidden). It reports only when a count changes, gives counts only (no names or contact details), and takes no action. Baseline: all counts 0 at 21:41 UTC.

**Handoff:**
- **Done:** the onboarding kit and staff-assisted import are built and tested locally (full suite: 2,700 passed); the open items and the daily check are recorded.
- **Remaining:**
  - merge approval;
  - the pilot vendor's application;
  - the accountant's advice;
  - counsel's draft.
- **Next authorized action:** none. Merging needs the owner's approval.

**[Owner decision 2026-10-17]** "Approved. Proceed to merge PR #278". **[Verified 2026-10-17]** All six CI checks were green on head `994760b`; merged as `accf704`.

**[Verified 2026-10-17 21:55 UTC, production]**
- `/api/health` reports `accf704`, healthy, database connected.
- `/merchant-catalog-template.csv` and `/merchant-catalog-example.csv` return 200 `text/csv` with the expected header row; `robots.txt` disallows both.
- The store portal serves the import guide; the admin dashboard serves "Import a CSV for this store".
- `POST /api/admin/merchants/:id/catalog/import` without admin returns 401; `POST /api/merchant/catalog/import` without a store session returns 401.
- The HTAF-domain redirect of the CSV files couldn't be checked from the build environment (its network proxy refuses `harveytransportationfoundation.com`). **[Verified 2026-10-17 by the owner's phone screenshot]** opening it on the HTAF domain landed on the HTAF home page, not a download. The address bar in the screenshot doesn't show the full path.

## 38. Update 2026-10-17 (UTC): "Ask HTAF" button no longer covers the 501(c)(3) status line (PR `claude/htaf-ask-button-overlap`, not merged)

**[Owner decision 2026-10-17]** "Approved. Proceed with the CSS/layout adjustment to prevent the floating Ask HTAF assistant button from overlapping the nonprofit credibility badge", with a phone-width browser test, bundled with the pending status entries.

**Problem [Verified 2026-10-17]:** the owner's phone screenshot showed the floating "Ask HTAF" button covering the end of the home page badge "Tennessee-Based 501(c)(3) Public Charity". It was reproduced locally in Chromium at 360 x 740 (the button overlapped the badge at the top of the page); at 390 x 844 and 412 x 915 it did not.

**Change (not merged, not deployed; no migration, no server change):**
- `public/htaf-assist.js`: the button steps aside (a short fade) while it would cover any element marked `data-htaf-keep-clear`, and comes back once that content scrolls away. It doesn't step aside while the chat panel is open (it is the close control) or while it has keyboard focus. It rechecks on scroll, resize, load and text-size or language changes.
- Marked as keep-clear: the home page badge and the footer status line ("501(c)(3) public charity · EIN …") on the home, contact and application pages.

**[Verified 2026-10-17, local]**
- `test/htaf-assistant.browser.test.js`: 6 new Chromium tests.
  - Scrolling each page top to bottom in 120-pixel steps, the button never covers a status line while shown: home at 360 x 740, 390 x 844 and 412 x 915; contact and application at 360 x 740.
  - At 360 x 740 on the home page, the button steps aside at the top, returns after scrolling, and stays while the panel is open.
- The new tests fail against the previous script (3 of 11 failed) and pass with the fix.
- HTAF browser suites: 25 passed. Full suite: 2,706 passed.

**[Unresolved] Open owner items (unchanged since §37):**
1. First pilot store's catalog: no application yet. The daily onboarding check (scheduled task "Merchant onboarding daily check", 08:46 America/Chicago, read-only, reports only changes; first run 2026-10-18) will report the first application.
2. Accountant's written advice on Tennessee marketplace-facilitator rules, including refunds.
3. Counsel's merchant agreement draft (12% commission, Monday payouts, 48-hour missing-item claim window with rollover).

**Handoff:**
- **Done:** #278 merged and verified in production; the button overlap is fixed and tested locally.
- **Remaining:**
  - merge approval for this PR;
  - after merge, confirm on a phone that the badge is readable;
  - the three open items above.
- **Next authorized action:** none. Merging needs the owner's approval.

**[Owner decision 2026-10-18]** "Approved. Proceed to merge PR #279". **[Verified 2026-10-18]** All six CI checks were green on head `7d90be4`; merged as `f679375`.

**[Verified 2026-10-18 00:05 UTC, production]**
- `/api/health` reports `f679375`, healthy.
- `htaf-assist.js` serves the keep-clear logic; the home, contact and application pages carry the markers.
- Live render: the build environment can't reach the HTAF domain and its browser doesn't trust the proxy certificate (certificate checks were not disabled). The production files were fetched with curl and rendered in Chromium from `harveytaxiservice.com/foundation.html`, the same file as the HTAF home page:
  - at 360 x 740 the button steps aside over the badge;
  - at 412 x 915 the button sits below the badge with no overlap.

**[Verified 2026-10-18 by the owner's phone screenshots, 7:10 local, Reduce Motion on]** The badge reads in full at the top of the page (button stepped aside) and after scrolling (button clear of it, over the hero paragraph).

**[Owner decision 2026-10-18]** "Keep the current approach; no changes needed": only the 501(c)(3) status lines are keep-clear; the button may sit over ordinary text while scrolling.

## 39. Update 2026-10-18 (UTC): phase 3 orders design for owner review (PR `claude/phase3-orders-design`, not merged; documentation only)

**[Owner decision 2026-10-18]** "Start the Phase 3 orders design document."

**Added:** `docs/merchant-portal-phase3-orders.md`. It covers:
- the order lifecycle and who can move it;
- the rider, store and staff experience;
- payment (one manual-capture authorization per order; capture at delivery, bounded by the authorization; refunds only through staff-approved proposals);
- sales-tax handling kept in one function until the accountant answers;
- the data model for one future migration (`orders`, `order_items`, `order_events`; not written, not applied);
- safety and privacy (stores see riders' first names only);
- a build plan in three PRs plus a test-mode demo.

No code, migration or Stripe change.

**[Verified 2026-10-18, code]** The design's starting points: rides authorize with manual capture and capture at completion; ride tips are added in full to the driver's earning; delivery switches are enforced and off; `lib/refundEngine.js` exports the money rules the design calls.

**[Decision] Seven owner decisions with recommendations (design §11):**
- D1: store response window (8 minutes);
- D2: rider cancellation after acceptance (free until ready, then through support);
- D3: tip (optional, 100% to the driver);
- D4: one charge for the whole order;
- D5: no minimum order in the pilot;
- D6: store alerts (portal sound and badge; SMS optional);
- D7: capture at delivery.

**[Blocked] Before real orders:**
- the accountant's sales-tax advice;
- counsel's merchant agreement and rider-terms update;
- Stripe Connect details (phase 5);
- at least 5 verified drivers;
- signed pilot stores with catalogs;
- the owner turning on `ENABLE_MERCHANT_ORDERS` and the delivery switches.

**Handoff:**
- **Done:** design drafted.
- **Remaining:**
  - owner review of the design and decisions D1–D7;
  - merge approval for this documentation PR;
  - building step 3a after approval.
- **Next authorized action:** none. Building phase 3 needs the owner's go-ahead on the design.

**[Owner decision 2026-10-18]** D1–D7 "Approved as recommended"; "Approved to merge PR #280"; "Approved. Authorize the initiation of Step 3a".

**[Verified 2026-10-18]** All six CI checks were green on head `b4f7bfb`; #280 merged as `ef44e86`; `/api/health` reports `ef44e86`, healthy (00:18 UTC).

## 40. Update 2026-10-18 (UTC): phase 3 step 3a, orders core (PR `claude/phase3a-orders`, not merged; migration not applied; ordering off)

**[Owner decision 2026-10-18]** "Approved. Authorize the initiation of Step 3a (database schema changes, checkout backend, store order inbox, and staff tools) to be built as a separate PR." D1–D7 approved as recommended.

**Changes (not merged, not deployed):** details are in `docs/merchant-portal-phase3-orders.md`, including §11a (refinements made while building).
- **Migration `20261018010000_orders.sql` (not applied; needs separate owner approval):** `orders`, `order_items`, `order_events`.
  - Money in whole cents with database checks: nothing negative, capture ≤ authorization, refunds ≤ capture.
  - One order per rider per checkout key; each fare quote usable once.
  - Order history is append-only, enforced by a trigger.
  - Server-only, RLS on.
- **`lib/orders.js`:** who may move an order between which states, cart building from the catalog (held or hidden items can never be ordered), totals, store hours in Nashville time, the 8-minute (D1) and 15-minute timers, and what a store may see (first name and items only).
- **Server:**
  - riders: checkout, confirm payment, list, detail, cancel (D2);
  - stores: inbox, accept with prep time, reject, mark ready, cancel;
  - staff: list (stuck orders flagged), detail with history, cancel with a reason.

  Every change is conditional on the order's current state, logged in `order_events` and audited. Every ending other than completion releases the card hold.
- **Store portal:** an Orders card, refreshed every 10 seconds, with a tone and a tab-title count for new orders (D6).
- **Admin dashboard:** "Store Orders (test mode)".

**Safety [Verified 2026-10-18, local]:**
- Ordering is off unless `ENABLE_MERCHANT_ORDERS` is on, Stripe uses test keys, and the delivery switches are on.
- Order authorizations have their own Stripe tag (`harvey_taxi_orders`), so the ride hold-release job can't act on them.

**Not in 3a [Unresolved]:**
- the rider cart and checkout screens (3b);
- delivery trip creation, which needs store coordinates (design §11a item 2);
- capture at delivery, substitutions while preparing, missing-item refunds and the store-share ledger (3c);
- SMS alerts (D6 optional).

**Tax:** the placeholder rate `ORDERS_TEST_TAX_RATE_BPS` defaults to 0 and is for test mode only (waiting on the accountant).

**[Verified 2026-10-18, local]**
- `lib/orders.test.js`: 29 tests.
- `test/server.orders.test.js`: 18 tests (checkout, retry, refusals, quote reuse and binding, payment confirmation, store inbox privacy, accept/ready/reject, the race, D1 expiry, sweep, D2 cancel, staff).
- `test/server.orders-gates.test.js`: 3 tests (switch off, live keys, no Stripe).
- `test/db/orders.db.test.js`: 7 tests (real Postgres).
- `test/merchant-orders.browser.test.js`: 2 tests (Chromium).
- Database suite: 171 passed, 4 skipped.

**Handoff:**
- **Done:** step 3a built and tested locally.
- **Remaining:**
  - merge approval;
  - separate approval to apply the migration;
  - owner approval before turning on `ENABLE_MERCHANT_ORDERS` (and the delivery switches) with Stripe test keys for the demo;
  - steps 3b and 3c;
  - the store-coordinates decision.
- **Next authorized action:** none. Merging, the migration and turning ordering on each need the owner's approval.

## 41. Update 2026-10-18 (UTC): #281 merged; orders migration not applied (confirmation cancelled); store pickup pin (PR `claude/store-pickup-pin`, not merged); demo activation needs a decision

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #281".
2. "Authorize the application of the order tables migration in the production database following the merge".
3. "Authorize turning on ordering in test mode (enabling ENABLE_MERCHANT_ORDERS and delivery settings with Stripe test keys) for the upcoming test-mode demo once the migration is applied".
4. Store location: "Staff confirm a map pin during the store approval process".

**[Verified 2026-10-18 00:37 UTC, production]**
- All six CI checks were green on `b42e4ac`; #281 merged as `1d919e9`; `/api/health` reports `1d919e9`, healthy.
- Without sign-in, the new routes refuse: `GET /api/admin/orders` 401, `POST /api/orders/checkout` 401, `GET /api/merchant/orders` 401.

**[Unresolved] Orders migration not applied.**
- The `apply_migration` call for `20261018010000_orders.sql` (identical to `main`, SHA-256 `afd5d606…`) returned "cancelled": the confirmation it asked for was not given in this session, as with the earlier DELETE.
- **[Verified 2026-10-18]** Nothing was partly applied: `orders`, `order_items`, `order_events` and the trigger function don't exist.
- Next: the owner runs the merged file in the Supabase SQL editor, or approves the confirmation; then the session verifies.

**[Unresolved] Demo activation: two side effects found before switching anything on.** Nothing has been switched on.
1. **The delivery switches would reopen the old delivery booking.** `ENABLE_DELIVERY`, `ENABLE_FOOD_DELIVERY` and `ENABLE_GROCERY_DELIVERY` also control the existing free-text delivery booking that #260 paused. Turning them on for the demo would let any rider book an old-style delivery again (verified in code: `deliveryBookingEnabled()` and `rejectUnavailableRideType()`).
2. **Stripe keys are shared with rides.** Orders refuse live keys by design. If production's Stripe key is live (this session can't see the key, by design), switching production to test keys would stop real ride payments.

**[Recommendation]** A small follow-up PR:
- orders use their own test key (`ORDERS_STRIPE_SECRET_KEY`, which must start with `sk_test_`), separate from the ride key;
- orders no longer depend on the general delivery switches (only `ENABLE_MERCHANT_ORDERS`).

The demo can then run in production with test money while rides keep their keys and delivery booking stays paused. Needs the owner's go-ahead.

**Store pickup pin [Verified 2026-10-18, local]:**
- Migration `20261018020000_merchant_pickup_pin.sql` (not applied; needs separate approval): pin columns on `merchants`, with who confirmed it and when; a check requires all four together.
- `parsePickupPin`: coordinates or a Google Maps link; Tennessee only.
- `POST /api/admin/merchants/:id/pickup-pin`: approved or paused stores; audited.
- The admin list shows the pin, a link to the address in Google Maps, and "Set pin". It reads pins separately, so the list still works before the migration.
- Checkout now needs a pinned store and a fee quote starting within 150 m of the pin.
- Tests:
  - `lib/merchants.test.js`: 9 new;
  - `lib/orders.test.js`: 1 new;
  - `test/server.orders.test.js`: 4 new;
  - `test/db/merchantPickupPin.db.test.js`: 1;
  - `test/admin-merchants.browser.test.js`: 1 new.
- Database suite: 172 passed, 4 skipped. Full suite: 2,773 passed.

**Handoff:**
- **Done:** #281 live (ordering off); pickup pin built.
- **Remaining:**
  - the orders migration (owner to run or confirm);
  - merge and migration approvals for the pin PR;
  - the owner's go-ahead on the separate-test-key recommendation before any demo switch-on;
  - step 3b.
- **Next authorized action:** none until the migration confirmation and the activation decision.

## 42. Update 2026-10-18 (UTC): #282 merged; orders tables not found after the owner's SQL-editor run; orders isolated from rides (PR `claude/orders-stripe-isolation`, not merged)

**[Owner decision 2026-10-18]** The owner reported running `20261018010000_orders.sql` in the production SQL editor. They also approved:
- the pin migration, to be run by the owner via the SQL editor after merge;
- merging #282;
- "the recommended small PR to decouple the new orders from the legacy delivery settings and implement a separate ORDERS_STRIPE_SECRET_KEY (enforcing the sk_test_ prefix). It is critical that real ride payments are completely unaffected and legacy delivery remains paused."

**[Unresolved] Orders tables not found [Verified 2026-10-18 ~00:47 UTC, read-only queries]:**
- `orders`, `order_items`, `order_events` and the trigger function don't exist in production (`orgahzncmzptljapqffj`, any schema).
- They aren't in the staging project (`yryfdobxhvklanmbotfu`) either.
- The script runs as one transaction, so an error, or a cancelled "destructive statement" confirmation in the SQL editor (the script contains `drop trigger if exists`), leaves nothing behind.
- Next: the owner reruns it and shares the editor's result message; then the session verifies.

**[Verified 2026-10-18 00:48 UTC]** All six CI checks were green on `b1edf8b`; #282 merged as `e0474be`; `/api/health` reports `e0474be`, healthy; `POST /api/admin/merchants/:id/pickup-pin` without admin returns 401.

**Pin migration [Unresolved]:** `supabase/migrations/20261018020000_merchant_pickup_pin.sql` (SHA-256 on `main` `cffba0ed…`) not applied; the owner will run it in the SQL editor.

**Orders isolation (this PR) [Verified 2026-10-18, local]:**
- Orders build their own Stripe client, only from `ORDERS_STRIPE_SECRET_KEY` and only if it is a test key. The ride key is never used for orders.
- Orders no longer depend on `ENABLE_DELIVERY` / `ENABLE_FOOD_DELIVERY` / `ENABLE_GROCERY_DELIVERY`; the fee quote is checked by a copy of the ride check without the delivery switches.
- `GET /api/orders/config` tells the rider screens whether ordering is on and gives the publishable key only if it is a `pk_test_` key.
- Tests run with the ride key set to a live-looking value and the delivery switches off:
  - a full order cycle works, and any use of the ride Stripe client would fail the test;
  - `POST /api/rides/payment-intent` for food still answers "Delivery is paused";
  - gates: switch off, a live orders key, and no orders key (even with a test ride key) all refuse.
- Full suite: 2,776 passed.

**Owner setup for the demo, after this PR merges and both migrations are applied:**
1. On Render (web service environment), add:
   - `ORDERS_STRIPE_SECRET_KEY`: a Stripe **test** secret key (`sk_test_…`);
   - `ORDERS_STRIPE_PUBLISHABLE_KEY`: its `pk_test_…` pair;
   - `ENABLE_MERCHANT_ORDERS=true`.

   Names only are recorded here.
2. Leave `STRIPE_SECRET_KEY` and the delivery switches unchanged.

**Handoff:**
- **Done:** #282 live (pin code, migration pending); isolation built.
- **Remaining:**
  - the orders migration rerun and the pin migration (owner, SQL editor);
  - merge approval for this PR;
  - the demo environment settings above;
  - step 3b.
- **Next authorized action:** verifying the migrations after the owner runs them. Merging this PR needs the owner's approval (the approval covered building it).

## 43. Update 2026-10-18 (UTC): #283 merged; orders and pin migrations live; step 3b part 1, menu, cart and markets (PR `claude/phase3b-menu-cart`, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #283".
2. "Add the 'market' field to stores, orders, and approvals now ... fold this into the upcoming step".
3. The staged, gated expansion plan is approved; "the strict arm's-length legal separation between Harvey Taxi Service LLC and HTAF is understood and will be maintained".
4. Write the expansion-readiness document for investors and counsel.
5. "We are cleared to proceed with Step 3b".

**[Verified 2026-10-18 01:00 UTC]** All six CI checks were green on `d848c56`; #283 merged as `822e40b`.
- `/api/health` reports `822e40b`, healthy.
- `GET /api/orders/config` returns `enabled: false, publishable_key: null`.
- The legacy delivery booking still answers "Delivery is paused".

**Migrations:**
- The owner's first two SQL-editor runs didn't take effect: no tables at ~00:47 and ~00:59 UTC; the migration history ended at `catalog_items`.
- The owner then ran the combined script (orders, then pickup pin, copied unchanged from `main`) in the project labelled PRODUCTION. The owner's screenshot (8:12 PM local, 17 Oct) shows the check returning `orders`, `order_items`, `order_events`, `4`.
- **[Verified 2026-10-18 ~01:13 UTC, read-only]**
  - RLS is on for all three tables, with 0 policies; `anon` and `authenticated` have no access; `service_role` can insert; 0 rows each.
  - `orders` has 38 columns; there are 12 indexes, including `orders_quote_jti_key` and `orders_rider_key_idx`.
  - The trigger `order_events_no_update` exists; its function has `search_path=public` and `anon` can't execute it.
  - All four `merchants.pickup_*` columns and `merchants_pickup_pin_check` exist; 0 stores are pinned.

**[Verified 2026-10-18 ~01:20 UTC]** The demo settings are **not** live: `/api/orders/config` still reports `enabled: false`. To turn them on, add `ORDERS_STRIPE_SECRET_KEY` (a `sk_test_` key), `ORDERS_STRIPE_PUBLISHABLE_KEY` (its `pk_test_` key) and `ENABLE_MERCHANT_ORDERS=true` on Render. Names only are recorded here.

**Expansion-readiness brief:** published as a private page, https://claude.ai/artifact/6MrGEV3WqnHqntnwv7LbRr. Others can open it only once the owner shares it.
- It covers the four gated stages, HTAF arm's-length rules, example state and city requirements, costs, technology order and open questions.
- Each figure is verified with a source, or marked "to confirm" or "estimate". The Tennessee TNC limits ($50k/$100k/$25k logged on; $1M during a trip) are "to confirm" in § 55-12-141.

**Step 3b part 1 (this PR) [Verified 2026-10-18, local]:** details are in `docs/merchant-portal-phase3-orders.md` §11b.
- `GET /api/stores` and `GET /api/stores/:id/menu`: signed-in riders only; empty or 503 while ordering is off.
- `/store-menu.html`: one-store cart and the term 5 choice. It redirects on the HTAF domain and is disallowed in `robots.txt`.
- Migration `20261018030000_markets.sql` (not applied; needs separate approval). Until it is applied, the store list reports "not set up".
- Tests:
  - `lib/markets.test.js` (2);
  - `test/server.orders.test.js` (3 new: listing rules, no held or hidden items, no internal fields; market filter; orders carry the market);
  - `test/db/markets.db.test.js` (1);
  - `test/store-menu.browser.test.js` (3, Chromium at 390 px).
- Database suite: 173 passed, 4 skipped. Full suite: 2,785 passed, 1 failed, on each of two runs, a different pre-existing browser test each time (`rider-navigation` on the first run, `htaf-languages` on the second). Neither page is touched by this PR, each passes when run alone (14/14 and 18/18), and CI does not run browser tests. `htaf-languages` captured the page before its totals had loaded: a timing race under load, not fixed here.

**Handoff:**
- **Done:** #283 live; orders and pin migrations verified; expansion brief published; 3b part 1 built.
- **Remaining:**
  - merge approval for this PR;
  - separate approval for the markets migration (likely via the SQL editor);
  - the demo settings on Render;
  - 3b part 2 (orders-only estimate, checkout screen, Stripe test card step);
  - 3c.
- **Next authorized action:** building 3b part 2 (Step 3b is authorized). Merging and the migration need the owner's approval.

## 44. Update 2026-10-18 (UTC): step 3b part 2, checkout (PR `claude/phase3b-checkout`, stacked on #284, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #284 into the main branch once CI is green."
2. The markets migration is approved; the owner will run it in the production SQL editor.
3. The owner is adding `ORDERS_STRIPE_SECRET_KEY` (sk_test), `ORDERS_STRIPE_PUBLISHABLE_KEY` (pk_test) and `ENABLE_MERCHANT_ORDERS=true` on Render (names only recorded).
4. "Once the database migration is confirmed, you are approved to proceed with Step 3b Part 2." Merging this PR needs its own approval.

**[Verified 2026-10-18 01:43 UTC]** All six CI checks were green on `e1edced`; #284 merged as `59e7ca7`. `/api/health` reports `59e7ca7`, healthy, database connected; `/store-menu.html` returns 200. `/api/orders/config` still reports `enabled: false` (the Render settings had not taken effect at that time).

**Markets migration:** the owner ran the SQL file (copied unchanged from `main`) in the project labelled PRODUCTION; the owner's screenshot (8:45 PM local, 17 Oct) shows the check returning `2 | 2`.
- **[Verified 2026-10-18 ~01:46 UTC, read-only]** `market` exists on `merchants` and `orders`: `not null`, default `'nashville'`, with the checks `merchants_market_check` and `orders_market_check` and the indexes `merchants_market_status_idx` and `orders_market_status_idx`. No store has a market other than `nashville`.
- **[Verified 2026-10-18 01:46 UTC]** `/api/orders/config` still reports `enabled: false`: the Render settings had not taken effect.

**Step 3b part 2 (this PR) [Verified 2026-10-18, local]:** details are in `docs/merchant-portal-phase3-orders.md` §11b.
- `POST /api/orders/estimate`: the delivery fee from the store's pin to the rider's address by road, signed and single use. The pin never leaves the server.
- Checkout, pay and order-status screens on `/store-menu.html`; a Stripe test card authorizes the order, then the server checks Stripe before the store sees it.
- The Delivery Center links to store ordering only while ordering is on. Production still reports it off, so nothing changes for riders until the owner adds the demo settings.
- **[Recommendation]** A 15-road-mile delivery limit until the owner sets the delivery area.
- **[Unresolved]** Tax is still the test-mode placeholder (`ORDERS_TEST_TAX_RATE_BPS`, default 0) pending the accountant's advice.
- Full suite: 2,795 passed, 0 failed (226 skipped). Tests: `test/server.orders.test.js` (4 new, 7 cases: pin used and not sent, fee carried into checkout, single use, Tennessee only, no pin, closed, no route, outage, 15-mile limit, another rider's quote refused); `test/store-menu.browser.test.js` (2 new, Chromium at 390 px: full checkout with a stand-in for Stripe.js, totals with tax and grocery hold, test-card authorization, order placed, cart cleared, reload, cancel releases the hold; no-route message).

**Handoff:**
- **Done:** 3b part 2 built and tested locally.
- **Remaining:**
  - merge approval for this PR;
  - confirming the demo settings on Render (`ORDERS_STRIPE_SECRET_KEY`, `ORDERS_STRIPE_PUBLISHABLE_KEY`, `ENABLE_MERCHANT_ORDERS=true`; names only);
  - the owner's choice of delivery area (or confirming 15 miles);
  - 3c.
- **Next authorized action:** none. Merging this PR waits for the owner's approval; once the Render settings are saved, check that `/api/orders/config` reports ordering on.

## 45. Update 2026-10-18 (UTC): #285 merged; ordering on in test mode; tip options corrected to D3 (PR `claude/orders-tip-d3`, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #285 into the main branch."
2. "Keep the 15 road miles limit as the standard for the pilot phase"; to be adjusted from real dispatch data.
3. The owner restarted the Render service with `ENABLE_MERCHANT_ORDERS=true`, `ORDERS_STRIPE_SECRET_KEY` (sk_test) and `ORDERS_STRIPE_PUBLISHABLE_KEY` (pk_test). Names only are recorded.
4. Staff will set the pickup pins for pilot stores when onboarding begins.

**[Verified 2026-10-18 01:59 UTC]** All six CI checks were green on `3b73aa1`; #285 merged as `f64512e`.
- `/api/health` reports `f64512e`, healthy, database connected.
- `/api/orders/config` reports `enabled: true, test_mode: true` and a `pk_test_` publishable key.
- The legacy booking (`/api/rides/estimate` with `grocery`) still answers "Delivery is paused".
- **What riders can see now:** the Delivery Center shows "Order from a partner store (test mode)". The store list is empty because no store has a pickup pin (0 pinned at the last check). No order can be placed until staff pin a store with listed items.

**Correction (this PR):** #285 shipped tip choices of none, $2, $3, $5 or $8 with **$3 pre-selected**. That conflicts with D3 (owner decision 2026-10-18: optional tip, none / 10% / 15% / 20% / custom, **no pre-selection**). The checkout now offers No tip, 10%, 15%, 20% of the items, or another amount, with nothing chosen in advance (an unchosen tip is $0). No rider could have been affected: no store was orderable. The browser test now checks that nothing is pre-selected. **[Verified 2026-10-18, local]** `test/store-menu.browser.test.js` 5/5.

**Handoff:**
- **Done:** #285 live; ordering on in test mode; tip corrected (this PR).
- **Remaining:** merge approval for this PR; pilot store pins; 3c (outline sent to the owner); the demo walkthrough.
- **Next authorized action:** none. Merging this PR and building 3c wait for the owner's approval.

## 46. Update 2026-10-18 (UTC): #286 merged; step 3c-1 schema (PR #287, not merged; migration applied and verified)

**[Owner decision 2026-10-18]**
1. Driver pay on orders: "Revert to the standard 70% of the delivery fee (DRIVER_PAYOUT_PERCENT) plus 100% of the tip."
2. "The 12% commission applies strictly to the item subtotal." The ledger isolates items, tax, delivery fee, tip, commission and the 88% store share.
3. "Implement the append-only ledger architecture", with credits for completed orders, debits for approved missing-item deductions, and the Nashville Monday date as the payout week.
4. "Do not create a duplicate status column": extend `fulfilment` and add only asked, expires, answer and answered fields.
5. Refund proposal statuses gain `refunded` and `refund_failed`; the 48-hour window runs from `delivered_at`.
6. "Approved. Proceed to merge PR #286."
7. Write the 3c-1 migration with tests and status updates, open the PR, and send the SQL file; the owner will apply it manually in production.

**[Verified 2026-10-18 02:05 UTC]** All six CI checks were green on `e969eb4`; #286 merged as `3e09852`. `/api/health` reports `3e09852`, healthy; `/api/orders/config` reports `enabled: true, test_mode: true`; the live checkout page has the new tip choices.

**3c-1 (this PR) [Verified 2026-10-18, local]:** details are in `docs/merchant-portal-phase3-orders.md` §11c.
- Migration `20261018040000_order_ledger.sql`: "Contact me first" fields and `refunded_quantity` on `order_items`; `order_refund_proposals`; append-only `store_ledger_entries`. Server-only (RLS on, no policies, no client access).
- Nothing reads or writes these yet; the server changes come in 3c-2 to 3c-4.
- **[Recommendation]** The proposals table is named `order_refund_proposals` (not `refund_proposals`) to keep it separate from ride refunds (`payment_refunds`).
- Tests: `test/db/orderLedger.db.test.js` (4: contact-me-first fields; proposal amounts and outcome records; ledger commission on items only, one credit per order, Monday weeks, append-only, balance by sum; server-only access). `test/db/orders.db.test.js` now clears the new tables with `orders`. Database suite: 177 passed, 4 skipped.

**Migration:** the owner ran the SQL file (copied unchanged from this PR at `4b3a74c`) in the project labelled PRODUCTION; the owner's screenshot (9:18 PM local, 17 Oct) shows the check returning `5 | 2 | 1 | 2`.
- **[Verified 2026-10-18 ~02:20 UTC, read-only]**
  - `order_items` has the 5 new columns (`refunded_quantity` not null, default 0) and the 4 new checks.
  - `order_refund_proposals` (23 checks) and `store_ledger_entries` (9 checks) exist with all 12 expected indexes, including `store_ledger_one_credit_per_order` and `store_ledger_one_deduction_per_proposal`.
  - RLS on, 0 policies, no `anon` or `authenticated` grants; `store_ledger_append_only` has `search_path=public` and `anon` can't execute it.
  - 0 rows in both new tables.

**Handoff:**
- **Done:** #286 live; 3c-1 written and tested; migration applied by the owner and verified.
- **Remaining:** merge approval for this PR; 3c-2 to 3c-4; the demo.
- **Next authorized action:** none. Merging this PR and starting 3c-2 wait for the owner's approval.

## 47. Update 2026-10-18 (UTC): #287 merged; step 3c-2, settling items while preparing (PR `claude/phase3c-2-substitutions`, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #287 into the main branch once the restarted CI checks are green."
2. "You are cleared to begin building Step 3c-2": store item marking (packed, out of stock, substituted), the in-app "Contact me first" prompt, the 7-minute auto-refund, and blocking "ready" until every item is resolved.

**[Verified 2026-10-18 02:23 UTC]** All six CI checks were green on `168e6f7`; #287 merged as `c6aa8d2`. `/api/health` reports `c6aa8d2`, healthy; `/api/orders/config` reports `enabled: true, test_mode: true`.

**3c-2 (this PR) [Verified 2026-10-18, local]:** details are in `docs/merchant-portal-phase3-orders.md` §11c.
- Server: `POST /api/merchant/orders/:id/items/:itemId` (packed / out of stock / substitute); `POST /api/orders/:id/items/:itemId/answer` (rider: substitute or refund); "Contact me first" questions expire after 7 minutes (sweep and on read); "Mark ready" refused until every item is settled.
- Rules in `lib/orders.js`: `planItemAction`, `settleQuestion` (uses `substitutionOutcome` from `lib/refundEngine.js`), `readyBlockers`, `finalTotals` (also for 3c-3 capture).
- Store portal: per-item buttons and states. Rider order screen: the question with Accept substitute / Refund it, refreshed every 10 seconds while the store prepares.
- No migration (uses the 3c-1 columns). Nothing is charged; capture is 3c-3.
- Tests: `lib/orders.test.js` (6 new); `test/server.orders.test.js` (5 new, and the ready test now settles items first; 79/79 three runs in a row with `lib/orders`); `test/merchant-orders.browser.test.js` (ready refused, then substitute and out of stock, then ready); `test/store-menu.browser.test.js` (1 new: the rider accepts a substitute at 390 px). Browser suites: 8/8.
- Full suite: 2,806 passed, 1 failed (230 skipped). The failure was `rider-navigation` (tracking after refresh), the same pre-existing browser test that failed under load on 2026-10-18 (§43). This PR doesn't touch the rider dashboard, the test passes alone (14/14), and CI doesn't run browser tests.

**Production supply [Verified 2026-10-18 ~02:00 UTC, read-only]:** 0 approved stores, 0 pinned, 0 listed items, 0 orders; 0 of 19 drivers fully verified (last recorded 2026-10-17). Nothing in 3c can be exercised in production until a pilot store is approved, pinned and stocked, and a test driver exists for the demo.

**Handoff:**
- **Done:** #287 live; 3c-2 built and tested.
- **Remaining:** merge approval for this PR; 3c-3 (driver trip and capture at delivery); 3c-4 (missing-item refunds); pilot store onboarding; a test driver for the demo; the accountant's tax advice and counsel's merchant agreement before any real order.
- **Next authorized action:** none. Merging this PR and starting 3c-3 wait for the owner's approval.

## 48. Update 2026-10-18 (UTC): #288 merged; step 3c-3, delivery trip and capture at handoff (PR `claude/phase3c-3-trip-capture`, not merged; migration not applied)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #288 ... The known local browser test flake (rider-navigation) is noted and accepted since it is unrelated to these changes and passed in isolation."
2. "You are authorized to begin building Step 3c-3": the delivery trip when the store accepts, and the final capture (delivered items, tax, fee and tip, never above the hold) at the driver's PIN or photo handoff.

**[Verified 2026-10-18 05:06 UTC]** All six CI checks were green on `36ce84b`; #288 merged as `1f3c7dc`. `/api/health` reports `1f3c7dc`, healthy; `/api/orders/config` reports `enabled: true, test_mode: true`.

**3c-3 (this PR) [Verified 2026-10-18, local]:** details are in `docs/merchant-portal-phase3-orders.md` §11c.
- Accepting creates one delivery trip (no payment of its own; 70% of the fee plus the tip to the driver); the sweep retries a failed start.
- The driver can't mark pickup until the store marks the order ready.
- The PIN or photo handoff delivers the order and captures, with the orders test key, what was delivered, capped at the hold; then the order is completed with commission, store share, payout week and one store-ledger credit. A failed charge leaves it delivered for staff; nothing retries on its own.
- Cancelling before pickup cancels the trip.
- **Migration `20261018050000_order_trip.sql` (not applied):** `orders.dropoff_address` and a unique index on `orders.ride_id`. **[Recommendation]** Run it before merging; the server reads the new column, so merging first would break order screens until it runs.
- Tests: `test/db/orderTrip.db.test.js` (2); `test/server.orders.test.js` (7 new: one trip with the right pay and no payment of its own; sweep retry; pickup gate; capture of the delivered amount with the ledger credit and no double charge; declined charge; cancel takes the trip; address saved); `test/store-menu.browser.test.js` (address saved; PIN shown). Orders server suite 50/50; browser suites 8/8; DB tests for orders 39/39 (including a real `rides` insert of the trip row).
- Full suite, two runs: 2,809 and 2,810 passed; 5 then 4 failed, all in browser suites this PR doesn't touch (`rider-navigation`, `rider-mobile-layout`, and once `htaf-languages`). Run alone, `rider-navigation` and `rider-mobile-layout` pass 20/20. CI doesn't run browser tests. **[Unresolved]** These rider-page browser tests fail more often under full-suite load; worth making robust in a separate PR.

**Before the demo:** a test driver account that can go online in the driver app, a staff-approved test store with a pin and listed items, and a Stripe test card.

**Handoff:**
- **Done:** #288 live; 3c-3 built and tested locally.
- **Remaining:** the owner runs the 3c-3 migration (then a read-only check); merge approval; 3c-4 (missing-item refunds); the demo walkthrough.
- **Next authorized action:** none. The migration and the merge wait for the owner.

## 49. Update 2026-10-18 (UTC): #289 merged and live; driver pipeline audit; dispatch timing and substitution alert (PR `claude/order-dispatch-timing-push`, not merged)

**[Owner decision 2026-10-18]**
1. The owner ran the 3c-3 migration in production (check `1 | 1`) and approved merging #289.
2. Dispatch timing "Approved as a follow-up PR": hold the trip until prep time − 10 minutes or until ready.
3. App Review panel: "Remove the large App Review Access panel from all public-facing screens ... Retain the small sign-in link. Update docs/app-review/review-notes-2026-10.md in this same PR" (the rider-screens PR).
4. Web push for the "Contact me first" window: approved.
5. Step 3c-4 (missing-item refunds): approved.
6. Driver email campaign: approved to draft, with the list de-duplicated by email or phone; one call to action ("Verify your email and phone to continue your Harvey Taxi application").
7. Backlog: show drivers' real setup state instead of "Approved" on admin screens; format rider names at display time; pin the driver emergency button; defer the 12% commission page until the merchant agreement is signed.

**[Verified 2026-10-18 ~05:37 UTC, read-only]** `orders.dropoff_address` (text, nullable, 3–300 check) and the unique index `orders_ride_id_key` exist; 0 orders.
**[Verified 2026-10-18 05:38 UTC]** All six CI checks were green on `48e3203`; #289 merged as `5a7c68b`. `/api/health` reports `5a7c68b`, healthy; `/api/orders/config` reports `enabled: true, test_mode: true`.

**Driver pipeline [Verified 2026-10-18 ~05:40 UTC, read-only; counts only, no names recorded here]:**
- 27 driver rows not deleted and not review accounts: 8 are the owner's or test accounts; 19 are applicants (applied July–August 2026).
- All 19 have vehicle details; **none** has a verified email or phone, a completed Persona check, background-check consent, a Checkr check, or licence or insurance records. Every applicant stops at the first step.
- Same first names recur 2–5 times, often on one day: likely repeat submissions (about 10 people). De-duplicate by email or phone before any email.
- All rows show approval "approved" although none is verified. **[Verified, code]** Going online and receiving offers re-check verification, so this can't let an unverified driver work; the admin label is misleading (backlog).

**Security finding [Unresolved]:** `POST /api/push/subscribe` takes `owner_type` and `owner_id` from the request without checking a session, so a browser could subscribe to another rider's or driver's notifications. **[Recommendation]** Tie sign-up to the signed-in rider or driver (a separate PR; it may need care for older app versions). Until then, new notifications carry no order details.

**This PR [Verified 2026-10-18, local]:** details in `docs/merchant-portal-phase3-orders.md` §11c.
- Order trips are held until prep time − 10 minutes (via the existing scheduled-ride sweep) or offered at once when the store marks the order ready.
- A "Contact me first" question sends the rider a web push with no item details.
- Tests: `lib/orders.test.js` (2 new); `test/server.orders.test.js` (4 new: hold time; short prep offered at once; ready releases a held trip; push sent without item details, none for packing). Orders suites 92/92 on four runs in a row (one unexplained failure in an earlier run did not recur in 12 further runs); the new tests 8/8 runs; order browser suites 8/8.

**Handoff:**
- **Done:** #289 live; driver audit; this PR.
- **Remaining:** merge approval for this PR; 3c-4 (next); rider-screens PR (App Review panel, overlap, setup button, status badge, name formatting); driver app emergency button (needs a build); driver email draft; admin driver-status label; push sign-up security fix (needs approval).
- **Next authorized action:** build 3c-4. Merging this PR waits for the owner.

## 50. Update 2026-10-18 (UTC): step 3c-4, missing-item refunds (PR `claude/phase3c-4-refunds`, stacked on PR #290, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. You are cleared to build Step 3c-4 to complete the Phase 3 order backend": the 48-hour window from `delivered_at`, the proposal row, the >3 claims/month flag, the staff approval dashboard, the Stripe refund with the test key, and the ledger deduction.
2. Driver email campaign: "Deduplicate the list by email/phone number. Draft a single, unified email campaign." Admin driver label: show "Unverified" or "Pending Setup" instead of "Approved" (backlog).
3. Build order: dispatch/push PR (#290), 3c-4, rider screens, driver app.

**This PR [Verified 2026-10-18, local]:** details in `docs/merchant-portal-phase3-orders.md` §11c.
- Rider report within 48 hours → `pending_review` proposal (routine, or `high_risk_review` over 3 a month). Store sees reports and can dispute within 48 hours.
- **[Recommendation, applied]** Only the owner account (`super_admin`) can approve or decline, matching ride refunds. Approve refunds with the orders test key; failures are `refund_failed` and retryable; a successful Stripe refund that fails to record is audited (`order_refund_record_failed`) and never refunded again.
- The store's share comes off through one ledger debit after its 48-hour window or a lost dispute; a won dispute means Harvey Taxi absorbs it.
- No migration. No live refunds (orders test key only).
- Tests: `test/server.orders.test.js` (6 new); `test/db/orderClaims.db.test.js` (1: the planned proposal, its refund and the debit are accepted by the real tables; a second debit is refused); `test/store-menu.browser.test.js` (rider reports at 390 px); `test/merchant-orders.browser.test.js` (store disputes; owner sees the high-risk and dispute flags and approves the refund). Orders suites 98/98 on three runs; browser suites 10/10. Database suite 181 passed, 4 skipped. Full suite 2,827 passed, 1 failed: `live-api-wiring` (the refund actions were one parameterised route the guard can't see; now four literal routes, passing).
- **Intermittent failure found:** `test/server.orders-gates.test.js` loads a fresh server per case and passed Jest's 5-second default on a cold cache (reproduced after `jest --clearCache`). Given a 30-second timeout; the cold-cache run now passes 102/102. This explains the one-off failures noted in §49.
- **Driver audience [Verified 2026-10-18 ~05:50 UTC, read-only, counts only]:** the 19 applicant rows are **8 distinct people** (8 unique emails, 8 unique phones), correcting the "about 10" estimate in §49. The follow-up email is drafted (not sent) for the owner; the list isn't stored in the repository.

**Handoff:**
- **Done:** 3c-4 built and tested locally. With #290, this completes the Phase 3 order backend in test mode.
- **Remaining:** merge approval for #290, then this PR; the test-mode demo (a test store with a pin and items, a test driver that can go online, a Stripe test card); rider-screens PR; driver app emergency button; driver email draft; admin driver-status label; push sign-up security fix.
- **Next authorized action:** the rider-screens PR. Merges wait for the owner.


## 51. Update 2026-10-18 (UTC): #290, #292 and #291 merged and live; rider-screen fixes (PR `claude/rider-screen-fixes`, not merged)

**[Owner decision 2026-10-18]**
1. "Approved. Proceed to merge PR #290 … immediately"; #291 pre-approved to merge once its CI was green; #292 approved to merge once CI passed.
2. "You are cleared to begin the Rider Screen UI Fixes": dynamic CTAs, the assistant button overlap, a high-contrast status badge, rider name formatting, and hiding the App Review panel while keeping the sign-in link (review notes updated in the same PR).
3. The owner adds the mailing address and sends the driver follow-up email (8 distinct applicants) linking to `/driver.html`. Not sent by an agent.

**Merges [Verified 2026-10-18]:**
- #290 → `4dc922c`; #292 → `4bb9a48`. `/api/health` reported `4bb9a48` at 06:19 UTC. `/driver.html` and `/driver` return 200; `/driver-dashboard.html` (with its query string) and `/driver-missions.html` return 301 to `/driver.html`.
- #291: all six CI checks green on `5e009a0`; merged as `7f9cdfe`. `/api/health` reported `7f9cdfe`, healthy, at 06:23 UTC. Unauthenticated calls to `/api/admin/refund-proposals` (401) and `/api/merchant/claims` (403) are refused. No migration. Refunds use the orders test key only.

**This PR [Verified 2026-10-18, local]:**
- Rider home button: "Complete Rider Setup" (to `rider-signup.html`) with no rider session; "Request a Ride" otherwise, including straight after App Review sign-in.
- Live status: a high-contrast badge in plain wording ("Driver on the way" instead of `driver_enroute`).
- Rider names capitalized at display time only; names typed in mixed case are kept; stored values unchanged.
- Harvey Assistant: a bottom spacer while its button shows, so the page's last controls scroll clear of it (all pages using `agent-assist.js`; cache version bumped).
- App Review: the home-screen card is removed; a small "App Review Sign-In" link stays in the footer while signed out. `docs/app-review/review-notes-2026-10.md` updated.
- Found and fixed during testing: the first version of the name formatter called a helper from another script block, which stopped the signed-in boot after App Review sign-in. A test now guards it.
- Tests: `test/rider-dashboard.display-format.test.js` (19, new); `test/rider-dashboard.app-review-markup.test.js` and `test/app-review.browser.test.js` updated (16/16). Full suite 2,838 passed, 1 failed: `test/rider-navigation.browser.test.js` (a known load-related failure; 14/14 when run alone).

**Just-in-Time booking [Recommendation, not approved]:** proposed to the owner: map and estimate first, sign-in at "Confirm Ride", one step per bottom sheet. **[Verified, code]** `/api/rides/estimate` needs no account; `/api/rides/request` checks rider readiness (email, phone, Persona if on, status) when `ENABLE_RIDER_APPROVAL_GATE` is on (default on; the production value is not confirmed). **[Unresolved]** Owner decisions needed: banner wording "Finish setup to book in one tap" (no $5 credit until budget and terms exist); when riders are approved (A: on phone verification, recommended; B: phone and email; C: staff review); go-ahead for the PR.

**Security finding [Unresolved]:** `/api/rides/request` skips the readiness check when no rider ID is sent, which is possible while rider sign-in enforcement is off. **[Recommendation]** A separate PR, alongside the push sign-up fix (§49).

**Handoff:**
- **Done:** #290, #291, #292 live; rider-screen fixes built and tested locally.
- **Remaining:** merge approval for this PR; the owner's decisions on Just-in-Time booking; driver app emergency button (needs a build); admin driver-status label; the two security fixes (need approval); the test-mode order demo.
- **Next authorized action:** none. Merging this PR waits for the owner.

## 52. Update 2026-10-18 (UTC): #293 merged and live; Just-in-Time booking (PR `claude/jit-booking`, not merged; switch off)

**[Owner decision 2026-10-18]**
1. Banner wording approved: "Finish setup to book in one tap." No $5 credit (needs a budget, terms and abuse limits first).
2. Rider approval Option A approved: "Automatic approval upon phone verification … The pre-dispatch card authorization provides sufficient financial security. Please build in the audit record for automatic approvals and the staff suspension capability."
3. Booking-flow PR approved, "keeping the sign-in enforcement switched off until we explicitly activate it."
4. "Approved" (12:20 UTC) after "I am standing by to review and merge the rider-screens fixes PR": taken as approval to merge #293.

**#293 [Verified 2026-10-18]:** all six CI checks green on `c7feb4e`; merged as `eedec41`. `/api/health` reported `eedec41`, healthy, at 12:22 UTC. The live `rider-dashboard.html` is byte-identical to the merged file; the live `agent-assist.js?v=20261018-shared` contains the bottom spacer. **[Unresolved]** Not yet checked on a phone or inside the rider app.

**This PR [Verified 2026-10-18, local]:** everything is behind a new system flag, `jit_booking_enabled`, which is **off**. With it off, nothing a rider or reviewer sees changes. `rider_auth_ui_enabled` and `rider_auth_enforced` are untouched.
- **Server:**
  - `GET /api/rider/jit-config` (on or off).
  - `POST /api/rider/quick/start`: texts a Twilio Verify code to any valid US number (rider-app header required; the same rate limits as the existing sign-in).
  - `POST /api/rider/quick/verify`: checks the code, then signs in the one active rider with that number or creates one (first name and phone only). Two or more active riders sharing a number are refused, never guessed.
  - **Option A:** a verified phone approves the rider under the owner's rule, recorded each time as `rider_auto_approved` (actor `system`, rule `phone_verified`, set by the owner on 2026-10-18, previous status). While the switch is on, it applies to ordinary phone sign-in too, and email is not required to book.
  - **Staff:** `POST /api/admin/riders/:id/suspend` and `/reinstate` (admin only, reason of 3–500 characters, audited as `rider_suspended` / `rider_reinstated`). A suspended rider can sign in but cannot book, and the rule never re-approves them. Reinstating restores approval if the phone is verified.
  - `POST /api/admin/system/enable-jit-booking` and `disable-jit-booking` (admin only, audited).
  - A ride request falls back to the rider account's name and phone for the driver when the booking screen sends none.
- **Rider page (switch on):** the hero reads "Where to?" with no setup warning; the booking screen asks for no name, phone or email; "Confirm Ride" opens a bottom sheet (first name and number, then the texted code with one-time-code autofill), then the existing approval check and card step. On phones the map stays pinned and the booking steps slide over it. A visitor who left at the phone step sees "Finish setup to book in one tap".
- **Admin page:** Suspend on active riders; Reinstate on suspended ones; each asks for a reason.
- No migration: `status` has no constraint and `email` and `last_name` are optional (read-only check of production, 2026-10-18).
- **[Verified 2026-10-18, read-only]** Production `/api/config/public` reports `persona_enabled: false`, so a verified phone is enough to book. If Persona is switched on later, riders would need it too (unchanged rule).
- Tests: `lib/riderJit.test.js` (23); `test/server.jit-booking.test.js` (14: off by default; sign-up, wrong code, missing name, existing and suspended riders, shared number, suspend and reinstate, the switch); `test/jit-booking.browser.test.js` (4: off unchanged; on shows "Where to?" and no rider fields; the sheet signs a new rider up and approves them; the banner).

**Before switching it on [Unresolved]:**
- SMS cost: each sign-up sends a Twilio Verify text (per-message pricing applies; rate-limited per number and per device).
- App Review notes describe today's flow; update them if the switch is on for a submission.
- The §51 server gap (no rider ID skipped the readiness check) is closed separately by the security fix in §53 (#295), which this PR is rebased on. With that fix, ordinary riders need a session to book, which this switch provides.
- Card authorization (`/api/rides/payment-intent`) doesn't check suspension itself; the ride request does, and an unused hold is released as today.

**Handoff:**
- **Done:** #293 live; Just-in-Time booking built and tested locally, switch off.
- **Remaining:** merge approval for this PR; the owner's decision to switch it on (`POST /api/admin/system/enable-jit-booking`); a phone check with the switch on; the two security fixes; driver app emergency button; admin driver-status label.
- **Next authorized action:** none. Merging and switching on wait for the owner.
## 53. Update 2026-10-18 (UTC): security fix, ride requests require a signed-in, approved rider (#295, merged and live)

**[Owner decision 2026-10-18]** "Approved merge after all test return successfully" (covers #295 and #294).

**[Verified 2026-10-18]** #295: all six CI checks green on `2acfa92`; merged as `91e2dac`. `/api/health` reported `91e2dac`, healthy, at 12:42 UTC. A production `POST /api/rides/request` with no session returned **401** (probe with placeholder addresses; nothing created).

**[Owner decision 2026-10-18]** "Approved. You are explicitly authorized to build the server-side fix to close this gap immediately … enforce a strict requirement that all /api/rides/request payloads must contain a valid, authenticated rider ID that resolves to an 'approved' or 'active' status, returning a hard 401/403 otherwise." Built as a separate patch PR so it can merge ahead of #294.

**Finding closed:** `POST /api/rides/request` skipped every rider check when the request carried no `rider_id` (§51), so a visitor with no account could book and a suspended rider could avoid the check.

**This PR [Verified 2026-10-18, local]:**
- The rider comes only from the verified session (or the App Review session), whatever `rider_auth_enforced` says. `req.body.rider_id` is no longer trusted for identity on this route.
- No session: **401** "Please sign in to request a ride." No ride is created and the quote is not used.
- A session for a rider who isn't ready, isn't approved or active, is suspended or revoked: **403**, even when `ENABLE_RIDER_APPROVAL_GATE` is off.
- App Review: the review account (active, approved, verified; read-only check 2026-10-18) books as before. A reviewer session while review login is switched off is refused.
- Tests: `test/server.ride-request-auth.test.js` (7, new). Seven existing suites now sign their riders in. Tests that expected an unauthenticated request to create a ride now expect 401 and no ride: idempotency replay with no session, a caller naming the review rider id, and a stale reviewer session.

**Impact [Verified 2026-10-18, read-only]:**
- In the last 30 days, all 21 rides came from the App Review rider account, which signs in with a session. No ride in the database lacks a rider ID.
- **[Unresolved] Ordinary riders:** with the rider sign-in screen (`rider_auth_ui_enabled`) and Just-in-Time booking (`jit_booking_enabled`) both off, an ordinary rider has no way to get a session, so they can't book until one of them is switched on. The rider sign-up page (`rider-signup.html`) doesn't create a session.
- Card authorization (`/api/rides/payment-intent`) is unchanged. A hold made without a session can't become a ride and is released as today.

**Handoff:**
- **Done:** fix merged and live; #294 rebased on it (tree identical to the tested version).
- **Remaining:** ordinary riders can book again only once rider sign-in or Just-in-Time booking is switched on (owner decision).
- **Next authorized action:** merge #294 when its CI is green (owner approval above).

## 54. Update 2026-10-18 (UTC): #294 live with the switch off; App Review notes drafted (branch `claude/app-review-notes-jit`, no PR yet)

**[Owner decision 2026-10-18]** "Keep JIT Booking OFF. Do not send the POST /api/admin/system/enable-jit-booking command yet": no verified drivers on the road yet, avoid SMS costs from bots or early discovery, and update the App Review notes first.

**[Verified 2026-10-18]**
- #294: all six CI checks green on `c098a15`; merged as `d4b66ef`.
- Production at 12:51 UTC:
  - `/api/health` reports `d4b66ef`, healthy.
  - `GET /api/rider/jit-config` returns `enabled: false`.
  - `POST /api/rider/quick/start` answers 404, so no text is sent.
  - The live rider page carries the phone sheet `hidden`; it only opens when the switch is on.

**App Review notes (draft, not merged):** `docs/app-review/review-notes-2026-10.md`:
- The sign-in requirement for booking (#295).
- Phone sign-up listed as a server setting that is currently off (Guideline 2.5.19 asks for dormant features to be described).
- An alternative paragraph to use only if it is on for a submission.
- Pre-submission checks: the switch state on the day; account deletion for a phone-only account (not yet tested); Sign in with Apple not triggered (first-party phone codes); the demo account stays the review path.

**Handoff:**
- **Done:** #294 live and switched off; notes drafted.
- **Remaining:** owner review of the notes; they ride the next code PR (owner preference: no standalone docs PRs). Test deletion for a phone-only account before any switch-on.
- **Next authorized action:** none. Switching on waits for the owner.

## 55. Update 2026-10-18 (UTC): #296 merged; admin driver setup labels (PR `claude/admin-driver-status-label`, not merged)

**[Owner decision 2026-10-18]**
- "Proceed with the Admin driver-status label … Correcting the false 'Approved' status to 'Unverified' or 'Pending Setup'."
- Push-notification sign-up fix: "I also formally approve the Push-notification sign-up fix. Please add it to the active development queue."
- #296: merge when green.
- Driver email: the owner adds the mailing address and sends it to the 8 applicants (not sent by an agent).

**[Verified 2026-10-18]** #296 (docs only): all six CI checks green on `c36f1e2`; merged as `b626384`.

**This PR [Verified 2026-10-18, local]:**
- `GET /api/admin/drivers` adds a `setup` state to each driver, from the same checks that decide whether a driver can go online (`computeDriverReadiness`):
  - **Unverified:** email or phone not verified.
  - **Pending Setup:** identity, background check or vehicle still open.
  - **Verified:** every check passes.
- The extra columns read to work this out (`persona_status`, vehicle make, model and year) aren't returned; the response is otherwise unchanged.
- Admin dashboard: the driver badge shows that label and "Still needed: …". A driver counts as active only when approved **and** Verified, so the 19 applicant rows marked "approved" now show as Unverified pending drivers and the active count no longer includes them.
- The label changes nothing about who can go online; that is still decided by the server readiness check.
- Tests: `lib/driverCompliance.test.js` (6 new); `test/server.admin-driver-setup.test.js` (2, new); `test/manual-driver-verification.browser.test.js` (labels before and after a manual contact check).
- Full suite: 2,901 passed, 2 failed (`booking-flow.browser` Mapbox App Review case, `rider-navigation.browser`). Both pass alone (19/19); they were load-related.

**Handoff:**
- **Done:** #296 merged; label change built and tested.
- **Remaining:** merge approval for this PR; then the push sign-up fix (approved, next in the queue); driver app emergency button (needs a build); phone-only account deletion test.
- **Next authorized action:** build the push sign-up fix. Merging this PR waits for the owner.

## 56. Update 2026-10-18 (UTC): #297 merged and live; push sign-up security fix (PR `claude/push-subscribe-auth`)

**[Owner decision 2026-10-18]**
1. #297 approved to merge.
2. Push sign-up fix "Pre-Approved. Once your full local test suite finishes and the GitHub CI checks go green, you are authorized to open and merge the PR."
3. Next: the phone-only account deletion test; the driver app emergency button ("I formally approve the creation of a new driver app build for this once the code changes are ready").

**[Verified 2026-10-18]** #297: all six CI checks green on `86a07da`; merged as `1273d93`. `/api/health` reported `1273d93`, healthy, at 13:29 UTC.

**This PR [Verified 2026-10-18, local]:** closes the §49 finding.
- `POST /api/push/subscribe` now takes the owner only from the signed-in session:
  - riders from the verified rider (or App Review) session;
  - drivers from their own driver session, with no admin override.
- `owner_id` in the request body is ignored. No session gives 401. A rider session can't register as a driver.
- The rider and driver pages already send their sign-in on this request, so no page change is needed.
- Tests: `test/server.push-subscribe-auth.test.js` (6, new).
- `test/server.htaf-assistant.test.js` given a 30-second timeout: its first test timed out at 5 s on a cold cache, 2 of 3 runs, on this branch and on `main` alike. Now 4/4 with `--no-cache`.
- Full suite: 2,899 passed, 2 failed (`server.htaf-assistant`, fixed above; `rider-navigation.browser`, load-related, passes alone). An earlier run with 12 scattered failures overlapped with a concurrent driver-app test run (CPU load) and did not recur.

**Handoff:**
- **Done:** #297 live; push fix built and tested.
- **Remaining:** this PR's CI, then merge (pre-approved); phone-only deletion test; driver app emergency button and build.
- **Next authorized action:** merge this PR when CI is green.

## 57. Update 2026-10-18 (UTC): #298 and #299 merged; Android build 12; phone-only account deletion fix (PR `claude/phone-only-deletion`)

**[Owner decision 2026-10-18]**
- Phone-only deletion fix approved: "Proceed to open and merge the PR once the full test suite clears." The owner will run a live phone test right after switching Just-in-Time booking on.
- #299 approved to merge, with a new driver app build after it.
- Android versionCode 12: **hold**, no upload until the iOS build is ready and this fix is merged; both are uploaded together.
- iOS: the owner builds locally on a Mac (`eas build --local`), to avoid the Expo quota and the upgrade cost.
- VAPID keys: the owner generates them locally and sets them on Render (not shared in chat).
- Store sign-in: the owner gives the approved pilot store sign-in access from the admin dashboard.
- Just-in-Time switch-on: the owner calls the enable route directly, swaps in the "on" App Review paragraph before submission, and accepts the Twilio cost.

**[Verified 2026-10-18]**
- #298 merged as `33fc8f4`; `/api/health` reported `33fc8f4` at 14:04 UTC.
- #299 merged as `0313997` (six checks green on `2946d82`).
- Driver app Android build **1.0.0 versionCode 12** finished on EAS from `0313997` (build `ca0ce0c1-8e6b-4ca2-a5af-b825d0d8c9f4`). Not uploaded.
- The iOS EAS build was refused: the account's free iOS builds for the month are used up (reset 2026-11-01).
- Push: `POST /api/push/subscribe` answered **503** and `/api/push/vapid-public-key` returned an empty key at 14:04, 14:49 and 15:03 UTC. Production has no VAPID keys yet, so web push is off; the "contact me first" push can't reach anyone until they are set.
- Merchant check (13:47 UTC, counts only): stores 0 → 1, approved 0 → 1, active store sign-ins 0, items 0.

**Deletion test [Verified 2026-10-18, local, fake database and Twilio]:** a Just-in-Time phone-only account (first name + phone, no email):
- deletes while signed in: data removed, access revoked, the session ends and the old session can't book;
- can sign up again with the same number afterwards, which creates a new account;
- can delete by texted code with the number as 10 digits or formatted.
- **Found and fixed:** typed with a +1 prefix, the code path answered "No account was found". The lookup matched the exact phone text; it now matches the last 10 digits, the same rule as phone sign-in.
- Tests: `test/server.jit-account-deletion.test.js` (5, new). The related suites (deletion, Just-in-Time, Twilio sign-in, rider auth, ride-request auth) pass 201/201.
- The local full suite couldn't finish this afternoon: the container ran at a load of about 9 on 4 CPUs and browser tests timed out; two attempts were stopped at the time limit. GitHub CI runs the full suite on this PR.

**Handoff:**
- **Done:** #298, #299 merged; Android build 12; deletion fix built and tested.
- **Remaining:**
  - merge this PR when CI is green;
  - the owner's local iOS build, then the joint store upload (needs approval);
  - VAPID keys on Render;
  - store sign-in;
  - Just-in-Time switch-on and the owner's phone test.
- **Next authorized action:** merge this PR when CI is green.

## 58. Update 2026-10-19 (UTC): #300 live; builds; assistant ratings (PR `claude/assistant-feedback-tracking`, switch off); model-activation review pack; traffic-aware ETA (separate PR)

**[Owner decision 2026-10-19]**
- "Model-Activation Review Pack: Approved… Do not activate the model."
- "Satisfaction and Resolution Tracking: Approved. Please build the PR for thumbs up/down tracking and 'resolved without staff' counts, and keep it toggled off."
- "Mapbox Traffic-Aware ETA: Approved… you may prepare the PR to switch the traffic-aware ETA on."
- Dynamic (surge) pricing deferred. The owner noted Tennessee's price-gouging law for declared emergencies; any future surge feature must switch itself off during a declared state of emergency. **[Recommendation]** Counsel confirms the statute before any pricing design.
- "Upload Android now" (driver app 1.0.0 (12)): the owner uploads it in Play Console (below).

**[Verified 2026-10-19]**
- #300 merged as `cb84c36`; `/api/health` reported `cb84c36` at 13:26 UTC.
- `/api/agent/status`: `answer_mode: "rules_only"`. Stored `agent_model_mode` is `test_accounts` with the list `["rider:RIDER_GPLAY_REVIEWER"]` (a store review account). See the review pack §1.
- `/api/geo/status`: Mapbox configured in production.
- Rides in production (read-only count): 24 in total (20 completed, 2 failed, 2 cancelled), 2026-09-11 to 2026-10-18, including test and App Review rides.

**Builds and uploads (2026-10-18/19)**
- **Driver iOS, local build on the owner's Mac: not possible.** **[Verified 2026-10-19, owner's screenshots]** The Mac is Intel (`x86_64`) on macOS 12.7.6 with no Xcode (Command Line Tools only). Homebrew refuses Intel Macs, and Xcode 16+, which Expo SDK 54 and App Store uploads need, requires macOS 14 or later. **[Unresolved]** The owner chooses the iOS route: the free cloud build after 2026-11-01, a paid plan now, or another Mac.
- **Driver Android 1.0.0 (12):** `eas submit` (internal track, draft) stopped before uploading: no Google service account key on EAS (credential name only; none exists). **Nothing was sent to Google Play.** The owner is uploading the `.aab` by hand to Internal testing as a draft. **[Unresolved]** Upload result; rollout needs separate approval.
- **Rider Android:** build 1.0.2 (versionCode 11), EAS `79cdbcc3-4f94-4d48-95c9-171424a92b2f`, 2026-10-04, exists. Nothing Android-related has changed in `mobile/` since. **[Unresolved]** Whether it was ever uploaded; the owner's Play Console screenshot will show the highest versionCode.
- **Rider iOS:** the scheduled cloud build check (`trig_01EQw4n15urNHMHP1dz5SrRz`, 2026-11-01 14:05 UTC) is still active.

**Assistant ratings and "resolved without staff" (this PR; switch `agent_feedback_enabled`, off)**
- Thumbs up/down under web assistant answers. A signed token means only the person who got the answer can rate it. One audit row per rating, no message text.
- A random chat id (until Clear chat or sign-out) links answers and support requests. A chat "needed staff" if it opened a safety or review case or sent a support request; otherwise it is "resolved without staff". Driver app answers count as untracked (no build).
- Admin Agent page: the "Answer ratings" switch (audited) and a "Ratings and resolution" section; `GET /api/admin/agent/feedback`.
- No migration (uses `audit_logs`). Details: `docs/ai-usage.md`.
- **[Verified 2026-10-19, local]** Tests:
  - `lib/agent/feedback.test.js` (8, new);
  - `test/server.agent-feedback.test.js` (8, new);
  - `test/assistant-feedback.browser.test.js` (1, new);
  - all agent suites 300/300;
  - the assistant browser suites 25/25. With the switch off the memory test still shows only the chat key in browser storage.

**Model-activation review pack:** `docs/assistant-model-activation-review-pack.md`. Documents only; nothing activated.

**Traffic-aware pickup ETA:** separate PR `claude/mapbox-traffic-eta` (status in that PR's description).

**Handoff:**
- **Done:** review pack; ratings PR (switch off); status recorded.
- **Remaining:**
  - owner review of this PR and the ETA PR;
  - the review pack decisions (§6), starting with the test list;
  - the driver Android upload result;
  - the iOS route decision;
  - the rider Play Console check;
  - VAPID keys;
  - Just-in-Time switch-on (the owner's).
- **Next authorized action:** none beyond preparing these PRs. Merging, switching on ratings, and any model step each need the owner's approval.

## 59. Update 2026-10-22 (UTC): #301 and #302 live; store reviewer off the AI test list; traffic-aware ETA on; Claude Haiku 5.5 (PR `claude/haiku-5-5`)

**[Owner decision 2026-10-19]**
- "Merge #301 (Ratings): Approved. Merge the PR and keep the admin switch toggled off."
- "Merge #302 … Once merged, you are authorized to execute the POST /api/admin/system/enable-traffic-eta admin call." Later the same day: "authorized to manually edit the database to bypass the admin endpoint … and generate the audit record."
- "Remove the Google Play Reviewer … from the AI test list immediately."
- Model: "I officially confirm the selection of Claude Haiku 5.5. Go ahead and make the necessary code changes and prepare the assistant evaluation re-run." The owner first named Claude 3.5 Haiku; it is retired (Anthropic model reference: retired 2026-02-19).

**[Verified 2026-10-19]**
- Model test list emptied at 13:43 UTC (`agent_model_test_accounts` = `[]`), audit row 1565. The session has no admin token, so this was a direct database update, recorded as such. `/api/agent/status` still `rules_only`.
- #301 merged as `be1b46e`, live at 13:44 UTC. Ratings stay off: the live rating route answers 409.
- #302: `main` merged into the branch, the two PRs' suites 58/58 together, 6/6 checks green on `d84d6cc`; merged as `7d2497c`, live at 13:53 UTC.
- `dispatch_route_api_enabled` = `true` at 13:53:53 UTC after checking ETA persistence on and Mapbox configured; audit row 1566 (`traffic_eta_enabled`, direct database update).

**[Verified 2026-10-22, read-only]**
- One ride since the switch (2026-10-20 01:59 UTC, completed). One Mapbox traffic call this month; the ride's stored pickup ETA is 1 min, 0.07 mi. The first live traffic-aware ETA worked.
- Merchant onboarding checks 2026-10-19, 20 and 21: no change (1 approved store, no sign-in access yet, no items).

**Claude Haiku 5.5 (this PR; model still off in production: no API key, empty test list)**
- `claude-haiku-5-5` for Harvey Assistant and the assistant pilot (they share the setting).
- Every request sends `thinking: {type: "disabled"}`: Haiku 5.5 thinks by default and thinking would count against the 500-token output cap.
- Prices added (Haiku 4.5 kept for earlier ledger rows). Worst case per answer $0.01035 (was $0.1035); the $10 ceiling is unchanged.
- Evaluation re-run prepared: `scripts/model-eval.js` runs the regression and holdout sets (49 questions, synthetic data) through the model path. It sends nothing without `--confirm-spend` and stops at `--max-usd` (default $1.00); at most $0.51 for the full set. It needs `ANTHROPIC_API_KEY` in the shell running it. **[Unresolved]** Not run: no key in this session, and it spends money.
- Tests [Verified 2026-10-22, local]: all assistant suites 356/356 after the price updates; new `lib/assistantPilot/gateway.test.js` (1) and `test/model-eval.test.js` (2).

**Handoff:**
- **Done:** #301 and #302 live; reviewer removed; traffic ETA on and working; Haiku 5.5 PR.
- **Remaining:**
  - merge this PR (owner approval);
  - the Console checks and the test-account plan (review pack §3);
  - the live evaluation run (needs the key and the owner's go-ahead to spend up to $1);
  - #207 updates before publication;
  - from §58: the Android driver upload result, the iOS route decision, the rider Play Console check, VAPID keys, Just-in-Time switch-on.
- **Next authorized action:** none beyond opening this PR. Merging, adding the key, the live evaluation and any model step each need the owner's approval.

## 60. Update 2026-10-22 (UTC): #303 live; live Stripe webhook created (signature not yet matching); first Claude Haiku 5.5 evaluation; quote fix (PR `claude/model-eval-quotes`)

**[Owner decision 2026-10-22]**
- Stripe: "Let's make a live webhook", then "Create the webhook and give it to me in this chat, you have my authorization."
- "Merge #303 … keep the model strictly switched off."
- "I authorize the $1 spend limit for the evaluation."
- "Approved, go ahead with the PR" (evaluation follow-ups below).

**[Verified 2026-10-22]**
- **Ride payments use the live Stripe account:** `/api/stripe-key` serves a live publishable key for account "Harvey Taxi2"; the Stripe connector's live account is the same one. All 25 rides so far are `payment_status = not_required` (ride payment gate off). Orders stay on the test key (`ORDERS_STRIPE_SECRET_KEY`, test only).
- **Live webhook created by the agent** through the Stripe connector: `we_1UTBZSK0dBlmhLqaUs6qbDyG`, URL `https://harveytaxiservice.com/api/stripe/webhook`, 4 events (`payment_intent.amount_capturable_updated`, `.succeeded`, `.payment_failed`, `.canceled`), enabled. Its signing secret was shown in the chat at the owner's request. Stored by the owner in Render as `STRIPE_WEBHOOK_SECRET` (name and location only here). **[Recommendation]** Roll the secret once working, without sharing it.
- From 02:28 UTC the webhook answers unsigned requests with 400 instead of 503 "not configured", so the variable is loaded.
- **[Unresolved]** Synthetic events signed with the webhook's secret (02:29–02:31 UTC; no matching ride) were rejected as "Invalid Stripe signature". Signing verifies locally, and Stripe shows only this one endpoint, so the value in Render differs from the secret. The owner is to re-copy it from Stripe and paste it exactly.
- #303 merged as `12e64cc` (6/6 checks), live at 02:31 UTC; `/api/agent/status` still `rules_only`.
- **Render shows "Payment failed — update your credit card"** (owner's screenshot). **[Unresolved]** If the workspace is suspended, harveytaxiservice.com goes offline. The owner updates the card.

**Evaluation (owner's Mac, owner's key; owner's screenshots)**
- Run 1: every call refused, "This API key is not scoped to a workspace". $0. Fixed by exporting `ANTHROPIC_WORKSPACE_ID`.
- Run 2: Claude Haiku 5.5 answered 47 of 49; 2 blocked by the number guard. Accuracy 69.4% overall (rules only: 69.4%), 68.1% for the model's own answers. **4 wrong policy quotes** (rules: 0). Cost $0.0192 ($0.0004 per question); p95 3.6 s.
- **[Recommendation]** Not ready; the model stays off.

**This PR (no production change; the model stays off)**
- Policy quotes in model answers come only from searching the person's own question, the rules assistant's search. The model's reworded search is no longer used to pick a section. Checked: on all 49 graded questions, searching the person's words returns either the expected section or nothing, never a wrong one.
- `scripts/model-eval.js`: writes per-question results (reply, sources, grade, Anthropic's reason) to `model-eval-results.json` (git-ignored) and adds `provider_errors` to the summary.
- Review pack: `ANTHROPIC_WORKSPACE_ID` (or a workspace-scoped key) added to step T2; the evaluation and its pass bar added to T4; results table added.
- Tests [Verified 2026-10-22, local]: 2 new quote-selection tests, 1 new evaluation-report test; model, agent and evaluation suites pass.

**Handoff:**
- **Done:** #303 live; live webhook created; evaluation run 2 analysed; quote fix and report improvements in this PR.
- **Remaining:**
  - owner: Render card; re-paste `STRIPE_WEBHOOK_SECRET`;
  - merge this PR, then re-run the evaluation (about $0.02);
  - from §58–59: Android upload result, iOS route, rider Play Console check, VAPID keys, Just-in-Time switch-on, store sign-in.
- **Next authorized action:** open this PR. Merging needs the owner's approval.

## 61. Update 2026-10-22 (UTC): #304 live; Business & Merchant Partnerships page (PR `claude/merchant-page-v2`, migration not applied)

**[Owner decision 2026-10-22]**
- "Merge #304." Stripe: "stripe webhook is set as well in env."
- Merchant page redesign (owner's brief: navy/white/gold, "Let's Move Business Forward.", partnership categories, sectioned application, consent, FAQ, confirmation only after the server accepts). Answers to the three questions:
  - "Two paths, same URL": `/merchant-apply.html` keeps its name and gains a business-partnership path; the delivery-pilot store application stays on the same page.
  - "New table + admin list": inquiries go to their own table with a list on the admin dashboard.
  - "No application fee": the FAQ says so.

**[Verified 2026-10-22]**
- #304 merged as `8c7e4c8`; `/api/health` reports `8c7e4c8` (03:48 UTC). `/api/agent/status` was `rules_only` at merge; the model stays off.
- **[Unresolved]** Stripe webhook signature: synthetic signed events at 03:31 and 03:32 UTC still returned 400 "Invalid Stripe signature" after the owner reported the variable set. The owner is checking the Render value against Stripe (first and last characters, no spaces or quotes). No ride payments depend on it yet (ride payment gate off).

**This PR (nothing goes live until the owner approves the merge)**
- **Page** `/merchant-apply.html`: new design and SEO/social tags. Two paths:
  - **Business partnership inquiry** (default): sections A–E (business, location, contact, interests, message) and a consent checkbox. "Application Received" appears only after the server stores the inquiry; on any error the message is shown and the entries are kept.
  - **Delivery pilot store application** (`#delivery`): the existing form, fields, "Delivery isn't live yet" notice and excluded-items list, unchanged in what it sends.
  - Healthcare card notes that HTAF is a separate nonprofit, with a link to harveytransportationfoundation.com. No airport, volume or revenue claims.
- **Server:** `POST /api/partnerships/inquiries` (5 per hour per address; spam via a hidden field or a form sent in under 3 s is dropped quietly and audited; one open inquiry per email; audited; emailed to `PARTNERSHIP_INQUIRY_EMAIL`, default support@harveytaxiservice.com). Until the table exists it answers 503 "Partnership inquiries aren't open yet. Please email support@harveytaxiservice.com." `GET /api/admin/partnerships` and `PATCH /api/admin/partnerships/:id` (admin only; status new → contacted → closed, optional note; audited).
- **Admin dashboard:** "Partnership Inquiries" card after Merchants.
- **Migration** `20261022010000_partnership_inquiries.sql`: new table `public.partnership_inquiries`, checks matching the form, RLS on, no anon or signed-in access. **[Unresolved] Not applied to production; needs the owner's approval.** Additive only; no existing table changes.
- Tests [Verified 2026-10-22, local]: full suite 3,151 passed, 0 failed, including database tests against a local Postgres 16 (the new migration applies on the schema baseline; constraints and RLS checked). New: 18 validation tests, 7 route tests, 2 browser tests (both paths; confirmation only after success; no sideways scroll at 390 px). Browser tests are desktop Chromium at phone size, not device tests.
- **[Recommendation]** Add a line to `/privacy.html` covering business contact details sent through this form (used to review and reply to the inquiry). Not changed in this PR; wording for the owner to approve.

**Handoff:**
- **Done:** #304 live; partnership page, routes, admin list, migration and tests in this PR.
- **Remaining:**
  - owner: review the PR and the page; approve the merge; approve applying the migration (the page shows the clear 503 message until then); privacy-policy line;
  - owner: Render card; Stripe webhook value check, then the agent re-tests;
  - re-run the evaluation after #304 (about $0.02);
  - from §58–60: Android upload result, iOS route, rider Play Console check, VAPID keys, Just-in-Time switch-on, store sign-in.
- **Next authorized action:** open this PR. Merging and applying the migration each need the owner's approval.

## 62. Update 2026-10-22 (UTC): #305 live with its migration; Stripe webhook verified; privacy policy line (PR `claude/privacy-partnership-inquiries`)

**[Owner decision 2026-10-22]**
- "Merge #305 and apply the migration, approved."
- Stripe: the owner rolled the webhook signing secret, saved it in Render and redeployed, then approved a live test (a $0.50 payment request created and cancelled, never confirmed).
- "Approved, add the privacy policy line."

**[Verified 2026-10-22]**
- **Migration** `partnership_inquiries` applied to production at 03:51 UTC, before the merge. Checked: the table didn't exist before; after, RLS on, no policies, no anon or signed-in access, service role can insert, 16 check constraints, 0 rows. Supabase recorded it as version `20261022035132` (the repo file is `20261022010000`; same SQL).
- **#305 merged** as `377676f` after 6/6 checks; `/api/health` reported `377676f` at 03:55 UTC. Live checks that stored nothing: the page shows both paths; an incomplete inquiry returns 400 with the field message; the admin list returns 401 without a token; `/api/agent/status` `rules_only`. No real inquiry has been sent yet.
- **Stripe webhook works.** The owner created `pi_3UTDHhK0dBlmhLqa0scJa8xa` ($0.50, live) from the Stripe CLI and cancelled it with no payment method attached; $0 received. Event `evt_3UTDHhK0dBlmhLqa0iNsvQpG` (`payment_intent.canceled`) shows `pending_webhooks: 0`, and production `audit_logs` has `stripe_webhook_received` for it at 04:11:56 UTC. No ride matched, so no ride changed. The §60 signature issue is resolved; the secret shown in chat earlier is no longer valid (rolled). The new value is stored only in Render as `STRIPE_WEBHOOK_SECRET`.
- The agent could not create the live payment itself (no live write for payment intents in the connector; the session's safety controls blocked live financial actions). The owner ran it.
- **[Recommendation]** The live secret key is a legacy-style key (the Stripe CLI refused it). Plan a change to a restricted key; it is used in Render, so schedule the switch.

**This PR**
- `/privacy.html`: new section 7 "Business and Partnership Inquiries" (NEMT section renumbered to 8); "Last updated: October 2026" added.
- `/privacy-policy.html`: the same wording added to section 1 (Information We Collect). Section numbers unchanged, so the assistant's policy citations are unaffected.
- Wording states only what the code does: collected fields, used to review and respond, stored in the database and emailed to support, not sold, no account created, correction or deletion by emailing support. No retention period stated (retention review still open).
- Tests [Verified 2026-10-22, local]: full suite 3,151 passed, 0 failed (including database tests).

**Handoff:**
- **Done:** #305 live; migration applied and checked; webhook verified end to end; privacy wording in this PR.
- **Remaining:**
  - owner: approve merging this PR; send one real partnership inquiry (check the confirmation, the support email and the admin card); Render card; plan the restricted live key;
  - re-run the evaluation after #304 (about $0.02);
  - from §58–60: Android upload result, iOS route, rider Play Console check, VAPID keys, Just-in-Time switch-on, store sign-in.
- **Next authorized action:** open this PR. Merging needs the owner's approval.
