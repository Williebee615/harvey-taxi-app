# Harvey Taxi AI Agent Manager

Status: **implemented, rules-only, off by default.** Every capability is behind a `system_flags` row that defaults to off. Automation stays off.

**What this release is:**
- rules-based rider and driver assistance;
- dispatch recommendations for admins;
- escalation of defined cases to a human;
- optional, guarded automatic redispatch of stalled paid rides, which is off.

**What it is not:** it does not handle every rider or driver decision. It answers a fixed set of questions from live data, and proposes actions that the rider or driver confirms in the existing screens. It never changes prices, payments, eligibility or ride status itself; the only exception is the guarded redispatch, which uses the existing dispatch function.

It runs **in rules-only mode** by default. The self-hosted model path below still refuses hosted OpenAI and Anthropic endpoints. **Update 2026-10-04:** the owner approved one hosted integration, Anthropic Claude Haiku 4.5, capped at $10 a month and limited to synthetic test accounts until a privacy disclosure is approved. See `docs/ai-model.md`.

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

**Rider preferences and vehicle requirements: confirmed gaps** (I checked the repository and the live database on 2026-10-01):

| Item | What exists | Used by any code? | Status |
|---|---|---|---|
| Favorite / preferred drivers | Table `preferred_drivers` (`id, rider_id, driver_id, nickname, is_active, …`), RLS-hardened | No (0 references in code) | **0 rows.** A design proposal (`docs/women-driver-preference-and-favorite-drivers-architecture.md`, *not approved*) says this table should **not** be reused. |
| Driver preference score | `drivers.preferred_score` (numeric, default 0) | No | **0 of 28** drivers have a non-zero value. |
| "Prefer a woman driver" | Proposal document only | — | Not built. |
| Vehicle type / class (XL, wheelchair-accessible, seats, car seat, pets) | No column or table anywhere | — | **Absent.** Drivers have only make/model/year/colour/plate and `supports_rides` / `supports_food_delivery` / `supports_grocery_delivery`. |
| Accessibility needs on a ride | No column; free-text `rides.notes` only | — | **Absent** as structured data. |
| Ride types in use | `rides.ride_type`: only `standard` appears in production data | — | — |

The recommender therefore uses the capability columns and reports `unsupported_inputs: ["rider_preferences", "vehicle_type_requirements"]`. It does **not** read `preferred_drivers` or `preferred_score`, because they hold no data and their use is unapproved. Adding these inputs is a separate product, privacy and schema decision.

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

### Kill switch and stopping automation
- **Who can use it:** any **authenticated** admin (admin session, admin password or admin token) can turn any agent flag off or engage the kill switch. Turning automation **on** additionally needs the admin token.
- **Unauthenticated callers cannot change anything.** Every `/api/admin/*` route except sign-in, sign-out and session lookup has admin middleware. This is enforced by a test that enumerates all 50 admin routes. A second test checks that missing, wrong, empty and forged credentials (including a forged session cookie) all get 401 and leave the flags unchanged.
- **Immediate, including queued work.**
  - The agent re-reads its flags from the database **before every automated action**, not once per sweep. The remaining planned rides in a running sweep are dropped as soon as the kill switch is on, or automation is off, dispatch is paused, shadow mode is on, or the flags can't be read. This applies on every server instance at its next check.
  - The 60-second interval only decides when a **new** sweep starts. It is not a delay before the kill switch takes effect.
- **Between claim and dispatch:** if automation is stopped in that window, the ride is handed back exactly as it was (`dispatch_status` restored, claim cleared). Neither the agent nor the stuck-redispatch recovery will then dispatch it.
- **Already running:** at most one `dispatchRide()` call per instance can already be in progress when the switch is engaged. It is the platform's own atomic dispatch; it completes or fails as a unit and is logged. No further action starts.
- **Assistance:** the kill switch also stops assistance from the next request on, because each request reads the flags.

### Transaction safety and duplicate protection
- **In the database, not in memory.** The redispatch claim is a conditional update that requires:
  - `status = payment_authorized`;
  - `driver_id IS NULL`;
  - `updated_at` unchanged since the snapshot.

  Of any number of concurrent sweeps, on one instance or several, at most one claims a ride.
