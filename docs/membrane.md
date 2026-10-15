# Membrane: Harvey Taxi's own model (vector search, RAG, LoRA/QLoRA)

**Status:** for owner review, prepared 2026-10-15. **Everything is off by default.** No migration is applied, no GPU is rented, and no model is served.

**Owner decisions (2026-10-15):**
1. Own model, no AI vendor.
2. Vector search and RAG first.
3. Fine-tuning data: published pages and synthetic Q&A only.
4. GPU: quotes first; nothing is rented without approval.

**Labels:** **[Verified]** = tested in this environment. **[Secondary]** = third-party price sources (the providers' own pages weren't reachable). **[Unverified]** = needs a real model, which this environment can't download.

---

## 1. What "membrane" means here

The membrane is **one model service Harvey Taxi runs itself**. Any standard open-source runtime works: llama.cpp server, vLLM, Ollama, or Hugging Face Text Embeddings Inference. It speaks the common OpenAI-compatible request shape, so the runtime can be swapped without code changes.
- **Now:** it serves **embeddings** for vector search.
- **Later:** the same service serves the **LoRA/QLoRA fine-tuned model** that writes answers.

```
Visitor ─▶ Harvey Taxi web server (Render)
              ├─ keyword search (BM25, in process)            ─┐
              ├─ vector search ─▶ membrane /v1/embeddings      ├─ fused (RRF) ─▶ permission filter ─▶ quoted answer + sources
              │                   (our server only)            ─┘
              └─ later: membrane /v1/chat/completions (our LoRA model) ─▶ citation checker ─▶ answer
```

**No vendor, enforced in code** (`lib/membrane/config.js`):
- The membrane address must be a private address (localhost, a private network, a Render private service), or a public host we list as ours in `MEMBRANE_ALLOWED_HOSTS`.
- Hosted AI APIs are **always refused, even if listed**: OpenAI, Anthropic, Google, Cohere, Mistral, Together, Groq, Voyage, Fireworks, DeepSeek, xAI, Perplexity, Replicate, Hugging Face and AWS.

## 2. Vector search and RAG (built in this PR)

