# Harvey Taxi AI setup audit

**Date: 2026-10-12 (UTC).** Read-only audit of `main` at `8bee024` and of production settings. Nothing was merged, deployed, migrated or switched during the audit, and no AI calls were made.
Shared record: [project-status.md](project-status.md).

Labels: **[Verified]** (with how) · **[Owner decision]** · **[Recommendation]** · **[Unresolved]**.

## 1. Summary

- Harvey Taxi owns the agent logic: the prompts, routing, rules, data lookups, safety checks, budget and records are in this repository (`lib/agent/`, `server.js`). Anthropic is used only as a model provider through its standard messages interface. The model has no direct database access, credentials or tools of its own.
- Almost everything answers from fixed rules. Claude answers only accounts on a test list.
- **[Verified 2026-10-11, `agent_model_usage`]** Every Claude call ever recorded came from the two review accounts (driver: 76 calls, 4–8 Oct; rider: 10 calls, 4–5 Oct) or the admin test console. No ordinary rider or driver has reached Claude. October spend is about $0.14.
- The older website chat still uses **OpenAI** for any visitor, with no sign-in and no consent, if `OPENAI_API_KEY` is set on Render **[Unresolved]**. This is the main open privacy item.

## 2. Agents

Catalogue: `lib/agent/specialists.js` (lines 33–39 and 53–109).

| Agent | Role | Engine | Where it runs today |
|---|---|---|---|
| Harvey Assistant (Rider) | Rider's own rides, fares, bookings, cancellations | Rules; Claude only for test-list accounts | Rider website dashboard (`public/rider-dashboard.html`), which is also what the rider apps show |
| Harvey Assistant (Driver) | Driver's own offers, trips, earnings, hours | Rules; Claude only for test-list accounts in a client that shows the AI label | Driver web dashboard (`public/driver-dashboard.html`) and the native driver app. Build 13 doesn't send the label, so it is rules only. |
| Escalation | Emergency, fraud, dispute, refund, account and screening detection; fixed answer plus staff case | Rules only (`lib/agent/escalation.js`) | Wherever the assistant runs |
| Support Handoff | Sends a summary the user wrote and approved | Rules only (`lib/agent/handoff.js`) | Rider and driver |
| Dispatch Recommender | Suggests drivers; advice only | Rules (`lib/agent/recommender.js`) | Admin pages |
| Ride Coordinator | Plans redispatch of stalled rides | Rules (`lib/agent/coordinator.js`) | **Off** (`agent_shadow_mode_enabled`, `agent_automation_enabled`, `agent_auto_redispatch_enabled` unset = off) |
| HTAF Information Assistant | Foundation questions from approved published content | Content only, no AI (`lib/htafAssistant.js`) | **Off** (`htaf_assist_enabled` unset; `/api/htaf/assist/status` returns `assist_available:false`) **[Verified 2026-10-11]** |
| 5 specialists: Ride Booking, Delivery, Driver Onboarding, Customer Support, Safety | Narrow topics for the agents above | Rules only, never AI | Each switch is on, but `agent_specialist_scope = test_accounts` uses the same test list as Claude. With the list empty, nobody gets them. |

## 3. AI providers, models and controls

| Function | Provider and model | Where it runs | Controls |
|---|---|---|---|
| Harvey Assistant model answers | Anthropic, `claude-haiku-4-5` (`lib/agent/claudeClient.js:16`); 6 s timeout, no retries, capped output | Server only (`api.anthropic.com`) | `agent_model_mode` (`off` / `test_accounts` / `all`); `agent_model_test_accounts`; `agent_model_driver_scope`; `ANTHROPIC_API_KEY` (Render); `all` also needs `AGENT_MODEL_PUBLIC_APPROVED=true` (`lib/agent/modelPolicy.js`) |
| Budget | $10/month limit in code and in the database (`lib/agent/modelBudget.js:21`, `agent_model_reserve`) | Server and database | `AGENT_MODEL_MONTHLY_BUDGET_USD` can only lower it |
| Admin "Try" console | Anthropic, same model | Server, admin sign-in only | Admin authentication |
| Old website support chat `/api/ai/support` (`public/ai-support-widget.js`) | OpenAI, `OPENAI_MODEL` default `gpt-4o-mini` (`server.js:613`) | Server | `OPENAI_API_KEY` and `ENABLE_AI_SUPPORT` (default on). No other switch on `main`; #219 adds `legacy_ai_support_enabled`, default off. |
| HTAF application triage | OpenAI | Server, admin only | Off unless `HTAF_AI_TRIAGE_ENABLED` and the owner-approval variables are set (`lib/htafActivation.js`); no triage has been recorded **[Verified 2026-10-11, audit log]** |
| Self-hosted model path | Owner's own model server only; hosted OpenAI/Anthropic endpoints are refused (`lib/agent/llmClient.js`) | — | `AGENT_LLM_BASE_URL`; production value **[Unresolved]** |