- **Cooldown:** the claim stamps `rides.last_dispatch_at`, so the cooldown holds across instances and restarts.
- **Exhausted rides:** these open one case with a deterministic id (`CASE-DISPATCH-<ride>`). The id is checked before opening, and duplicates are collapsed in the case list.
- **Crash after the claim:** the existing stuck-redispatch recovery (`dispatch_status = redispatching` plus `dispatch_claimed_at`) picks the ride up.
- **Verified outcome:** after an automated redispatch, the agent re-reads the ride and its offers, and logs what it observed (`verified`), rather than trusting the return value.
- **Never written by the agent:** ride status (`dispatchRide()` owns it, and still respects `dispatch_paused`), prices, payments.
- **Output guard:** rejects model text that adds numbers, claims an action was completed, adds links or contacts, or drops the 911 line.

### Accountability (`audit_logs`, action prefix `agent.`)
| action | `metadata.record_type` | Meaning |
|---|---|---|
| `agent.decision` | `assistance_answer` | Assistance turn: intent, policy, tool calls, outcome, answer source and model-rejection reason. No message text. |
| `agent.recommendation` | `recommendation` | Advice for a ride: candidate driver IDs and the requesting admin. |
| `agent.shadow_decision` | `shadow_only_not_executed` | What automation would have done. |
| `agent.action_executed` | `executed_action` | An automated action that actually ran, with its result. |
| `agent.case_opened` / `agent.case_resolved` | `human_review_case` / `admin_change` | The human-review queue. The case excerpt is redacted (card, phone, email and token patterns removed) and capped at 160 characters. |
| `agent.override`, `agent.flag_changed`, `agent.rules_changed` | `admin_change` | Human overrides and configuration changes, with before and after values. |

### In the Harvey Taxi Driver app (`driver-app/`)

The same assistant is available in the driver app as **Harvey Assistant**. It uses the same route (`POST /api/agent/driver/assist`), rules engine, decision boundaries, audit trail and `agent_assist_enabled` flag as the web dashboard. The only difference is the request field `client: "driver_app"`, which the server accepts only on the driver route. The web dashboard sends no `client`, and its answers and links are unchanged.

| | Web driver dashboard | Driver app |
|---|---|---|
| Where it opens | Floating launcher, then a panel | **Harvey Assistant** button on the Drive screen, then a full screen in place of the content. No floating overlay. |
| Shown when | `GET /api/agent/status` reports `assist_available` | Same, checked at sign-in and whenever the app returns to the foreground |
| Topics | Offers, active trip, earnings, availability | Same, plus **directions** (`driver_navigation`) and **support** (`driver_support`) |
| Proposed actions | Link to the dashboard | In-app actions built only from the driver's own rows: `respond_offer` (offer id), `trip_step` (ride id and status), `navigate` (pickup or drop-off), `toggle_availability`, `open_screen`, `open_support` |
| Emergencies | 911 first, safety alert after confirmation, human case | Same |

**How app actions run.** The app (`driver-app/src/assistant.js`) checks each proposal against its live state:
- an offer must still be pending for this driver;
- a ride must still have the same id and status.

Stale or foreign proposals are dropped. Anything that changes a ride, an offer or availability shows a confirmation dialog first. It then runs the **same app action and authenticated driver route** as the Drive screen's own button. The server never changes anything for the assistant. Directions open the phone's maps app, which changes nothing.

**Hands-free while driving.**
- **During an active trip:** typing is switched off. The assistant offers six large one-tap questions and reads answers aloud with the phone's built-in text-to-speech (`expo-speech`; on-device, with no new permissions and no data sent anywhere).
- **Read aloud:** can be switched on or off at any time.
- **New ride offers:** a newly arrived offer closes the assistant, so the offer card and its countdown are on screen.
- **Not included:** voice *input*. It would need microphone and speech-recognition permissions, privacy-policy and App Privacy changes, and owner approval.

**What drivers can ask.** Going online, ride offers, the next trip step, directions, earnings and support. Quick questions avoid the phrase "help me", which the emergency rule treats as possible distress.

Tests:
- `test/server.agent-driver-app.test.js`: own rows only, nothing changed by the server, web answers unchanged, the rider route ignores `client`, 401 without a session, 503 when off.
- `driver-app/__tests__/assistant.test.js` and `Assistant.flow.test.js`: hidden when off; the driver session and `client` are sent; cancelling a confirmation changes nothing, confirming calls the same route as the Drive screen; a new offer closes the assistant; stale and foreign proposals are dropped; no typing and spoken answers during a trip; safe reply when the assistant is off.

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

### Model status shown to admins
| Status | Meaning |
|---|---|
| **Disabled** | `AGENT_LLM_BASE_URL` / `AGENT_LLM_MODEL` not set. Rules-only, which is **this release's mode**. |
| **Not checked** | A model is configured, but no health check has succeeded yet. Rule-based answers are used until one does. |
| **Healthy** | `GET <base>/models` answered and lists the configured model. The time of the check is shown. Answering a chat request does **not** count as a health check. |
| **Unreachable** | The last health check failed. Rule-based answers are in use. |

