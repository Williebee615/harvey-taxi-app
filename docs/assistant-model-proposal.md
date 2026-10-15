# Assistant model proposal: Anthropic data flow and terms review

**Status:** proposal for owner review, prepared 2026-10-15. **Model activation stays off.** Both assistant pilots are quote-only (no external calls). That was verified 2026-10-14 by a live test and by `test/server.assistant-pilot-no-provider.test.js`.

**Labels:**
- **[Verified-official]:** read on Anthropic's own page today.
- **[Secondary]:** third-party sources only; Anthropic's own page was not reachable from this environment.
- **[Owner to confirm]:** visible only in your Anthropic Console or contract.

---

## 1. What would be sent, and when

Only when model mode is switched on for an organization. That needs four things:
- the `assistant_pilot_<org>_model_enabled` flag set to `true`;
- `ASSISTANT_PILOT_MODEL_APPROVED=true` on Render;
- the usage-ledger migration applied;
- budget remaining.

| Sent to Anthropic per answer | Not sent |
|---|---|
| A fixed system prompt (rules and organization name) | Visitor identity, account, email or phone (except what the visitor types), IP address, cookies, user agent |
| Up to 4 retrieved passages from **published public pages** | Any database record: applications, drivers, rides, payments, locations, background checks, ID documents |
| The visitor's message (≤1,000 characters) and up to 8 recent turns from their page (≤1,200 tokens), cleaned | Credentials other than the API key in the request header |

**Gap: visitors can type personal details** (a name, a phone number, a medical appointment) into a public chat. Today:
- private-record questions (application status, background checks, payments, location) are stopped before any model call;
- other free text would be sent as typed.

**[Recommendation]** Before model mode:
- (a) mask email addresses and phone numbers in the message before sending, as the HTAF assistant already does for its gap log;
- (b) add a short notice beside the input: "Don't include personal or medical details";
- (c) update each organization's privacy notice to name the AI provider.

---

## 2. Anthropic terms

