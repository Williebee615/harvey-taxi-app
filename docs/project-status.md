# Harvey Taxi platform: project status (shared record)

**Last updated: 2026-10-11 (UTC)** by Claude Code (session `session_01NLS9NQfpaLwc6iu7ve7HfQ`).

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
| `main` | `47f63b4` (#211, rider layout fix) **[Verified 2026-10-11, Git]** |
| Production web/API (Render, harveytaxiservice.com) | Running `47f63b4`. Render showed it live at about 13:30 UTC on 2026-10-10, and `/api/health` returned healthy. **[Verified 2026-10-10]** |
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
| Driver verification gate | `ENABLE_CHECKR` = on, `ENABLE_PERSONA` = on in production | **[Verified 2026-10-11]** via the public `/api/config/public` (`checkr_enabled`, `persona_enabled`), read only, nothing changed |
| Admin pages | `admin-home.html` approves through `PATCH /api/admin/drivers/:id/approve`; `/admin` and `/admin.html` redirect (301) to `admin-dashboard.html`; admin APIs return 401 without a session | **[Owner decision 2026-10-11]** #220 approved; merged as `8bee024`; **[Verified 2026-10-11]** live by HTTP checks |
| Old website chat endpoint `/api/ai/support` (OpenAI) | Enabled state **[Unresolved]**. It is not exposed publicly. Confirm via admin `/api/health` → `integrations.openai`, or `OPENAI_API_KEY` on Render. | Checked 2026-10-10 |

## 2. Pull requests

Nothing below is merged. **[Verified 2026-10-11, GitHub]**

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
9. **Offer-time verification recheck:** PR #221, **ready for review** (2026-10-12). All 6 checks pass on its final commit `4c28aaa`; the branch is current with `main`. The deployment and rollback plan is in the PR. Merge awaits the owner. Offers, acceptance and admin assignment now re-check verification; dispatch fails closed; trips under way are untouched. 6 new tests (4 fail without the change); full suite 1,905 passed **[Verified 2026-10-11, local]**. Needs merge approval.
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

## 7. Scheduled checks **[Verified 2026-10-11, Routines]**

| Routine | When | What it does |
|---|---|---|
| `trig_01EQw4n15urNHMHP1dz5SrRz` "Rider iOS 1.0.2 (11) cloud build day" | 2026-11-01 14:05 UTC | Checks the allowance reset ($0), signing, main settings and tests, and stored build number 10. Then it starts exactly one rider iOS build. It never uploads or submits. It starts a driver build only with explicit owner approval. |
| `trig_018F8fjW1v3aiHoGsBSHu3Je` "HTAF Grant Pipeline Watch" | Monthly, 1st, 14:00 UTC | HTAF grant openings (separate from Harvey Taxi) |

## 8. Session handoff (2026-10-11, updated)

**Completed this session (2026-10-10 to 2026-10-11):**
- #211 merged and live.
- Drafts #212–#217 prepared. The #210/#212 conflict is resolved.
- #217 safeguards added.
- These three records created.
- #220 merged (`8bee024`) and verified live; production Checkr/Persona flags read; online gate and review isolation verified; 27 accounts classified.

**Remaining:**
- Owner reviews of Stack A and Stack B.
- Privacy checks.
- Provider and tax confirmations.
- Device tests (see the app files).
- Owner decision on the 27-account cleanup.
- Rider: the Harvey Taxi (6761441561) 1.0.1 submission of 11:45 AM: the owner is removing it **[Owner decision 2026-10-11]**; removal not yet confirmed.
- Owner decisions: cleanup SQL, #221, the #207 wording and the Google Ads question, and whether the rider review account keeps Claude answers before #210 ships.

**Next authorized action:** the 1 November rider iOS build check (scheduled). Nothing else is authorized to merge, deploy, build, upload or submit.