A health check runs once at server start, and on demand from the admin page ("Check model now").

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

## 7. Rollout checklist

**Phase 0: merge (everything off)**
- [ ] #152 merged first, or merged together with this PR. Assistant links target `?screen=book&mode=driver` and `?screen=track&ride_id=`, which work with and without #152; with #152 they open the separate booking and tracking screens.
- [ ] Deploy. Confirm `GET /api/agent/status` shows `assist_available: false` and that the launcher does not appear on the rider or driver dashboards.
- [ ] Confirm the admin page shows model status **Disabled** (rules-only).
- [ ] Booking, payment and dispatch smoke tests pass, unchanged.

**Phase 1: assistance and recommendations (no automation)**
- [ ] Turn on **Rider & driver assistance** from `/admin-agent.html`.
- [ ] Phone checks on iOS and Android:
  - the launcher sits above the bottom navigation;
  - the 911 banner stays visible;
  - the input stays above the keyboard;
  - the launcher is hidden while the assistant is open.
- [ ] Ask the assistant for an emergency, a refund and a dispute. Each opens a case, and the case appears in the admin queue.
- [ ] Use **Recommend drivers** on a real stalled ride. Check the exclusion reasons against the driver records.
- [ ] Two weeks of `agent.decision` review: no ungrounded answers, and no personal data in the logs.

**Phase 2: shadow mode**
- [ ] Turn on **Shadow mode**. For two or more weeks, compare each `agent.shadow_decision` with what dispatchers actually did.
- [ ] Written sign-off on agreement and safety.

**Phase 3: automation (not part of this release)**
- [ ] Only after sign-off: the elevated admin enables **Automation** and **Automatic redispatch**, and turns shadow mode off.
- [ ] Practise the kill switch: engage it with a stalled test ride queued, then confirm it is not dispatched and the ride is unchanged.
- [ ] Monitor `agent.action_executed` and check its `verified` fields.

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
- **Everything, with Postgres 16 and Chromium** (`HARVEY_TEST_DATABASE_URL`, `HARVEY_REQUIRE_DB_TESTS=1`, Playwright): **55 suites, 1268 passed, 0 skipped, 0 failed.**
- **CI-style, no database or browser:** 1153 passed, 115 skipped (the DB and browser suites).
- **Combined with #152** (this branch applied on top of `claude/rider-dashboard-home`): **58 suites, 1300 passed, 0 skipped, 0 failed.**
- `lib/agent/agent.test.js` (52): flags and modes, rules, escalation, sanitizing and redaction, recommender, stalled-ride planning, the model client and health check (disabled / not checked / healthy only with the model listed / unreachable), the output guard, scoped tools, assistant behavior and audit records.
- `test/server.agent-manager.test.js` (37): routes, permissions, escalation cases, recommendations being read-only, shadow mode, gated automation, cooldown and pause.
- `test/server.agent-safety.test.js` (19):
  - every admin route is protected (enumerated);
  - 6 kinds of missing or forged credentials on 8 agent admin routes;
  - unauthenticated callers can't disable assistance or engage the kill switch;
  - the kill switch stops queued rides mid-sweep, and a ride stopped between claim and dispatch is handed back unchanged;
  - turning automation off, or a failed flag read, also stops queued work;
  - two instances sweeping at once dispatch once;
  - the cooldown survives a restart;
  - one case per exhausted ride across instances;
  - a crash after the claim is left for stuck-redispatch recovery;
  - model status reads not checked, then unreachable.
- `test/agent-manager.browser.test.js` (7, Playwright):
  - admin page on desktop and phone, and the signed-out notice;
  - rider status, cancel confirmation and the emergency flow;
  - driver earnings;
  - the launcher hidden when the flag is off;
  - **phone layout:** the launcher doesn't overlap the bottom navigation and is hidden while the assistant is open; the 911 banner stays outside the scrolling list; the input stays on screen in a 390×480 viewport;
  - **links:** "Track ride" goes to `?screen=track&ride_id=…`, and "Open booking" opens the booking screen.
- **Screenshots** (`docs/screenshots/ai-agent-manager/`) use fixture data only. Every image carries a "TEST FIXTURE DATA" watermark and a "TEST DATA - NOT LIVE" tag; names and IDs are `TestDriver …` and `TEST-RIDE-…`. The admin page shows only what the admin API returns and contains no built-in sample data.
