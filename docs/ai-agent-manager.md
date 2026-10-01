# Harvey Taxi AI Agent Manager

Status: **implemented and off by default.** Every capability is behind a `system_flags` row that defaults to off. This release does not turn on any live autonomous operation.

The feature has **no dependency on OpenAI or Anthropic**. It needs no account or API key from either provider. It runs entirely on the Harvey Taxi rules engine. An optional, self-hosted, open-weight model can rephrase the rules engine's answers.

---

## 1. What was inspected and reused

| Area | Existing service | How the agent uses it |
|---|---|---|
| Dispatch | `findAvailableDrivers()`, `dispatchRide()` (atomic `dispatch_ride_atomic` RPC with a two-step fallback), the `dispatch_paused` flag, and the offer-expiry and stuck-redispatch sweeps (`lib/offerExpiry.js`) | The recommender mirrors the dispatcher's eligibility rules. The only executable action, automatic redispatch, calls `dispatchRide()` itself. A crash midway is recovered by the existing stuck-redispatch sweep. |
| Eligibility | `lib/driverAvailability.js` (`getBusyDriverIds`), `lib/driverCompliance.js` (`computeDriverReadiness`), reviewer isolation (`planReviewAwareDispatch`) | These are reused unchanged. The recommender adds the live `supports_rides` / `supports_food_delivery` / `supports_grocery_delivery` columns, location freshness and rating. |
| Ride lifecycle | `lib/rideDispatch.js` (`RIDE_STATUS`), `lib/rideLifecycle.js`, `lib/rideCancellation.js` (no cancellation fee in this phase) | Status wording and next steps come from these. The agent never transitions a ride. |
| Pricing | `lib/pricing.js`, signed quotes (`lib/rideQuote.js`) | The agent never calculates a price. It only repeats a fare already stored on the rider's own ride. |
| Auth | `requireAdmin` / `requireElevatedAdmin` (admin token), `resolveVerifiedRiderSession`, `requireDriverSelf` | Every route uses one of these. Identity always comes from the session, never from the message or request body. |
| Audit | `audit_logs` table and `auditLog()` | All agent decisions, cases and overrides are logged here, so **no schema change or migration is needed**. |
| Safety | `POST /api/safety/911` (records an emergency alert) | The assistant shows **Call 911** and **Alert Harvey Taxi safety team** buttons. The second calls this existing route after the user confirms. |
| Existing AI support (`/api/ai/support`, uses `OPENAI_API_KEY`) | Not used | The agent is fully independent of it. Neither depends on the other. |

Inputs that **do not exist** in the live schema, which the agent therefore cannot honor yet:
- rider preferences (such as favorite drivers or accessibility needs);
- vehicle-type requirements (such as XL or wheelchair access).

Recommendations report these as `unsupported_inputs`. Adding them is a separate product and schema decision.

## 2. Architecture

```
 rider / driver dashboards                  admin (/admin-agent.html)
   public/agent-assist.js                      │
          │                                    ▼
          ▼                         /api/admin/agent/*  (requireAdmin;
 /api/agent/rider/assist                        enabling automation needs the
 /api/agent/driver/assist                       elevated admin token)
 (verified rider session /                      │
  requireDriverSelf)                            │
          │                                     │
          ▼                                     ▼
 ┌──────────────── lib/agent (rules engine, deterministic) ───────────────┐
 │ escalation.js  sanitize untrusted text → emergency / fraud / dispute / │
 │                refund / account / screening boundaries → fixed answer  │
 │                + human-review case (model never used for these)        │
 │ assistant.js   fixed intents → scoped tools → rule-written answer      │
 │                + proposed actions that require user confirmation       │
 │ tools.js       read-only, fixed columns, role + ownership checked      │
 │ recommender.js dispatcher-equivalent eligibility + ranking (advice)    │
 │ coordinator.js stalled-ride plan + alerts (pure)                       │
 │ policy.js      flags → mode (off/assist/shadow/automation/killed)      │
 │ audit.js       decision / case / override records (redacted)           │
 │ grounding.js   optional model rephrase + output guard                  │
 │ llmClient.js   HTTP client for a SELF-HOSTED runtime, circuit breaker  │
 └────────────────────────────────────────────────────────────────────────┘
          │ (optional)                                     │ automation only
          ▼                                                ▼
 self-hosted model runtime (separate service)    existing dispatchRide()
```

