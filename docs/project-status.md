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

1. Approve merging Stack A (#212 → #210 → #214 → #215), including #210's migration and deploy.
2. Privacy policy (#207): complete the Anthropic Console checks and approve the wording before publication and any public AI.
3. Approve Stack B (#213 → #216 → #217) for merge as test-mode code only, or keep it as drafts.
4. Africa: send written questions to Paynow and EcoCash. Set commission rates, unpaid limits and dispute allowances per market. Decide cash approval per market.
5. Driver iOS build with AI consent (after #210): approve the build in the 1 November allowance.
6. Old `/api/ai/support` endpoint: confirm its status; decide whether to turn it off or delete it after #214/#215.
7. Supabase plan and staging project decision.

## 7. Scheduled checks **[Verified 2026-10-11, Routines]**

| Routine | When | What it does |
|---|---|---|
| `trig_01EQw4n15urNHMHP1dz5SrRz` "Rider iOS 1.0.2 (11) cloud build day" | 2026-11-01 14:05 UTC | Checks the allowance reset ($0), signing, main settings and tests, and stored build number 10. Then it starts exactly one rider iOS build. It never uploads or submits. It starts a driver build only with explicit owner approval. |
| `trig_018F8fjW1v3aiHoGsBSHu3Je` "HTAF Grant Pipeline Watch" | Monthly, 1st, 14:00 UTC | HTAF grant openings (separate from Harvey Taxi) |

## 8. Session handoff (2026-10-11)

**Completed this session (2026-10-10 to 2026-10-11):**
- #211 merged and live.
- Drafts #212–#217 prepared. The #210/#212 conflict is resolved.
- #217 safeguards added.
- These three records created.

**Remaining:**
- Owner reviews of Stack A and Stack B.
- Privacy checks.
- Provider and tax confirmations.
- Device tests (see the app files).

**Next authorized action:** the 1 November rider iOS build check (scheduled). Nothing else is authorized to merge, deploy, build, upload or submit.
