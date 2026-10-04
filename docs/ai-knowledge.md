# Harvey Assistant: approved knowledge and phased plan

The rider and driver assistants share one backend: `lib/agent/` (Agent Manager) plus `lib/knowledge/` (this document).
- Riders and drivers get separate permissions and tools.
- Live trip, payment, earnings and hours data come only from authenticated server routes.
- Policy answers come only from approved published pages, quoted with their source and date.

## 1. Audit of what existed (2026-10-04)

| Part | State | Reused |
|---|---|---|
| `lib/agent/escalation.js` | Keyword routing; emergency, fraud, dispute, refund, account and screening boundaries that never depend on a model; input sanitizing and redaction | Yes. Added `policy_question` and `driver_hours` topics |
| `lib/agent/tools.js` | Read-only tools scoped by role; identity always taken from the session | Yes. Added `driver_hours_shift` |
| `lib/agent/assistant.js` | Rules write every answer; actions are proposed only, the app asks for confirmation, then calls the existing route | Yes. Added knowledge answers and driver hours |
| `lib/agent/grounding.js`, `llmClient.js` | Optional *self-hosted* model may only reword a rules answer, and is discarded if it adds numbers or claims an action. Hosted OpenAI and Anthropic are refused by design | Unchanged; not used in phase 1 |
| `lib/agent/audit.js` | Every decision goes to `audit_logs`; raw messages are never stored | Yes. Added sources and gap logging |
| Driver app assistant (`driver-app/src/assistant.js`, `AssistantScreen.js`) | Quick prompts, confirmation dialogs, read-aloud, hands-free during a trip | Yes. Added sources and a "My hours" prompt |
| Rider website assistant (`public/agent-assist.js`) | Panel on the rider dashboard (also inside the rider app) | Yes. Added sources |
| `/api/ai/support` (OpenAI, `gpt-4o-mini`) | A separate, older support-triage feature | Not used |
| Production switch `agent_assist_enabled` | **Off** | Turning it on is a separate, approved step |

What was missing: approved knowledge with sources, policy questions, driver hours, conversation memory, support handoff and an evaluation set.

## 2. Phased plan

| Phase | Scope | Paid service? | Status |
|---|---|---|---|
| **1** | Policy questions from approved published pages (quoted, with source and date; gaps reported); read-only help: ride status, fare, offers, trip step, earnings, **hours**; evaluation set | None | **This PR** |
| 2 | Admin-managed knowledge: a `knowledge_articles` table (draft, approved, retired; approver and date), an admin page, conflict detection between approved articles, gap queue from `agent.decision` rows with `knowledge_gap` | None | Planned |
| 3 | Conversation context: follow-up questions use the last few turns held **on the device**; "Clear chat" and preference controls; server-side storage only after retention rules are approved (see §5) | None | Planned |
| 4 | Support handoff: the assistant drafts a summary, the user edits and approves it, then it is sent to support; the user sees a reference | None | Planned |
| 5 | Optional model wording and multi-step help, behind spending caps | **Yes** (needs your cost approval) | Not started |

Every change to state (book, cancel, change destination, account changes) stays in the existing routes. The assistant only proposes them; the user confirms; the result shown is the server's response.

## 3. How phase 1 works

1. **Safety boundaries first.** Emergency, fraud, dispute, refund, account and screening messages get fixed guidance and a human-review case. No search runs.
2. **Routing.** Policy questions, and anything that matches no other topic, go to the approved-knowledge search.
3. **Approved knowledge** (`lib/knowledge/sources.js`): the published Terms of Service, Privacy Policy and Support pages. The text is read from the deployed pages at server start, so an answer always matches the live site.
4. **Search** (`lib/knowledge/search.js`):
   - In-process keyword ranking (BM25) over 31 page sections.
   - A heading that names what was asked gets extra weight.
   - A section must contain at least 75% of the question's key terms (or close synonyms). Filler words like "policy" or "terms" don't count.
   - Below the match threshold, the answer is: *"I don't have approved Harvey Taxi information that answers that, so I won't guess."*
5. **Answer**: the matching sentences, quoted, plus the page title, section and date ("date not stated on the page" when the page gives none). Each answer also offers a Contact support link.
6. **Gaps**:
   - Each unanswered question is logged (`agent.decision`, `knowledge_gap: true`) with a 160-character excerpt.
   - Phone numbers, emails, card numbers and tokens are removed from the excerpt before it is stored.
   - This is the to-do list for adding approved answers.