### Decision boundaries (hard-coded, model-independent)
| Trigger | What the agent does |
|---|---|
| Emergency (accident, injury, weapon, threat, "unsafe") | Shows **call 911 first**, then the button for the existing safety alert. Opens a `critical` case and broadcasts an `agent_emergency_case` admin SSE event. |
| Disputed charge, refund, fraud, suspension or deactivation, background or identity screening | Fixed answer saying a staff member decides. Opens a case. The agent never changes charges, accounts or screening. |
| Ride out of automatic attempts (`max_auto_redispatch_attempts`) | Opens a `dispatch_exhausted` case for a dispatcher. |

### What riders and drivers can and cannot do through the agent
- **Book:** the agent links to the existing booking screen (`?screen=book`). The rider confirms the fare in the wizard. Payment is authorized before dispatch, exactly as today.
- **Cancel:** the agent only proposes this, as a button with a confirmation dialog. It calls the existing `POST /api/rides/:id/cancel`, which keeps its own session, ownership and payment-void logic. An in-progress ride is not cancellable, which matches the existing policy.
- **Change a paid service:** the agent explains that this means cancelling (no fee) and rebooking. Both steps need confirmation.
- **Drivers:** read-only help covering pending offers, the next step on the active trip, and recorded earnings. Accepting or declining offers, availability and start/complete remain the driver's own actions in the dashboard.

### Secure execution
- No credential leaves the server. The model receives only the drafted answer and a small facts object. It never receives keys, tool access or the database.
- Message text is untrusted:
  - control characters are stripped and the text is capped at 1,000 characters;
  - it can only select one of the fixed intents;
  - prompt-injection attempts are tested.
- Tools are fixed queries with explicit column lists:
  - rider tools read only `rider_id = <session rider>`;
  - driver tools read only `driver_id = <session driver>`;
  - admin tools return no rider phone or email and no driver coordinates.
- Admin capabilities:
  - **any admin** can turn things off, use the kill switch, resolve cases and edit rules (rules are bounded and validated);
  - **only the elevated admin token** can enable the automation flags.
- If the flags cannot be read, the agent is off and automation is blocked (fail closed).

### Transaction safety
- **Duplicate prevention:** an automatic redispatch first claims the ride with a conditional update. The update requires:
  - `status = payment_authorized`;
  - `driver_id IS NULL`;
  - `updated_at` unchanged since the snapshot.

  If anything else touched the ride, the claim fails and the agent skips the ride. A per-ride cooldown and an in-process single-flight guard add further protection. The tests cover concurrent runs and a ride that changes mid-run.
- **Lifecycle:** the agent never writes ride status itself. `dispatchRide()` does, under its existing rules, and it still respects the `dispatch_paused` flag.
- **Facts:**
  - the agent never invents prices, ETAs, availability or completed actions;
  - the output guard rejects any model reply that adds a number, claims an action was completed, adds a link or contact detail, or drops the 911 line.

### Accountability (`audit_logs`, action prefix `agent.`)
| action | `metadata.record_type` | Meaning |
|---|---|---|
| `agent.decision` | `assistance_answer` | Assistance turn: intent, policy, tool calls, outcome, answer source and model-rejection reason. No message text. |
| `agent.recommendation` | `recommendation` | Advice for a ride: candidate driver IDs and the requesting admin. |
| `agent.shadow_decision` | `shadow_only_not_executed` | What automation would have done. |
| `agent.action_executed` | `executed_action` | An automated action that actually ran, with its result. |
| `agent.case_opened` / `agent.case_resolved` | `human_review_case` / `admin_change` | The human-review queue. The case excerpt is redacted (card, phone, email and token patterns removed) and capped at 160 characters. |
| `agent.override`, `agent.flag_changed`, `agent.rules_changed` | `admin_change` | Human overrides and configuration changes, with before and after values. |

## 3. Admin command center (`/admin-agent.html`)
The page shows:
- mode, with a one-click **Disable automation now** button (kill switch);
- live counts and alerts (stalled rides, no free drivers, stale driver locations, dispatch paused, model degraded);
- active rides with **Recommend drivers**, which lists eligible drivers, every exclusion and why, **Assign (manual)** (uses the existing assign-driver route and records the override) and **Reject recommendation**;
- pending coordination decisions, with **Evaluate now (shadow only)**, which never executes;
- driver availability and compliance;
- the human-review case queue;
- flag controls, rules and model status;
- the decision log, which labels each entry as a recommendation, a shadow decision or an executed action.