| Piece | Behavior | Status |
|---|---|---|
| `lib/membrane/embeddings.js` | Calls our runtime only. Normalizes vectors and checks their size. 1.5 s timeout. Opens a circuit after 3 failures (no calls for 60 s). Supports E5/BGE query and passage prefixes. | [Verified, tests] |
| `lib/assistantPilot/vectors.js` | Vector index per organization. **Memory store** (default; ~31 and ~65 passages, so a scan is under 1 ms) or **pgvector store**. Reciprocal rank fusion. | [Verified, tests] |
| `retrieveHybrid` | Keyword and vector rankings fused. Vector hits below `MEMBRANE_MIN_SIMILARITY` are dropped, so off-topic questions still get "not covered". Hits whose passage changed since embedding (version mismatch) are ignored. Another organization's store or passage can never be used. **Any membrane failure falls back to keyword retrieval with identical answers.** | [Verified, tests] |
| Server | Per-organization flags `assistant_pilot_<org>_vectors_enabled` (off). Also requires `MEMBRANE_BASE_URL`, `MEMBRANE_EMBED_MODEL` and a calibrated `MEMBRANE_MIN_SIMILARITY`. The index builds in the background, so a turn never waits for it; a failed build is retried after 5 minutes, not per request. | [Verified, tests] |
| Migration `20261015020000` (**not applied**) | Installs pgvector (0.8.0 offered by Supabase; it doesn't change existing tables). Adds `assistant_passage_embeddings` (384-dim, HNSW cosine index, organization check, server-only) and `match_assistant_passages` (one organization and model only). | [Verified, local Postgres + pgvector 0.6] |
| `scripts/assistant-vector-sync.js` | Fills the pgvector store from the published pages. Dry run by default; skips unchanged passages. | Written; needs a membrane |
| `scripts/membrane-calibrate.js` | 19 labeled paraphrase questions (including 4 out-of-scope). Compares keyword vs hybrid, suggests the threshold. | Written; needs a membrane |
| CI | The database job installs pgvector in its Postgres container. | Runs on push |

**Proven with a deterministic test embedder:** the paraphrase "how long does it take?" now finds "within five business days", which keyword search misses, and the answer cites the source. This proves the pipeline only; real quality needs the calibration run.

**[Unverified] Real model:** the recommended model is `intfloat/multilingual-e5-small`:
- 384 dimensions, matching the migration;
- MIT license (to re-confirm when downloading);
- multilingual, which matters for HTAF's 16 languages.

Its weights, and every alternative tried (including WordLlama, whose tokenizer also downloads from Hugging Face), come from **huggingface.co, which this environment's network policy blocks**. Once the host is allowed, or a membrane is running, run `scripts/membrane-calibrate.js` and set the threshold from its output.

## 3. LoRA / QLoRA (pipeline built; training not run)

| Piece | What it does |
|---|---|
| `scripts/membrane-build-dataset.js` | Builds training data **only from published pages**, in the exact RAG prompt format production uses. Targets quote and cite the sources; there are "not covered" examples and examples with injected instructions inside a source. **Every target must pass the production citation checker or the build fails.** It caught one wording problem during development. Whole sources are held out for evaluation. Reproducible (seeded). |
| `training/membrane/train_lora.py` | `--mode lora` (bf16) or `--mode qlora` (4-bit NF4 plus LoRA). Rank 16, all attention and MLP projections, loss on the answer only. Saves the **adapter only** (tens of MB). `--predict` writes held-out answers. Pinned `requirements.txt`. |
| `scripts/membrane-score-predictions.js` | Scores the fine-tuned model's held-out answers with the production citation checker, a grounding check (cited sentences must match their source) and the "not covered" rate. Exits non-zero below the bar (default 90%). |

**[Verified 2026-10-15]** Current dataset: **139 training and 72 held-out examples**.
- Harvey Taxi: 62 grounded, 6 not-covered and 6 injection examples.
- HTAF: 126 grounded, 6 not-covered and 5 injection examples.
- No held-out passage appears in any training example, not even as a distractor. A test enforces this, and it caught a leak during development.
- The scorer passes all 72 reference answers and fails a planted bad answer.

**Known limit:** Harvey Taxi has only 3 published sources, and the seeded split holds out 2 of them (Support, Terms), so its training examples come from the Privacy page alone. More published pages, or staff-written questions, would balance this.

**What fine-tuning would and would not do:**
- LoRA teaches a small open model the **behavior**: answer only from the sources, cite them, refuse private topics, say "not covered", ignore injected instructions.
- **Facts still come from RAG**, so a page edit takes effect without retraining.
- Templated questions are a starting point. Better results need a person (staff) to write and review paraphrased questions; this is the main quality lever.

**Base model:** a small open-weight instruct model (1.5B–8B) with a permissive license, e.g. an Apache-2.0 Qwen2.5 Instruct model. **[Owner decision at training time]** Re-check the license and newer releases before choosing.

## 4. GPU and hosting quotes **[Secondary — confirm on each provider's page before approving]**

| Need | Option | Price found | Source |
|---|---|---|---|
| Training (one QLoRA run on ~200–2,000 examples; estimate 1–3 GPU-hours for a ≤8B model) | RunPod L4 / A40 (Secure Cloud) | ≈ $0.49/hr each; A100 ≈ $1.59/hr | [usagepricing.com](https://www.usagepricing.com/blueprint/runpod), [memetik.ai](https://www.memetik.ai/guides/runpod-pricing) (Sept 2026) |
| | RunPod RTX 4090 (24 GB) | ≈ $0.74/hr Secure; ≈ $0.34/hr Community | same |
| | Modal L4 (per-second billing) | ≈ $0.80/hr; Starter plan includes $30/month in credits | [computeprices.com](https://computeprices.com/providers/modal/gpus/l4), [devtune.ai](https://devtune.ai/verticals/aiml-infrastructure-llm-tools/modal/pricing) |
| **Estimated training cost** | 1–3 hrs × $0.49–$0.80 | **≈ $0.50–$2.50 per run (estimate)**, plus a few dollars of storage | derived |
| Embeddings only (CPU) | Render private service, Standard (2 GB) or Pro (4 GB) | ≈ $25/month or $85/month | [jwatte.com](https://jwatte.com/blog/render-com-platform-review/), [temps.sh](https://temps.sh/blog/render-pricing-2026) (mid-2026) |
| Serving the fine-tuned model, always on | RunPod L4 at $0.49/hr × 730 hrs | **≈ $360/month (estimate)** | derived |
| Serving, scale to zero | Modal L4, billed per second; idle costs nothing, but expect cold starts | Depends on traffic | derived |

**Note:** the estimates are arithmetic on secondary prices, and Render's GPU availability is unverified. The fixed cost of always-on serving is far above today's $10/month assistant budget, which is why serving is a later decision.

## 5. Recommended order (each production step needs your approval)
1. **Merge this PR.** Everything stays off.
2. **Embeddings membrane:** a CPU Render private service running Text Embeddings Inference or llama.cpp with `multilingual-e5-small`, about $25/month (secondary price). Alternatively, first allow `huggingface.co` in this environment so I can calibrate locally at $0.
3. Run `membrane-calibrate.js`, set `MEMBRANE_MIN_SIMILARITY`, then enable vectors for **one organization**.
4. Write and review 200+ paraphrased questions (staff), rebuild the dataset.
5. **One QLoRA training run** on a rented GPU (≈ $0.50–$2.50 estimated). It ships only if the scorer passes the bar.
6. **Serving decision** (scale-to-zero vs always-on) with a measured traffic estimate.

## 6. Rollback
- Turn the vectors flag off; it takes effect on the next request.
- Unset `MEMBRANE_BASE_URL`.
- The pgvector table is an index of public text only; it can be dropped and rebuilt any time:

  ```sql
  drop table public.assistant_passage_embeddings;
  drop function public.match_assistant_passages;
  ```
