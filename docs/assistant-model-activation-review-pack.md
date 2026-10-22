# Harvey Assistant: model-activation review pack

**Prepared:** 2026-10-19 (UTC), for the owner's review.

**Owner decision (2026-10-19):** "Model-Activation Review Pack: Approved. Please prepare the documents detailing the AI privacy disclosure (#207), the test-account plan, the cost cap details, and the deactivation protocol. Do not activate the model."

**This pack activates nothing.** It changes no flag, no Render variable and no published page. Every step below that changes production is marked **[Needs owner approval]**.

Labels follow `CLAUDE.md`: **[Verified]** (how and when), **[Owner decision]**, **[Recommendation]**, **[Unresolved]**.

Details already documented elsewhere are not repeated here:
- `docs/ai-model.md`: how the model integration works.
- `docs/privacy-ai-disclosure-draft.md`: the original disclosure draft.
- `docs/assistant-model-proposal.md`: Anthropic's terms, reviewed 2026-10-15.

---

## 1. Where things stand today

| Item | State | Evidence |
|---|---|---|
| What riders and drivers get | **Rules-based answers only.** No AI model answers anyone. | **[Verified 2026-10-19]** `GET /api/agent/status` on harveytaxiservice.com returned `answer_mode: "rules_only"` (version `cb84c36`) |
| Anthropic API key on Render | Appears **not set** | **[Verified 2026-10-19, by inference]** The server reports `rules_only` whenever the key is missing (`lib/agent/claudeClient.js`). Render itself was not checked; only the owner can see it. |
| Stored model mode | `agent_model_mode = test_accounts` | **[Verified 2026-10-19]** read-only query of `system_flags` (production) |
| Model test list | `["rider:RIDER_GPLAY_REVIEWER"]` | **[Verified 2026-10-19]** same query |
| Model spending to date | 76 model calls, **$0.1354** in total, all between 2026-10-04 and 2026-10-08 | **[Verified 2026-10-19]** `agent_model_usage` |
| Assistant volume (all rules-based) | 217 answers in the last 30 days (173 to signed-in accounts); 111 in the last 7 days | **[Verified 2026-10-19]** `audit_logs`, `agent.decision` rows. Includes test and App Review traffic. |
| Owner decision in force | Harvey Assistant stays rules-only | **[Owner decision 2026-10-12, repeated 2026-10-13]** |
| Privacy disclosure | PR #207: draft, unmerged and unpublished | **[Verified 2026-10-19]** GitHub. Its base is from 2026-10-09. |

**Finding: the test list holds a store review account, not a synthetic one.**
- **[Recommendation]** Before any test, have the test list hold only the synthetic test accounts in §3. `RIDER_GPLAY_REVIEWER` is the Google Play reviewer's account. If a key were added today, Google's reviewer would start getting AI answers before the disclosure is published.
- Alternatively, set the model mode to `off` now. That is a production change, so **[Needs owner approval]**.

---

## 2. The AI privacy disclosure (PR #207)

### What #207 publishes

1. **A new Privacy Policy section, "10. Harvey Assistant (AI)".** It covers:
   - asking permission first ("Allow AI answers" / "Not now");
   - what is sent to Anthropic, PBC: the typed message, up to six recent messages kept on the device, and the account details the app already shows;
   - that Anthropic does not train on this data;
   - legal and safety-flag retention (up to 2 years);
   - what Harvey Taxi keeps: a per-request record without message text, redacted excerpts of unanswered questions, and approved support requests;
   - that the assistant can't change anything by itself, can be wrong, and is not an emergency service;
   - how to turn AI answers off.
2. **Anthropic, PBC added to the "Sharing of Information" list.**
3. **A fix to the assistant's knowledge index** so reviewer comments in the HTML are never quoted to users.

### What must change in #207 before it is published