The page uses the existing admin session cookie. Enabling automation additionally needs the admin token. The page holds the token only for the current browser tab.

Screenshots are in `docs/screenshots/ai-agent-manager/`.

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| *(none)* | — | Rules-only mode needs **no new variables**. Everything runs on the existing service. |
| `AGENT_LLM_BASE_URL` | Optional | Base URL of **your** self-hosted runtime's chat-completions API (for example `http://harvey-llm:8080/v1`). Unset means rules only. Hosted `openai.com`, `openai.azure.com`, `anthropic.com` and `claude.ai` endpoints are refused. |
| `AGENT_LLM_MODEL` | Required if a base URL is set | The model name the runtime serves. |
| `AGENT_LLM_API_KEY` | Optional | Shared secret you set on your own runtime (for example llama.cpp `--api-key`). This is not a vendor key. It is never logged or shown; the admin page only shows whether it is set. |
| `AGENT_LLM_TIMEOUT_MS` | Optional | Default 8000, range 500–60000. Raise it for CPU-only hosting (see section 6). |

Flags are stored as `system_flags` rows and are all `false` or absent by default:
- `agent_assist_enabled`
- `agent_shadow_mode_enabled`
- `agent_automation_enabled`
- `agent_auto_redispatch_enabled`
- `agent_kill_switch`

Rules are stored as a JSON row with key `agent_rules`.

## 5. Model selection and licensing

I verified these licenses from the model publishers' statements on 2026-10-01. Re-check the model card before you deploy.

| Model | License | Q4_K_M size | Use |
|---|---|---|---|
| **Qwen2.5-1.5B-Instruct** | Apache-2.0 (all Qwen2.5 sizes except 3B and 72B are Apache-2.0) | ~1.0 GB (estimate) | **Recommended for CPU-only hosting.** It only rephrases short, already-written answers. |
| **Phi-3.5-mini-instruct** (3.8B) | MIT | ~2.2–2.4 GB | Better phrasing, slower on CPU. |
| Qwen2.5-7B-Instruct | Apache-2.0 | ~4.7 GB (estimate) | Only with 8 GB+ RAM or a GPU. |
| ~~Qwen2.5-3B-Instruct~~ | Qwen Research License (non-commercial) | — | **Do not use.** |

Runtime options (all can be self-hosted, need no provider account, and serve `/v1/chat/completions`): llama.cpp `llama-server`, Ollama, vLLM (GPU) and LocalAI.

Example of a CPU runtime as its own service. This is illustrative only; nothing has been deployed or purchased.
```
llama-server -m qwen2.5-1.5b-instruct-q4_k_m.gguf --host 0.0.0.0 --port 8080 \
  -c 4096 -t 4 --api-key "$AGENT_LLM_API_KEY"
# app: AGENT_LLM_BASE_URL=http://<private-host>:8080/v1  AGENT_LLM_MODEL=qwen2.5-1.5b-instruct
```

## 6. Hosting capacity, compute and cost

**What I could not inspect.** This work was done from a sandbox that has no access to the Render dashboard or API. The repo also has no `render.yaml`. **I therefore could not confirm the current Render instance type, RAM or CPU of `harvey-taxi-app-2`.** The owner needs to confirm the plan (Render Dashboard → harvey-taxi-app-2 → Settings → Instance Type) before choosing a model host.

### Runs on existing infrastructure (no new cost)
- the rules engine, all assistance in rules-only mode, recommendations, shadow mode, the admin command center, the audit trail and the human-review cases;
- data storage in the existing Supabase `audit_logs` and `system_flags` tables;
- an added load of a few indexed reads per assistance message. The coordination sweep makes about 4 queries per minute, and only when shadow or automation mode is on.

### Needs additional compute (optional; only for model-phrased answers)

The model must **not** run inside the existing web service. It would compete with booking and dispatch for RAM and CPU, and Render's smaller instances (Starter: 512 MB) cannot load any of these models. Run it as a separate private service or host instead.

