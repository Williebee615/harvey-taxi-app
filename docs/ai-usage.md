# Harvey Assistant usage accounting and limits (phase 1)

## What is measured

- **Unit: assistant requests.** One request is one question sent to `/api/agent/rider/assist` or `/api/agent/driver/assist`.
- **No AI model is called.** Answers come from rules, Harvey's own read-only data and quotes from approved pages (`docs/ai-knowledge.md`).
  - So **no model tokens are used, and none are counted**.
  - The dashboard shows "Model calls: 0", and the summary reports `model_tokens: null`, not 0 tokens.
  - Requests are never labelled as tokens.
- **No model or API charges.** Requests still use the existing Render server and Supabase database. Those costs are unchanged by this phase, but they aren't zero.
- **If a model is ever added** (paid phase, on hold), the provider reports `prompt_tokens` / `completion_tokens` per call. Those numbers would be recorded per request next to the request count, and limits could then also be set in tokens.

## What Harvey owns

| Part | Where | Owner |
|---|---|---|
| Request meter and daily limits | `lib/agent/usage.js`, in the Harvey server | Harvey |
| Limit settings | `system_flags.agent_rules`, edited on the admin Agent page | Harvey |
| Durable usage record | `audit_logs` (`agent.decision`, `agent.usage_limited`) in Harvey's Supabase database | Harvey |
| Dashboard | `/admin-agent.html` → "Assistant usage" | Harvey |
| Model token counts and model bills | Only if a paid provider is added later: the provider measures, Harvey records | Provider and Harvey |

No third-party usage, analytics or billing service is involved.

## Limits

These are admin-editable on the Agent page (Rules) and bounds-checked. Defaults:

| Limit | Default | Bounds |
|---|---|---|
| Requests per signed-in rider or driver per UTC day | 100 | 1–10,000 |
| Requests per signed-out visitor per UTC day (counted by a salted hash of the IP address; the address is never kept) | 30 | 1–1,000 |
| Requests in total per UTC day | 5,000 | 10–1,000,000 |

**Over a limit:**
- The assistant answers HTTP 429 with: *"You've reached today's limit for the Harvey Taxi assistant. Booking, your trips and support still work as usual. In an emergency, call 911."*
- One `agent.usage_limited` audit row is written per account per day. Refused requests write nothing else.
- Booking, dispatch, payments and driver-hours enforcement never go through the assistant, so a limit can't affect them.

The existing per-IP rate limit (20 assistant requests a minute) still applies.

## Database load

- **Per request:** no added reads or writes. The counters live in server memory, and the per-request audit row already existed.
- **Dashboard:** one query over the last 7 days of `audit_logs` (capped at 20,000 rows), only when an admin opens the page.
- **Trade-off:** in-memory counters restart when the server restarts or deploys, and are per server instance. After a restart, an account can use up to one more day's allowance. A durable counter would add a database write per request, which phase 1 deliberately avoids after the 2026-10-04 database outage.

## Dashboard (`/admin-agent.html`)

- **Today, live:**
  - requests, split into signed-in riders, drivers and signed-out visitors;
  - requests refused by a limit;
  - model calls.
- **Last 7 days:**
  - per day: requests, riders, drivers, signed in, answered from approved pages, not covered, safety escalations, accounts that hit a limit;
  - a list of recent questions approved pages don't cover yet, redacted. This is the to-do list of policies for the owner to write and approve.

Local screenshot (test data, not production): `docs/screenshots/ai-phase1/admin-assistant-usage.png`.

## Not in this phase (on hold)

- Paid models, token budgets and per-token spending caps.
- Any token or credit platform beyond counting Harvey's own assistant requests.