Production flag values **[Verified 2026-10-11, read-only query]**:
- `agent_assist_enabled` = true; `agent_kill_switch` = false;
- `agent_model_mode` = test_accounts;
- `agent_model_test_accounts` = `["rider:RIDER_GPLAY_REVIEWER"]`. **[Owner decision 2026-10-12]** Set this to `[]` until consent ships. Not yet applied: the database connector was unavailable **[Unresolved]**.
- `agent_specialist_scope` = test_accounts; all 5 specialist switches = true;
- `review_account_login_enabled` = true;
- HTAF assistant, shadow mode and automation flags absent (off).

Keys are named only. Their presence on Render is **[Unresolved]**, apart from `ANTHROPIC_API_KEY`, which was set on 8 Oct (successful calls).

## 4. Data sent, and consent

| Provider | What it receives | Consent |
|---|---|---|
| Anthropic | The message; up to a few earlier turns from the device; a fixed instruction prompt; the results of the account's own lookups. Riders: ride status, the driver's first name and vehicle, the pickup estimate, the fare. Drivers: offers, trip steps and addresses, earnings, hours. Messages caught by Escalation are never sent. (`lib/agent/modelAssistant.js:121–262`) | **Not enforced on `main`.** Ordinary users can't reach Claude. The review rider could, until the list is emptied. #210 adds the prompt and the `agent_ai_consents` record and fails safe (no AI) without a recorded yes. |
| OpenAI (old chat) | Whatever any visitor types (up to 4,000 characters), chat history, page and role names | None; no sign-in |
| OpenAI (HTAF triage, off) | Coarse application categories only, no name, contact, income or address (`server.js` HTAF triage prompt) | Admin-only; off |

## 5. Permissions and human approval

- **Data:** 12 fixed read-only lookups (`lib/agent/tools.js`), each tied to the signed-in account. Rider: open rides, open deliveries, dispatch outlook. Driver: onboarding status, pending offers, active ride, hours, earnings. Admin: open rides, one ride, candidate drivers, a ride's offers. Tables read: `rides`, `drivers`, `driver_offers`, `driver_earnings`, `driver_online_sessions`. No writes, no free-form queries.
- **Actions:** none are taken by an agent. Cancelling, accepting, trip steps, going online or offline, and support requests are buttons the user taps; they go through the normal signed-in routes.
- **Output check:** Claude's reply is discarded if it adds numbers, claims an action, or adds links or phone numbers (`lib/agent/grounding.js`).
- **Human approval:** Escalation cases go to staff review. Handoffs are sent only after the user approves them. Redispatch automation needs separate admin switches, and the stop switch overrides everything (`lib/agent/policy.js`).

## 6. Deployed versus pending

| Deployed today | Pending |
|---|---|
| Rules-based assistant for everyone; Claude only for the review rider (removal approved, not yet applied) | #212 → #210: consent prompt and records (migration + deploy) |
| Specialists for test-list accounts only | #214 / #215: replace the old OpenAI widget on the home page, sign-up and Settings |
| Driver build 13 (in App Review): rules only | #219: switch off the old OpenAI chat by default |
| Old OpenAI widget on `index.html`, `rider-signup.html`, `settings.html`, `admin-dashboard.html` | #207: privacy policy naming every provider. Held unpublished until provider use and advertising data flows are confirmed **[Owner decision 2026-10-12]**. |
| HTAF assistant, HTAF triage and automation: off | Next driver build with the consent screen and AI label (separate approval) |

## 7. Not verified

1. Whether `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AGENT_LLM_BASE_URL` and `GOOGLE_ROUTES_API_KEY` are currently set on Render. Confirming the OpenAI one by sending a message would be a paid call, so it wasn't done.
2. Whether the old OpenAI chat has been used; it records no usage.
3. Anthropic Console data settings (retention, training).
4. What the Google Analytics and Google Ads tags collect and share (Google account settings).

## 8. Recommendations

- **[Recommendation]** Apply the approved test-list change as soon as the database connector is back.
- **[Recommendation]** Approve #219, or remove `OPENAI_API_KEY` on Render. Either closes the only AI path ordinary visitors can reach without consent.
- **[Recommendation]** Keep `agent_model_mode` at `test_accounts` with an empty list until #210 is deployed and checked.