| # | Change | Why |
|---|---|---|
| 1 | Update the branch from `main` and re-run all checks. | The branch is ten days behind `main`. |
| 2 | Remove or reword the OpenAI line in §3 ("older website support chat and optional foundation application triage… (OpenAI)"). | The old OpenAI chat was replaced by Harvey Assistant (#223), and the OpenAI HTAF triage was removed (#237). |
| 3 | Add one sentence on ratings, if the ratings PR is merged and switched on: "If you rate an answer, we keep the rating, the type of question and which app you used, not your message." | The ratings PR stores a thumbs up/down per answer (no message text). |
| 4 | Adjust the maps line if the traffic-aware ETA PR is merged and switched on: Mapbox would supply the arrival estimates instead of Google Maps Platform. | That PR moves pickup-ETA routing from Google Routes to Mapbox. |
| 5 | State the Anthropic retention period only if your Console confirms it. | **[Unresolved]** Anthropic's standard API retention (30 days, per secondary sources) was not readable from this environment. The draft deliberately says nothing about it until you check. |
| 6 | Set the exact "Last updated" date on the day it is published. | The draft says "October 2026". |

### Checks only you can do, in the Anthropic Console

These are **[Unresolved]** until you confirm them:
1. The account is a commercial API account under Anthropic's Commercial Terms.
2. No training or data-sharing opt-in is enabled.
3. The data-retention setting (Settings → Privacy / Data retention), including whether zero data retention applies.
4. The Data Processing Addendum is accepted.
5. The workspace spend limit is **$10 or less**, and automatic credit reload is **off**.

### Also needed at publication

- **Store privacy labels:** Apple App Privacy and Google Play Data safety must declare the data sent to a service provider. **[Recommendation]** Counsel confirms the wording.
- **Legal review:** **[Recommendation]** counsel reviews §10 before publication. This pack is not legal advice.

---

## 3. Test-account plan

Every step changes production and needs **[Needs owner approval]**, given once for the whole plan or step by step.

| Step | Who | What | Pass condition |
|---|---|---|---|
| T0 | Owner | Anthropic Console checks (§2). Spend limit ≤ $10, auto-reload off. | Confirmed in writing in this chat (names only, never the key). |
| T1 | Agent, with approval | Replace the test list with two **synthetic** accounts: one rider and one driver, holding test data only (names in the status record, never credentials). Remove `RIDER_GPLAY_REVIEWER`. | `GET /api/admin/agent/model` shows only the two synthetic ids. |
| T2 | Owner | Add `ANTHROPIC_API_KEY` in Render (typed by you; never in chat or GitHub). Leave `AGENT_MODEL_PUBLIC_APPROVED` unset. | `/api/agent/status` shows `rules_only_except_test_accounts`. The public still gets rules. |
| T3 | Owner (admin token) | Admin Agent page → Claude model → **Check connection** (free; nothing billed). | Both rider and driver requests accepted. |
| T4 | Owner or agent with the owner's token | Admin **Try** console: the 40-question synthetic set, as the synthetic rider and driver. | No made-up numbers, links or "booked/charged" claims (the grounding guard falls back to rules if one appears). Safety topics (emergency, fraud, refunds) never reach the model. |
| T5 | Owner | Sign in as the synthetic rider and driver in all four apps and ask 5 questions each. | Every model answer shows "AI-generated by Harvey Assistant". |
| T6 | Agent | Cost check: real cost per answer against the estimate in §4, from the admin page. | Average ≤ $0.006 per answer. |
| T7 | Agent | Write the results into `docs/project-status.md`. | Results recorded with dates. |

**Public activation is a separate later decision.** It needs: #207 published, `AGENT_MODEL_PUBLIC_APPROVED=true` set by you, and mode `all`. It is not part of this plan.

---

## 4. Cost cap details

| Control | Value | Where it's enforced |
|---|---|---|
| Monthly ceiling | **$10.00**, all apps combined | On the server (`MONTHLY_BUDGET_CEILING_USD`) **and** inside the database reservation function (`least(budget, 10)`). Can be lowered with `AGENT_MODEL_MONTHLY_BUDGET_USD`, never raised. |
| Reservation before each answer | **$0.01035** on Claude Haiku 5.5 ($0.1035 on Haiku 4.5) (worst case: 3 calls × 16,000 input tokens at the dearest rate + 500 output tokens) | `agent_model_reserve`, atomic across server instances |
| Typical answer | Haiku 5.5: about **$0.0003** (estimate); Haiku 4.5: about $0.002–$0.006 | Settled at the real cost; the unused reservation is released |
| Observed so far | 76 calls, $0.1354 → **about $0.0018 per call** | **[Verified]** `agent_model_usage`, 2026-10-04 to 2026-10-08 |
| When the budget runs out | That question gets the rules-based answer. Nothing breaks. | Server |
| Provider backstop | $10 spend limit in the Anthropic Console | Anthropic (owner sets it) |

**Estimate at today's volume:** 173 signed-in answers per 30 days × $0.006 ≈ **$1.04/month** at the top of the typical range. This is an estimate; much of today's traffic is testing. Even at 1,500 answers a month, the typical cost is about **$4.90**, under the cap.

**[Owner decision 2026-10-19] Claude Haiku 5.5 chosen** (PR `claude/haiku-5-5`). Original recommendation: Claude Haiku 5.5 ($0.10 / $0.50 per million tokens, read on claude.com/pricing 2026-10-15). It needs a small code change (a price row in `lib/agent/modelBudget.js`, which today prices only Haiku 4.5) and a re-run of the evaluation. That is a separate PR, and only if you want it.

---

## 5. Deactivation protocol

Any one level stops model answers. Each level is listed with how to check it worked.

| Level | Action | Who | Effect | How to check |
|---|---|---|---|---|
| 1 (fastest) | Admin Agent page → Claude model → mode **off** | Any admin | Immediate; audited (`agent.flag_changed`) | `/api/agent/status` shows `rules_only` |
| 2 | Admin Agent page → **Kill switch** on | Any admin | Stops the whole assistant, rules answers included; the assistant button disappears and booking is unaffected | `/api/agent/status` shows `assist_available: false` |
| 3 | Remove `ANTHROPIC_API_KEY` in Render | Owner | Model off after the restart Render performs | `rules_only`, and the admin model panel says the key is not set |
| 4 | Revoke the key in the Anthropic Console | Owner | Any call is refused by Anthropic; the server falls back to rules | Admin model panel shows Anthropic's refusal |
| 5 (automatic) | Budget exhausted or Anthropic spend limit reached | — | Rules answers until the next month | Admin model panel shows the budget or provider limit |

**[Recommendation] Switch the model off (level 1) at once if:**
- an answer states a wrong fare, time or policy;
- a model answer appears without the AI label;
- anyone reports personal data in an answer that wasn't theirs;
- cost per answer exceeds $0.02;
- Anthropic reports an incident or changes its data terms.

Record each switch-off in `docs/project-status.md` with the time, the level and the reason.

---

## 6. Decisions for the owner

1. **[Needs owner approval]** Remove `RIDER_GPLAY_REVIEWER` from the model test list now, or set the mode to `off` (§1).
2. Complete the Console checks (§2) and tell me the results, without any key.
3. **[Needs owner approval]** Run the test-account plan T1–T7 (§3).
4. ~~Choose a model.~~ **[Owner decision 2026-10-19]** Claude Haiku 5.5. Evaluation runner: `scripts/model-eval.js` (step T4).
5. After counsel's review, approve #207's updated wording and its publication. This is a separate approval and isn't needed for synthetic testing.
