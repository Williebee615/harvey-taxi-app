# Harvey Taxi Operations Assistant

**Status: implemented, behind flags that default off.** It adds no OpenAI or Anthropic dependency, purchases no hosting, and takes no autonomous production actions. Every platform action needs a person's approval: the rider in the app, or staff in the command center. Rule-based reasoning is the whole engine; a self-hosted model is optional, and only rephrases.

## Dependencies

| PR | Why it is needed |
|---|---|
| **#152** (rider dashboard / booking / tracking) | Rider-facing links to the booking and tracking screens; the rider cancels through the existing cancel route, which the assistant then verifies. |
| **#153** (AI Agent Manager, rules-only) | **Required: this PR is stacked on it.** It reuses #153's flags and kill switch, scoped tools, recommender, escalation boundaries, output guard, self-hosted model client and audit records. |
| #155 (payment records) | Optional. Without it there is no `payments` row, and payment investigations report "payment record missing" from the ride's own payment fields. With it they also read the record. |

Merge order: **#152 → #153 → this PR**. Then apply the `agent_ops_cases` migration, which is not applied by this PR.

## What it does

1. **Complex case reasoning.** It splits a multi-part report ("the driver never came, the app said he arrived, and I was charged $24.50") into issue types and specific claims:
   - issue types: missed pickup, incorrect location, stalled dispatch, scheduling conflict, payment discrepancy, delivery problem;
   - claims: the driver did not arrive; the app showed arrived; the amount charged; the scheduled time; items missing.

   It then:
   - asks follow-up questions only for information the records can't supply (which ride, the amount seen, the scheduled time, where the rider waited);
   - checks each claim against the records;
   - proposes a resolution.

   Implementation: `lib/ops/intake.js`, `lib/ops/analyzers.js`.
2. **Investigation tools.** The tools are authorized and read-only (`lib/ops/evidence.js`):
   - the ride record and its timestamps;
   - dispatch attempts (`driver_offers`);
   - driver heartbeat (location freshness);
   - the payment status (ride fields plus the `payments` record);
   - the ride's audit events;
   - emergency alerts.

   Every finding is labelled as one of four kinds:
   - **verified fact**, with its source column or table;
   - **missing information**, with the reason it is missing;
   - **hypothesis**, marked "unverified", with its basis;
   - **conflict**: the report versus the records, and what that means.
3. **Plan → policy check → confirmation → execute → verify** (`lib/ops/planner.js`, `lib/ops/engine.js`). The complete action catalogue:

   | Action | Confirmed by | Runs through |
   |---|---|---|
   | Explain the finding | — | case summary only |
   | Cancel the ride (no fee) | **rider**, in the app | existing `POST /api/rides/:id/cancel` |
   | Send the ride to the next eligible driver | **staff**, in the command center | conditional claim plus the existing `dispatchRide()` |
   | Hand to staff | — | human-review queue |

   - **Policy is checked twice:** at planning, and again with fresh evidence at the moment of approval.
   - **Verification is a separate database read after execution.** An action that ran but cannot be seen in the records is reported as **not verified** and goes to staff. It is never claimed as a success.
   - **Concurrency:** two staff approving the same action at once results in one execution and one conflict.
4. **Case memory** (`lib/ops/caseStore.js`, table `agent_ops_cases`, migration `supabase/migrations/20261002000000_agent_ops_cases.sql`, **not applied**).
   - **What is stored:** structured summaries only (issues, claims, findings, plan, queue, state) and redacted follow-up answers. **No raw message text.**
   - **Continuity:** a second report about the same ride continues the same case.
   - **Isolation:**
     - a rider sees only cases where they are the subject, and a driver likewise;
     - their view leaves out hypotheses, conflicts, driver location evidence and internal notes;
     - a rider can never read a driver's case or vice versa;
     - a ride the person doesn't own is "not found".
   - **Retention:** `AGENT_CASE_RETENTION_DAYS` (default 90, allowed range 7–365). A purge runs every 6 hours, and staff can trigger one.
   - **Deletion:** approving an account deletion deletes that account's cases.
   - **Before the migration:** investigations still work, statelessly, and the command center says "Case memory is not installed".
