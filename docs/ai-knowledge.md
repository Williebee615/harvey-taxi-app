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
| **1** | Policy questions from approved published pages (quoted, with source and date; gaps reported); read-only help: ride status, fare, offers, trip step, earnings, **hours**; evaluation set | None | **Deployed** (2026-10-04) |
| 2 | Admin-managed knowledge: a `knowledge_articles` table (draft, approved, retired; approver and date), an admin page, conflict detection between approved articles, gap queue from `agent.decision` rows with `knowledge_gap` | None | **Built** (see "Admin-approved articles" below) |
| 3 | Conversation context held **on the device only**, with Clear chat; no server-side history (see §5) | None | **Built** |
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

### Admin-approved articles (phase 2)

- **Where:** `/admin-knowledge.html` (admin sign-in). Stored in `knowledge_articles` (migration `20261004190000_add_knowledge_articles.sql`); server-only access, like every recent table.
- **Workflow:**
  1. An admin writes a **draft**: title, link name, the exact wording, and who it is for (riders, drivers or both).
  2. An admin **approves** it. Approval must name the version that was reviewed; if the text changed in between, approval is refused.
  3. The assistant can then quote it, and it appears on the public **`/policies.html`** page, which is the source link the assistant shows.
  4. **Any edit** returns the article to draft (version + 1). The assistant stops using it until it is approved again.
  5. **Retire** removes it from the assistant and the public page; the record is kept.
- **Audit:** every create, edit, approval and retirement writes an `audit_logs` row (`knowledge.article_*`) with the admin, slug and version.
- **Audience:** a rider-only article is never quoted to drivers, and the reverse.
- **Conflicts:**
  - On save and approval, the admin is warned about approved articles with overlapping titles.
  - When two approved sources answer a question about equally well and quote different numbers, the assistant shows the best match and adds: "Another approved Harvey Taxi source may say something different… please confirm with Harvey Taxi support."
- **Load:** approved articles are read from the database at most every 10 minutes, and right after an approval, edit or retirement. Answering a question never reads them from the database. If the read fails (for example, before the migration is applied), the assistant keeps answering from the published pages.
- **Gap queue:** the admin knowledge page and the usage dashboard list recent redacted questions no approved source covers.

### Policies still needed (owner to provide)

No approved Harvey Taxi page covers these, so the assistant says it has no approved information. The wording must come from Harvey Taxi; none has been drafted on the owner's behalf.

- Cancellation fees and refunds for cancelled rides
- Wait-time fees
- Service area (cities and counties served)
- Pricing rules beyond the fare estimate (surcharges, tolls, airport rates)
- Wheelchair-accessible vehicles and accessibility services
- Service animals and pets
- Child car seats
- Lost and found
- Driver vehicle requirements (age, type, inspection)
- Driver insurance requirements

Approving text for these is the fastest way to make the assistant more useful.

Local screenshots (test fixture data on a local test server, not production and not a device): `docs/screenshots/ai-phase2/admin-knowledge-draft.png`, `docs/screenshots/ai-phase2/policies-page-mobile.png`.

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

## 5. Conversation memory (phase 3, built: device only)

**No conversation history is stored on the server** (owner decision, 2026-10-04).

- **Driver app** (`driver-app/src/chatMemory.js`):
  - Each signed-in account's conversation is kept in app memory, so leaving and reopening the assistant keeps it.
  - **Clear chat** empties it. Signing out clears every conversation, and an app restart clears memory. Nothing is written to disk.
- **Rider website / rider app panel** (`public/agent-assist.js`):
  - The conversation lives only in the open page; nothing is saved in browser storage.
  - **Clear chat** empties it. Leaving the page or signing out (which reloads it) clears it.
- **Follow-ups** (`lib/agent/followUp.js`):
  - With each question the device sends its last 6 turns (text only, 500 characters each).
  - The server uses them for one thing: a short follow-up ("and what about my location?") is searched together with the previous question.
  - Context is sanitized like any message. It is never stored or logged, and it never chooses an account, a tool or an action.
  - Emergency and other safety checks run on the new message alone.
- **Saved preferences:** none stored yet. "Read answers aloud" stays a per-screen switch.

## 6. Evaluation (`test/agent-eval/`)

There are two question sets, reported separately:
- **Regression set** (`questions.js`, 27 questions). The matching was tuned on these, so a pass rate here shows nothing broke. It does **not** show accuracy on new questions. CI enforces 100%. Run with `node test/agent-eval/run.js`.
- **Held-out set** (`holdout.js`, 20 questions written after tuning). It is run without changing thresholds. CI enforces safety only. Run with `node test/agent-eval/run.js holdout`.

| Metric | Regression (tuned) | **Held-out baseline (2026-10-04)** |
|---|---|---|
| Answer accuracy | 27/27 | **5/20 (25%)** |
| Source correctness | 12/12 | 3/12 |
| Gap honesty ("not covered" when no page applies) | 5/5 | 1/5 |
| **Wrong policy quotes** | 0 | **0** |
| Claimed or performed actions | 0 | 0 |
| Privacy isolation | 4/4 | 4/4 |
| Response time in-process (p95) | < 4 ms | < 3 ms |
| Model calls / model and API charges | 0 / none | 0 / none |

**What the held-out set shows:**
- Keyword matching does not generalize well to new wording.
- Its failures were unhelpful, never invented:
  - 6 misroutes: questions containing "my driver" or "where" got the live ride status;
  - 5 generic help replies;
  - 3 false "not covered" replies where a page does cover the question;
  - plus one correct answer marked failed by a strict topic label.
- No answer quoted a policy that doesn't apply.

**Cost wording:** phase 1 has **no model or API charges**. It is not zero total cost: it runs on the existing Render server and Supabase database.

**Next improvement:** approved articles (phase 2, now built) for the missing policies, then a **new** held-out set. These held-out questions must not be used to tune; when one is used to fix the matcher, it moves to the regression set and a fresh one replaces it.

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