| Topic | What the terms say | Source and status |
|---|---|---|
| **Training on our data** | "Anthropic may not train models on Customer Content from Services." | Commercial Terms §B, effective June 17, 2025 **[Verified-official]** ([anthropic.com/legal/commercial-terms](https://www.anthropic.com/legal/commercial-terms)) |
| **Ownership** | The customer "retains all rights to its Inputs" and "owns its Outputs." | Commercial Terms §B **[Verified-official]** |
| **Confidentiality and deletion on request** | Customer Content is the customer's Confidential Information. The recipient "will destroy Discloser's Confidential Information promptly upon request", except data "retained to comply with law or copies in Recipient's automated back-up systems." | Commercial Terms §E.1, §E.4 **[Verified-official]** |
| **Standard API retention** | API inputs and outputs are kept up to **30 days**, then deleted, unless longer is needed for legal reasons or usage-policy enforcement. | **[Secondary]**: [The Register, 2026-09-02](https://www.theregister.com/ai-and-ml/2026/09/02/anthropic-promises-zero-data-retention-but-customers-must-check-it-worked/5293789); [Voibe](https://www.getvoibe.com/resources/claude-api-data-retention/). Anthropic's privacy-center article was not reachable. |
| **Zero data retention (ZDR)** | Available by agreement and approval, per organization, not self-serve. Your setting appears under Console → Settings → Privacy Controls → Data retention period. | **[Secondary]**: [Anthropic privacy center article (search summary)](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to). **[Owner to confirm]** in the Console. |
| **Safety-flagged content** | Even under ZDR, safety-classifier results and flagged content may be kept longer; one vendor reports up to 2 years. One source says some newest models require 30-day retention even under ZDR. | **[Secondary]**, conflicting: [Harriet](https://harriethq.com/blog/zero-data-retention/), [IntuitionLabs](https://intuitionlabs.ai/insights/guides/zero-data-retention-claude-anthropic-life-sciences) |
| **Consumer privacy policy** | It "does not apply to content that we process on behalf of customers of our business offerings", which are governed by the customer agreements. | Anthropic Privacy Policy, effective Sept 10, 2026 **[Verified-official]** ([anthropic.com/legal/privacy](https://www.anthropic.com/legal/privacy)) |
| **Data Processing Addendum (DPA)** | Referenced by the Commercial Terms §C. | `anthropic.com/legal/dpa` returned 404 today. **[Owner to confirm]** that the DPA is accepted for your organization. |
| **Subprocessors** | The official list moved to `trust.anthropic.com/subprocessors`, which wasn't reachable from here. A search summary names Google Cloud Platform, Cloudflare, Sentry, Stripe, Metronome, Intercom and Sift, among others. | **[Secondary]** ([anthropic.com/subprocessors](https://www.anthropic.com/subprocessors)). Review the current list before activation. |

**How this meets your retention policy (§5, external providers):**
- The policy requires documented handling, retention and deletion terms before any provider receives data.
- Training and deletion-on-request are documented officially.
- The **30-day provider retention** and **longer retention of flagged content** exceed "no persistent storage" for public conversation text. They need either a ZDR agreement or a **documented exception approved by you**.

---

## 3. Why Anthropic, compared with the existing provider plan

| | Anthropic (proposed) | Existing plan: Claude Haiku 4.5 for Harvey Assistant | Legacy OpenAI chat | Self-hosted open-weight model |
|---|---|---|---|---|
| Status | Proposal for the assistant preview | **[Owner decision 2026-10-04]** approved for synthetic and review test accounts only, $10/month cap | Code remains (`OPENAI_API_KEY`, `/api/ai/support`); **[Owner decision]** not to be restored without approval. The OpenAI HTAF triage was removed in #237. | Client exists (`lib/agent/llmClient.js`), off |
| Integration | Same Anthropic account, SDK, budget ledger and spend controls as the existing plan | — | Separate vendor and terms to review | Needs a GPU host |
| Training on our data | Contractually prohibited | Same | Not reviewed here | None (our server) |
| Data retention at provider | Up to 30 days unless ZDR (secondary) | Same | Not reviewed | Ours |
| Extra vendors | None beyond the one already approved | — | Adds a second AI vendor | Adds a hosting vendor |
| Cost | Pennies per month at current volume (§4) | Same ledger, shared $10 cap | — | Fixed monthly GPU cost; not practical at this volume |

**Why Anthropic:**
- It is the provider you already approved (4 October) for the existing assistant.
- Using it again adds **no new processor**.
- It reuses the database-enforced budget, the spend-limit handling and the audited client code.
- Its terms forbid training on our content.

**Main open issue:** retention at the provider (§2).

---

## 4. Model choice and cost

**[Verified-official]** prices from [claude.com/pricing](https://claude.com/pricing), read 2026-10-15, per million tokens:

| Model | Input | Output | Typical answer (2,500 in / 150 out) | 1,500 answers/month |
|---|---|---|---|---|
| Haiku 4.5 (currently approved) | $1.00 | $5.00 | ≈ $0.0033 | ≈ $4.90 |
| **Haiku 5.5** (current small model; ≤100K-token prompts) | $0.10 | $0.50 | ≈ **$0.0003** | ≈ **$0.49** |

**[Recommendation]** Use Haiku 5.5 for the assistant preview if its retention terms match Haiku 4.5's. It is about 10× cheaper per answer. Switching needs:
- a code change: add its price row to `lib/agent/modelBudget.js`, which today prices only `claude-haiku-4-5` and reserves conservatively;
- an evaluation run on synthetic questions.

Either model stays far under the existing $10/month ceiling.

---

## 5. What I recommend before any activation

1. **[Owner to confirm]** in the Anthropic Console:
   - the organization's data-retention setting, and whether ZDR applies;
   - DPA acceptance;
   - a workspace spend limit at or below $10.
2. Decide on the retention exception: accept 30-day provider retention, or request ZDR.
3. Code before activation:
   - mask emails and phone numbers in visitor messages;
   - add the input notice;
   - add the Haiku 5.5 price row (if chosen);
   - apply migration `20261014070000`.
4. Privacy notices: add one sentence per organization naming the AI provider for the assistant preview (counsel review).
5. Staging evaluation: run the 40-question set per organization (architecture doc §16) with the model, and measure accuracy, citations and latency.
6. Only then set the server approval and one organization's model flag.