5. **Self-hosted intelligence.** This is the optional phrasing layer from #153: a self-hosted runtime, with output checked by the guard. See "Model evaluation" below.
6. **Controlled authority** (`lib/ops/policies.js`).
   - **Pricing, eligibility, payment and the ride lifecycle stay authoritative.** The assistant never changes them.
   - **Approved financial limit: $0.** No refunds, credits, captures or reversals.
   - **Always escalated:** emergencies (911 first), screening, account deactivation, disputed charges, fraud, and anything outside the catalogue.
   - Riders confirm their own cancellations; drivers keep control of offers and trip steps.
7. **Command center** (`/admin-operations.html`):
   - live operations overview, from the real snapshot;
   - case list with **Investigating / Awaiting confirmation / Resolved / Needs human review** states;
   - case detail: decision summary, the 6-step workflow, facts, conflicts, missing information, hypotheses, trip timeline, plan and actions, policy checks, policy references, investigation tools used;
   - action queue with approve/reject, and agent activity from the real audit log.

   It respects reduced-motion settings, has a phone layout (list ↔ detail, no horizontal scrolling) and accessible labels. Every number and state comes from the API.
8. **Honest explanations.** Decision summaries are composed from the findings. Every statement cites a record or is labelled unverified. **No confidence percentages**, and no hidden model reasoning, because there is none: decisions are rules.

## Data the investigations can and cannot use (verified 2026-10-01)

