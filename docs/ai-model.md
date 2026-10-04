# Harvey Assistant: Claude Haiku model integration

**Status:**
- **Merged (#186); budget hardened (atomic reservations).** Built and tested locally, with a scripted test double in place of Anthropic. No real model call has been made yet.
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

## Budget ($10 per month): how it's enforced

**Atomic across simultaneous requests and server instances.**
- Before every model answer, the server calls the database function `agent_model_reserve` (migration `20261005010000`). It takes a per-month lock, so requests from any number of server instances (for example, during a Render deploy) are checked one at a time against one shared total.
- The check is: spent this month (`agent_model_usage`) + open reservations (`agent_model_reservations`) + this reservation ≤ budget. If it doesn't fit, that question gets the rules-based answer.
- **Tested:** 30 separate database sessions reserving at the same moment against $10 at $0.60 each granted exactly 16 (`test/db/agentModelBudget.db.test.js`).

**The reservation covers everything an answer can be billed for:**

| Billable item | How it's covered |
|---|---|
| Every model call, including each tool round | At most 3 calls per answer (each tool round is one call). The reservation covers all 3. |
| Retries | The SDK's automatic retries are off (`maxRetries: 0`), and the server never retries. A failure falls back to the rules answer. |
| Input tokens | Hard ceiling of 16,000 per call, checked before sending as UTF-8 bytes of the request + 1,000 for Anthropic's tool instructions and formatting. A token always covers at least one byte, so this is a guaranteed bound, not an estimate. A request over the ceiling is never sent. |
| Input price | Reserved at the dearest input rate, the 1-hour cache write ($2 per million tokens), although requests never use caching. |
| Output tokens | `max_tokens` 500 per call, the provider's hard cap. Extended thinking is not enabled. |
| Cache writes (5-minute and 1-hour), cache reads | Priced separately when settling. Cache writes without a 5-minute/1-hour split are priced at the 1-hour rate. |
| Server tools (web search) | Never sent. Priced anyway ($10 per 1,000) if ever reported. |
| Calls with unknown outcome (timeout, dropped connection, server error) | Charged at that call's worst case, since they may have been billed. Rejected requests (invalid key, bad request, rate limit, spend limit) are charged $0. |
| Server stops mid-answer | The reservation stays open and keeps counting at its full amount. Unknown spend is treated as spent. |

**Settling and caps:**
- Each answer settles its reservation once (`agent_model_settle`), writing the real cost and token counts to the ledger in the same transaction. A second settle writes nothing.
- The real cost is recorded as is, never capped.
- **Worst case per answer:** 3 × (16,000 × $2 + 500 × $5) / 1,000,000 = **$0.1035**. This is reserved, not spent. A typical answer costs about $0.002–$0.006 and releases the rest.
- **The $10 ceiling is enforced twice:** on the server (`MONTHLY_BUDGET_CEILING_USD`) and inside the database function (`least(budget, 10)`). `AGENT_MODEL_MONTHLY_BUDGET_USD` can only lower it.
- **Fails closed:** if the database can't reserve, the model is off for that question.
- **Provider backstop:** a $10 spend limit in the Claude Console. If Anthropic refuses for a spend limit, the server stops calling the model until the next month.
- **Usable budget:** with the $0.1035 reservation, answers stop once less than that remains, so slightly under $10 is ever spent.
- **Caching:** prompt caching isn't used. Haiku 4.5 caches only prompts of 4,096 tokens or more; the assistant's instructions and tools are shorter.

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
