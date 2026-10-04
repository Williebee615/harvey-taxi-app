# Harvey Assistant: Claude Haiku model integration

**Status:**
- **Built and tested locally**, with a scripted test double in place of Anthropic. No real model call has been made yet.
- **Off in production** until the owner adds the API key in Render, then **limited to synthetic test accounts**.
- **Not enabled for real riders or drivers** until the owner approves the privacy disclosure (`docs/privacy-ai-disclosure-draft.md`).
- The rules-based assistant remains the answer for everyone else, and the fallback for any problem.

**Owner approval (2026-10-04):**
- Anthropic Claude Haiku 4.5 for the rider app and the driver app, on iOS and Android.
- At most **$10 per month in total**, enforced by Harvey's server, with the provider's spending limit set as a backstop.
- The hosted-provider block is lifted for this integration only.

## What the model does

- Writes the reply in natural language and understands follow-ups. The last 6 turns from the device are sent as conversation; nothing is stored on the server.
- Chooses which of Harvey's existing lookups to use. Each lookup is one of the assistant's existing rider or driver answer functions, run on the server for the signed-in account only, through the role-checked tools.

| Rider tools | Driver tools | Both |
|---|---|---|
| `get_my_ride_status`, `get_my_fare`, `get_booking_help`, `prepare_ride_cancellation`, `get_service_change_help` | `get_my_hours`, `get_my_ride_offers`, `get_my_active_trip`, `get_directions`, `get_my_earnings`, `get_availability_help` | `search_harvey_policies` (approved pages and articles, with sources), `prepare_support_request` (general or lost item) |

## What the model cannot do

- **Change anything.** Buttons (cancel ride, accept or decline an offer, trip step, go online or offline, send a support request) come only from the tools, with the same checks as before. The model can't create or edit them. The user confirms every change in the app, which calls the existing authenticated route. Server enforcement of booking, dispatch, payments and driver hours is unchanged.
- **See other accounts.** Tools read only the signed-in account's own data. The model gets no database access or credentials.
- **Handle safety boundaries.** Emergency, fraud, dispute, refund, account and screening messages get the fixed answer and a human-review case, and are never sent to the model.
- **Make claims the guard rejects** (`lib/agent/grounding.js`). The reply is discarded, and the rules-based answer used instead, if it:
  - contains a number that no tool returned;
  - claims something was booked, cancelled, charged or sent;
  - contains a link, phone number or email address;
  - is empty or too long.

## Who gets the model

Set on the admin Agent page, "Claude model" section (system flags `agent_model_mode` and `agent_model_test_accounts`):

| Mode | Who gets model answers |
|---|---|
| `off` (default) | Nobody |
| `test_accounts` | Only accounts on the list (`rider:ID` / `driver:ID`), meant for synthetic test accounts |
| `all` | Every signed-in rider and driver. Refused unless the server has `AGENT_MODEL_PUBLIC_APPROVED=true`, which the owner sets after approving the privacy disclosure; until then it behaves like `test_accounts`. |

Signed-out visitors never get the model. The admin "Try the model" console runs one question as a listed test account, through the same budget.

## Budget ($10 per month) and costs

- **Price:** Claude Haiku 4.5 costs $1 per million input tokens, $5 per million output tokens, $1.25 per million cache writes and $0.10 per million cache reads (Anthropic pricing page, read 2026-10-04).
- **Cost per answer:** Harvey computes it from the token counts Anthropic reports with each call (`lib/agent/modelBudget.js`).
- **Spending ledger:** table `agent_model_usage`, one row per model answer, including answers that fell back to the rules. The server sums the current UTC month from it, so restarts don't reset spending.
- **Before every model answer**, the server reserves the worst case: 3 calls × (12,000 input tokens at the cache-write price + 500 output tokens) = **$0.0525**. If spent + reserved + $0.0525 would exceed the budget, that question gets the rules-based answer. Concurrent answers can't overshoot.
- **The $10 ceiling is in code.** `AGENT_MODEL_MONTHLY_BUDGET_USD` can lower it; raising it needs a code change and owner approval.
- **Fails closed:** if spending can't be read from the database, the model stays off.
- **Provider backstop:** set a $10 spend limit in the Claude Console. If Anthropic refuses for a spend limit, the server stops calling the model until the next month.
- **Per-call limits:**
  - 500 output tokens;
  - about 12,000 input tokens, estimated conservatively;
  - 3 calls per answer;
  - a 6-second timeout per call and 12 seconds per answer;
  - no automatic retries. A retry could double the cost; a failure falls back instead.

**Expected spend:** about $0.002–$0.006 per model answer, so the $10 budget covers roughly 1,500–5,000 answers a month. Current volume is far below that. Prompt caching doesn't apply yet: Haiku 4.5 caches only prompts of 4,096 tokens or more, and the assistant's instructions and tools are shorter.

## Usage tracking (Harvey-owned)

- **Admin Agent page, "Claude model" section:**
  - spent this month;
  - budget;
  - remaining;
  - reserve per answer;
  - whether the provider limit was hit.
- **Admin Agent page, "Assistant usage" section:**
  - model answers and model cost for the last 7 days;
  - tokens and fallback reasons (`/api/admin/agent/usage` → `history.totals`).
- **Audit trail:** each decision row records the model's calls, tokens, cost and, if the rules answered, why. Message text is never stored there; redacted gap excerpts follow the existing rules.

## Configuration (Render)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | The Claude API key. The owner adds it in Render; it never goes in chat or GitHub. Unset means the model is off. |
| `AGENT_MODEL_MONTHLY_BUDGET_USD` | Optional; lowers the budget below $10. |
| `AGENT_MODEL_PUBLIC_APPROVED` | Set to `true` only after the owner approves the privacy disclosure. Allows mode `all`. |

The client always calls Anthropic's own endpoint (no base-URL override). The self-hosted path (`llmClient.js`) still refuses hosted providers.

## Rollout

1. Merge and deploy. Mode stays `off`, and no key is set yet.
2. Owner: create the Anthropic account, buy credits, turn auto-reload off, set the $10 spend limit, add `ANTHROPIC_API_KEY` in Render.
3. Create synthetic test accounts (one rider, one driver; test data only). Add them to the test list, set mode `test_accounts`.
4. Synthetic testing:
   - in the admin Try console;
   - in all four apps signed in as the synthetic accounts;
   - the regression and holdout evaluation sets;
   - check the cost per answer against the estimate.
5. Owner approves the privacy disclosure. The updated Privacy Policy is published. The owner sets `AGENT_MODEL_PUBLIC_APPROVED=true`, then mode `all`.

## Not changed

- Chat memory stays session-only on the device.
- Booking, dispatch, payments and driver-hours enforcement are unchanged.
- No new app builds are needed: model replies use the existing response format, which all four apps already render.