7. **Driver hours**: read from the signed-in driver's own `driver_online_sessions` rows, using the same rules the server enforces (`lib/driverHours.js`).

**Not covered by any approved page yet** (the assistant reports a gap):
- cancellation fees;
- service area;
- wheelchair-accessible vehicles;
- pets and service animals;
- pricing rules;
- driver vehicle requirements.

Publishing approved text for these is the fastest way to make the assistant more useful.

## 4. Provider SDK or orchestration framework

**Decision: no new framework and no new service in phase 1.**

- **The corpus is about 3,500 words** (31 sections). Keyword ranking in-process returns in under 4 ms at p95, with **zero database queries and no paid calls**.
  - Embeddings would add a paid API call per question.
  - A vector index (pgvector) would add database load on the Free-plan instance that just had an outage.
  - For a corpus this small, neither would measurably improve accuracy.
- **LangChain (or similar)**:
  - Its value is in chaining model calls, tool calling and vector stores.
  - Phase 1 makes no model call.
  - The existing code already has the parts that matter here: tools scoped to the signed-in user, deterministic safety boundaries, an output guard and an audit trail.
  - Adding the framework would bring a large dependency tree into the Express server with nothing to show for it.
- **If phase 5 adds a hosted model**:
  - Use the provider's official SDK directly (`openai` is already a dependency).
  - Keep the existing guard: the model may only reword a rules or knowledge answer, and is discarded if it adds numbers, links or claims an action.
  - **This reverses an earlier decision.** `llmClient.js` refuses hosted OpenAI and Anthropic by design, and changing that needs your approval.

Revisit the framework question only if the evaluation shows multi-step model planning beating the rules on real questions.

## 5. Conversation memory and retention (proposed, not yet built)

- **Phase 3 starts on the device:**
  - the last 6 turns are kept in app memory and sent with the next question for follow-ups;
  - cleared by "Clear chat", by signing out and when the app restarts.
  - No conversation text is stored on the server.
- **Server-side history**, if wanted later, needs your approval of:
  - a retention period (proposed: 30 days, then deleted by a sweep);
  - redaction before storage;
  - per-role access: riders see only their own conversations, drivers only theirs, admins only through audited access;
  - deletion together with the account.
- **Saved preferences** (for example, "always read answers aloud") would be stored per account, viewable and deletable in Settings.

## 6. Evaluation (`test/agent-eval/`)

27 rider and driver questions:
- policy questions with an expected source section;
- uncovered questions that must be reported as gaps;
- live account questions;
- prompt-injection attempts;
- 4 privacy checks.

`node test/agent-eval/run.js` prints the report; `test/agent-eval.test.js` enforces it in CI.

| Metric | Result (2026-10-04) |
|---|---|
| Answer accuracy | 27/27 (100%) |
| Source correctness | 12/12 (100%) |
| Gap honesty (says "not covered", no invented answer) | 5/5 (100%) |
| Privacy isolation (own rows only; a rider cannot use driver tools) | 4/4 (100%) |
| Task completion (answered questions answered correctly) | 100% |
| Response time in-process | p50 under 0.5 ms, p95 under 4 ms (varies by run) |
| Model calls / cost per conversation | 0 / $0 |

**Caveat:** the matching threshold and heading weight were tuned on these same questions, so they overstate real-world accuracy. Add real rider and driver questions, especially failures, as they come in.

## 7. Reliability, load and cost

- **Assistant switched off or unavailable:** the apps work exactly as before. The assistant answers with "not available" and booking and trips are unaffected.
- **Database load per question:** unchanged from before (one flag read and one audit insert). Knowledge search reads no database rows. Driver hours reads one indexed query of that driver's sessions.
- **Rate limit:** 20 assistant requests per minute per client (existing).
- **No credentials** reach the apps.
- **Phase 5 cost formula:** monthly cost ≈ conversations × turns per conversation × (input tokens × input price + output tokens × output price).
  - Prices must be taken from the provider's official pricing page at the time. This session could not reach OpenAI's pricing pages (network blocked), so no figure is given yet.
  - Before enabling, set a monthly spending cap in the provider account and a server-side daily request cap.

## 8. Not yet verified

- On-device demonstrations:
  - the driver app needs a new build for the sources display;
  - the rider app shows the website panel;
  - both need `agent_assist_enabled` switched on.
- Android and iOS screenshots of both apps.