- **Used:**
  - `rides` (status, timestamps, fares, payment fields, delivery fields);
  - `driver_offers`;
  - `drivers` (current location and its age);
  - `payments` (needs #155);
  - `audit_logs` for the ride;
  - `emergency_alerts`;
  - `system_flags.dispatch_paused`.
- **New evidence (this PR):** each driver status change (en route, arrived, start, complete) now logs **distance to the pickup or drop-off and the age of the driver's location**. No coordinates are logged. This is what lets "the app said arrived but nobody came" be checked.
- **Not available:**
  - `trip_events`, `driver_locations`, `support_cases`, `incident_reports` and `notification_logs` exist, but **the server never writes them** (0 rows in production).
  - `support_cases` and `incident_reports` key rides by `uuid`, while `rides.id` is text, so they could not link to rides anyway.
  - Driver location **history** is not stored. For rides before this PR, "where was the driver when they marked arrived" is reported as missing.
  - Rider wait time is not stored.
  - Item-level delivery contents are not stored.

## Quality benchmark (rules engine)
`node scripts/ops-benchmark.js` runs **36 labelled synthetic cases** through the real engine; it also runs in CI as `lib/ops/ops.test.js`. The cases are in `test/fixtures/opsScenarios.js`.

| Measure | Result |
|---|---|
| Cases fully correct | **36/36** |
| Issue categories | 29/29 |
| Decision boundaries (emergency, fraud, dispute, refund, account) | 36/36 |
| Case state | 27/27 |
| Conflicts detected | 13/13 |
| Proposed actions | 13/13 |
| Never queues a forbidden action (refund, credit, capture, completion, suspension) | 36/36 |
| Latency, engine only, in-memory data (this sandbox, 4 vCPU) | p50 0.4 ms, p95 3.3 ms |

**Read these numbers carefully:**
- The rules and the 30 original cases were written by the same author. The benchmark measures consistency on known patterns, **not real-world accuracy**.
- **Two failures were found and fixed during development:**
  - B06: "can't **I** get a driver" (word order).
  - B35, a held-out case: "my groceries never arrived" was read as a missed pickup.
- The six held-out cases (B31–B36) were written **after** the B06 fix and before re-running. **First held-out result: 5/6.** After the B35 fix: 6/6.
- With a real database, each investigation adds about 6–8 indexed reads. That cost has not been measured against production.
- **Before claiming production readiness:** run the assistant in shadow on real, consented support cases, with staff grading the output. That is not done yet.

## Model evaluation (optional layer)
- **Harness:** `scripts/model-benchmark.js` measures, against **any self-hosted endpoint** that serves `/v1/chat/completions`:
  - health;
  - latency p50 / p95 / max;
  - completion tokens per second;
  - guard acceptance rate and rejection reasons.

  It runs over the 36 cases.
- **Measured in this environment:**
  - **No model has been measured.** The sandbox's network policy blocks `huggingface.co` (proxy 403), so no model weights could be downloaded, and no hosting was purchased.
  - The harness itself was validated against a local stub runtime that echoes the draft. That run is a harness check, not a model result.
  - **That run found a real false positive in #153's guard:** a rule-written "Nothing has been charged" was rejected as a claimed action. It is fixed here and in #153; phrases already in the trusted draft are allowed.
- **Candidates** (licenses verified 2026-10-01 from the publishers):

| Model | License | Q4_K_M weights | Expected fit (estimates, not measured) |
|---|---|---|---|
| Qwen2.5-1.5B-Instruct | Apache-2.0 | ~1.0 GB | CPU-only; about 10–20 tokens/s on 2 vCPU / 4 GB, so roughly 5–10 s for a 100-token reply. |
| Phi-3.5-mini-instruct (3.8B) | MIT | ~2.2–2.4 GB | 4 vCPU / 8 GB; about 6–12 tokens/s. |
| Qwen2.5-7B-Instruct | Apache-2.0 | ~4.7 GB | 8 GB+ RAM or a GPU. |
| ~~Qwen2.5-3B-Instruct~~ | Research license | — | **Not for commercial use.** |

- **Hosting options** (Render published list prices; none purchased):
  - Pro (2 CPU / 4 GB): **$85/month**.
  - Pro Plus (4 CPU / 8 GB): **$175/month**.
  - A comparable VPS: get a quote.
  - The existing web service must not host the model.
- **To measure:** allow `huggingface.co` in the environment's network settings, or run the harness on any machine that can reach a self-hosted runtime:
  ```
  AGENT_LLM_BASE_URL=http://<host>:8080/v1 AGENT_LLM_MODEL=<model> node scripts/model-benchmark.js --runs 3 --out results.json
  ```
- **Recommendation:** stay rules-only. Consider a model only if staff grading during shadow mode shows the rule-written wording is a problem, and only after a measured run on the chosen hardware.

## Flags (all default off)

| Flag | Effect |
|---|---|
| `ops_assistant_enabled` | Rider and driver case routes (`/api/ops/rider|driver/cases`). |
| `ops_actions_enabled` | Staff approval may execute "send the ride to the next eligible driver". **Off:** approval returns "execution is currently off" and the case is unchanged. |
| `agent_kill_switch` (from #153) | Blocks execution immediately. |

Admin investigation (`/api/admin/ops/*`) is read-only and needs admin sign-in. It is covered by #153's test that enumerates every admin route.

## End-to-end demonstration
Run `node scripts/ops-demo.js`; the output is in `docs/agent-operations/demo-transcript.md`. It uses **labelled test cases only**, with an in-memory database and no external services.
1. **TEST CASE 1, complicated report** (missed pickup, plus "the app said arrived", plus a charge):
   - investigated: 7 verified facts, 2 conflicts, 2 missing items, 2 labelled hypotheses;
   - finding: the driver marked arrived 1.42 mi from the pickup point, and the "charge" is an uncaptured hold;
   - the rider is offered a no-fee cancellation and confirms it in the app; the assistant **verifies it from the ride record**;
   - driver conduct goes to staff.
2. **TEST CASE 2, authorized action verified:**
   - stalled paid ride; plan: redispatch (staff confirmation);
   - staff approve; it runs through `dispatchRide()`;
   - **verified** from the database: 1 pending offer to the free test driver; case resolved;
   - a second approval is refused (409).
3. **TEST CASE 3, escalation:**
   - a disputed double charge goes to **Needs human review**, with no assistant action and the $0 financial limit cited;
   - staff resolve it with a recorded resolution.

Screenshots (fixtures, watermarked "TEST FIXTURE DATA"): `docs/screenshots/agent-operations/`.

## Rollout
1. Merge #152, then #153, then this PR, with all flags off.
2. Apply `agent_ops_cases`, with owner approval.
3. Staff use `/admin-operations.html` to investigate real reports (read-only). **Grade the decision summaries for 2+ weeks.** This is the real benchmark.
4. Turn on `ops_assistant_enabled` for riders and drivers.
5. Only after grading: turn on `ops_actions_enabled`. Every execution still needs a staff approval.

**Rollback:**
- Turn the flags off; this is immediate.
- Revert the PR; the transition-evidence change is metadata-only.
- Drop `agent_ops_cases` if needed; the rollback SQL is in the migration file.
