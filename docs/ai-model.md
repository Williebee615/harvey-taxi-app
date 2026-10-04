# Harvey Assistant: Claude Haiku model

Status: **built, off by default, synthetic test accounts only.** Not enabled for real riders or drivers.

## 1. Owner approval (2026-10-04)

- **Model:** Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`).
- **Apps:** Harvey Taxi Mobile and Harvey Taxi Driver, on iOS and Android. All four apps use the same server route, so the model and the budget are shared across them.
- **Budget:** at most **$10 per calendar month (UTC)**, total across all four apps.
- **Provider block:** lifted for this Anthropic integration only. `lib/agent/llmClient.js`, the self-hosted path, still refuses hosted endpoints.
- **Rollout:** synthetic test accounts first. Real users only after the owner approves the privacy disclosure (`docs/ai-model-privacy-disclosure-draft.md`).
- **Purchases:** no card charges, no automatic reloads, and no spending above $10 without further owner approval.

## 2. How it works

| Part | File | What it does |
|---|---|---|
| Client | `lib/agent/claudeClient.js` | Official Anthropic SDK (`@anthropic-ai/sdk`). Always calls Anthropic's own endpoint; the base URL can't be changed. No automatic retries, a 6-second timeout per call, and a cap on output tokens. |
| Budget | `lib/agent/modelBudget.js` | `MONTHLY_BUDGET_CEILING_USD = 10` in code. `AGENT_MODEL_MONTHLY_BUDGET_USD` can lower the budget but never raise it. Before each turn the server reserves the turn's worst-case cost (about $0.05), so turns running at the same time can't push spending past the budget. |
| Ledger | `supabase/migrations/20261004230000_add_agent_model_usage.sql` | One row per model turn: tokens, cost, outcome. **No message text is stored.** Server-only access (RLS on, no policies). Spending is still counted after a restart. |
| Policy | `lib/agent/modelPolicy.js` | Mode `off` (default), `test_accounts` or `all`. `all` is refused unless `AGENT_MODEL_PUBLIC_APPROVED=true` is set on the server. Signed-out visitors never get the model. |
| Assistant | `lib/agent/modelAssistant.js` | The model writes the reply and picks which existing role-scoped lookups to run (ride status, fare, offers, hours, earnings, approved policy pages). It has no database access, no credentials, and no way to change anything. |

**Safety rules carried over from the rules-based assistant:**
- Emergencies, fraud, disputed charges, refunds, account actions and driver screening are caught before the model and keep their fixed answers. The model never sees those messages.
- Buttons (cancel, accept, trip step, go online, support request) come only from the existing tools. The user confirms each one in the app.
- Every model reply passes the existing guard (`grounding.js`). A reply is rejected if it has a number no tool returned, claims something was done, or includes a link, phone number or email address.

**Falling back to rules-based answers.** The rules-based assistant answers instead when:
- the API key isn't set;
- the account isn't eligible;
- the month's spending can't be loaded (fail closed);
- the monthly budget is reached;
- Anthropic's spending limit has been hit;
- a call times out or returns an error;
- the model reaches the tool-call or deadline limit;
- the guard rejects the reply.

The audit log records which of these happened.

## 3. Owner setup (Anthropic Console)

Sources: [Get your API key](https://platform.claude.com/docs/en/get-api-key), [How do I pay for my Claude API usage?](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage), [Getting started after creating an organization](https://support.claude.com/en/articles/8114531-i-created-a-claude-console-organization-how-do-i-start-using-the-claude-api), [Rate and spend limits](https://platform.claude.com/docs/en/api/rate-limits), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). Read 2026-10-04.

1. **Create the account.** Sign in or sign up at [platform.claude.com](https://platform.claude.com). Fill in the organization and use-case details.
2. **Buy credits.** You need an Admin or Billing role. Go to **Settings → Billing → Buy credits**, enter an amount and confirm.
   - **Minimum purchase:** not stated in Anthropic's published docs. The Console shows it at purchase time. Buy no more than $10.
   - Credits **expire one year** after purchase and are **non-refundable**.
3. **Leave auto-reload off.** It's a toggle on **Settings → Billing**. Confirm it is off after buying credits.
4. **Set the provider spend limit.** On **Settings → Billing**, set your organization's monthly limit to **$10**. This is a second cap alongside Harvey's server budget. When Harvey sees Anthropic refuse for a spending limit, it stops calling the model until the next month.
5. **Create the API key.** Go to **Settings → API keys → Create key**. A service account key is recommended for a production server. The key starts with `sk-ant-` and is shown only once.
6. **Add the key in Render.** Under **Environment**, add `ANTHROPIC_API_KEY`, then save and redeploy. Never paste the key into chat, code or tickets.

**Price used for cost tracking** (Claude Haiku 4.5, per million tokens): input $1, 5-minute cache write $1.25, cache read $0.10, output $5.

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, to use the model | Owner sets this in Render. If it's unset, the model is off. |
| `AGENT_MODEL_MONTHLY_BUDGET_USD` | Optional | A lower monthly budget. Values above 10 are capped at 10. |
| `AGENT_MODEL_PUBLIC_APPROVED` | Optional | Set to `true` only after the owner approves the privacy disclosure. Until then, mode `all` is refused. |

## 5. Synthetic-account testing (admin)

1. **Check status:** `GET /api/admin/agent/model` shows whether the key is set, the mode, the test list and the budget (spent, reserved, remaining).
2. **Add test accounts:** `POST /api/admin/agent/model` with `{"mode":"test_accounts","test_accounts":["rider:<id>","driver:<id>"]}`.
   - Use synthetic test accounts only, at most 25.
3. **Try a question:** `POST /api/admin/agent/model/try` with `{"role":"rider","actor_id":"<id>","message":"Where is my driver?"}`.
   - Only listed test accounts are accepted.
   - Each try counts against the same budget.
4. **Review results:** check the reply, the `model` record (tokens, cost, fallback reason) and the usage summary at `GET /api/admin/agent/usage`.

There is no admin web page for these settings yet; they're API-only for now.

## 6. Before real users

1. Owner approves the privacy disclosure. Then the Privacy Policy and the in-app notice are updated.
2. Test results reviewed: answer quality, guard rejections and cost per turn.
3. Set `AGENT_MODEL_PUBLIC_APPROVED=true` in Render, then set the mode to `all`.

## 7. Tests

- `lib/agent/modelBudget.test.js`: budget and policy units.
- `test/server.agent-model.test.js`: end-to-end tests with a scripted fake SDK. No real API calls and no cost.
- `test/db/agentModelUsage.db.test.js`: ledger migration against Postgres.
