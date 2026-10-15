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