| Option | Resources | Published list price | Fit |
|---|---|---|---|
| Render private service, **Pro** | 2 CPU / 4 GB | $85/month | Qwen2.5-1.5B Q4. Estimate: about 10–20 tokens/s, so a 100-token reply takes roughly 5–10 s. Set `AGENT_LLM_TIMEOUT_MS=15000`. |
| Render private service, **Pro Plus** | 4 CPU / 8 GB | $175/month | Phi-3.5-mini or Qwen2.5-1.5B with headroom. Estimate: Phi-3.5-mini at about 6–12 tokens/s. |
| Render **Standard** | 1 CPU / 2 GB | $25/month | Qwen2.5-1.5B Q4 only, and probably too slow (estimate: over 10 s per reply). |
| Any VPS or on-premises machine with 4+ vCPU and 8 GB | — | Varies by provider; get a quote | Same runtime and same environment variables. |
| GPU host (vLLM) | — | Get a quote | Only needed for 7B+ models or high chat volume. |

- Render list prices come from Render's public pricing as summarized by third-party trackers (2026). Render may also charge a workspace fee (Professional: $25/month).
- **Treat every speed figure as an estimate.** Benchmark on the chosen host with representative prompts before you enable model phrasing.
- **Recommendation:**
  1. Launch in rules-only mode, which costs $0 extra.
  2. Add a model host only if, after Phase 1, staff decide the rule-written answers need more natural phrasing.

I have not purchased or provisioned any infrastructure.

## 7. Rollout plan

| Phase | How to enable | Exit criteria |
|---|---|---|
| 0. Merge | Nothing to enable. All flags are off. The widget renders nothing, and recommendations are available to admins on request. | The deploy is healthy and booking and dispatch smoke tests pass. |
| 1. Recommendations and assistance | Admin turns on **Rider & driver assistance**. Admins use **Recommend drivers**. | 2+ weeks: review `agent.decision` outcomes and cases, check that no ungrounded answers appear, and confirm emergency cases reach staff. |
| 2. Shadow mode | Admin turns on **Shadow mode**. | 2+ weeks: compare each `agent.shadow_decision` with what dispatchers actually did. Agreement and safety are signed off in writing. |
| 3. Narrow automation | The **elevated** admin turns on **Automation (master)** and **Automatic redispatch**, and turns shadow mode off. | Applies only to stalled paid rides with no live offer, through `dispatchRide()`, capped by the attempt and cooldown rules. Monitor `agent.action_executed`. |

Optional at any phase: deploy the model service and set `AGENT_LLM_*`. Remove the variables to go back to rules only.

## 8. Rollback

1. **Immediate, no deploy:** any admin clicks **Disable automation now** (kill switch), or turns the individual flags off. The change takes effect on the next request and the next sweep, within 60 seconds. You can also do this in SQL:
   ```sql
   update system_flags set value='true', updated_at=now() where key='agent_kill_switch';
   -- or turn everything off:
   update system_flags set value='false', updated_at=now()
    where key in ('agent_assist_enabled','agent_shadow_mode_enabled','agent_automation_enabled','agent_auto_redispatch_enabled');
   ```
2. **Model only:** unset `AGENT_LLM_BASE_URL`. Answers fall back to rule-written ones.
3. **Code:** revert the PR. There is no schema change and nothing to migrate back. Existing `agent.*` audit rows stay as history and do no harm.

Booking, payment and dispatch never call the agent. They keep working with the agent off, killed, or with its model down. The test suite covers this.

## 9. Tests
- `lib/agent/agent.test.js` (50 tests): flags and modes, rule validation, escalation boundaries, sanitizing and redaction, recommender eligibility and isolation, stalled-ride planning, the model client (unset or blocked hosts, timeout, HTTP errors, circuit breaker), the output guard, tool role and ownership checks, assistant behavior (confirmation gating, sessionless privacy, grounded fares, model fallback, database outage, prompt injection) and audit records.
- `test/server.agent-manager.test.js` (37 tests, real Express routes): permissions on every admin route, elevated-only automation enablement, the kill switch, fail-closed flags, rider ownership, emergency and dispute cases, the read-only nature of recommendations, shadow mode making no writes, manual evaluation being shadow-only, a single redispatch under concurrent sweeps, a changed ride not being claimed, cooldown, pause and kill blocking automation, and attempt-exhausted rides escalating to a human. Runs with the model endpoint unreachable and no OpenAI or Anthropic variables set.
- `test/agent-manager.browser.test.js` (5 tests, Playwright, skipped without a browser): the admin page on desktop and phone, the signed-out notice, rider status, cancel confirmation, the emergency flow, driver earnings, and the widget staying hidden when the flag is off.
